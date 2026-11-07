// Validation of a whole `.aipgx` package. Callers read the zip with whatever library
// they have and pass the entries in, with sizes taken from the zip's directory so a
// zip bomb is refused before anything is decompressed.
import {
  ACCEPTED_CATEGORIES,
  MANIFEST_FILE,
  publisherOf,
  validateManifest,
  type PluginManifest,
  type PluginPermission,
  type ValidationIssue,
} from './manifest.ts'
import { compareVersions } from './semver.ts'

export const PACKAGE_EXTENSION = '.aipgx'
export const LIMITS = {
  totalBytes: 20 * 1024 * 1024,
  fileBytes: 10 * 1024 * 1024,
  files: 500,
  iconBytes: 256 * 1024,
  readmeBytes: 64 * 1024,
  pathLength: 200,
} as const

const ALLOWED_EXTENSIONS = new Set(['.json', '.md', '.txt', '.png', '.jpg', '.jpeg', '.webp'])
const ALLOWED_BARE_NAMES = new Set(['LICENSE', 'NOTICE', 'README', 'CHANGELOG'])
const WEIGHT_EXTENSIONS = new Set([
  '.safetensors',
  '.gguf',
  '.ckpt',
  '.bin',
  '.pt',
  '.pth',
  '.onnx',
  '.pb',
  '.tflite',
  '.xml',
])
const CUSTOM_NODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][\w.-]*@[0-9a-f]{40}$/
// A PyPI project pinned to one version: no URLs, local paths or installer options.
const PYTHON_PACKAGE_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9._,-]+\])?==[A-Za-z0-9.+!_-]+$/
// Flags without values only; the rest either open ComfyUI to the network or point it at other files.
const COMFY_FLAG_PATTERN = /^--[a-z0-9][a-z0-9-]*$/
const FORBIDDEN_COMFY_FLAGS =
  /^--(listen|port|enable-cors-header|tls-|front-end-|enable-manager|comfy-api-base|database-url|.*-director(y|ies)$|extra-model-paths-config|user-directory|multi-user|whitelist-custom-nodes|disable-all-custom-nodes)/

export type PackageEntry = { path: string; size: number; read(): Uint8Array }

export type PresetSummary = { path: string; name: string; type: 'chat' | 'comfy' }

export type PackageReport = {
  ok: boolean
  issues: ValidationIssue[]
  manifest?: PluginManifest
  presets: PresetSummary[]
  files: { path: string; size: number }[]
  totalBytes: number
  readme?: string
  changelog?: string
}

export type PackageOptions = {
  /** The uploader's publisher id; the manifest id must be in this namespace. */
  publisherId?: string
  /** Latest published version of this plugin, which the new one must exceed. */
  latestVersion?: string
  /** Enforce the master's publishing policy (accepted categories). */
  enforcePolicy?: boolean
}

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

/** Rejects anything that could escape the folder the package is unpacked into. */
export function isSafeEntryPath(path: string): boolean {
  if (!path || path.length > LIMITS.pathLength) return false
  if (path.includes('\\') || path.includes('\0') || path.includes(':')) return false
  if (path.startsWith('/')) return false
  return path.split('/').every((segment) => segment !== '..' && segment !== '.' && segment !== '')
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*')
  return new RegExp(`^${escaped}$`)
}

const decoder = new TextDecoder('utf-8', { fatal: false })

function readJson(entry: PackageEntry): unknown {
  return JSON.parse(decoder.decode(entry.read()))
}

