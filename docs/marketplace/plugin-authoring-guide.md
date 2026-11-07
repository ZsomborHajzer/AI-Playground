# Building plugins for AI Playground

This guide walks you through making a plugin, testing it in your own copy of AI Playground,
and publishing it to the marketplace. It also lists the rules every plugin has to follow,
because the marketplace checks them automatically and a reviewer checks them again.

If you are an AI agent, read [AI-PLUGIN-DEVELOPMENT.md](AI-PLUGIN-DEVELOPMENT.md) instead. It
covers the same rules in a form that is easier to follow step by step.

## What a plugin can do today

A plugin adds **presets** to AI Playground. There are two kinds:

| Kind               | What the user gets                                                                          | Marketplace category |
| ------------------ | ------------------------------------------------------------------------------------------- | -------------------- |
| **Chat preset**    | A new entry in the Chat preset list, with its own system prompt, model choices and settings | `presets`            |
| **ComfyUI preset** | A new image, video or 3D workflow in Image Gen, Image Edit or Video                         | `workflows`          |

One plugin can contain several presets of either kind.

The marketplace also lists other categories (themes, language packs, agent skills, tools and MCP
servers, Home Agent channels). The servers **do not accept these yet**: they will need code to
run inside the app, which needs a sandbox first. Uploading one is refused with a clear message.

## Before you start

You need:

- **AI Playground 3.2 or newer**, to test your plugin.
- **A text editor.** Plugins are folders of JSON and Markdown files.
- **For ComfyUI presets:** ComfyUI (the copy AI Playground installs is fine), to build and export
  your workflow.
- **Optionally, Node.js 24**, to run the `aipg-plugin` command-line tool. Everything it does can
  also be done in the app, but the tool is faster when you iterate.
- **To publish:** a publisher account on the marketplace's master server. Register on its
  `/register` page (for example `https://master.marketplace.example.com/register`), or ask its
  admin to create one. Either way you get a **publisher token**. Keep it private: anyone with it
  can upload plugins in your name.

To use the command-line tool, run this once from a checkout of this repository:

```bash
cd marketplace-server
npm install
npm run aipg-plugin -- --help
```

## 1. Create the plugin folder

Pick a **plugin id** of the form `<publisher-id>.<plugin-name>`, using lowercase letters, digits
and dashes, for example `acme.watercolor-styles`. The part before the dot must be your
publisher id. You cannot publish into someone else's namespace.

Create the folder with the tool:

```bash
npm run aipg-plugin -- init ../my-plugins/watercolor --id acme.watercolor-styles --name "Watercolor Styles" --type comfy
```

Or create it by hand. Either way you end up with:

```
watercolor/
  aipg-plugin.json      the manifest (required)
  presets/
    watercolor.json     one file per preset
    watercolor.png      optional thumbnail, same name as its preset
  README.md             what users see on the plugin page (strongly recommended)
  CHANGELOG.md          shown on the Changelog tab (optional)
  icon.png              optional, up to 256 KB
```

## 2. Write the manifest

`aipg-plugin.json` describes the plugin:

```json
{
  "manifestVersion": 1,
  "id": "acme.watercolor-styles",
  "name": "Watercolor Styles",
  "version": "1.0.0",
  "description": "Three watercolor looks for Image Gen.",
  "license": "MIT",
  "repository": "https://github.com/acme/watercolor-styles",
  "engines": { "aipg": ">=3.2.0" },
  "category": "workflows",
  "tags": ["watercolor", "painting"],
  "permissions": ["models"],
  "contributes": { "presets": ["presets/*.json"] }
}
```

