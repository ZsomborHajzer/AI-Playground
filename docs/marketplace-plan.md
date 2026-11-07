# Plugin Marketplace: Plan

Status: **UI preview only.** The marketplace view ships with sample listings and simulated
installs and uploads. Nothing below is implemented yet. This document is the plan for the
registry service and for the install pipeline inside the app.

## Goal

A VS Code–style marketplace where people can **find, install, update and publish** add-ons
that customize AI Playground. Listings come in two tiers:

- **Community**: anyone with a publisher account can upload. The upload is scanned
  automatically and listed straight away, marked "not reviewed".
- **Verified**: a community plugin that has passed a manual review and is signed by the
  AI Playground team. It gets a badge and a lighter install prompt.

## What exists today (UI preview)

| Piece                      | File                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Full-screen view           | `WebUI/src/views/Marketplace.vue`                                                                    |
| List row, detail pane      | `WebUI/src/components/marketplace/PluginListItem.vue`, `PluginDetail.vue`                            |
| Install consent dialog     | `WebUI/src/components/marketplace/InstallConsentDialog.vue`                                          |
| Publish form + submissions | `WebUI/src/components/marketplace/PublishPanel.vue`                                                  |
| Store (simulated actions)  | `WebUI/src/assets/js/store/marketplace.ts`                                                           |
| Shared types               | `WebUI/src/assets/js/marketplace/types.ts`                                                           |
| Filter / sort (pure)       | `WebUI/src/assets/js/marketplace/catalog.ts`, test in `electron/test/lib/marketplaceCatalog.test.ts` |
| Sample data                | `WebUI/src/assets/js/marketplace/sampleCatalog.ts`                                                   |

The marketplace opens from the puzzle-piece button in the title bar (`uiStore.openMarketplace()`).
`types.ts` has no Vue imports, so the main process can reuse it as is. When the backend lands,
the store's actions become IPC calls. The components don't change.

## 1. Plugin package

A plugin is a zip with the extension `.aipgx`. Its root holds an `aipg-plugin.json`
manifest:

```json
{
  "id": "pixelforge.upscale-restore",
  "name": "Upscale & Restore Workflows",
  "version": "2.1.0",
  "publisher": "pixelforge",
  "description": "4× upscaling, face restore and JPEG artifact removal.",
  "license": "MIT",
  "repository": "https://github.com/pixelforge/upscale-restore",
  "engines": { "aipg": ">=2.6.0" },
  "category": "workflows",
  "permissions": ["models"],
  "contributes": {
    "workflows": ["workflows/upscale-4x.json", "workflows/face-restore.json"],
    "presets": ["presets/upscale-4x.json"],
    "customNodes": [
      { "repo": "https://github.com/…/ComfyUI-Foo", "commit": "a1b2c3d" }
    ],
    "models": [
      {
        "repo_id": "example/4x-UltraSharp",
        "backend": "comfyui",
        "sizeGb": 0.07
      }
    ]
  }
}
```

### What a plugin can contribute

Each contribution type maps to a seam the app already has. A plugin only adds files at that
seam. It never patches app code.

| `contributes` key | Lands in                                                                                                  | Kind of content |
| ----------------- | --------------------------------------------------------------------------------------------------------- | --------------- |
| `presets`         | the user presets directory (`getUserPresetsPath`), validated by the preset Zod schema                     | data            |
| `workflows`       | ComfyUI workflow JSON referenced by those presets                                                         | data            |
| `customNodes`     | ComfyUI custom nodes, **pinned to a commit**, installed by the existing `comfyui:downloadCustomNode` path | code (Python)   |
| `models`          | catalog entries only; weights are fetched on first use (see §5)                                           | data            |
| `themes`          | CSS token files layered on the theme store                                                                | data            |
| `languages`       | locale JSON with the same key set as `en-US.json`                                                         | data            |
| `agentSkills`     | skill markdown plus an optional `AgentCapability` module                                                  | data or code    |
| `mcpServers`      | MCP server definitions added to the MCP settings                                                          | code (process)  |
| `channels`        | a Home Agent `ChannelAdapter` plus its Python module                                                      | code            |

**Data plugins** (presets, workflows, themes, languages, skill markdown) are validated against
a schema and cannot run anything. **Code plugins** can. That split decides the review and
sandbox rules below.

