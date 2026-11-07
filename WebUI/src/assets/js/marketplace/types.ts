// Renderer-side shapes of the marketplace. Categories and permissions are typed from
// the shared package (marketplace-server/shared) so the two cannot drift; only types
// are imported, because the shared index pulls in node:crypto.
import type {
  PluginCategory as SharedCategory,
  PluginPermission as SharedPermission,
} from '@marketplace-shared'

export type PluginCategory = SharedCategory
export type PluginPermission = SharedPermission

/** `local`: installed from a file or folder by its author, not signed by a master. */
export type PluginTrust = 'verified' | 'community' | 'local'

export type PluginPublisher = {
  id: string
  name: string
  verified: boolean
}

export type PluginChangelogEntry = {
  version: string
  date: string
  notes: string
}

export type PluginListing = {
  /** `<publisher>.<name>`, unique across the registry. */
  id: string
  name: string
  publisher: PluginPublisher
  trust: PluginTrust
  category: PluginCategory
  version: string
  description: string
  overview: string
  tags: string[]
  downloads: number
  rating?: number
  ratingCount?: number
  updatedAt: string
  license: string
  repository?: string
  sizeKb: number
  /** Semver range of AI Playground versions the plugin supports. */
  compatibility: string
  /** False when this app version is outside `compatibility`. */
  compatible?: boolean
  permissions: PluginPermission[]
  /** Model weights the plugin uses; fetched on first use through the permissions layer. */
  models?: { label: string; sizeGb: number }[]
  changelog: PluginChangelogEntry[]
}

export type InstalledPlugin = {
  id: string
  version: string
  enabled: boolean
  revoked?: { reason: string }
  presetNames?: string[]
}

export type MarketplaceView = 'discover' | 'installed' | 'updates' | 'publish'

export type MarketplaceSort = 'popular' | 'rating' | 'recent' | 'name'

export type MarketplaceFilters = {
  search: string
  category: PluginCategory | 'all'
  trust: PluginTrust | 'all'
  sort: MarketplaceSort
}

export const PLUGIN_CATEGORIES: PluginCategory[] = [
  'presets',
  'workflows',
  'agent-skills',
  'tools',
  'themes',
  'channels',
  'languages',
]

export const PLUGIN_PERMISSIONS: PluginPermission[] = [
  'network',
  'filesystem',
  'models',
  'shell',
  'channels',
]

/** Numeric semver compare; a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = a.split('-')
  const [coreB, preB] = b.split('-')
  const pa = coreA.split('.').map(Number)
  const pb = coreB.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (preA === preB) return 0
  if (preA === undefined) return 1
  if (preB === undefined) return -1
  return preA.localeCompare(preB, undefined, { numeric: true })
}