| Field                    | Rules                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `manifestVersion`        | Always `1`.                                                                                                                          |
| `id`                     | `publisher.plugin-name`. It cannot change once published.                                                                            |
| `name`                   | Up to 60 characters. Shown as the plugin's title.                                                                                    |
| `version`                | Semantic version (`1.0.0`, `1.2.3`, `2.0.0-beta.1`). Every upload must be **higher** than the last published version.                |
| `description`            | One line, up to 160 characters. Shown in the list.                                                                                   |
| `license`                | An SPDX license id such as `MIT` or `Apache-2.0`.                                                                                    |
| `repository`, `homepage` | Optional, must be `https://` links.                                                                                                  |
| `engines.aipg`           | The AI Playground versions your plugin works with: `>=3.2.0`, `^3.2.0`, `>=3.2.0 <4.0.0`. Users on other versions cannot install it. |
| `category`               | `presets` for chat presets, `workflows` for ComfyUI presets.                                                                         |
| `tags`                   | Up to 10 short words that help search.                                                                                               |
| `permissions`            | What the plugin needs (see below). Declare exactly what it uses.                                                                     |
| `contributes.presets`    | Paths to your preset files. `*` matches any file name in one folder.                                                                 |
| `icon`                   | Optional path to a `.png`, `.jpg` or `.webp`.                                                                                        |

### Permissions

Users see the permissions in the install dialog, so they have to be accurate. The validator
works out what your presets need and rejects a package that does not declare it:

| Permission | Declare it when                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `models`   | Any preset lists `requiredModels`. The models download the first time the preset runs, after the user confirms.                           |
| `shell`    | Any ComfyUI preset lists `requiredCustomNodes` or `requiredPythonPackages`. They run third-party code inside ComfyUI, so users must know. |

You get a warning if you declare a permission nothing uses. Remove it.

## 3. Write a chat preset

A chat preset is the same JSON file AI Playground uses for its own presets. A complete
example:

```json
{
  "type": "chat",
  "category": "chat",
  "name": "Writing Coach",
  "description": "Reviews your text and suggests clearer, tighter wording.",
  "tags": ["Chat", "Writing"],
  "backends": ["llamaCPP", "openVINO"],
  "systemPrompt": "You are a writing coach. When the user shares text, say in one sentence what works, then list the three changes that would improve it most, each with a rewritten example.",
  "contextSize": 16384,
  "maxNewTokens": 2048,
  "temperature": 0.4,
  "requiredModels": []
}
```

The fields you will use most:

| Field                                                        | Meaning                                                                                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                                       | Unique preset name. If it clashes with a built-in preset, the user's own preset or another plugin's, your preset is **not shown**, so choose a distinctive name. |
| `backends`                                                   | Which inference backends it can run on: `llamaCPP`, `openVINO`, `cloud`. At least one.                                                                           |
| `preferredModels`                                            | Optional default model per backend, e.g. `{ "llamaCPP": "unsloth/Qwen3.5-9B-GGUF/Qwen3.5-9B-Q4_K_M.gguf" }`.                                                     |
| `systemPrompt`                                               | The instructions the model gets. Most of a chat preset's value is here.                                                                                          |
| `contextSize`, `maxNewTokens`, `temperature`                 | Generation limits and sampling.                                                                                                                                  |
| `requiresVision`, `requiresToolCalling`, `requiresReasoning` | Filter the model list to models that can do this.                                                                                                                |
| `enableRAG`, `showTools`, `toolsEnabledByDefault`            | Show document (RAG) and tool controls.                                                                                                                           |
| `agentPreset`, `agentCapabilities`                           | Turn the preset into an Agent Mode preset. Reviewers read these closely. `mcp:` capabilities are refused, because they refer to the user's own MCP servers.      |

The app's bundled presets in [`modes/base/presets/`](../../modes/base/presets/) are working
examples of every field. The full schema, with comments, is `ChatPresetSchema` in
[`WebUI/src/lib/presetSchemas.ts`](../../WebUI/src/lib/presetSchemas.ts).

## 4. Turn a ComfyUI workflow into a preset

1. **Build the workflow in ComfyUI** and check that it works.
2. **Give the nodes you want to expose clear titles.** Right-click a node, choose **Title**, and
   name it, for example `Prompt`, `Steps` or `upscale_factor`. Presets find nodes by title.
