# AI Playground plugins: specification for AI agents

You are building a plugin for AI Playground's marketplace. This file is the whole contract.
Follow it top to bottom, and finish only when `aipg-plugin validate --json` reports
`"ok": true`. The human-oriented guide is [plugin-authoring-guide.md](plugin-authoring-guide.md),
and the rules are the same.

## 0. Hard invariants (never violate)

1. **Only presets.** A plugin ships preset JSON files (`type: "chat"` or `type: "comfy"`)
   plus docs and images. No code, no scripts, no executables, no model weights.
2. **Manifest category is `presets` (chat presets) or `workflows` (ComfyUI presets).** Every
   other category, and every `contributes` key other than `presets`, is refused.
3. **The id is `<publisher>.<name>`**, lowercase `[a-z0-9-]`. The publisher part must equal
   the uploader's publisher id. Ask the user for it; do not invent one.
4. **The version must be higher than the last published version** (semver). For a new
   plugin, use `1.0.0`, or `0.1.0` for a draft.
5. **Declare exactly the permissions the presets need:** `models` if any preset has a
   non-empty `requiredModels`; `shell` if any comfy preset has non-empty `requiredCustomNodes`
   or `requiredPythonPackages`. Nothing else.
6. **Never bundle model files.** Reference models in `requiredModels`; the app downloads them
   on first use, after the user confirms.
7. **Pin custom nodes:** `owner/repo@<40-hex commit>`. Look up a real commit hash; never
   make one up. If you cannot verify one, ask the user.
8. **Preset names must be unique and distinctive.** A name that clashes with a built-in
   preset (see `modes/base/presets/*.json`) is silently hidden in the app.
9. **No `mcp:` agent capabilities**, and no instructions that hide actions from the user,
   exfiltrate data, or override the user. A human reviewer reads every system prompt.

## 1. File layout

```
<plugin-folder>/
  aipg-plugin.json          REQUIRED, at the root
  presets/<name>.json       ≥1 preset file, matched by contributes.presets
  presets/<name>.png        optional thumbnail (same basename as its preset; .png/.jpg/.jpeg)
  README.md                 strongly recommended (missing → warning); shown as the overview
  CHANGELOG.md              optional; "## <version>" headings followed by bullets
  icon.png                  optional; set "icon": "icon.png"; ≤ 256 KB
  LICENSE                   optional
```

Allowed files: `.json .md .txt .png .jpg .jpeg .webp` and bare `LICENSE`, `NOTICE`, `README`,
`CHANGELOG`. Paths must be relative and use `/`, with no `..`, `.`, empty segments, `\` or `:`.
Limits: 20 MB unpacked, 500 files, 10 MB per file, 200 characters per path.

## 2. Manifest (`aipg-plugin.json`)

Machine-readable schema: [`marketplace-server/shared/aipg-plugin.schema.json`](../../marketplace-server/shared/aipg-plugin.schema.json)
(also printed by `aipg-plugin schema`). The enforcing code is `validateManifest()` in
[`marketplace-server/shared/manifest.ts`](../../marketplace-server/shared/manifest.ts).

```json
{
  "manifestVersion": 1,
  "id": "acme.writing-coach",
  "name": "Writing Coach",
  "version": "1.0.0",
  "description": "A chat preset that reviews and improves your writing.",
  "license": "MIT",
  "repository": "https://github.com/acme/writing-coach",
  "engines": { "aipg": ">=3.2.0" },
  "category": "presets",
  "tags": ["writing"],
  "permissions": [],
  "contributes": { "presets": ["presets/*.json"] }
}
```

Field constraints: `name` 1–60 characters, `description` 1–160, `license` 1–64 (SPDX),
`repository`/`homepage` must be `https://…`, `tags` ≤ 10 entries of 1–24 characters each,
`engines.aipg` a range (`>=3.2.0`, `^3.2.0`, `>=3.2.0 <4.0.0`, `*`), `contributes.presets` ≥ 1
entry. `*` matches within one path segment only. Unknown keys produce a warning.

## 3. Preset files

The app's schema is the source of truth: `ChatPresetSchema` and `ComfyUiPresetSchema` in
[`WebUI/src/lib/presetSchemas.ts`](../../WebUI/src/lib/presetSchemas.ts). The app silently skips
a preset that fails it, so match it exactly. The marketplace validator checks only the subset
below. Copy field shapes from the bundled presets in
[`modes/base/presets/`](../../modes/base/presets/) rather than guessing.

### Chat preset: minimum

```json
{
  "type": "chat",
  "category": "chat",
  "name": "Writing Coach",
  "description": "Reviews your text and suggests clearer wording.",
  "tags": ["Chat"],
  "backends": ["llamaCPP", "openVINO"],
  "systemPrompt": "…",
  "requiredModels": []
}
```

