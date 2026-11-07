import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../observability/logger.ts', () => ({
  appLoggerInstance: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  generateSigningKeys,
  keyId,
  sha256Hex,
  signObject,
  type CatalogIndex,
  type ReleaseRecord,
  type Revocation,
  type SignedRelease,
} from '@marketplace-shared'
import { createPluginHost, type PublisherTokenStore } from '../../plugins/pluginHost'
import AdmZip from 'adm-zip'
import {
  entriesFromFolder,
  entriesFromZip,
  writeEntries,
  zipEntries,
} from '../../plugins/packageIO'
import {
  loadMarketplaceServers,
  type MarketplaceServers,
} from '../../adapters/marketplace/registryClient'

const examples = path.resolve(__dirname, '../../../../marketplace-server/examples')
const keys = generateSigningKeys()
const MIRROR = 'http://mirror.test'
const MASTER = 'http://master.test'
const servers: MarketplaceServers = {
  mirrors: [MIRROR],
  masterUrl: MASTER,
  publicKeyPem: keys.publicKeyPem,
}

type Published = { bytes: Uint8Array; signed: SignedRelease }

function packExample(name: string, manifest: Record<string, unknown> = {}): Uint8Array {
  const entries = entriesFromFolder(path.join(examples, name)).map((e) => {
    if (e.path !== 'aipg-plugin.json' || !Object.keys(manifest).length) return e
    const merged = { ...JSON.parse(new TextDecoder().decode(e.read())), ...manifest }
    const data = new TextEncoder().encode(JSON.stringify(merged))
    return { path: e.path, size: data.length, read: () => data }
  })
  return zipEntries(entries)
}

function release(bytes: Uint8Array, seq: number, signingKey = keys.privateKeyPem): SignedRelease {
  const manifest = JSON.parse(
    new TextDecoder().decode(
      entriesFromFolder(path.join(examples, 'writing-coach'))
        .find((e) => e.path === 'aipg-plugin.json')!
        .read(),
    ),
  )
  const record: ReleaseRecord = {
    id: manifest.id,
    version: manifest.version,
    sha256: sha256Hex(bytes),
    size: bytes.length,
    trust: 'verified',
    publisher: { id: 'aipg', name: 'AI Playground', verified: true },
    manifest,
    publishedAt: '2026-11-07T00:00:00.000Z',
    seq,
    keyId: keyId(keys.publicKeyPem),
  }
  return { release: record, signature: signObject(record, signingKey) }
}

function fakeNetwork(state: {
  published: Published[]
  revoked?: Revocation[]
  seq?: number
  tamper?: boolean
  indexKey?: string
  uploads?: FormData[]
}): typeof fetch {
  return async (input, init) => {
    const url = String(input)
    if (url === `${MIRROR}/v1/index`) {
      const index: CatalogIndex = {
        formatVersion: 1,
        generatedAt: 'now',
        seq: state.seq ?? state.published.length,
        keyId: keyId(keys.publicKeyPem),
        plugins: state.published.map((p) => ({
          latest: p.signed,
          versions: [p.signed.release.version],
        })),
        revoked: state.revoked ?? [],
      }
      return Response.json({
        index,
        signature: signObject(index, state.indexKey ?? keys.privateKeyPem),
      })
    }
    if (url.startsWith(`${MIRROR}/v1/plugins`)) {
      return Response.json({
        items: state.published.map((p) => ({ latest: p.signed, downloads: 7 })),
        pageSize: 100,
      })
    }
    const pkg = /\/v1\/packages\/([0-9a-f]+)$/.exec(url)
    if (pkg) {
      const found = state.published.find((p) => p.signed.release.sha256 === pkg[1])
      if (!found) return new Response('missing', { status: 404 })
      const body = state.tamper ? new TextEncoder().encode('evil') : found.bytes
      return new Response(new Blob([body as Uint8Array<ArrayBuffer>]))
    }
    if (url === `${MASTER}/v1/me`) {
      const auth = new Headers(init?.headers).get('authorization')
      return auth === 'Bearer good'
        ? Response.json({ id: 'aipg', name: 'AI Playground', verified: true })
        : Response.json({ error: 'Missing or invalid publisher token' }, { status: 401 })
    }
    if (url === `${MASTER}/v1/submissions`) {
      state.uploads?.push(init?.body as FormData)
      return Response.json(
        {
          id: 1,
          pluginId: 'aipg.writing-coach',
          version: '1.0.0',
          status: 'in-review',
          issues: [],
        },
        { status: 201 },
      )
    }
    return new Response('not found', { status: 404 })
  }
}

let root: string
const memoryTokens = (): PublisherTokenStore => {
  let token: string | null = null
  return { read: () => token, write: (t) => (token = t) }
}