3. **Export it in API format.** In ComfyUI, enable dev mode options in the settings, then use
   **Workflow → Export (API)**. The file maps node ids to `{ "class_type", "inputs", "_meta": { "title" } }`.
4. **Paste that JSON into the preset as `comfyUiApiWorkflow`**, and describe the inputs in
   `settings`:

```json
{
  "type": "comfy",
  "name": "Watercolor Portrait",
  "description": "Turns a prompt into a soft watercolor portrait.",
  "backend": "comfyui",
  "category": "create-images",
  "toolCategory": "create-images",
  "mediaType": "image",
  "tags": ["watercolor"],
  "requiredModels": [
    {
      "type": "checkpoints",
      "model": "acme/watercolor-xl/watercolor-xl.safetensors"
    }
  ],
  "requiredCustomNodes": [
    "evanspearman/ComfyMath@939bb813f1c0ace959b62f20bb2da47190c4e211"
  ],
  "settings": [
    {
      "type": "string",
      "label": "Prompt",
      "displayed": true,
      "modifiable": true,
      "settingName": "prompt"
    },
    {
      "type": "number",
      "label": "Steps",
      "displayed": true,
      "modifiable": true,
      "defaultValue": 25,
      "min": 10,
      "max": 50,
      "step": 1,
      "nodeTitle": "Steps",
      "nodeInput": "value"
    }
  ],
  "comfyUiApiWorkflow": { "…": "the exported API-format workflow" }
}
```

How the pieces fit:

- **`category`** chooses the mode the preset appears in: `create-images` (Image Gen),
  `edit-images` (Image Edit) or `create-videos` (Video). Set `toolCategory` to the same value
  if the chat assistant should be able to call your workflow as a tool. Add `toolInstructions`
  to tell it when and how.
- **`settings`** come in two kinds:
  - **Standard settings** use `settingName`, and AI Playground wires them to its own controls:
    `prompt`, `negativePrompt`, `seed`, `inferenceSteps`, `width`, `height`, `resolution`,
    `batchSize`, `safetyCheck`, `showPreview`.
  - **Workflow inputs** use `nodeTitle` and `nodeInput` to point at a node's input. Their `type`
    is `number`, `string`, `boolean`, `image`, `video`, `stringList`, `model` (with
    `modelType`), `inpaintMask` or `outpaintCanvas`.
- **`requiredModels`** lists the model files the workflow loads as Hugging Face paths
  (`owner/repo/file`) plus a ComfyUI model `type` (`checkpoints`, `loras`, `vae`, `upscale`, …).
  The app downloads them **only when the user first runs the preset, and only after they
  confirm**. Never put model files in the plugin.
- **`requiredCustomNodes`** lists custom node repositories as `owner/repo@<full 40-character
commit hash>`. Unpinned entries are rejected, because a branch can change after review.
- **`variants`** (optional) offer alternative versions of the same preset, for example a fast
  draft and a high-quality version. See `upscale.json` among the bundled presets.

The bundled ComfyUI presets in [`modes/base/presets/`](../../modes/base/presets/) (`sdxl.json`,
`upscale.json`, `flux.json`, …) are the best reference.
[`marketplace-server/examples/upscale-workflow`](../../marketplace-server/examples/upscale-workflow)
is a complete, publishable ComfyUI plugin.

## 5. Test it in AI Playground

1. Open the **Marketplace** (puzzle-piece icon in the title bar) → **Installed**.
2. Click **Install from folder…** and choose your plugin folder. The app runs the same checks the
   marketplace does and shows any error.
3. Find your presets in the Chat preset list, or in Image Gen / Image Edit / Video, and try them.
   For a ComfyUI preset, run it once so the models and custom nodes install.
4. To try a change, install the folder again: the new files replace the old ones.
5. **Uninstall** it from the Installed list when you are done.