Required: `type`, `name`, `backends` (non-empty; values `llamaCPP`, `openVINO`, `cloud`).
Common optional fields: `preferredModels` `{backend: modelId}`, `contextSize`, `maxNewTokens`,
`temperature`, `requiresVision`, `requiresToolCalling`, `requiresReasoning`, `enableRAG`,
`showTools`, `toolsEnabledByDefault`, `displayPriority`. Agent presets (`agentPreset: true`,
`agentCapabilities` from `media`, `web-debug`, `game-studio`, `memory`) are allowed but get
extra scrutiny.

### ComfyUI preset: minimum

```json
{
  "type": "comfy",
  "name": "Upscale 4x",
  "description": "Enlarges an image 4x.",
  "backend": "comfyui",
  "category": "edit-images",
  "toolCategory": "edit-images",
  "mediaType": "image",
  "tags": [],
  "requiredModels": [
    {
      "type": "upscale",
      "model": "Comfy-Org/Real-ESRGAN_repackaged/RealESRGAN_x4plus.safetensors"
    }
  ],
  "settings": [
    {
      "type": "image",
      "label": "Input Image",
      "displayed": true,
      "modifiable": true,
      "defaultValue": "",
      "nodeTitle": "Load Image",
      "nodeInput": "image"
    }
  ],
  "comfyUiApiWorkflow": {
    "15": {
      "class_type": "LoadImage",
      "inputs": { "image": "" },
      "_meta": { "title": "Load Image" }
    }
  }
}
```

Required: `type: "comfy"`, `name`, `backend: "comfyui"`, a non-empty `comfyUiApiWorkflow`
object in **ComfyUI API format** (node id → `{class_type, inputs, _meta.title}`; links are
`["<nodeId>", <outputIndex>]`).

- `category`: `create-images` (Image Gen), `edit-images` (Image Edit), `create-videos` (Video).
- `settings[]` entries need `type`, `label`, `displayed`, `modifiable`, and either:
  - `settingName`, one of `prompt`, `negativePrompt`, `seed`, `inferenceSteps`, `width`,
    `height`, `resolution`, `batchSize`, `safetyCheck`, `showPreview`; or
  - `nodeTitle` + `nodeInput`, where `nodeTitle` equals a node's `_meta.title` in the
    workflow **exactly**, and `nodeInput` is a key in that node's `inputs`. A `type: "model"`
    input also needs `modelType`.
- `requiredModels[]`: `{ "type": <ComfyUI model folder>, "model": "<hf-owner>/<repo>/<path/file>" }`.
- `requiredCustomNodes[]`: `"owner/repo@<40-hex commit>"`. Needs the `shell` permission.

## 4. Build loop

Tooling lives in `marketplace-server/` (Node ≥ 24, `npm install` once). Run every command with
`--json` and parse its output.

```bash
cd marketplace-server
npm run -s aipg-plugin -- init <dir> --id <publisher>.<name> --name "<Name>" --type chat|comfy --json
# edit files …
npm run -s aipg-plugin -- validate <dir> --json      # repeat until "ok": true
npm run -s aipg-plugin -- pack <dir> --json          # → { file, sha256 }
# publishing needs the user's token; do it only when the user asks:
AIPG_MASTER_URL=… AIPG_PUBLISHER_TOKEN=… npm run -s aipg-plugin -- publish <dir> --json
```

`validate --json` returns:

```json
{
  "ok": false,
  "manifest": { "...": "…" },
  "presets": [{ "path": "presets/a.json", "name": "A", "type": "chat" }],
  "issues": [
    {
      "level": "error",
      "code": "permissions/missing",
      "message": "…",
      "path": "permissions"
    }
  ],
  "totalBytes": 1234
}
```

Fix every `level: "error"`. Fix `warning`s unless they are `review/*` notices, which are
expected for agent presets, custom nodes, Python packages and launch flags. Mention those
in the README instead.

To check that the app really loads the presets, the user can install the folder from
Marketplace → Installed → **Install from folder…**. The app runs the full preset schema; a
preset that does not appear failed it.

## 5. Issue codes and fixes