function host(network: typeof fetch, options: { appVersion?: string; configured?: boolean } = {}) {
  return createPluginHost({
    root,
    appVersion: options.appVersion ?? '3.2.1-beta',
    servers: () => (options.configured === false ? null : servers),
    tokens: memoryTokens(),
    log: { info: () => undefined, warn: () => undefined },
    fetchImpl: network,
  })
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aipg-plugins-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('catalog', () => {
  it('reports "not configured" without servers', async () => {
    expect(await host(fakeNetwork({ published: [] }), { configured: false }).getCatalog()).toEqual({
      configured: false,
      listings: [],
    })
  })

  it('lists verified plugins with compatibility and downloads', async () => {
    const bytes = packExample('writing-coach')
    const catalog = await host(
      fakeNetwork({ published: [{ bytes, signed: release(bytes, 1) }] }),
    ).getCatalog()
    expect(catalog.error).toBeUndefined()
    expect(catalog.listings).toMatchObject([
      { id: 'aipg.writing-coach', trust: 'verified', compatible: true, downloads: 7 },
    ])
  })

  it('refuses a catalog not signed by the pinned master key', async () => {
    const bytes = packExample('writing-coach')
    const network = fakeNetwork({
      published: [{ bytes, signed: release(bytes, 1) }],
      indexKey: generateSigningKeys().privateKeyPem,
    })
    const catalog = await host(network).getCatalog()
    expect(catalog.listings).toEqual([])
    expect(catalog.error).toMatch(/bad index signature/)
  })

  it('refuses a catalog older than one already seen', async () => {
    const bytes = packExample('writing-coach')
    const published = [{ bytes, signed: release(bytes, 1) }]
    await host(fakeNetwork({ published, seq: 5 })).getCatalog()
    const stale = await host(fakeNetwork({ published, seq: 3 })).getCatalog()
    expect(stale.error).toMatch(/older/)
  })
})

describe('install', () => {
  it('installs a verified package and contributes its preset until uninstalled', async () => {
    const bytes = packExample('writing-coach')
    const h = host(fakeNetwork({ published: [{ bytes, signed: release(bytes, 1) }] }))
    const installed = await h.install('aipg.writing-coach')
    expect(installed).toMatchObject({
      version: '1.0.0',
      trust: 'verified',
      enabled: true,
      presetNames: ['Writing Coach'],
    })
    expect(
      fs.existsSync(
        path.join(root, 'aipg.writing-coach', '1.0.0', 'presets', 'writing-coach.json'),
      ),
    ).toBe(true)

    const presets = await h.presetFiles(new Set())
    expect(presets.map((p) => JSON.parse(p.content).name)).toEqual(['Writing Coach'])

    await h.uninstall('aipg.writing-coach')
    expect(await h.listInstalled()).toEqual([])
    expect(await h.presetFiles(new Set())).toEqual([])
  })

  it('refuses package bytes that do not match the signed hash', async () => {
    const bytes = packExample('writing-coach')
    const h = host(fakeNetwork({ published: [{ bytes, signed: release(bytes, 1) }], tamper: true }))
    await expect(h.install('aipg.writing-coach')).rejects.toThrow(/signed hash/)
    expect(await h.listInstalled()).toEqual([])
  })

  it('refuses a plugin built for another app version', async () => {
    const bytes = packExample('writing-coach')
    const h = host(fakeNetwork({ published: [{ bytes, signed: release(bytes, 1) }] }), {
      appVersion: '2.0.0',
    })
    await expect(h.install('aipg.writing-coach')).rejects.toThrow(/needs AI Playground/)
  })

  it('keeps the previous version on update and prunes older ones', async () => {
    const state = { published: [] as Published[] }
    const h = host(fakeNetwork(state))
    for (const [i, version] of ['1.0.0', '1.1.0', '1.2.0'].entries()) {
      const bytes = packExample('writing-coach', { version })
      const signed = release(bytes, i + 1)
      signed.release = {
        ...signed.release,
        version,
        manifest: { ...signed.release.manifest, version },
      }
      signed.signature = signObject(signed.release, keys.privateKeyPem)
      state.published = [{ bytes, signed }]
      await h.getCatalog()
      await h.install('aipg.writing-coach')
    }
    const [record] = await h.listInstalled()
    expect(record.version).toBe('1.2.0')
    expect(fs.readdirSync(path.join(root, 'aipg.writing-coach')).sort()).toEqual(['1.1.0', '1.2.0'])
  })

  it('installs a local folder as an unsigned "local" plugin', async () => {
    const installed = await host(fakeNetwork({ published: [] })).installFromPath(
      path.join(examples, 'upscale-workflow'),
    )
    expect(installed).toMatchObject({
      id: 'aipg.upscale-4x',
      trust: 'local',
      permissions: ['models', 'shell'],
    })
  })
})

describe('presets and revocation', () => {
  it('skips presets whose names are taken and those of disabled plugins', async () => {
    const h = host(fakeNetwork({ published: [] }))
    await h.installFromPath(path.join(examples, 'writing-coach'))
    expect(await h.presetFiles(new Set(['Writing Coach']))).toEqual([])
    await h.setEnabled('aipg.writing-coach', false)
    expect(await h.presetFiles(new Set())).toEqual([])
  })

  it('disables an installed plugin once the catalog revokes it', async () => {
    const bytes = packExample('writing-coach')
    const published = [{ bytes, signed: release(bytes, 1) }]
    await host(fakeNetwork({ published })).install('aipg.writing-coach')
    const revoked = [
      { id: 'aipg.writing-coach', version: '1.0.0', reason: 'Malicious prompt', revokedAt: 'x' },
    ]
    const h = host(fakeNetwork({ published: [], revoked, seq: 2 }))
    await h.getCatalog()
    const [record] = await h.listInstalled()
    expect(record).toMatchObject({ enabled: false, revoked: { reason: 'Malicious prompt' } })
    await expect(h.setEnabled('aipg.writing-coach', true)).rejects.toThrow(/revoked/)
  })
})

describe('publishing', () => {
  it('validates the token with the master before storing it, then uploads', async () => {
    const uploads: FormData[] = []
    const h = host(fakeNetwork({ published: [], uploads }))
    await expect(h.publish(path.join(examples, 'writing-coach'))).rejects.toThrow(/publisher token/)
    await expect(h.setPublisherToken('bad')).rejects.toThrow(/invalid publisher token/)
    expect(await h.setPublisherToken('good')).toMatchObject({ id: 'aipg' })
    const submission = await h.publish(path.join(examples, 'writing-coach'))
    expect(submission).toMatchObject({ status: 'in-review' })
    expect(uploads).toHaveLength(1)
  })

  it('inspects a package with the same rules the master enforces', () => {
    const report = host(fakeNetwork({ published: [] })).inspect(
      path.join(examples, 'upscale-workflow'),
    )
    expect(report.ok).toBe(true)
    expect(report.issues.map((i) => i.code)).toContain('review/custom-nodes')
  })
})

describe('writeEntries', () => {
  it('refuses to write outside the target folder', () => {
    const data = new Uint8Array([1])
    expect(() =>
      writeEntries([{ path: '../escape.txt', size: 1, read: () => data }], root),
    ).toThrow(/Unsafe/)
  })

  it('refuses plugin ids from IPC that are not plugin ids', async () => {
    const keep = path.join(root, 'keep.txt')
    fs.writeFileSync(keep, 'x')
    const plugins = host(fakeNetwork({ published: [] }))
    for (const id of ['..', '.', '../..', 'a/b', ''])
      await expect(plugins.uninstall(id)).rejects.toThrow(/Invalid plugin id/)
    await expect(plugins.setEnabled('..', true)).rejects.toThrow(/Invalid plugin id/)
    expect(fs.existsSync(keep)).toBe(true)
  })

  it('reads zips from other tools but refuses ones a second parser could read differently', () => {
    const other = new AdmZip()
    other.addFile('aipg-plugin.json', Buffer.from('{}'))
    expect(entriesFromZip(new Uint8Array(other.toBuffer())).map((e) => e.path)).toEqual([
      'aipg-plugin.json',
    ])

    const hidden = new AdmZip()
    hidden.addFile('presets/evil.json', Buffer.from('{"evil":true}'))
    const polyglot = new Uint8Array([
      ...new Uint8Array(hidden.toBuffer()).subarray(0, 60),
      ...packExample('writing-coach'),
    ])
    expect(() => entriesFromZip(polyglot)).toThrow(/Not a valid package zip/)
  })
})

describe('server config', () => {
  it('drops a master URL that would send the publisher token in clear text', () => {
    const pem = keys.publicKeyPem
    const write = (masterUrl: string) =>
      fs.writeFileSync(
        path.join(root, 'marketplace.json'),
        JSON.stringify({ mirrors: [MIRROR], masterUrl, publicKeyPem: pem }),
      )
    write('http://master.example.com')
    expect(loadMarketplaceServers(root)?.masterUrl).toBe('')
    write('http://127.0.0.1:7480')
    expect(loadMarketplaceServers(root)?.masterUrl).toBe('http://127.0.0.1:7480')
    write('https://master.example.com/')
    expect(loadMarketplaceServers(root)?.masterUrl).toBe('https://master.example.com')
  })
})