Plugins installed this way are marked **Local**: nobody has reviewed or signed them. That is fine
on your own machine, but don't hand out unreviewed packages to other people.

## 6. Validate and package

The marketplace refuses an upload that fails any check, so run them first:

```bash
npm run aipg-plugin -- validate ../my-plugins/watercolor
```

**Errors** must be fixed. **Warnings** don't block an upload, but the reviewer sees them too:
fix them or explain them in your README.

When it passes, build the package:

```bash
npm run aipg-plugin -- pack ../my-plugins/watercolor
# → acme.watercolor-styles-1.0.0.aipgx
```

An `.aipgx` is a zip file. The tool builds it reproducibly: the same files always give the same
package, with the same sha256.

## 7. Publish

**From the app:** Marketplace → **Publish**. Paste your publisher token once, choose your
`.aipgx` or the plugin folder, check the result, and click **Submit for publishing**.

**From the command line:**

```bash
export AIPG_MASTER_URL=https://master.marketplace.example.com
export AIPG_PUBLISHER_TOKEN=aipg_acme_…
npm run aipg-plugin -- publish ../my-plugins/watercolor
npm run aipg-plugin -- status
```

## 8. Review

Every upload is checked automatically and then reviewed by a person. You can follow it under
**Your submissions** in the Publish tab, or with `aipg-plugin status`:

| Status            | Meaning                                                       | What to do                                                   |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| In review         | Waiting for a reviewer.                                       | Wait.                                                        |
| Changes requested | The reviewer left a note.                                     | Fix it and upload again. The same version number is allowed. |
| Rejected          | Not suitable for the marketplace. The note says why.          | Don't re-upload unchanged.                                   |
| Published         | Signed by the master and pushed to every distribution server. | Users can install it within a minute or two.                 |

Reviewers check that:

- the plugin does what its README says, and nothing else;
- the permissions match what the presets do;
- custom nodes and Python packages are pinned, well known, and needed;
- system prompts and agent instructions don't try to make the model do something the user would
  not expect (hide actions, exfiltrate data, ignore the user);
- no model weights, executables or scripts are bundled;
- names, descriptions and images are accurate and appropriate;
- the license allows redistribution.

### Trust tiers

When a reviewer approves a plugin, they choose its tier:

- **Verified:** the publisher's identity is verified by the marketplace team, and the plugin has
  been reviewed. Verified plugins without special permissions install without an extra
  confirmation.
- **Community:** the plugin has been reviewed for safety, but the publisher is not verified. The
  install dialog says so.

Ask the marketplace admin if you want your publisher account verified.

## 9. Updates and withdrawals

- **Updating:** bump `version`, add a `CHANGELOG.md` entry (`## 1.1.0` followed by bullet
  points), and publish again. Each version is reviewed. Users see an update in the marketplace's
  **Updates** list. The app keeps the previous version on disk until the next update.
- **Withdrawing:** ask the marketplace admin to revoke a version. Revoked versions disappear
  from every distribution server, and apps that installed them disable them and show the reason.

## Rules at a glance

A package is refused automatically if it:

- has no `aipg-plugin.json` at its root, or the manifest breaks a rule above;
- uses an id outside your publisher namespace, or a version that is not higher than the last;
- uses a category other than `presets` or `workflows`, or a contribution type other than
  `presets`;
- contains model weights (`.safetensors`, `.gguf`, `.ckpt`, `.bin`, `.pt`, `.pth`, `.onnx`, …),
  executables, or scripts; only `.json`, `.md`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.webp` and
  `LICENSE`/`NOTICE` files are allowed;
- is larger than 20 MB unpacked, has more than 500 files, has a file over 10 MB, or has an icon
  over 256 KB;
- has paths that use `..`, start with `/`, or contain `\`;
- has a preset that is not valid JSON, has no `type`/`name`, has duplicate names, or (for
  ComfyUI) has no `comfyUiApiWorkflow` or unpinned custom nodes;
- needs a permission it doesn't declare.