## 2. Trust model

- **Signing.** Every package is signed twice. The publisher signs with their key, and the
  registry countersigns once the automated checks pass. Verified plugins also carry an
  AI Playground team signature. The app checks the signatures before it unpacks anything.
  Sigstore-style keyless signing tied to the publisher's GitHub identity keeps key
  management off publishers' hands.
- **Verified review** checks that the declared permissions match what the code does, that
  dependencies are pinned, that no weights are bundled or auto-downloaded, and that the
  plugin works on the current release. A verified plugin is tied to the version that was
  reviewed. An update falls back to community status until it is reviewed again, unless the
  publisher itself is verified and the update requests no new permissions.
- **Code plugins require a verified publisher** (manual identity check) at first. Community
  publishers can ship data plugins only. This is the largest risk reduction available, and
  it can be relaxed once the sandbox in §6 exists.
- **Revocation.** The registry serves a signed deny-list. The app fetches it with the update
  check and disables any installed plugin on it (it does not delete it). The user sees why.

## 3. Registry service

A small, mostly read-heavy service. Static package files go to object storage behind a CDN.
The API only handles metadata.

**Components**

- API server (Node/TypeScript, so it can share `types.ts` and the manifest Zod schema)
- Postgres: publishers, plugins, versions, ratings, reports, review queue
- Object storage + CDN: `.aipgx` packages, icons, screenshots
- Scan worker (queue-driven): manifest validation, malware scan, secret scan, permission
  heuristics
- Search: Postgres full-text to start. A separate search engine is only worth it at
  thousands of listings.

**API (v1)**

| Method | Path                                          | Purpose                                                             |
| ------ | --------------------------------------------- | ------------------------------------------------------------------- |
| GET    | `/v1/plugins?q=&category=&trust=&sort=&page=` | search / browse                                                     |
| GET    | `/v1/plugins/:id`                             | listing + latest compatible version                                 |
| GET    | `/v1/plugins/:id/versions`                    | changelog                                                           |
| GET    | `/v1/plugins/:id/versions/:v/download`        | redirect to signed CDN URL                                          |
| POST   | `/v1/updates`                                 | body: installed `{id, version}[]` + app version → available updates |
| GET    | `/v1/revocations`                             | signed deny-list                                                    |
| POST   | `/v1/publish`                                 | multipart upload (auth) → submission id                             |
| GET    | `/v1/me/submissions`                          | publisher's submissions and their status                            |
| POST   | `/v1/plugins/:id/ratings`, `/reports`         | feedback and abuse reports (auth)                                   |

`engines.aipg` filters results on the server, so the app never shows a version it can't run.

**Accounts.** Publishers sign in with GitHub OAuth. The app uses the OAuth device flow, so
it never handles a password, and stores the token with Electron `safeStorage`, as the
Home Agent channel config already does. Browsing and installing need no account.

## 4. Publishing pipeline

```
upload ─► manifest + schema check ─► automated scans ─► community listing
                                        │                    │
                                        └─ reject w/ report  └─ (opt-in) verified review ─► verified
```

Automated checks reject the upload if:

- the manifest is invalid or the `id` is not under the uploader's publisher namespace
- the version is not greater than the latest published version
- the package contains model weights (size and extension heuristics: `.safetensors`,
  `.gguf`, `.bin` over a threshold), because weights must be fetched on demand
- the package contains an executable when no `shell` permission is declared, or a custom node
  that is not pinned to a commit
- the malware or secret scan flags it

The upload form in the preview (`PublishPanel.vue`) already collects what this pipeline
needs. For real, most of it should be read from the manifest rather than typed in. The form
then becomes a confirmation of the parsed manifest plus the "request verified review" choice.

## 5. Install pipeline in the app

This follows the main-process layering in `AGENTS.md`.

| Layer       | New module                                    | Job                                                                                         |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `adapters/` | `adapters/marketplace/registryClient.ts`      | HTTP to the registry, download, signature verification                                      |
| `persist/`  | `persist/pluginFiles.ts`                      | `userData/plugins/<id>/<version>/`, `plugins/installed.json` (id, version, enabled, grants) |
| capability  | `plugins/pluginHost.ts`                       | unpack, validate, register contributions with each seam, unregister on disable/uninstall    |
| `kernel/`   | IPC rows + `kernel/registries/marketplace.ts` | `marketplace:*` channels                                                                    |
| renderer    | `store/marketplace.ts`                        | swap sample data and timers for IPC + kernel events                                         |

