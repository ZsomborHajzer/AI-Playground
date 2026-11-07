// The master's domain logic, free of HTTP: publishers, submissions and their review,
// signing, the replication event log and the signed catalog index.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  PUBLISHER_ID_PATTERN,
  compareVersions,
  sha256Hex,
  signObject,
  validatePackage,
  type CatalogEntry,
  type CatalogIndex,
  type PackageReport,
  type PluginManifest,
  type ReleaseRecord,
  type ReplicationBatch,
  type ReplicationEvent,
  type Revocation,
  type SignedIndex,
  type SignedRelease,
  type TrustTier,
} from '../shared/index.ts'
import { readZip } from '../lib/zip.ts'
import { newPublisherToken } from './auth.ts'
import {
  nowIso,
  transaction,
  type EventRow,
  type MirrorRow,
  type PublisherRow,
  type ReleaseRow,
  type SubmissionRow,
} from './db.ts'
import type { SigningKeys } from './keys.ts'

export type HttpError = Error & { statusCode: number; details?: unknown }

export function httpError(statusCode: number, message: string, details?: unknown): HttpError {
  return Object.assign(new Error(message), { statusCode, details })
}

export type SubmissionView = {
  id: number
  pluginId: string
  version: string
  status: SubmissionRow['status']
  trust: TrustTier | null
  reviewNote: string | null
  createdAt: string
  updatedAt: string
  issues: PackageReport['issues']
}

export type MasterCore = ReturnType<typeof createMasterCore>

