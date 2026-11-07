// Maps what main returns from the marketplace servers onto the listing shape the
// marketplace components already render.
import type { InstalledPluginWire, MarketplaceListingWire } from '@/types/marketplaceIpc'
import type { InstalledPlugin, PluginChangelogEntry, PluginListing } from './types'

/** `## 1.2.0` headings (optionally `## 1.2.0 - 2026-11-07`) and the text under each. */
export function parseChangelog(markdown: string | undefined): PluginChangelogEntry[] {
  if (!markdown) return []
  const entries: PluginChangelogEntry[] = []
  let current: PluginChangelogEntry | undefined
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^#{2,3}\s+\[?v?(\d+\.\d+\.\d+[^\]\s]*)\]?(?:\s*[-–(]\s*([\d-]{8,10}))?/.exec(
      line,
    )
    if (heading) {
      current = { version: heading[1], date: heading[2] ?? '', notes: '' }
      entries.push(current)
    } else if (current && line.trim()) {
      current.notes += (current.notes ? '\n' : '') + line.replace(/^\s*[-*]\s+/, '• ')
    }
  }
  return entries
}

export function listingFromWire(wire: MarketplaceListingWire): PluginListing {
  return {
    id: wire.id,
    name: wire.name,
    publisher: wire.publisher,
    trust: wire.trust,
    category: wire.category,
    version: wire.version,
    description: wire.description,
    overview: wire.readme ?? wire.description,
    tags: wire.tags,
    downloads: wire.downloads,
    updatedAt: wire.publishedAt.slice(0, 10),
    license: wire.license,
    repository: wire.repository,
    sizeKb: Math.max(1, Math.round(wire.sizeBytes / 1024)),
    compatibility: wire.engines,
    compatible: wire.compatible,
    permissions: wire.permissions,
    changelog: parseChangelog(wire.changelog),
  }
}

export function installedFromWire(wire: InstalledPluginWire): InstalledPlugin {
  return {
    id: wire.id,
    version: wire.version,
    enabled: wire.enabled,
    revoked: wire.revoked,
    presetNames: wire.presetNames,
  }
}

/** A listing for a plugin that is installed but not in the catalog (local, or revoked). */
export function listingFromInstalled(wire: InstalledPluginWire): PluginListing {
  return {
    id: wire.id,
    name: wire.name,
    publisher: { id: wire.id.split('.')[0], name: wire.id.split('.')[0], verified: false },
    trust: wire.trust,
    category: 'presets',
    version: wire.version,
    description: wire.revoked ? wire.revoked.reason : wire.presetNames.join(', '),
    overview: '',
    tags: [],
    downloads: 0,
    updatedAt: wire.installedAt.slice(0, 10),
    license: '',
    sizeKb: 0,
    compatibility: '',
    permissions: wire.permissions,
    changelog: [],
  }
}