| Code                                                                    | Fix                                                                                                            |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `package/no-manifest`                                                   | Put `aipg-plugin.json` at the folder root.                                                                     |
| `manifest/json`                                                         | Make the manifest valid JSON (no comments, no trailing commas).                                                |
| `manifest/version`                                                      | Set `"manifestVersion": 1`.                                                                                    |
| `manifest/id`                                                           | Use `publisher.plugin-name`, lowercase letters, digits and dashes.                                             |
| `manifest/required`, `manifest/too-long`                                | Fill the field within its length limit.                                                                        |
| `manifest/semver`                                                       | Use `MAJOR.MINOR.PATCH`.                                                                                       |
| `manifest/url`                                                          | Use an `https://` URL or remove the field.                                                                     |
| `manifest/engines`                                                      | Set `"engines": { "aipg": ">=3.2.0" }`.                                                                        |
| `manifest/category`, `policy/category`                                  | Use `presets` or `workflows`.                                                                                  |
| `manifest/tags`                                                         | ≤ 10 tags, each 1–24 characters.                                                                               |
| `manifest/permissions`                                                  | Only `network`, `filesystem`, `models`, `shell`, `channels`, no duplicates; in practice only `models`/`shell`. |
| `manifest/icon`, `package/missing-icon`, `package/icon-too-large`       | Point `icon` at an existing image ≤ 256 KB, or remove it.                                                      |
| `manifest/contributes`, `manifest/presets`                              | `"contributes": { "presets": ["presets/*.json"] }`.                                                            |
| `manifest/unsupported-contribution`, `manifest/unknown-contribution`    | Remove every `contributes` key except `presets`.                                                               |
| `contributes/no-match`                                                  | The pattern matched no `.json` file; fix the path.                                                             |
| `package/unsafe-path`, `package/duplicate-path`                         | Rename files: relative, `/`-separated, no `..`, unique ignoring case.                                          |
| `package/model-weights`                                                 | Delete the weight file; add it to `requiredModels`.                                                            |
| `package/file-type`                                                     | Delete the file; only the allowed types may ship.                                                              |
| `package/too-large`, `package/too-many-files`, `package/file-too-large` | Shrink images, remove unneeded files.                                                                          |
| `policy/namespace`                                                      | The id must start with the uploader's publisher id.                                                            |
| `policy/version`                                                        | Raise `version` above the published one.                                                                       |
| `preset/json`                                                           | Make the preset a valid JSON object.                                                                           |
| `preset/type`, `preset/name`                                            | Set `type` to `chat`/`comfy` and a 1–60 character `name`.                                                      |
| `preset/duplicate-name`                                                 | Give every preset a different `name`.                                                                          |
| `preset/backends`                                                       | Chat preset: non-empty `backends`.                                                                             |
| `preset/backend`, `preset/workflow`                                     | Comfy preset: `"backend": "comfyui"` and a non-empty API-format `comfyUiApiWorkflow`.                          |
| `preset/custom-nodes`                                                   | Use `owner/repo@<40-hex commit>`.                                                                              |
| `preset/required-models`                                                | `requiredModels` must be an array.                                                                             |
| `preset/mcp-capability`                                                 | Remove `mcp:` entries from `agentCapabilities`.                                                                |
| `permissions/missing`                                                   | Add the named permission.                                                                                      |
| `permissions/unused` (warning)                                          | Remove the permission.                                                                                         |
| `package/no-readme`, `package/doc-too-large` (warning)                  | Add a README.md under 64 KB.                                                                                   |
| `package/unreferenced-json` (warning)                                   | Reference the file in `contributes.presets`, or delete it.                                                     |
| `preset/inline-image` (warning)                                         | Move the base64 `image` into a `.png` next to the preset.                                                      |
| `review/*` (warning)                                                    | Expected notices for the reviewer; explain them in the README.                                                 |

## 6. Complete examples

Two publishable plugins live in [`marketplace-server/examples/`](../../marketplace-server/examples/):

- `writing-coach/`: one chat preset, no permissions, category `presets`.
- `upscale-workflow/`: one comfy preset with `requiredModels` and a pinned custom node,
  permissions `["models", "shell"]`, category `workflows`.

Copy the closer one, then change the id, names and content.

## 7. What happens after upload (for explaining it to the user)

1. The master re-runs these checks and queues the upload for a human reviewer.
2. The reviewer approves it (as _verified_ or _community_), requests changes (the same
   version may be re-uploaded), or rejects it, with a note.
3. On approval the master signs the release with its Ed25519 key and pushes it to every
   distribution server. The app verifies the signature and sha256 before installing.
4. Revoked versions are removed from every server and disabled in apps that have them.

## 8. Final self-check

- [ ] `aipg-plugin validate <dir> --json` → `"ok": true`.
- [ ] `id` starts with the user's real publisher id; `version` is higher than any published one.
- [ ] `category` matches the presets (`presets` = chat, `workflows` = comfy).
- [ ] `permissions` lists exactly what the presets need.
- [ ] Every preset name is distinctive and not a built-in preset's name.
- [ ] Every comfy `settings[].nodeTitle` matches a `_meta.title` in its workflow.
- [ ] Every model is in `requiredModels`; every custom node is pinned to a verified commit.
- [ ] README.md says what the plugin adds, which models it downloads, and why it needs each permission.
- [ ] No system prompt asks the model to deceive, hide actions, or act against the user.
