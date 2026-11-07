// HTTP to the marketplace servers. Mirrors are not trusted: the catalog and every
// package are checked against the master public key the app ships with.
import fs from 'node:fs'
import path from 'node:path'
import {
  sha256Hex,
  verifyIndex,
  verifyRelease,
  type CatalogIndex,
  type SignedIndex,
  type SignedRelease,
} from '@marketplace-shared'
import type { PublisherInfo, SubmissionWire } from '@/types/marketplaceIpc'

export type MarketplaceServers = { mirrors: string[]; masterUrl: string; publicKeyPem: string }

const REQUEST_TIMEOUT_MS = 10_000
const DOWNLOAD_TIMEOUT_MS = 120_000
const MAX_INDEX_BYTES = 32 * 1024 * 1024
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const LOOPBACK_URL = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/

/** Reads a body but stops at `limit` bytes, so a hostile server cannot exhaust memory. */
async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > limit) throw new Error(`response is larger than ${limit} bytes`)
  if (!response.body) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      await reader.cancel()
      throw new Error(`response is larger than ${limit} bytes`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

const readJsonLimited = async <T>(response: Response, limit: number): Promise<T> =>
  JSON.parse(new TextDecoder().decode(await readLimited(response, limit))) as T

/** `external/marketplace.local.json` (dev cluster, gitignored) wins over the shipped `marketplace.json`. */
export function loadMarketplaceServers(externalDir: string): MarketplaceServers | null {
  for (const name of ['marketplace.local.json', 'marketplace.json']) {
    const file = path.join(externalDir, name)
    if (!fs.existsSync(file)) continue
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<MarketplaceServers>
      const mirrors = (raw.mirrors ?? []).filter((m) => /^https?:\/\/\S+$/.test(m))
      // The publisher token travels to the master, so it must not cross the network in clear text.
      const masterUrl = (raw.masterUrl ?? '').replace(/\/+$/, '')
      const safeMaster = masterUrl.startsWith('https://') || LOOPBACK_URL.test(masterUrl)
      if (mirrors.length && raw.publicKeyPem?.includes('BEGIN PUBLIC KEY')) {
        return {
          mirrors: mirrors.map((m) => m.replace(/\/+$/, '')),
          masterUrl: safeMaster ? masterUrl : '',
          publicKeyPem: raw.publicKeyPem,
        }
      }
    } catch {
      // Fall through to the next file; an unreadable config means "not configured".
    }
  }
  return null
}

export type VerifiedCatalog = {
  mirror: string
  index: CatalogIndex
  downloads: Record<string, number>
}

export async function fetchVerifiedCatalog(
  servers: MarketplaceServers,
  minSeq: number,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifiedCatalog> {
  const failures: string[] = []
  for (const mirror of servers.mirrors) {
    try {
      const response = await fetchImpl(`${mirror}/v1/index`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const signed = await readJsonLimited<SignedIndex>(response, MAX_INDEX_BYTES)
      const check = verifyIndex(signed, servers.publicKeyPem, minSeq)
      if (!check.ok) throw new Error(check.reason)
      return { mirror, index: signed.index, downloads: await fetchDownloads(mirror, fetchImpl) }
    } catch (e) {
      failures.push(`${mirror}: ${(e as Error).message}`)
    }
  }
  throw new Error(`No marketplace server returned a verifiable catalog (${failures.join('; ')})`)
}

/** Popularity is unsigned and optional: a failure here just means zero downloads shown. */
async function fetchDownloads(mirror: string, fetchImpl: typeof fetch) {
  const downloads: Record<string, number> = {}
  try {
    for (let page = 1; page <= 20; page++) {
      const response = await fetchImpl(`${mirror}/v1/plugins?pageSize=100&page=${page}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) break
      const body = await readJsonLimited<{
        items: { latest: { release: { id: string } }; downloads: number }[]
        pageSize: number
      }>(response, MAX_INDEX_BYTES)
      for (const item of body.items) downloads[item.latest.release.id] = item.downloads
      if (body.items.length < body.pageSize) break
    }
  } catch {
    // see above
  }
  return downloads
}

/** The package bytes, from the first mirror that serves bytes matching the signed hash. */
export async function downloadVerifiedPackage(
  servers: MarketplaceServers,
  release: SignedRelease,
  preferredMirror?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  if (!verifyRelease(release, servers.publicKeyPem)) {
    throw new Error(`The release record for ${release.release.id} is not signed by the master`)
  }
  const order = preferredMirror
    ? [preferredMirror, ...servers.mirrors.filter((m) => m !== preferredMirror)]
    : servers.mirrors
  const failures: string[] = []
  for (const mirror of order) {
    try {
      const response = await fetchImpl(`${mirror}/v1/packages/${release.release.sha256}`, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = await readLimited(response, release.release.size)
      if (sha256Hex(bytes) !== release.release.sha256)
        throw new Error('bytes do not match the signed hash')
      return bytes
    } catch (e) {
      failures.push(`${mirror}: ${(e as Error).message}`)
    }
  }
  throw new Error(`Could not download ${release.release.id}: ${failures.join('; ')}`)
}

async function masterJson<T>(
  servers: MarketplaceServers,
  token: string,
  urlPath: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; body: T & { error?: string; issues?: [] } }> {
  if (!servers.masterUrl) throw new Error('No master server is configured for publishing')
  const response = await fetchImpl(`${servers.masterUrl}${urlPath}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  const text = new TextDecoder().decode(await readLimited(response, MAX_RESPONSE_BYTES))
  let body: T & { error?: string; issues?: [] }
  try {
    body = JSON.parse(text)
  } catch {
    body = { error: text || response.statusText } as T & { error?: string }
  }
  return { ok: response.ok, status: response.status, body }
}

export async function fetchPublisher(
  servers: MarketplaceServers,
  token: string,
  fetchImpl?: typeof fetch,
): Promise<PublisherInfo> {
  const result = await masterJson<PublisherInfo>(servers, token, '/v1/me', {}, fetchImpl)
  if (!result.ok) throw new Error(result.body.error ?? `HTTP ${result.status}`)
  return { id: result.body.id, name: result.body.name, verified: result.body.verified }
}

export async function fetchSubmissions(
  servers: MarketplaceServers,
  token: string,
  fetchImpl?: typeof fetch,
): Promise<SubmissionWire[]> {
  const result = await masterJson<{ submissions: SubmissionWire[] }>(
    servers,
    token,
    '/v1/me/submissions',
    {},
    fetchImpl,
  )
  if (!result.ok) throw new Error(result.body.error ?? `HTTP ${result.status}`)
  return result.body.submissions
}

export async function uploadPackage(
  servers: MarketplaceServers,
  token: string,
  bytes: Uint8Array,
  fileName: string,
  fetchImpl?: typeof fetch,
) {
  const form = new FormData()
  form.append('package', new Blob([bytes as Uint8Array<ArrayBuffer>]), fileName)
  return masterJson<SubmissionWire>(
    servers,
    token,
    '/v1/submissions',
    { method: 'POST', body: form },
    fetchImpl,
  )
}