export function validatePackage(
  entries: PackageEntry[],
  options: PackageOptions = {},
): PackageReport {
  const issues: ValidationIssue[] = []
  const error = (code: string, message: string, path?: string) =>
    issues.push({ level: 'error', code, message, path })
  const warn = (code: string, message: string, path?: string) =>
    issues.push({ level: 'warning', code, message, path })

  const files = entries.filter((e) => !e.path.endsWith('/'))
  const report: PackageReport = {
    ok: false,
    issues,
    presets: [],
    files: files.map((f) => ({ path: f.path, size: f.size })),
    totalBytes: files.reduce((sum, f) => sum + f.size, 0),
  }

  if (files.length > LIMITS.files)
    error('package/too-many-files', `At most ${LIMITS.files} files are allowed`)
  if (report.totalBytes > LIMITS.totalBytes) {
    error(
      'package/too-large',
      `Unpacked size must be at most ${LIMITS.totalBytes / 1024 / 1024} MB`,
    )
  }
  const seen = new Set<string>()
  for (const file of files) {
    if (!isSafeEntryPath(file.path)) {
      error(
        'package/unsafe-path',
        'Paths must be relative, use "/" and contain no ".." segments',
        file.path,
      )
      continue
    }
    const lower = file.path.toLowerCase()
    if (seen.has(lower))
      error('package/duplicate-path', 'Two files differ only in letter case', file.path)
    seen.add(lower)
    const ext = extensionOf(file.path)
    const bare = (file.path.split('/').pop() ?? '').toUpperCase()
    if (WEIGHT_EXTENSIONS.has(ext)) {
      error(
        'package/model-weights',
        'Model weights must not be bundled; list them in requiredModels so the app downloads them on demand',
        file.path,
      )
    } else if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_BARE_NAMES.has(bare)) {
      error(
        'package/file-type',
        `File type "${ext || bare}" is not allowed in a data plugin`,
        file.path,
      )
    }
    if (file.size > LIMITS.fileBytes)
      error(
        'package/file-too-large',
        `Files must be at most ${LIMITS.fileBytes / 1024 / 1024} MB`,
        file.path,
      )
  }
  if (issues.some((i) => i.level === 'error')) return report

  const byPath = new Map(files.map((f) => [f.path, f]))
  const manifestEntry = byPath.get(MANIFEST_FILE)
  if (!manifestEntry) {
    error('package/no-manifest', `${MANIFEST_FILE} must be at the root of the package`)
    return report
  }
  let manifestJson: unknown
  try {
    manifestJson = readJson(manifestEntry)
  } catch (e) {
    error(
      'manifest/json',
      `${MANIFEST_FILE} is not valid JSON: ${(e as Error).message}`,
      MANIFEST_FILE,
    )
    return report
  }
  const result = validateManifest(manifestJson)
  issues.push(...result.issues)
  if (!result.ok) return report
  const manifest = result.manifest
  report.manifest = manifest

  if (options.publisherId && publisherOf(manifest.id) !== options.publisherId) {
    error(
      'policy/namespace',
      `Plugin id must start with your publisher id "${options.publisherId}."`,
      'id',
    )
  }
  if (options.latestVersion && compareVersions(manifest.version, options.latestVersion) <= 0) {
    error(
      'policy/version',
      `Version must be greater than the latest published version ${options.latestVersion}`,
      'version',
    )
  }
  if (options.enforcePolicy && !ACCEPTED_CATEGORIES.includes(manifest.category)) {
    error(
      'policy/category',
      `Category "${manifest.category}" is not accepted yet; use ${ACCEPTED_CATEGORIES.join(' or ')}`,
      'category',
    )
  }

  if (manifest.icon) {
    const icon = byPath.get(manifest.icon)
    if (!icon)
      error('package/missing-icon', 'The icon file named in the manifest is missing', manifest.icon)
    else if (icon.size > LIMITS.iconBytes)
      error(
        'package/icon-too-large',
        `The icon must be at most ${LIMITS.iconBytes / 1024} KB`,
        manifest.icon,
      )
  }

  for (const [key, name] of [
    ['readme', 'README.md'],
    ['changelog', 'CHANGELOG.md'],
  ] as const) {
    const entry = byPath.get(name)
    if (entry && entry.size <= LIMITS.readmeBytes) report[key] = decoder.decode(entry.read())
    else if (entry)
      warn(
        'package/doc-too-large',
        `${name} is over ${LIMITS.readmeBytes / 1024} KB and will not be shown`,
        name,
      )
  }
  if (!report.readme)
    warn('package/no-readme', 'Add a README.md; it is the overview users see before installing')

  const presetPaths = new Set<string>()
  for (const pattern of manifest.contributes.presets ?? []) {
    const regex = globToRegExp(pattern)
    const matches = files.filter((f) => regex.test(f.path) && f.path.endsWith('.json'))
    if (matches.length === 0)
      error('contributes/no-match', `No .json file matches "${pattern}"`, 'contributes.presets')
    for (const m of matches) presetPaths.add(m.path)
  }
  presetPaths.delete(MANIFEST_FILE)

  const declared = new Set<PluginPermission>(manifest.permissions)
  const needed = new Set<PluginPermission>()
  const names = new Set<string>()
  for (const path of [...presetPaths].sort()) {
    const summary = checkPreset(byPath.get(path)!, path, { error, warn, needed })
    if (!summary) continue
    if (names.has(summary.name))
      error('preset/duplicate-name', `Two presets are named "${summary.name}"`, path)
    names.add(summary.name)
    report.presets.push(summary)
  }
  for (const permission of needed) {
    if (!declared.has(permission)) {
      error(
        'permissions/missing',
        `A preset needs the "${permission}" permission; add it to "permissions"`,
        'permissions',
      )
    }
  }
  for (const permission of declared) {
    if (!needed.has(permission)) {
      warn(
        'permissions/unused',
        `"${permission}" is declared but nothing in the package needs it`,
        'permissions',
      )
    }
  }

  const covered = new Set([
    MANIFEST_FILE,
    ...presetPaths,
    manifest.icon,
    'README.md',
    'CHANGELOG.md',
  ])
  for (const f of files) {
    if (f.path.endsWith('.json') && !covered.has(f.path)) {
      warn(
        'package/unreferenced-json',
        'This .json file is not listed in contributes.presets and will be ignored',
        f.path,
      )
    }
  }

  report.ok = !issues.some((i) => i.level === 'error')
  return report
}

