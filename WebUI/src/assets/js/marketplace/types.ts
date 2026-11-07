// Shapes of the plugin marketplace. Kept free of Vue/Pinia imports so the main
// process can share them once the registry client lands (docs/marketplace-plan.md).

export type PluginCategory =
  'presets' | 'workflows' | 'agent-skills' | 'tools' | 'themes' | 'channels' | 'languages'

export type PluginTrust = 'verified' | 'community'

export type PluginPermission = 'network' | 'filesystem' | 'models' | 'shell' | 'channels'

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
  rating: number
  ratingCount: number
  updatedAt: string
  license: string
  repository?: string
  sizeKb: number
  /** Semver range of AI Playground versions the plugin supports. */
  compatibility: string
  permissions: PluginPermission[]
  /** Model weights the plugin uses; fetched on first use through the permissions layer. */
  models?: { label: string; sizeGb: number }[]
  changelog: PluginChangelogEntry[]
}

export type InstalledPlugin = {
  id: string
  version: string
  enabled: boolean
}

export type MarketplaceView = 'discover' | 'installed' | 'updates' | 'publish'

export type MarketplaceSort = 'popular' | 'rating' | 'recent' | 'name'

export type MarketplaceFilters = {
  search: string
  category: PluginCategory | 'all'
  trust: PluginTrust | 'all'
  sort: MarketplaceSort
}

export type SubmissionStatus = 'in-review' | 'published' | 'changes-requested'

export type PluginSubmissionDraft = {
  fileName: string
  id: string
  name: string
  category: PluginCategory
  version: string
  description: string
  repository: string
  permissions: PluginPermission[]
  requestVerified: boolean
}

export type PluginSubmission = PluginSubmissionDraft & {
  submittedAt: string
  status: SubmissionStatus
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

export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

/** Numeric semver compare, ignoring pre-release tags. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('-')[0].split('.').map(Number)
  const [pa, pb] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
