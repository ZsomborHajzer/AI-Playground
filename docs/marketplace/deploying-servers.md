# Deploying the marketplace servers

The plugin marketplace runs on two kinds of server, each on its own VM:

- **One master server.** Publishers upload plugins to it. Reviewers approve or reject them in
  its admin pages. It signs what is approved and pushes it to the distribution servers.
- **One or more distribution servers (mirrors).** They receive signed plugins from the master
  and serve the catalog and downloads to everyone's AI Playground.

```
 publishers ──upload──▶  MASTER  ──signed push──▶  MIRROR A ──┐
 reviewers ──/admin────▶ (signs)  ──signed push──▶  MIRROR B ──┼──▶ AI Playground apps
                           ▲          (HMAC)          …       ─┘     (verify signature
                           └──── catch-up feed, download stats ◀──    against the master key)
```

**Why this is safe:** the master signs every release and the whole catalog with an Ed25519 key.
The app ships with the master's **public** key and checks every signature and every package
hash itself. A mirror therefore can't change or forge a plugin. If one is compromised, the
worst it can do is withhold updates or serve an old catalog, and the app refuses a catalog older
than one it has already seen.

The code is in [`marketplace-server/`](../../marketplace-server/). Both roles are the same
program (Node.js 24, TypeScript run directly) with a different start command.

## Requirements

|           | Master                                                              | Each mirror                                    |
| --------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| OS        | Ubuntu 24.04 LTS (any Linux with Docker works)                      | same                                           |
| CPU / RAM | 2 vCPU / 2 GB                                                       | 1 vCPU / 1 GB                                  |
| Disk      | 20 GB + every package ever uploaded (20 MB max each)                | 10 GB + published packages                     |
| Network   | Public IPv4, ports 80 and 443 open                                  | same                                           |
| DNS       | A name, e.g. `master.marketplace.example.com`                       | A name each, e.g. `eu.marketplace.example.com` |
| Software  | Docker Engine 24+ with Compose, **or** Node.js 24 + a reverse proxy | same                                           |

The master must be able to reach every mirror's URL, and every mirror must be able to reach the
master. Users only ever contact the mirrors. Publishers and reviewers contact the master.

Put mirrors in different regions or providers if you want downloads to keep working when one
goes down. The app tries mirrors in the order listed in its config.

## 1. Set up the master

On the master VM:

```bash
git clone https://github.com/ZsomborHajzer/AI-Playground.git
cd AI-Playground/marketplace-server/deploy
cp master.env.example master.env
nano master.env            # DOMAIN, MASTER_PUBLIC_URL, REGISTRATION
docker compose -f docker-compose.master.yml up -d --build
```

Caddy gets a TLS certificate for `DOMAIN` by itself, as long as the DNS name points at the VM
and ports 80 and 443 are open. Check that it's up:

```bash
curl https://master.marketplace.example.com/healthz
# {"ok":true,"seq":0,"keyId":"306f88abec3c3445"}
```

**Create the first admin (reviewer) account:**

```bash
docker compose -f docker-compose.master.yml exec master node master/adminCli.ts alice
# prompts for a password (at least 10 characters); run it again to reset a password
```

Then sign in at `https://master.marketplace.example.com/admin`.

**Settings in `master.env`:**

| Variable                       | Default                 | Meaning                                                                                                                            |
| ------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DOMAIN`                       | —                       | Host name Caddy serves and certifies.                                                                                              |
| `MASTER_PUBLIC_URL`            | `http://localhost:8080` | The URL publishers, mirrors and apps use. Must be `https://` in production; secure cookies follow from it.                         |
| `REGISTRATION`                 | `open`                  | `open`: anyone can sign up at `/register` and get a publisher token. `invite`: only admins create publishers (Admin → Publishers). |
| `MAX_UPLOAD_MB`                | `20`                    | Upload size limit. Packages can't unpack beyond 20 MB regardless.                                                                  |
| `REPLICATION_INTERVAL_SECONDS` | `15`                    | How often failed pushes are retried. Approvals push at once.                                                                       |
| `LOG_LEVEL`                    | `info`                  | `debug`, `info`, `warn`, `error`.                                                                                                  |

