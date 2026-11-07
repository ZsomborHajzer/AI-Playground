#!/usr/bin/env node
// aipg-plugin: scaffold, validate, pack and publish AI Playground plugins.
// Every command takes --json for machine-readable output (used by AI agents).
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  MANIFEST_FILE,
  MANIFEST_JSON_SCHEMA,
  PACKAGE_EXTENSION,
  PLUGIN_ID_PATTERN,
  sha256Hex,
  validatePackage,
  type PackageEntry,
  type PackageReport,
} from '../shared/index.ts'
import { readFolder } from '../lib/folder.ts'
import { readPackageZip as readZip, writePackageZip as writeZip } from '../shared/index.ts'

const HELP = `aipg-plugin <command> [options]

Commands:
  init <dir> --id <publisher.name> --name <name> [--type chat|comfy]
                         Create a plugin folder with a manifest, a preset and a README.
  validate <dir|file.aipgx>
                         Check a plugin against every rule the master server enforces.
  pack <dir> [-o <file>] Validate, then write a reproducible <id>-<version>.aipgx.
  publish <dir|file.aipgx> [--master <url>] [--token <token>]
                         Upload for review. Defaults: $AIPG_MASTER_URL, $AIPG_PUBLISHER_TOKEN.
  status [--master <url>] [--token <token>]
                         List your submissions and their review state.
  schema                 Print the JSON Schema of aipg-plugin.json.

Options:
  --json                 Print machine-readable JSON instead of text.
`

type Flags = {
  json?: boolean
  id?: string
  name?: string
  type?: string
  output?: string
  master?: string
  token?: string
  help?: boolean
}

function loadEntries(target: string): PackageEntry[] {
  if (!fs.existsSync(target)) throw new Error(`Not found: ${target}`)
  if (fs.statSync(target).isDirectory()) return readFolder(target)
  const result = readZip(new Uint8Array(fs.readFileSync(target)))
  if ('error' in result) throw new Error(result.error)
  return result.entries
}

function printReport(report: PackageReport, json: boolean) {
  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          manifest: report.manifest,
          presets: report.presets,
          issues: report.issues,
          totalBytes: report.totalBytes,
        },
        null,
        2,
      ),
    )
    return
  }
  const label = report.manifest ? `${report.manifest.id}@${report.manifest.version}` : 'plugin'
  for (const issue of report.issues) {
    const where = issue.path ? ` (${issue.path})` : ''
    console.log(
      `${issue.level === 'error' ? 'ERROR' : 'warn '} ${issue.code}${where}: ${issue.message}`,
    )
  }
  if (report.presets.length) {
    console.log(`Presets: ${report.presets.map((p) => `${p.name} [${p.type}]`).join(', ')}`)
  }
  console.log(report.ok ? `OK: ${label} is valid` : `FAILED: ${label} has errors`)
}

function pack(
  dir: string,
  output: string | undefined,
  json: boolean,
): { file: string; sha256: string; report: PackageReport } | undefined {
  const entries = readFolder(dir)
  const report = validatePackage(entries, { enforcePolicy: true })
  if (!report.ok || !report.manifest) {
    printReport(report, json)
    return undefined
  }
  const bytes = writeZip(entries.map((e) => ({ path: e.path, data: e.read() })))
  const file =
    output ??
    path.join(process.cwd(), `${report.manifest.id}-${report.manifest.version}${PACKAGE_EXTENSION}`)
  fs.writeFileSync(file, bytes)
  return { file, sha256: sha256Hex(bytes), report }
}

function masterConfig(flags: Flags): { master: string; token: string } {
  const master = (flags.master ?? process.env.AIPG_MASTER_URL ?? '').replace(/\/+$/, '')
  const token = flags.token ?? process.env.AIPG_PUBLISHER_TOKEN ?? ''
  if (!master) throw new Error('Set --master or AIPG_MASTER_URL to the master server URL')
  if (!token) throw new Error('Set --token or AIPG_PUBLISHER_TOKEN to your publisher token')
  return { master, token }
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return { error: text || response.statusText }
  }
}