type Reporter = {
  error: (code: string, message: string, path?: string) => void
  warn: (code: string, message: string, path?: string) => void
  needed: Set<PluginPermission>
}

function checkPreset(entry: PackageEntry, path: string, r: Reporter): PresetSummary | undefined {
  let preset: Record<string, unknown>
  try {
    const parsed = readJson(entry)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not an object')
    preset = parsed as Record<string, unknown>
  } catch (e) {
    r.error('preset/json', `Not a valid preset JSON object: ${(e as Error).message}`, path)
    return
  }
  const { type, name } = preset
  if (type !== 'chat' && type !== 'comfy') {
    r.error('preset/type', '"type" must be "chat" or "comfy"', path)
    return
  }
  if (typeof name !== 'string' || !name.trim() || name.length > 60) {
    r.error('preset/name', '"name" must be a non-empty string of up to 60 characters', path)
    return
  }

  if (preset.requiredModels !== undefined) {
    if (!Array.isArray(preset.requiredModels))
      r.error('preset/required-models', '"requiredModels" must be an array', path)
    else if (preset.requiredModels.length > 0) r.needed.add('models')
  }

  if (type === 'chat') {
    if (!Array.isArray(preset.backends) || preset.backends.length === 0) {
      r.error(
        'preset/backends',
        'A chat preset needs a non-empty "backends" array (llamaCPP, openVINO, cloud)',
        path,
      )
    }
    if (preset.agentPreset === true) {
      r.warn(
        'review/agent-preset',
        'Agent presets let a model edit files in a workspace; reviewers check the instructions closely',
        path,
      )
      const capabilities = Array.isArray(preset.agentCapabilities) ? preset.agentCapabilities : []
      if (capabilities.some((c) => typeof c === 'string' && c.startsWith('mcp:'))) {
        r.error(
          'preset/mcp-capability',
          '"mcp:" capabilities refer to the user\'s own MCP servers and cannot be shipped in a plugin',
          path,
        )
      }
    }
  } else {
    if (preset.backend !== 'comfyui')
      r.error('preset/backend', 'A comfy preset must have "backend": "comfyui"', path)
    const workflow = preset.comfyUiApiWorkflow
    if (
      !workflow ||
      typeof workflow !== 'object' ||
      Array.isArray(workflow) ||
      Object.keys(workflow).length === 0
    ) {
      r.error(
        'preset/workflow',
        'A comfy preset needs a "comfyUiApiWorkflow" object (ComfyUI API format)',
        path,
      )
    }
    const nodes = preset.requiredCustomNodes
    if (nodes !== undefined) {
      if (
        !Array.isArray(nodes) ||
        nodes.some((n) => typeof n !== 'string' || !CUSTOM_NODE_PATTERN.test(n))
      ) {
        r.error(
          'preset/custom-nodes',
          '"requiredCustomNodes" entries must be "owner/repo@<40-character commit hash>"',
          path,
        )
      } else if (nodes.length > 0) {
        r.needed.add('shell')
        r.warn(
          'review/custom-nodes',
          `Installs ComfyUI custom nodes (third-party Python code): ${nodes.join(', ')}`,
          path,
        )
      }
    }
    const packages = preset.requiredPythonPackages
    if (
      packages !== undefined &&
      (!Array.isArray(packages) ||
        packages.some((p) => typeof p !== 'string' || !PYTHON_PACKAGE_PATTERN.test(p)))
    ) {
      r.error(
        'preset/python-packages',
        '"requiredPythonPackages" entries must be PyPI names pinned to one version, like "package==1.2.3"',
        path,
      )
    } else if (Array.isArray(packages) && packages.length > 0) {
      r.needed.add('shell')
      r.warn(
        'review/python-packages',
        `Installs Python packages into ComfyUI: ${packages.join(', ')}`,
        path,
      )
    }
    const flags = preset.requiredComfyUiParameters
    if (
      flags !== undefined &&
      (!Array.isArray(flags) ||
        flags.some(
          (f) =>
            typeof f !== 'string' || !COMFY_FLAG_PATTERN.test(f) || FORBIDDEN_COMFY_FLAGS.test(f),
        ))
    ) {
      r.error(
        'preset/comfy-parameters',
        '"requiredComfyUiParameters" may only hold value-less performance flags such as "--use-quad-cross-attention"; network, path and security flags are not allowed',
        path,
      )
    } else if (Array.isArray(flags) && flags.length > 0) {
      r.warn(
        'review/comfy-parameters',
        `Adds ComfyUI launch flags: ${(flags as string[]).join(' ')}`,
        path,
      )
    }
  }
  if (typeof preset.image === 'string' && preset.image.length > 0) {
    r.warn(
      'preset/inline-image',
      'Ship the thumbnail as a .png next to the preset instead of an inline "image"',
      path,
    )
  }
  return { path, name, type }
}
