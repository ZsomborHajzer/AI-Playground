// What the master signs and the mirrors and app verify. The master's public key is
// the only thing a client has to trust; mirrors only store and serve these objects.
import type { PluginManifest } from './manifest.ts'
import { keyId, verifyObject } from './signing.ts'

export type TrustTier = 'verified' | 'community'

export type ReleaseRecord = {
  id: string
  version: string
  sha256: string
  size: number
  trust: TrustTier
  publisher: { id: string; name: string; verified: boolean }
  manifest: PluginManifest
  readme?: string
  changelog?: string
  publishedAt: string
  seq: number
  keyId: string
}

export type SignedRelease = { release: ReleaseRecord; signature: string }

export type Revocation = { id: string; version: string; reason: string; revokedAt: string }

export type CatalogEntry = {
  latest: SignedRelease
  /** Every published, non-revoked version, newest first. */
  versions: string[]
}

export type CatalogIndex = {
  formatVersion: 1
  generatedAt: string
  seq: number
  keyId: string
  plugins: CatalogEntry[]
  revoked: Revocation[]
}

export type SignedIndex = { index: CatalogIndex; signature: string }

/** What a mirror lists: a signed release plus unsigned popularity data. */
export type Listing = CatalogEntry & { downloads: number }

export type ReplicationEvent =
  | { seq: number; type: 'release'; release: SignedRelease }
  | { seq: number; type: 'revoke'; revocation: Revocation }

/** One push from master to mirror, and the shape the catch-up feed returns too. */
export type ReplicationBatch = {
  events: ReplicationEvent[]
  index: SignedIndex
  downloads: Record<string, number>
}

export function verifyRelease(signed: SignedRelease, publicKeyPem: string): boolean {
  return (
    signed.release.keyId === keyId(publicKeyPem) &&
    verifyObject(signed.release, signed.signature, publicKeyPem)
  )
}

export type IndexCheck = { ok: true } | { ok: false; reason: string }

/**
 * Checks the index signature, every release inside it, and that the index is not
 * older than one already seen (a mirror replaying an old index to hide a revocation).
 */
export function verifyIndex(signed: SignedIndex, publicKeyPem: string, minSeq = 0): IndexCheck {
  if (signed.index.keyId !== keyId(publicKeyPem))
    return { ok: false, reason: 'signed by an unknown key' }
  if (!verifyObject(signed.index, signed.signature, publicKeyPem))
    return { ok: false, reason: 'bad index signature' }
  if (signed.index.seq < minSeq)
    return {
      ok: false,
      reason: `index is older (seq ${signed.index.seq}) than one already seen (${minSeq})`,
    }
  for (const entry of signed.index.plugins) {
    if (!verifyRelease(entry.latest, publicKeyPem))
      return { ok: false, reason: `bad signature on ${entry.latest.release.id}` }
  }
  return { ok: true }
}

export function isRevoked(
  index: CatalogIndex,
  id: string,
  version: string,
): Revocation | undefined {
  return index.revoked.find((r) => r.id === id && (r.version === version || r.version === '*'))
}