function init(dir: string, flags: Flags) {
  const id = flags.id ?? ''
  if (!PLUGIN_ID_PATTERN.test(id)) throw new Error('--id must look like publisher.plugin-name')
  const name = flags.name ?? id.split('.')[1]
  const type = flags.type === 'comfy' ? 'comfy' : 'chat'
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) throw new Error(`${dir} is not empty`)
  fs.mkdirSync(path.join(dir, 'presets'), { recursive: true })
  const write = (rel: string, content: string) => fs.writeFileSync(path.join(dir, rel), content)
  write(
    MANIFEST_FILE,
    JSON.stringify(
      {
        manifestVersion: 1,
        id,
        name,
        version: '0.1.0',
        description: `${name} for AI Playground`,
        license: 'MIT',
        engines: { aipg: '>=3.2.0' },
        category: type === 'comfy' ? 'workflows' : 'presets',
        tags: [],
        permissions: type === 'comfy' ? ['models'] : [],
        contributes: { presets: ['presets/*.json'] },
      },
      null,
      2,
    ) + '\n',
  )
  const preset =
    type === 'chat'
      ? {
          type: 'chat',
          category: 'chat',
          name,
          description: 'Describe what this preset is for.',
          tags: ['Chat'],
          backends: ['llamaCPP', 'openVINO'],
          systemPrompt: 'You are a helpful assistant.',
          contextSize: 16384,
          requiredModels: [],
        }
      : {
          type: 'comfy',
          name,
          description: 'Describe what this workflow does.',
          backend: 'comfyui',
          category: 'create-images',
          tags: [],
          requiredModels: [{ type: 'checkpoints', model: 'owner/repo/model.safetensors' }],
          settings: [],
          comfyUiApiWorkflow: { '1': { class_type: 'ReplaceWithYourWorkflow', inputs: {} } },
        }
  write(`presets/${id.split('.')[1]}.json`, JSON.stringify(preset, null, 2) + '\n')
  write('README.md', `# ${name}\n\nWhat this plugin adds and how to use it.\n`)
  write('CHANGELOG.md', `## 0.1.0\n\n- First version.\n`)
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: 'boolean' },
      id: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string' },
      output: { type: 'string', short: 'o' },
      master: { type: 'string' },
      token: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const flags = values as Flags
  const json = !!flags.json
  const [command, target] = positionals

  switch (command) {
    case 'init': {
      if (!target) throw new Error('Usage: aipg-plugin init <dir> --id publisher.name')
      init(target, flags)
      console.log(
        json
          ? JSON.stringify({ ok: true, dir: target })
          : `Created ${target}. Next: edit it, then run "aipg-plugin validate ${target}".`,
      )
      return 0
    }
    case 'validate': {
      if (!target) throw new Error('Usage: aipg-plugin validate <dir|file.aipgx>')
      const report = validatePackage(loadEntries(target), { enforcePolicy: true })
      printReport(report, json)
      return report.ok ? 0 : 1
    }
    case 'pack': {
      if (!target) throw new Error('Usage: aipg-plugin pack <dir> [-o file]')
      const result = pack(target, flags.output, json)
      if (!result) return 1
      if (json)
        console.log(
          JSON.stringify(
            { ok: true, file: result.file, sha256: result.sha256, issues: result.report.issues },
            null,
            2,
          ),
        )
      else {
        printReport(result.report, false)
        console.log(`Wrote ${result.file}\nsha256 ${result.sha256}`)
      }
      return 0
    }
    case 'publish': {
      if (!target) throw new Error('Usage: aipg-plugin publish <dir|file.aipgx>')
      const { master, token } = masterConfig(flags)
      let file = target
      if (fs.statSync(target).isDirectory()) {
        const packed = pack(target, undefined, json)
        if (!packed) return 1
        file = packed.file
      }
      const form = new FormData()
      form.append('package', new Blob([fs.readFileSync(file)]), path.basename(file))
      const response = await fetch(`${master}/v1/submissions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      })
      const body = (await readResponse(response)) as {
        id?: number
        status?: string
        error?: string
        issues?: unknown[]
      }
      if (json) console.log(JSON.stringify({ httpStatus: response.status, ...body }, null, 2))
      else if (response.ok) console.log(`Submitted #${body.id}: ${body.status}`)
      else
        console.log(
          `Upload refused (${response.status}): ${body.error ?? ''}\n${JSON.stringify(body.issues ?? [], null, 2)}`,
        )
      return response.ok ? 0 : 1
    }
    case 'status': {
      const { master, token } = masterConfig(flags)
      const response = await fetch(`${master}/v1/me/submissions`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const body = (await readResponse(response)) as {
        submissions?: {
          id: number
          pluginId: string
          version: string
          status: string
          reviewNote?: string
        }[]
        error?: string
      }
      if (json) console.log(JSON.stringify(body, null, 2))
      else if (!response.ok) console.log(`Error (${response.status}): ${body.error}`)
      else
        for (const s of body.submissions ?? [])
          console.log(
            `#${s.id} ${s.pluginId}@${s.version} ${s.status}${s.reviewNote ? ` — ${s.reviewNote}` : ''}`,
          )
      return response.ok ? 0 : 1
    }
    case 'schema':
      console.log(JSON.stringify(MANIFEST_JSON_SCHEMA, null, 2))
      return 0
    default:
      console.log(HELP)
      return command && !flags.help ? 1 : 0
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error(`aipg-plugin: ${(e as Error).message}`)
    process.exit(1)
  })
