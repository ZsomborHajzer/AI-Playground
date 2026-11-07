// The `aipg-plugin.json` contract. Hand-written validation (no Zod) keeps this file
// importable from the servers, the CLI and the app's main process alike; the JSON
// Schema in aipg-plugin.schema.json describes the same rules for editors and agents.
import { isValidRange, parseVersion } from './semver.ts'

export const MANIFEST_FILE = 'aipg-plugin.json'
export const MANIFEST_VERSION = 1

export const PLUGIN_CATEGORIES = [
  'presets',
  'workflows',
  'agent-skills',
  'tools',
  'themes',
  'channels',
  'languages',
] as const
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number]

/** Categories the master accepts today: everything in them ships as preset files. */
export const ACCEPTED_CATEGORIES: readonly PluginCategory[] = ['presets', 'workflows']

export const PLUGIN_PERMISSIONS = ['network', 'filesystem', 'models', 'shell', 'channels'] as const
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number]

export const SUPPORTED_CONTRIBUTIONS = ['presets'] as const
export const RESERVED_CONTRIBUTIONS = [
  'themes',
  'languages',
  'mcpServers',
  'agentSkills',
  'channels',
] as const

export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}\.[a-z0-9][a-z0-9-]{1,62}$/
export const PUBLISHER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}$/

export type PluginManifest = {
  manifestVersion: 1
  id: string
  name: string
  version: string
  description: string
  license: string
  repository?: string
  homepage?: string
  engines: { aipg: string }
  category: PluginCategory
  tags?: string[]
  permissions: PluginPermission[]
  icon?: string
  contributes: { presets?: string[] }
}

export type ValidationIssue = {
  level: 'error' | 'warning'
  code: string
  message: string
  path?: string
}

export type ManifestResult =
  | { ok: true; manifest: PluginManifest; issues: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] }

const KNOWN_KEYS = new Set([
  'manifestVersion',
  'id',
  'name',
  'version',
  'description',
  'license',
  'repository',
  'homepage',
  'engines',
  'category',
  'tags',
  'permissions',
  'icon',
  'contributes',
])

export function publisherOf(pluginId: string): string {
  return pluginId.split('.')[0]
}

export function validateManifest(value: unknown): ManifestResult {
  const issues: ValidationIssue[] = []
  const error = (path: string, code: string, message: string) =>
    issues.push({ level: 'error', code, message, path })

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      issues: [
        { level: 'error', code: 'manifest/not-object', message: 'Manifest must be a JSON object' },
      ],
    }
  }
  const m = value as Record<string, unknown>
  const str = (key: string, max: number, required = true) => {
    const v = m[key]
    if (v === undefined && !required) return
    if (typeof v !== 'string' || !v.trim())
      error(key, 'manifest/required', `"${key}" must be a non-empty string`)
    else if (v.length > max)
      error(key, 'manifest/too-long', `"${key}" must be at most ${max} characters`)
  }

  if (m.manifestVersion !== MANIFEST_VERSION) {
    error('manifestVersion', 'manifest/version', `"manifestVersion" must be ${MANIFEST_VERSION}`)
  }
  if (typeof m.id !== 'string' || !PLUGIN_ID_PATTERN.test(m.id)) {
    error(
      'id',
      'manifest/id',
      '"id" must look like publisher.plugin-name (lowercase letters, digits, dashes)',
    )
  }
  str('name', 60)
  if (typeof m.version !== 'string' || !parseVersion(m.version)) {
    error('version', 'manifest/semver', '"version" must be semver, e.g. 1.0.0')
  }
  str('description', 160)
  str('license', 64)
  for (const key of ['repository', 'homepage']) {
    const v = m[key]
    if (v !== undefined && (typeof v !== 'string' || !/^https:\/\/\S+$/.test(v))) {
      error(key, 'manifest/url', `"${key}" must be an https:// URL`)
    }
  }
  const engines = m.engines as Record<string, unknown> | undefined
  if (!engines || typeof engines.aipg !== 'string' || !isValidRange(engines.aipg)) {
    error(
      'engines.aipg',
      'manifest/engines',
      '"engines.aipg" must be a version range, e.g. ">=3.2.0"',
    )
  }
  if (!PLUGIN_CATEGORIES.includes(m.category as PluginCategory)) {
    error(
      'category',
      'manifest/category',
      `"category" must be one of ${PLUGIN_CATEGORIES.join(', ')}`,
    )
  }
  if (m.tags !== undefined) {
    if (
      !Array.isArray(m.tags) ||
      m.tags.length > 10 ||
      m.tags.some((t) => typeof t !== 'string' || !t.trim() || t.length > 24)
    ) {
      error('tags', 'manifest/tags', '"tags" must be at most 10 strings of up to 24 characters')
    }
  }
  if (
    !Array.isArray(m.permissions) ||
    m.permissions.some((p) => !PLUGIN_PERMISSIONS.includes(p as PluginPermission)) ||
    new Set(m.permissions).size !== m.permissions.length
  ) {
    error(
      'permissions',
      'manifest/permissions',
      `"permissions" must be a list of distinct values from ${PLUGIN_PERMISSIONS.join(', ')}`,
    )
  }
  if (
    m.icon !== undefined &&
    (typeof m.icon !== 'string' || !/\.(png|jpg|jpeg|webp)$/i.test(m.icon))
  ) {
    error(
      'icon',
      'manifest/icon',
      '"icon" must be a path to a .png, .jpg or .webp file in the package',
    )
  }

  const contributes = m.contributes as Record<string, unknown> | undefined
  if (!contributes || typeof contributes !== 'object' || Array.isArray(contributes)) {
    error('contributes', 'manifest/contributes', '"contributes" must be an object')
  } else {
    for (const key of Object.keys(contributes)) {
      if ((RESERVED_CONTRIBUTIONS as readonly string[]).includes(key)) {
        error(
          `contributes.${key}`,
          'manifest/unsupported-contribution',
          `"${key}" contributions are not supported yet; only presets can be published today`,
        )
      } else if (!(SUPPORTED_CONTRIBUTIONS as readonly string[]).includes(key)) {
        error(
          `contributes.${key}`,
          'manifest/unknown-contribution',
          `Unknown contribution type "${key}"`,
        )
      }
    }
    const presets = contributes.presets
    if (
      !Array.isArray(presets) ||
      presets.length === 0 ||
      presets.some((p) => typeof p !== 'string' || !p.trim())
    ) {
      error(
        'contributes.presets',
        'manifest/presets',
        '"contributes.presets" must list at least one path or pattern, e.g. "presets/*.json"',
      )
    }
  }

  for (const key of Object.keys(m)) {
    if (!KNOWN_KEYS.has(key)) {
      issues.push({
        level: 'warning',
        code: 'manifest/unknown-key',
        message: `Unknown key "${key}" is ignored`,
        path: key,
      })
    }
  }

  if (issues.some((i) => i.level === 'error')) return { ok: false, issues }
  return { ok: true, manifest: m as unknown as PluginManifest, issues }
}
