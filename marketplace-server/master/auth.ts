// Publisher tokens (stored hashed), admin passwords (scrypt) and admin sessions.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { sha256Hex } from '../shared/index.ts'
import { nowIso, type PublisherRow } from './db.ts'

const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export function newPublisherToken(publisherId: string): string {
  return `aipg_${publisherId}_${randomBytes(24).toString('base64url')}`
}

export function publisherForToken(
  db: DatabaseSync,
  token: string | undefined,
): PublisherRow | undefined {
  if (!token) return undefined
  const row = db
    .prepare('SELECT * FROM publishers WHERE token_hash = ? AND disabled = 0')
    .get(sha256Hex(token)) as PublisherRow | undefined
  return row
}

export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '')
  return match?.[1]
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function checkPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}

export function createAdmin(db: DatabaseSync, username: string, password: string) {
  if (password.length < 10) throw new Error('Admin passwords must be at least 10 characters')
  db.prepare(
    'INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash',
  ).run(username, hashPassword(password), nowIso())
}

export type Session = { id: string; username: string; csrf: string }

export function login(db: DatabaseSync, username: string, password: string): Session | undefined {
  const admin = db.prepare('SELECT password_hash FROM admins WHERE username = ?').get(username) as
    { password_hash: string } | undefined
  if (!admin || !checkPassword(password, admin.password_hash)) return undefined
  const session = {
    id: randomBytes(32).toString('base64url'),
    username,
    csrf: randomBytes(24).toString('base64url'),
  }
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
  db.prepare('INSERT INTO sessions (id, username, csrf, expires_at) VALUES (?, ?, ?, ?)').run(
    session.id,
    session.username,
    session.csrf,
    Date.now() + SESSION_TTL_MS,
  )
  return session
}

export function sessionFor(db: DatabaseSync, id: string | undefined): Session | undefined {
  if (!id) return undefined
  const row = db
    .prepare('SELECT id, username, csrf FROM sessions WHERE id = ? AND expires_at > ?')
    .get(id, Date.now()) as Session | undefined
  return row
}

export function logout(db: DatabaseSync, id: string) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

/** Fixed-window limiter for login attempts, per client address. */
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return (key: string): boolean => {
    const now = Date.now()
    const entry = hits.get(key)
    if (!entry || entry.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs })
      return true
    }
    entry.count++
    return entry.count <= limit
  }
}
