import { describe, expect, it } from 'vitest'
import { listingFromWire, parseChangelog } from '@/assets/js/marketplace/remote'
import type { MarketplaceListingWire } from '@/types/marketplaceIpc'

describe('parseChangelog', () => {
  it('splits a CHANGELOG.md into version entries', () => {
    const entries = parseChangelog(
      '# Changelog\n\n## 1.1.0 - 2026-11-02\n\n- Faster\n- Smaller\n\n## [1.0.0]\n\nFirst release.\n',
    )
    expect(entries).toEqual([
      { version: '1.1.0', date: '2026-11-02', notes: '• Faster\n• Smaller' },
      { version: '1.0.0', date: '', notes: 'First release.' },
    ])
  })

  it('returns nothing for a missing changelog', () => {
    expect(parseChangelog(undefined)).toEqual([])
  })
})

describe('listingFromWire', () => {
  it('maps a verified catalog entry onto the listing the UI renders', () => {
    const wire: MarketplaceListingWire = {
      id: 'aipg.writing-coach',
      name: 'Writing Coach',
      version: '1.0.0',
      description: 'Reviews your writing',
      publisher: { id: 'aipg', name: 'AI Playground', verified: true },
      trust: 'verified',
      category: 'presets',
      tags: ['writing'],
      permissions: [],
      license: 'Apache-2.0',
      readme: '# Writing Coach',
      changelog: '## 1.0.0\n- First release.',
      sizeBytes: 3000,
      publishedAt: '2026-11-07T10:00:00.000Z',
      engines: '>=3.2.0',
      compatible: true,
      versions: ['1.0.0'],
      downloads: 12,
    }
    expect(listingFromWire(wire)).toMatchObject({
      overview: '# Writing Coach',
      sizeKb: 3,
      updatedAt: '2026-11-07',
      compatibility: '>=3.2.0',
      compatible: true,
      changelog: [{ version: '1.0.0', notes: '• First release.' }],
    })
    expect(listingFromWire(wire).rating).toBeUndefined()
  })
})
