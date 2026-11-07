import {
  compareVersions,
  type InstalledPlugin,
  type MarketplaceFilters,
  type MarketplaceView,
  type PluginListing,
} from './types'

export function hasUpdate(listing: PluginListing, installed: InstalledPlugin | undefined): boolean {
  return !!installed && compareVersions(listing.version, installed.version) > 0
}

function matchesSearch(listing: PluginListing, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [listing.name, listing.description, listing.publisher.name, listing.id, ...listing.tags]
    .join(' ')
    .toLowerCase()
    .includes(needle)
}

export function filterCatalog(
  catalog: PluginListing[],
  installed: Record<string, InstalledPlugin>,
  view: MarketplaceView,
  filters: MarketplaceFilters,
): PluginListing[] {
  const rows = catalog.filter((listing) => {
    if (view === 'installed' && !installed[listing.id]) return false
    if (view === 'updates' && !hasUpdate(listing, installed[listing.id])) return false
    if (filters.category !== 'all' && listing.category !== filters.category) return false
    if (filters.trust !== 'all' && listing.trust !== filters.trust) return false
    return matchesSearch(listing, filters.search)
  })
  return rows.sort((a, b) => {
    switch (filters.sort) {
      case 'rating':
        return (
          (b.rating ?? 0) - (a.rating ?? 0) ||
          (b.ratingCount ?? 0) - (a.ratingCount ?? 0) ||
          b.downloads - a.downloads
        )
      case 'recent':
        return b.updatedAt.localeCompare(a.updatedAt)
      case 'name':
        return a.name.localeCompare(b.name)
      default:
        return b.downloads - a.downloads
    }
  })
}

export function formatCount(count: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    count,
  )
}
