// What crosses the IPC line for the plugin marketplace. Main fetches and verifies
// against the configured servers; the renderer only ever sees these plain shapes.
import type {
  PluginCategory,
  PluginPermission,
  TrustTier,
  ValidationIssue,
} from '@marketplace-shared'

export type MarketplaceListingWire = {
  id: string
  name: string
  version: string
  description: string
  publisher: { id: string; name: string; verified: boolean }
  trust: TrustTier
  category: PluginCategory
  tags: string[]
  permissions: PluginPermission[]
  license: string
  repository?: string
  readme?: string
  changelog?: string
  sizeBytes: number
  publishedAt: string
  engines: string
  /** False when this app version is outside the plugin's `engines.aipg` range. */
  compatible: boolean
  versions: string[]
  downloads: number
}

export type MarketplaceCatalog = {
  /** False when no marketplace servers are configured; the UI then shows samples. */
  configured: boolean
  mirror?: string
  masterUrl?: string
  seq?: number
  listings: MarketplaceListingWire[]
  /** Set when servers are configured but none answered with a verifiable catalog. */
  error?: string
}

export type InstalledPluginWire = {
  id: string
  version: string
  name: string
  enabled: boolean
  /** `local` for a package installed from a file or folder (not signed by a master). */
  trust: TrustTier | 'local'
  permissions: PluginPermission[]
  presetNames: string[]
  installedAt: string
  revoked?: { reason: string }
}

export type PackageInspection = {
  ok: boolean
  manifest?: { id: string; name: string; version: string; category: PluginCategory }
  presets: { name: string; type: 'chat' | 'comfy' }[]
  issues: ValidationIssue[]
}

export type PublisherInfo = { id: string; name: string; verified: boolean }

export type SubmissionWire = {
  id: number
  pluginId: string
  version: string
  status: 'in-review' | 'changes-requested' | 'rejected' | 'published'
  trust: TrustTier | null
  reviewNote: string | null
  createdAt: string
  updatedAt: string
  issues: ValidationIssue[]
}

export type MarketplaceFailure = { success: false; error: string; issues?: ValidationIssue[] }

/** A marketplace call's result; a failure may list the validation issues behind it. */
export type MarketplaceResult<Fields> = ({ success: true } & Fields) | MarketplaceFailure
