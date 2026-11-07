import { describe, expect, it } from 'vitest'
import { filterCatalog, hasUpdate } from '@/assets/js/marketplace/catalog'
import { SAMPLE_CATALOG } from '@/assets/js/marketplace/sampleCatalog'
import { compareVersions, type MarketplaceFilters } from '@/assets/js/marketplace/types'

const noFilters: MarketplaceFilters = { search: '', category: 'all', trust: 'all', sort: 'popular' }
const anime = SAMPLE_CATALOG.find((l) => l.id === 'aipg.anime-illustration-pack')!

describe('compareVersions', () => {
  it('compares numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
    expect(compareVersions('0.9.3', '1.0.0')).toBeLessThan(0)
  })
})

describe('hasUpdate', () => {
  it('is true only for an installed plugin behind the listing', () => {
    expect(hasUpdate(anime, undefined)).toBe(false)
    expect(hasUpdate(anime, { id: anime.id, version: '1.3.2', enabled: true })).toBe(true)
    expect(hasUpdate(anime, { id: anime.id, version: anime.version, enabled: true })).toBe(false)
  })
})

describe('filterCatalog', () => {
  const installed = { [anime.id]: { id: anime.id, version: '1.3.2', enabled: true } }

  it('sorts discover by downloads by default', () => {
    const rows = filterCatalog(SAMPLE_CATALOG, {}, 'discover', noFilters)
    expect(rows).toHaveLength(SAMPLE_CATALOG.length)
    expect(rows.map((r) => r.downloads)).toEqual(
      [...rows.map((r) => r.downloads)].sort((a, b) => b - a),
    )
  })

  it('limits installed and updates views to what is installed', () => {
    expect(filterCatalog(SAMPLE_CATALOG, installed, 'installed', noFilters)).toEqual([anime])
    expect(filterCatalog(SAMPLE_CATALOG, installed, 'updates', noFilters)).toEqual([anime])
    expect(filterCatalog(SAMPLE_CATALOG, {}, 'updates', noFilters)).toEqual([])
  })

  it('combines trust, category and search', () => {
    const rows = filterCatalog(SAMPLE_CATALOG, {}, 'discover', {
      ...noFilters,
      trust: 'community',
      category: 'tools',
      search: 'OBSIDIAN',
    })
    expect(rows.map((r) => r.id)).toEqual(['kai-m.obsidian-rag'])
  })

  it('matches tags and publisher names', () => {
    const byTag = filterCatalog(SAMPLE_CATALOG, {}, 'discover', { ...noFilters, search: 'lora' })
    expect(byTag.map((r) => r.id)).toContain(anime.id)
    const byPublisher = filterCatalog(SAMPLE_CATALOG, {}, 'discover', {
      ...noFilters,
      search: 'PixelForge',
    })
    expect(byPublisher.every((r) => r.publisher.id === 'pixelforge')).toBe(true)
  })
})
