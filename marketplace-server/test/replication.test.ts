import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import {
  generateSigningKeys,
  hmacHeaders,
  keyId,
  sha256Hex,
  signObject,
  verifyIndex,
  type ReplicationBatch,
  type SignedIndex,
} from '../shared/index.ts'
import { buildMasterApp } from '../master/app.ts'
import type { MasterCore } from '../master/core.ts'
import { pushToMirror } from '../master/replication.ts'
import { buildMirrorApp } from '../mirror/app.ts'
import type { MirrorStore } from '../mirror/store.ts'
import { packExample, tempDir } from './helpers.ts'

type RunningMirror = {
  app: FastifyInstance
  store: MirrorStore
  url: string
  id: string
  secret: string
}

let master: FastifyInstance
let core: MasterCore
let db: DatabaseSync
let masterUrl: string
const mirrors: RunningMirror[] = []

beforeEach(async () => {
  const built = await buildMasterApp({
    host: '127.0.0.1',
    port: 0,
    dataDir: tempDir('aipg-rmaster-'),
    publicUrl: 'http://127.0.0.1',
    registration: 'open',
    maxUploadBytes: 20 * 1024 * 1024,
    replicationIntervalMs: 60_000,
    secureCookies: false,
  })
  master = built.app
  core = built.core
  db = built.db
  masterUrl = await master.listen({ host: '127.0.0.1', port: 0 })
})

afterEach(async () => {
  for (const m of mirrors.splice(0)) await m.app.close()
  await master.close()
})

async function startMirror(name: string, fetchImpl?: typeof fetch): Promise<RunningMirror> {
  const { mirror, secret } = core.addMirror({ name, url: 'http://placeholder.invalid' })
  const { app, store } = await buildMirrorApp(
    {
      host: '127.0.0.1',
      port: 0,
      dataDir: tempDir(`aipg-${name}-`),
      mirrorId: mirror.id,
      mirrorSecret: secret,
      masterUrl,
      masterPublicKeyPem: core.keys.publicKeyPem,
      catchUpIntervalMs: 60_000,
      statsFlushIntervalMs: 60_000,
    },
    { fetchImpl },
  )
  const url = await app.listen({ host: '127.0.0.1', port: 0 })
  db.prepare('UPDATE mirrors SET url = ? WHERE id = ?').run(url, mirror.id)
  const running = { app, store, url, id: mirror.id, secret }
  mirrors.push(running)
  return running
}

function publish(version = '1.0.0') {
  if (!core.publisher('aipg'))
    core.registerPublisher({ id: 'aipg', name: 'AI Playground', email: 'a@b.co' })
  const view = core.submit(core.publisher('aipg')!, packExample('writing-coach', { version }))
  return core.approve(view.id, 'reviewer', 'community')
}

const push = (m: RunningMirror) => pushToMirror(core, core.mirror(m.id)!)
const get = (m: RunningMirror, path: string) => fetch(`${m.url}${path}`)

type PluginList = { total: number; items: { latest: { release: { id: string } } }[] }
type PluginDetail = { versions: string[]; releases: unknown[] }
const getJson = async <T>(m: RunningMirror, path: string) =>
  (await (await get(m, path)).json()) as T

describe('replication', () => {
  it('pushes a release to every mirror, which serve a verifiable catalog and the exact package', async () => {
    const a = await startMirror('eu')
    const b = await startMirror('us')
    const { release } = publish()
    expect(await push(a)).toEqual({ ok: true, seq: 1 })
    expect(await push(b)).toEqual({ ok: true, seq: 1 })

    for (const m of [a, b]) {
      const index = (await (await get(m, '/v1/index')).json()) as SignedIndex
      expect(verifyIndex(index, core.keys.publicKeyPem)).toEqual({ ok: true })
      const list = await getJson<PluginList>(m, '/v1/plugins?q=writing')
      expect(list.items.map((i) => i.latest.release.id)).toEqual(['aipg.writing-coach'])
      const bytes = new Uint8Array(
        await (await get(m, `/v1/packages/${release.sha256}`)).arrayBuffer(),
      )
      expect(sha256Hex(bytes)).toBe(release.sha256)
    }
    expect(core.mirror(a.id)!.last_acked_seq).toBe(1)
  })

  it('lets a mirror that missed pushes catch up from the master feed', async () => {
    const a = await startMirror('eu')
    publish('1.0.0')
    publish('1.1.0')
    expect(a.store.seq()).toBe(0)
    expect(await a.store.catchUp()).toBe(2)
    const detail = await getJson<PluginDetail>(a, '/v1/plugins/aipg.writing-coach')
    expect(detail.versions).toEqual(['1.1.0', '1.0.0'])
    expect(detail.releases).toHaveLength(2)
  })

  it('answers 304 when the catalog has not changed', async () => {
    const a = await startMirror('eu')
    publish()
    await push(a)
    const first = await get(a, '/v1/index')
    const etag = first.headers.get('etag')!
    const again = await fetch(`${a.url}/v1/index`, { headers: { 'if-none-match': etag } })
    expect(again.status).toBe(304)
  })

  it('propagates revocations: the package is gone and the plugin leaves the listing', async () => {
    const a = await startMirror('eu')
    const { release } = publish()
    await push(a)
    core.revoke('aipg.writing-coach', '1.0.0', 'Withdrawn by the publisher')
    expect(await push(a)).toEqual({ ok: true, seq: 2 })
    expect((await get(a, `/v1/packages/${release.sha256}`)).status).toBe(410)
    const list = await getJson<PluginList>(a, '/v1/plugins')
    expect(list.total).toBe(0)
  })

  it('sends download counts back to the master', async () => {
    const a = await startMirror('eu')
    const { release } = publish()
    await push(a)
    await get(a, `/v1/packages/${release.sha256}`)
    await get(a, `/v1/packages/${release.sha256}`)
    await a.store.flushStats()
    expect(core.downloads()).toEqual({ 'aipg.writing-coach': 2 })
  })
})

describe('a mirror refuses', () => {
  it('pushes without its secret', async () => {
    const a = await startMirror('eu')
    publish()
    const body = JSON.stringify(core.batchSince(0))
    const res = await fetch(`${a.url}/v1/replicate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...hmacHeaders(a.id, 'guessed', 'POST', '/v1/replicate', body),
      },
      body,
    })
    expect(res.status).toBe(401)
  })

  it('a catalog signed by any key but the master’s, even with a valid HMAC', async () => {
    const a = await startMirror('eu')
    publish()
    const forger = generateSigningKeys()
    const batch = core.batchSince(0)
    const index = { ...batch.index.index, keyId: keyId(forger.publicKeyPem) }
    const forged: ReplicationBatch = {
      ...batch,
      index: { index, signature: signObject(index, forger.privateKeyPem) },
    }
    const body = JSON.stringify(forged)
    const res = await fetch(`${a.url}/v1/replicate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...hmacHeaders(a.id, a.secret, 'POST', '/v1/replicate', body),
      },
      body,
    })
    expect(res.status).toBe(422)
    expect(a.store.index()).toBeUndefined()
  })

  it('a package whose bytes do not match the signed hash', async () => {
    const tampering: typeof fetch = async (input, init) => {
      const response = await fetch(input, init)
      if (!String(input).includes('/v1/mirror/packages/')) return response
      return new Response(new TextEncoder().encode('swapped bytes'), { status: 200 })
    }
    const a = await startMirror('eu', tampering)
    publish()
    await expect(a.store.catchUp()).rejects.toThrow(/does not match its signed hash/)
    expect(a.store.seq()).toBe(0)
    expect((await get(a, '/v1/index')).status).toBe(503)
  })
})
