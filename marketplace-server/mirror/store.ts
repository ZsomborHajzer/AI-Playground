// A mirror's state: the signed index it serves, every signed release it has seen,
// the package files, and download counts. Nothing is accepted without the master's
// signature, and the served index never points at a package that is not on disk.
import fs from 'node:fs'
import path from 'node:path'
import {
  hmacHeaders,
  sha256Hex,
  verifyIndex,
  verifyRelease,
  type ReplicationBatch,
  type SignedIndex,
  type SignedRelease,
} from '../shared/index.ts'
import type { MirrorConfig } from './config.ts'

type State = { seq: number; releases: Record<string, SignedRelease>; revoked: string[] }

export type MirrorStore = ReturnType<typeof createMirrorStore>

const releaseKey = (id: string, version: string) => `${id}@${version}`

function writeAtomic(file: string, content: string | Uint8Array) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, file)
}

export function createMirrorStore(config: MirrorConfig, fetchImpl: typeof fetch = fetch) {
  const packagesDir = path.join(config.dataDir, 'packages')
  fs.mkdirSync(packagesDir, { recursive: true })
  const stateFile = path.join(config.dataDir, 'state.json')
  const indexFile = path.join(config.dataDir, 'index.json')

  let state: State = fs.existsSync(stateFile)
    ? (JSON.parse(fs.readFileSync(stateFile, 'utf8')) as State)
    : { seq: 0, releases: {}, revoked: [] }
  let index: SignedIndex | undefined = fs.existsSync(indexFile)
    ? (JSON.parse(fs.readFileSync(indexFile, 'utf8')) as SignedIndex)
    : undefined
  let masterDownloads: Record<string, number> = {}
  let pendingDownloads: Record<string, number> = {}
  let queue: Promise<unknown> = Promise.resolve()

  const packagePath = (sha256: string) => path.join(packagesDir, `${sha256}.aipgx`)
  const hasPackage = (sha256: string) => fs.existsSync(packagePath(sha256))

  async function masterRequest(method: 'GET' | 'POST', urlPath: string, body?: string) {
    const response = await fetchImpl(`${config.masterUrl}${urlPath}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...hmacHeaders(config.mirrorId, config.mirrorSecret, method, urlPath, body ?? ''),
      },
      body,
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`master ${method} ${urlPath}: HTTP ${response.status}`)
    return response
  }

  async function ensurePackage(release: SignedRelease) {
    const { sha256, id, version } = release.release
    if (hasPackage(sha256)) return
    const response = await masterRequest('GET', `/v1/mirror/packages/${sha256}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (sha256Hex(bytes) !== sha256)
      throw new Error(`package for ${id}@${version} does not match its signed hash`)
    writeAtomic(packagePath(sha256), bytes)
  }

  async function apply(batch: ReplicationBatch): Promise<number> {
    const check = verifyIndex(batch.index, config.masterPublicKeyPem, index?.index.seq ?? 0)
    if (!check.ok) throw new Error(`rejected index: ${check.reason}`)
    const next: State = {
      seq: state.seq,
      releases: { ...state.releases },
      revoked: [...state.revoked],
    }
    for (const event of [...batch.events].sort((a, b) => a.seq - b.seq)) {
      if (event.seq <= next.seq) continue
      if (event.seq !== next.seq + 1) break
      if (event.type === 'release') {
        if (!verifyRelease(event.release, config.masterPublicKeyPem)) {
          throw new Error(`rejected release at seq ${event.seq}: bad signature`)
        }
        await ensurePackage(event.release)
        const { id, version } = event.release.release
        next.releases[releaseKey(id, version)] = event.release
      } else {
        const { id, version } = event.revocation
        next.revoked.push(version === '*' ? `${id}@*` : releaseKey(id, version))
      }
      next.seq = event.seq
    }
    for (const entry of batch.index.index.plugins) {
      await ensurePackage(entry.latest)
      next.releases[releaseKey(entry.latest.release.id, entry.latest.release.version)] ??=
        entry.latest
    }
    // Only an index whose events have all been applied may be served.
    if (next.seq >= batch.index.index.seq) {
      writeAtomic(indexFile, JSON.stringify(batch.index))
      index = batch.index
    }
    writeAtomic(stateFile, JSON.stringify(next))
    state = next
    masterDownloads = batch.downloads ?? masterDownloads
    return state.seq
  }

  /** Serialized, so a push and a catch-up never interleave. */
  const applyBatch = (batch: ReplicationBatch) => {
    const run = queue.then(() => apply(batch))
    queue = run.catch(() => undefined)
    return run
  }

  async function catchUp(): Promise<number> {
    for (let round = 0; round < 50; round++) {
      const before = state.seq
      const response = await masterRequest('GET', `/v1/mirror/feed?since=${state.seq}`)
      const batch = (await response.json()) as ReplicationBatch
      await applyBatch(batch)
      if (batch.events.length === 0 || state.seq === before) break
    }
    return state.seq
  }

  function countDownload(sha256: string) {
    const release = Object.values(state.releases).find((r) => r.release.sha256 === sha256)
    if (!release) return
    pendingDownloads[release.release.id] = (pendingDownloads[release.release.id] ?? 0) + 1
  }

  async function flushStats() {
    if (Object.keys(pendingDownloads).length === 0) return
    const counts = pendingDownloads
    pendingDownloads = {}
    try {
      await masterRequest('POST', '/v1/mirror/stats', JSON.stringify({ counts }))
      for (const [id, n] of Object.entries(counts))
        masterDownloads[id] = (masterDownloads[id] ?? 0) + n
    } catch (e) {
      for (const [id, n] of Object.entries(counts))
        pendingDownloads[id] = (pendingDownloads[id] ?? 0) + n
      throw e
    }
  }

  const isRevoked = (id: string, version: string) =>
    state.revoked.includes(releaseKey(id, version)) || state.revoked.includes(`${id}@*`)

  return {
    applyBatch,
    catchUp,
    flushStats,
    countDownload,
    isRevoked,
    seq: () => state.seq,
    index: () => index,
    release: (id: string, version: string) => state.releases[releaseKey(id, version)],
    releasesOf: (id: string) =>
      Object.values(state.releases).filter(
        (r) => r.release.id === id && !isRevoked(id, r.release.version),
      ),
    downloads: (id: string) => (masterDownloads[id] ?? 0) + (pendingDownloads[id] ?? 0),
    packagePath: (sha256: string) =>
      /^[0-9a-f]{64}$/.test(sha256) && hasPackage(sha256) ? packagePath(sha256) : undefined,
    releaseForPackage: (sha256: string) =>
      Object.values(state.releases).find((r) => r.release.sha256 === sha256),
  }
}
