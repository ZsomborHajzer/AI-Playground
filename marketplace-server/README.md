# AI Playground marketplace servers

The backend of AI Playground's plugin marketplace: one **master** server that takes uploads,
runs review and signs what is approved, and any number of **distribution servers (mirrors)**
that serve the signed catalog and packages to apps.

| Folder                   | What it is                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/`                | The plugin format: manifest and package validation, Ed25519 signing, signed catalog types. No npm dependencies; the app imports it too (`@marketplace-shared`). |
| `lib/`                   | Zip reading and writing, folder reading (servers and CLI).                                                                                                      |
| `master/`                | Master server: publisher API, review pipeline, admin pages, replication.                                                                                        |
| `mirror/`                | Distribution server: replication receiver, public catalog and download API.                                                                                     |
| `cli/`                   | `aipg-plugin`: init, validate, pack, publish, status, schema.                                                                                                   |
| `examples/`              | Two complete plugins (a chat preset and a ComfyUI workflow).                                                                                                    |
| `deploy/`                | Dockerfile, a Compose file per role, Caddyfile, env examples, systemd units.                                                                                    |
| `scripts/dev-cluster.ts` | Master and two mirrors on localhost for development.                                                                                                            |

Requires Node.js 24, which runs the TypeScript directly; there is no build step.

```bash
npm install
npm test                       # unit + HTTP tests (real master and mirrors on random ports)
npm run typecheck
npm run dev:cluster -- --seed  # local master + 2 mirrors, wired into WebUI's `npm run dev`
npm run aipg-plugin -- --help
```

Documentation:

- [Deploying the servers](../docs/marketplace/deploying-servers.md): VMs, Docker, HTTPS, mirrors, backups.
- [Building plugins](../docs/marketplace/plugin-authoring-guide.md): for plugin authors.
- [Plugin specification for AI agents](../docs/marketplace/AI-PLUGIN-DEVELOPMENT.md).
