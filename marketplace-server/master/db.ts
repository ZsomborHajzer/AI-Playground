import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type SubmissionStatus = 'in-review' | 'changes-requested' | 'rejected' | 'published'

export type PublisherRow = {
  id: string
  name: string
  email: string
  verified: number
  disabled: number
  token_hash: string
  created_at: string
}

export type SubmissionRow = {
  id: number
  publisher_id: string
  plugin_id: string
  version: string
  sha256: string
  size: number
  status: SubmissionStatus
  report_json: string
  manifest_json: string
  readme: string | null
  changelog: string | null
  trust: string | null
  reviewer: string | null
  review_note: string | null
  created_at: string
  updated_at: string
}

export type ReleaseRow = {
  plugin_id: string
  version: string
  seq: number
  sha256: string
  signed_json: string
  published_at: string
  revoked: number
  revoke_reason: string | null
}

export type MirrorRow = {
  id: string
  name: string
  url: string
  secret: string
  last_acked_seq: number
  last_contact: string | null
  last_error: string | null
  attempts: number
  next_attempt_at: number
  created_at: string
}

export type EventRow = { seq: number; type: string; payload_json: string; created_at: string }

const MIGRATIONS = [
  `CREATE TABLE publishers (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     email TEXT NOT NULL,
     verified INTEGER NOT NULL DEFAULT 0,
     disabled INTEGER NOT NULL DEFAULT 0,
     token_hash TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL
   );
   CREATE TABLE admins (
     username TEXT PRIMARY KEY,
     password_hash TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL,
     csrf TEXT NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE TABLE submissions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     publisher_id TEXT NOT NULL REFERENCES publishers(id),
     plugin_id TEXT NOT NULL,
     version TEXT NOT NULL,
     sha256 TEXT NOT NULL,
     size INTEGER NOT NULL,
     status TEXT NOT NULL,
     report_json TEXT NOT NULL,
     manifest_json TEXT NOT NULL,
     readme TEXT,
     changelog TEXT,
     trust TEXT,
     reviewer TEXT,
     review_note TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX submissions_status ON submissions(status);
   CREATE INDEX submissions_plugin ON submissions(plugin_id, version);
   CREATE TABLE releases (
     plugin_id TEXT NOT NULL,
     version TEXT NOT NULL,
     seq INTEGER NOT NULL,
     sha256 TEXT NOT NULL,
     signed_json TEXT NOT NULL,
     published_at TEXT NOT NULL,
     revoked INTEGER NOT NULL DEFAULT 0,
     revoke_reason TEXT,
     PRIMARY KEY (plugin_id, version)
   );
   CREATE TABLE events (
     seq INTEGER PRIMARY KEY,
     type TEXT NOT NULL,
     payload_json TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE mirrors (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     url TEXT NOT NULL,
     secret TEXT NOT NULL,
     last_acked_seq INTEGER NOT NULL DEFAULT 0,
     last_contact TEXT,
     last_error TEXT,
     attempts INTEGER NOT NULL DEFAULT 0,
     next_attempt_at INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   );
   CREATE TABLE downloads (
     plugin_id TEXT PRIMARY KEY,
     count INTEGER NOT NULL DEFAULT 0
   );`,
]

export function openDatabase(dataDir: string): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(path.join(dataDir, 'master.sqlite'))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT version FROM schema_version').get() as
    { version: number } | undefined
  let version = row?.version ?? 0
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run()
  while (version < MIGRATIONS.length) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version])
      db.prepare('UPDATE schema_version SET version = ?').run(version + 1)
    })
    version++
  }
  return db
}

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export const nowIso = () => new Date().toISOString()