**IPC rows** (added row-first to `src/types/ipcChannels.ts`, per the channel-manifest rule):
`marketplace:search`, `marketplace:getListing`, `marketplace:install`, `marketplace:uninstall`,
`marketplace:setEnabled`, `marketplace:checkUpdates`, `marketplace:listInstalled`,
`marketplace:publish`, `marketplace:mySubmissions`. Install progress travels as a
`marketplace-install` kernel event, the same way `artifact-phase` does today.

**Consent goes through the permissions layer.** `requestInstall` calls a new
`permissions.requestPluginInstall({ listing, permissions })` that shows the dialog the
preview already has (`InstallConsentDialog.vue`). The grant is recorded in
`permissionGrants` as `plugin:<id>@<permissions-hash>`, so it is reviewable and revocable
under Settings → Permissions. An update that adds permissions has to ask again.

**Model weights are never downloaded at install time.** A plugin's `contributes.models` only
adds catalog entries. The first time a preset or workflow from the plugin runs, the
existing pre-flight finds the missing files and asks through `permissions.requestDownload`,
exactly as for built-in presets. The detail pane and the consent dialog already tell the
user this.

**Lifecycle**

- **Install**: download → verify signatures → check `engines` → unpack to a temp directory →
  validate every contribution → atomic rename into `plugins/<id>/<version>` → register.
- **Disable**: unregister contributions and keep the files.
- **Update**: install the new version next to the old one, switch, then delete the old one
  after a successful start, which keeps a one-step rollback.
- **Uninstall**: unregister and delete. User data the plugin produced (presets the user
  edited, generated media) is left alone.
- **Startup**: register enabled plugins after the kernel is up. A plugin that fails to
  register is disabled and reported through the error sink with `surface: 'toast'`. It
  never blocks boot.
- **Update check**: once a day, plus on opening the marketplace. Updates are not installed
  automatically unless the user turns that on.

## 6. Running code plugins

Data plugins need no sandbox. Code plugins are the hard part, and the plan is to keep
them out of the main process:

- **MCP servers** already run as separate processes. Launch them with the plugin directory as
  the working directory and pass only the environment variables the manifest declares.
- **Agent capabilities** with code run in an Electron `utilityProcess` that gets a narrow RPC
  API (register tools, read the workspace through the existing sandboxed operations) instead
  of `require` access to the main process.
- **ComfyUI custom nodes** run inside ComfyUI, the same trust level as nodes users install by
  hand today. That is why they must be pinned to a commit and reviewed.
- **Home Agent channels** follow the five-place rule in `AGENTS.md`, and a third-party channel
  needs a Python module. Ship these as verified-only until there is a generic channel
  host.

Declared permissions are enforced where the platform allows it (network for utility
processes, file access through the sandboxed file operations). Anything that can't be
enforced is shown to the user as a declaration, and the review checks it.

## 7. Phased rollout

1. **Phase 0 (done)**: the UI preview on sample data.
2. **Phase 1, static index, data plugins only.** A GitHub repository holds `index.json`,
   and publishing is a pull request that adds an entry pointing at a release asset (the
   model Obsidian's community plugins use). CI runs the automated checks on the PR, and
   merging is the review. The app fetches the index and installs presets, workflows,
   themes and language packs. No server to run, and it proves the install pipeline (§5)
   end to end.
3. **Phase 2, registry service**: in-app upload, accounts, ratings, update API, revocation
   list, community/verified tiers as described.
4. **Phase 3, code plugins**: utility-process host, MCP/agent-skill contributions, verified
   channels.

Phase 1 is the recommended next step. It needs only the app-side work in §5 plus a CI
workflow, and it settles the manifest format before anything server-side depends on it.

## Open questions

- Who staffs verified reviews, and what turnaround is promised?
- Do paid plugins ever make sense? If not, say so in the publisher terms early.
- Should OEM builds (e.g. the Acer variant) be able to pin a curated subset or add their own
  verified publisher?
- Telemetry for download counts: count registry downloads only, or also report installs
  from the app (opt-in)?