export function createMasterCore(options: {
  db: DatabaseSync
  keys: SigningKeys
  dataDir: string
}) {
  const { db, keys } = options
  const packagesDir = path.join(options.dataDir, 'packages')
  fs.mkdirSync(packagesDir, { recursive: true })
  let cachedIndex: SignedIndex | undefined
  const listeners = new Set<() => void>()

  const changed = () => {
    cachedIndex = undefined
    for (const listener of listeners) listener()
  }

  // ── publishers ───────────────────────────────────────────────────────────

  function registerPublisher(input: { id: string; name: string; email: string }) {
    const id = input.id?.trim().toLowerCase()
    const name = input.name?.trim()
    const email = input.email?.trim()
    if (!PUBLISHER_ID_PATTERN.test(id ?? '')) {
      throw httpError(400, 'Publisher id must be 2-39 lowercase letters, digits or dashes')
    }
    if (!name || name.length > 60) throw httpError(400, 'Name must be 1-60 characters')
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      throw httpError(400, 'A valid email is required')
    if (db.prepare('SELECT 1 FROM publishers WHERE id = ?').get(id)) {
      throw httpError(409, `Publisher id "${id}" is taken`)
    }
    const token = newPublisherToken(id)
    db.prepare(
      'INSERT INTO publishers (id, name, email, token_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, name, email, sha256Hex(token), nowIso())
    return { publisher: publisher(id)!, token }
  }

  const publisher = (id: string) =>
    db.prepare('SELECT * FROM publishers WHERE id = ?').get(id) as PublisherRow | undefined

  const publishers = () =>
    db.prepare('SELECT * FROM publishers ORDER BY created_at DESC').all() as PublisherRow[]

  function rotateToken(id: string): string {
    if (!publisher(id)) throw httpError(404, 'No such publisher')
    const token = newPublisherToken(id)
    db.prepare('UPDATE publishers SET token_hash = ? WHERE id = ?').run(sha256Hex(token), id)
    return token
  }

  function setPublisherFlag(id: string, flag: 'verified' | 'disabled', value: boolean) {
    db.prepare(`UPDATE publishers SET ${flag} = ? WHERE id = ?`).run(value ? 1 : 0, id)
  }

  // ── submissions ──────────────────────────────────────────────────────────

  const latestPublished = (pluginId: string): string | undefined => {
    const versions = db
      .prepare('SELECT version FROM releases WHERE plugin_id = ?')
      .all(pluginId) as { version: string }[]
    return versions
      .map((v) => v.version)
      .sort(compareVersions)
      .pop()
  }

  function submit(owner: PublisherRow, bytes: Uint8Array): SubmissionView {
    const zip = readZip(bytes)
    if ('error' in zip) {
      throw httpError(422, 'The upload is not a readable .aipgx package', [
        { level: 'error', code: 'package/zip', message: zip.error },
      ])
    }
    const peek = validatePackage(zip.entries)
    const latestVersion = peek.manifest ? latestPublished(peek.manifest.id) : undefined
    const report = validatePackage(zip.entries, {
      publisherId: owner.id,
      latestVersion,
      enforcePolicy: true,
    })
    if (!report.ok || !report.manifest) {
      throw httpError(422, 'The package did not pass the automated checks', report.issues)
    }
    const manifest = report.manifest
    const pending = db
      .prepare(
        "SELECT id FROM submissions WHERE plugin_id = ? AND version = ? AND status = 'in-review'",
      )
      .get(manifest.id, manifest.version)
    if (pending) {
      throw httpError(409, `${manifest.id}@${manifest.version} is already waiting for review`)
    }
    const sha256 = sha256Hex(bytes)
    const file = path.join(packagesDir, `${sha256}.aipgx`)
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes)
    const now = nowIso()
    const result = db
      .prepare(
        `INSERT INTO submissions (publisher_id, plugin_id, version, sha256, size, status, report_json,
           manifest_json, readme, changelog, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'in-review', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        owner.id,
        manifest.id,
        manifest.version,
        sha256,
        bytes.length,
        JSON.stringify(report),
        JSON.stringify(manifest),
        report.readme ?? null,
        report.changelog ?? null,
        now,
        now,
      )
    changed()
    return view(submission(Number(result.lastInsertRowid))!)
  }

  const submission = (id: number) =>
    db.prepare('SELECT * FROM submissions WHERE id = ?').get(id) as SubmissionRow | undefined

  function view(row: SubmissionRow): SubmissionView {
    const report = JSON.parse(row.report_json) as PackageReport
    return {
      id: row.id,
      pluginId: row.plugin_id,
      version: row.version,
      status: row.status,
      trust: (row.trust as TrustTier | null) ?? null,
      reviewNote: row.review_note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      issues: report.issues,
    }
  }

  const submissionsFor = (publisherId: string) =>
    (
      db
        .prepare('SELECT * FROM submissions WHERE publisher_id = ? ORDER BY id DESC LIMIT 200')
        .all(publisherId) as SubmissionRow[]
    ).map(view)

  const submissionsByStatus = (status: SubmissionRow['status'] | 'decided', limit = 100) =>
    (status === 'decided'
      ? db
          .prepare(
            "SELECT * FROM submissions WHERE status != 'in-review' ORDER BY updated_at DESC LIMIT ?",
          )
          .all(limit)
      : db
          .prepare('SELECT * FROM submissions WHERE status = ? ORDER BY id ASC LIMIT ?')
          .all(status, limit)) as SubmissionRow[]

  const readPackage = (sha256: string): Uint8Array | undefined => {
    if (!/^[0-9a-f]{64}$/.test(sha256)) return undefined
    const file = path.join(packagesDir, `${sha256}.aipgx`)
    return fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : undefined
  }

  // ── review decisions ─────────────────────────────────────────────────────

  function decide(
    id: number,
    reviewer: string,
    decision: 'changes-requested' | 'rejected',
    note: string,
  ) {
    const row = submission(id)
    if (!row) throw httpError(404, 'No such submission')
    if (row.status !== 'in-review') throw httpError(409, `Submission is already ${row.status}`)
    if (!note.trim()) throw httpError(400, 'Tell the publisher why, in the note')
    db.prepare(
      'UPDATE submissions SET status = ?, reviewer = ?, review_note = ?, updated_at = ? WHERE id = ?',
    ).run(decision, reviewer, note.trim(), nowIso(), id)
    changed()
  }

  const nextSeq = () =>
    ((db.prepare('SELECT MAX(seq) AS seq FROM events').get() as { seq: number | null }).seq ?? 0) +
    1

  function appendEvent(event: ReplicationEvent) {
    db.prepare('INSERT INTO events (seq, type, payload_json, created_at) VALUES (?, ?, ?, ?)').run(
      event.seq,
      event.type,
      JSON.stringify(event),
      nowIso(),
    )
  }

  function approve(id: number, reviewer: string, trust: TrustTier, note = ''): SignedRelease {
    const signed = transaction(db, () => {
      const row = submission(id)
      if (!row) throw httpError(404, 'No such submission')
      if (row.status !== 'in-review') throw httpError(409, `Submission is already ${row.status}`)
      const owner = publisher(row.publisher_id)!
      if (trust === 'verified' && !owner.verified) {
        throw httpError(
          409,
          'Only a verified publisher can receive the Verified tier; verify the publisher first',
        )
      }
      const latest = latestPublished(row.plugin_id)
      if (latest && compareVersions(row.version, latest) <= 0) {
        throw httpError(409, `${row.version} is not newer than the published ${latest}`)
      }
      const seq = nextSeq()
      const release: ReleaseRecord = {
        id: row.plugin_id,
        version: row.version,
        sha256: row.sha256,
        size: row.size,
        trust,
        publisher: { id: owner.id, name: owner.name, verified: !!owner.verified },
        manifest: JSON.parse(row.manifest_json) as PluginManifest,
        readme: row.readme ?? undefined,
        changelog: row.changelog ?? undefined,
        publishedAt: nowIso(),
        seq,
        keyId: keys.keyId,
      }
      const signedRelease: SignedRelease = {
        release,
        signature: signObject(release, keys.privateKeyPem),
      }
      appendEvent({ seq, type: 'release', release: signedRelease })
      db.prepare(
        'INSERT INTO releases (plugin_id, version, seq, sha256, signed_json, published_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        release.id,
        release.version,
        seq,
        release.sha256,
        JSON.stringify(signedRelease),
        release.publishedAt,
      )
      db.prepare(
        "UPDATE submissions SET status = 'published', trust = ?, reviewer = ?, review_note = ?, updated_at = ? WHERE id = ?",
      ).run(trust, reviewer, note.trim() || null, nowIso(), id)
      return signedRelease
    })
    changed()
    return signed
  }

  function revoke(pluginId: string, version: string, reason: string) {
    if (!reason.trim()) throw httpError(400, 'A revocation needs a reason; users see it')
    transaction(db, () => {
      const rows = db
        .prepare(
          version === '*'
            ? 'SELECT version FROM releases WHERE plugin_id = ? AND revoked = 0'
            : 'SELECT version FROM releases WHERE plugin_id = ? AND version = ? AND revoked = 0',
        )
        .all(...(version === '*' ? [pluginId] : [pluginId, version])) as { version: string }[]
      if (rows.length === 0) throw httpError(404, 'Nothing published to revoke')
      const revocation: Revocation = {
        id: pluginId,
        version,
        reason: reason.trim(),
        revokedAt: nowIso(),
      }
      appendEvent({ seq: nextSeq(), type: 'revoke', revocation })
      for (const r of rows) {
        db.prepare(
          'UPDATE releases SET revoked = 1, revoke_reason = ? WHERE plugin_id = ? AND version = ?',
        ).run(reason.trim(), pluginId, r.version)
      }
    })
    changed()
  }

  // ── catalog and replication ──────────────────────────────────────────────

  const currentSeq = () => nextSeq() - 1

  const releases = () =>
    db.prepare('SELECT * FROM releases ORDER BY plugin_id, seq DESC').all() as ReleaseRow[]

  function signedIndex(): SignedIndex {
    if (cachedIndex) return cachedIndex
    const byPlugin = new Map<string, ReleaseRow[]>()
    for (const row of releases()) {
      if (!row.revoked) byPlugin.set(row.plugin_id, [...(byPlugin.get(row.plugin_id) ?? []), row])
    }
    const revoked = (
      db.prepare("SELECT payload_json FROM events WHERE type = 'revoke' ORDER BY seq").all() as {
        payload_json: string
      }[]
    ).map((r) => (JSON.parse(r.payload_json) as { revocation: Revocation }).revocation)
    const plugins: CatalogEntry[] = [...byPlugin.values()].map((rows) => {
      const sorted = rows.sort((a, b) => compareVersions(b.version, a.version))
      return {
        latest: JSON.parse(sorted[0].signed_json) as SignedRelease,
        versions: sorted.map((r) => r.version),
      }
    })
    const index: CatalogIndex = {
      formatVersion: 1,
      generatedAt: nowIso(),
      seq: currentSeq(),
      keyId: keys.keyId,
      plugins,
      revoked,
    }
    cachedIndex = { index, signature: signObject(index, keys.privateKeyPem) }
    return cachedIndex
  }

  function batchSince(since: number, limit = 200): ReplicationBatch {
    const events = (
      db
        .prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?')
        .all(since, limit) as EventRow[]
    ).map((e) => JSON.parse(e.payload_json) as ReplicationEvent)
    return { events, index: signedIndex(), downloads: downloads() }
  }

  const downloads = (): Record<string, number> =>
    Object.fromEntries(
      (
        db.prepare('SELECT plugin_id, count FROM downloads').all() as {
          plugin_id: string
          count: number
        }[]
      ).map((r) => [r.plugin_id, r.count]),
    )

  function addDownloads(counts: Record<string, unknown>) {
    const add = db.prepare(
      'INSERT INTO downloads (plugin_id, count) VALUES (?, ?) ON CONFLICT(plugin_id) DO UPDATE SET count = count + excluded.count',
    )
    transaction(db, () => {
      for (const [pluginId, count] of Object.entries(counts)) {
        if (typeof count === 'number' && Number.isInteger(count) && count > 0 && count < 1e7) {
          add.run(pluginId, count)
        }
      }
    })
  }

  // ── mirrors ──────────────────────────────────────────────────────────────

  function addMirror(input: { name: string; url: string }) {
    const name = input.name?.trim()
    const url = input.url?.trim().replace(/\/+$/, '')
    if (!name || name.length > 60) throw httpError(400, 'Name must be 1-60 characters')
    if (!/^https?:\/\/[^\s/]+(:\d+)?(\/\S*)?$/.test(url ?? ''))
      throw httpError(400, 'URL must be http(s)://host[:port]')
    const id = `${
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30) || 'mirror'
    }-${randomBytes(3).toString('hex')}`
    const secret = randomBytes(32).toString('base64url')
    db.prepare(
      'INSERT INTO mirrors (id, name, url, secret, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, name, url, secret, nowIso())
    changed()
    return { mirror: mirror(id)!, secret }
  }

  const mirror = (id: string) =>
    db.prepare('SELECT * FROM mirrors WHERE id = ?').get(id) as MirrorRow | undefined
  const mirrors = () => db.prepare('SELECT * FROM mirrors ORDER BY created_at').all() as MirrorRow[]
  const removeMirror = (id: string) => db.prepare('DELETE FROM mirrors WHERE id = ?').run(id)

  function mirrorContact(id: string, result: { ackedSeq?: number; error?: string }) {
    const row = mirror(id)
    if (!row) return
    if (result.error) {
      const attempts = row.attempts + 1
      const delay = Math.min(5_000 * 2 ** Math.min(attempts, 7), 10 * 60_000)
      db.prepare(
        'UPDATE mirrors SET last_error = ?, attempts = ?, next_attempt_at = ? WHERE id = ?',
      ).run(result.error.slice(0, 500), attempts, Date.now() + delay, id)
    } else {
      db.prepare(
        'UPDATE mirrors SET last_acked_seq = MAX(last_acked_seq, ?), last_contact = ?, last_error = NULL, attempts = 0, next_attempt_at = 0 WHERE id = ?',
      ).run(result.ackedSeq ?? row.last_acked_seq, nowIso(), id)
    }
  }

  return {
    keys,
    registerPublisher,
    publisher,
    publishers,
    rotateToken,
    setPublisherFlag,
    submit,
    submission,
    view,
    submissionsFor,
    submissionsByStatus,
    readPackage,
    approve,
    requestChanges: (id: number, reviewer: string, note: string) =>
      decide(id, reviewer, 'changes-requested', note),
    reject: (id: number, reviewer: string, note: string) => decide(id, reviewer, 'rejected', note),
    revoke,
    releases,
    latestPublished,
    currentSeq,
    signedIndex,
    batchSince,
    downloads,
    addDownloads,
    addMirror,
    mirror,
    mirrors,
    removeMirror,
    mirrorContact,
    onChange: (listener: () => void) => listeners.add(listener),
  }
}