**The signing key** is created on first start in the data volume (`/data/keys/`).
`master-ed25519.pem` is the private key: **it never leaves the master, and it must be backed
up** (see [Backups](#backups)). Its public half is served at `/v1/public-key`.

## 2. Add a distribution server

On the master, open **Admin → Mirrors**, enter a name and the URL the mirror will have (e.g.
`https://eu.marketplace.example.com`), and click **Add**. The page shows, **once**:

- four lines for the mirror's `.env` (`MIRROR_ID`, `MIRROR_SECRET`, `MASTER_URL`,
  `MASTER_PUBLIC_KEY_FILE`), and
- the master public key.

On the mirror VM:

```bash
git clone https://github.com/ZsomborHajzer/AI-Playground.git
cd AI-Playground/marketplace-server/deploy
cp mirror.env.example mirror.env
nano mirror.env                      # DOMAIN + the lines from the admin page
nano master-public-key.pem           # paste the public key from the admin page
docker compose -f docker-compose.mirror.yml up -d --build
curl https://eu.marketplace.example.com/healthz
# {"ok":true,"mirrorId":"eu-1a2b3c","seq":0,"plugins":0,"masterKeyId":"306f88abec3c3445"}
```

`masterKeyId` must match the `keyId` the master's `/healthz` shows. Within a few seconds,
**Admin → Mirrors** shows the mirror's synced seq equal to the master's. A mirror that was
offline catches up on its own when it starts, and again every 10 minutes.

`MIRROR_SECRET` authenticates traffic between this mirror and the master (HMAC over every
request body, with a 5-minute timestamp window). If it leaks, remove the mirror in the admin
page and add it again to get a new secret.

## 3. Point AI Playground at your servers

The app reads `external/marketplace.json` (in a packaged build, `marketplace.json` in the
resources folder):

```json
{
  "mirrors": [
    "https://eu.marketplace.example.com",
    "https://us.marketplace.example.com"
  ],
  "masterUrl": "https://master.marketplace.example.com",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA…\n-----END PUBLIC KEY-----\n"
}
```

- `mirrors`: tried in order. The first one that returns a catalog with a valid signature wins.
- `masterUrl`: used only for publishing (token check, uploads, submission status).
- `publicKeyPem`: the master public key, exactly as `/v1/public-key` returns it. This is the
  app's trust anchor. Ship it with the app; never fetch it at runtime.

With `mirrors` empty, the marketplace shows sample listings and simulates installs. That is
the default in this repository.

## Operations

**Monitoring.** Watch `GET /healthz` on every server (Docker also runs it as a healthcheck).
On the master, **Admin → Mirrors** shows each mirror's synced seq, last contact and last error.
A mirror behind the master's seq is either down or rejecting batches; its log says which.

**Logs.** `docker compose -f docker-compose.<role>.yml logs -f <master|mirror>`.

**Reviewing.** Admin → **Review queue**. Each submission shows the automated checks, a diff
against the last published version, every preset's JSON, the README and the file list. Approve
as **Community** or **Verified** (Verified needs a publisher you verified under Admin →
Publishers), request changes, or reject. Notes are shown to the publisher.

**Revoking.** Admin → **Published** → _Revoke_ with a reason. Mirrors stop serving that
version (HTTP 410), it leaves the catalog, and apps disable it and show the reason.

**Publisher tokens.** They are stored hashed. Admin → Publishers → _New token_ replaces a lost
or leaked one; _Disable_ blocks a publisher.

### Backups

| Server | Back up                                                                    | Why                                                                               |
| ------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Master | The whole `master-data` volume: `master.sqlite*`, `packages/`, **`keys/`** | Everything lives here. Without `keys/`, apps reject anything you sign afterwards. |
| Mirror | Nothing essential                                                          | A new, empty mirror catches up from the master.                                   |

For example, nightly:

```bash
docker compose -f docker-compose.master.yml exec master sh -c \
  'cd /data && tar czf - master.sqlite* packages keys' > master-backup-$(date +%F).tgz
```

Store copies off the VM and encrypted: they contain the private signing key.

### Upgrades

```bash
git pull
docker compose -f docker-compose.<role>.yml up -d --build
```

The database migrates itself on start. Upgrade the master first, then the mirrors.

### If the signing key is lost or leaked

The app trusts exactly one master public key, the one in its `marketplace.json`, and every
stored release is signed with the old key. There is no in-place key rotation yet. Starting over
with a new key means:

1. Keep the old data volume as a backup (it has the submission history), then start the master
   on a **fresh** data volume. It generates a new key and an empty catalog.
2. Re-register the mirrors on the new master (new secrets) and give them an empty data
   directory.
3. Ship an AI Playground update whose `marketplace.json` has the new `publicKeyPem`.
4. Publishers register again (or you recreate them under Admin → Publishers) and upload their
   plugins again, keeping their version numbers. Approve them as before.

Plugins users already installed keep working. Until users update the app, they reject the new
catalog, which is what you want if the old key leaked.

## Without Docker

[`deploy/systemd/`](../../marketplace-server/deploy/systemd/) has units for both roles: a
dedicated user, data in `/var/lib/aipg-*`, and `ProtectSystem=strict`. Install Node.js 24,
put `marketplace-server/` in `/opt/aipg-marketplace`, run `npm ci --omit=dev` there, and put a
reverse proxy that terminates HTTPS in front of port 8080 (master) or 8090 (mirror). The
comment at the top of each unit lists the exact steps. The bundled `Caddyfile` works with a
system-wide Caddy too.

## Trying it on one machine

For development, `npm run dev:cluster -- --seed` in `marketplace-server/` runs a master and two
mirrors on `127.0.0.1:7480–7482`. It creates an admin (`admin` / `dev-cluster-password`) and a
verified publisher, publishes the two example plugins, and writes
`WebUI/external/marketplace.local.json`, so `npm run dev` uses the cluster right away. It has no
HTTPS and a fixed password; never expose it.

## Troubleshooting

| Symptom                                                           | Cause                                                                                                                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App: "no server answered with a catalog that passed verification" | Wrong `publicKeyPem` in the app, mirrors unreachable, or a mirror with no catalog yet (`503`). Check each mirror's `/healthz` and compare `masterKeyId`. |
| Mirror log: `rejected index: signed by an unknown key`            | The mirror's `master-public-key.pem` is not the master's key.                                                                                            |
| Admin → Mirrors shows `HTTP 401`                                  | `MIRROR_ID`/`MIRROR_SECRET` don't match, or the clocks differ by over 5 minutes (run NTP).                                                               |
| Mirror stuck behind the master's seq                              | It can't fetch packages from `MASTER_URL`. Check DNS and HTTPS from the mirror to the master.                                                            |
| Upload refused with `policy/namespace`                            | The plugin id doesn't start with the uploader's publisher id.                                                                                            |
| Caddy has no certificate                                          | DNS doesn't point at the VM yet, or ports 80/443 are blocked.                                                                                            |
