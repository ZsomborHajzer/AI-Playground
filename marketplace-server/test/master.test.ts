import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { hmacHeaders, verifyIndex, verifyRelease } from '../shared/index.ts'
import { buildMasterApp } from '../master/app.ts'
import { createAdmin } from '../master/auth.ts'
import type { MasterConfig } from '../master/config.ts'
import type { MasterCore } from '../master/core.ts'
import { packExample, tempDir } from './helpers.ts'

let app: FastifyInstance
let core: MasterCore

const config = (dataDir: string): MasterConfig => ({
  host: '127.0.0.1',
  port: 0,
  dataDir,
  publicUrl: 'http://master.test',
  registration: 'open',
  maxUploadBytes: 20 * 1024 * 1024,
  replicationIntervalMs: 60_000,
  secureCookies: false,
})

beforeEach(async () => {
  const built = await buildMasterApp(config(tempDir('aipg-master-')))
  app = built.app
  core = built.core
  createAdmin(built.db, 'reviewer', 'correct horse battery')
})
afterEach(async () => {
  await app.close()
})

async function register(id = 'aipg') {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/publishers/register',
    payload: { id, name: 'AI Playground', email: 'team@example.com' },
  })
  expect(res.statusCode).toBe(201)
  return res.json().token as string
}

async function upload(token: string, bytes: Uint8Array) {
  const form = new FormData()
  form.append('package', new Blob([bytes]), 'plugin.aipgx')
  return app.inject({
    method: 'POST',
    url: '/v1/submissions',
    headers: { authorization: `Bearer ${token}` },
    payload: form,
  })
}

async function adminSession() {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/login',
    payload: 'username=reviewer&password=correct+horse+battery',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
  const cookie = String(res.headers['set-cookie']).split(';')[0]
  const page = await app.inject({ method: 'GET', url: '/admin/queue', headers: { cookie } })
  const csrf = /name="csrf" value="([^"]+)"/.exec(page.body)![1]
  return { cookie, csrf, queue: page.body }
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString()

describe('publishing', () => {
  it('accepts a valid package into review and lists it for its publisher', async () => {
    const token = await register()
    const res = await upload(token, packExample('writing-coach'))
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      pluginId: 'aipg.writing-coach',
      version: '1.0.0',
      status: 'in-review',
    })

    const mine = await app.inject({
      method: 'GET',
      url: '/v1/me/submissions',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(mine.json().submissions).toHaveLength(1)
  })

  it('refuses bad tokens, foreign namespaces and duplicate pending uploads', async () => {
    expect((await upload('aipg_nobody_x', packExample('writing-coach'))).statusCode).toBe(401)
    const other = await register('acme')
    const foreign = await upload(other, packExample('writing-coach'))
    expect(foreign.statusCode).toBe(422)
    expect(foreign.json().issues.map((i: { code: string }) => i.code)).toContain('policy/namespace')

    const token = await register()
    expect((await upload(token, packExample('writing-coach'))).statusCode).toBe(201)
    expect((await upload(token, packExample('writing-coach'))).statusCode).toBe(409)
  })

  it('rejects garbage uploads with a readable reason', async () => {
    const token = await register()
    const res = await upload(token, new TextEncoder().encode('not a zip'))
    expect(res.statusCode).toBe(422)
    expect(res.json().issues[0].code).toBe('package/zip')
  })
})

describe('review', () => {
  it('signs and publishes on approval, and the index verifies', async () => {
    const token = await register()
    const { id } = (await upload(token, packExample('writing-coach'))).json()
    const { cookie, csrf, queue } = await adminSession()
    expect(queue).toContain('aipg.writing-coach')

    const decided = await app.inject({
      method: 'POST',
      url: `/admin/submissions/${id}/decision`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ csrf, decision: 'approve-community', note: '' }),
    })
    expect(decided.statusCode).toBe(302)

    const signed = core.signedIndex()
    expect(verifyIndex(signed, core.keys.publicKeyPem)).toEqual({ ok: true })
    expect(signed.index.plugins).toHaveLength(1)
    const release = signed.index.plugins[0].latest
    expect(release.release).toMatchObject({ id: 'aipg.writing-coach', trust: 'community', seq: 1 })
    expect(verifyRelease(release, core.keys.publicKeyPem)).toBe(true)
    expect(core.batchSince(0).events.map((e) => e.type)).toEqual(['release'])
  })

  it('refuses decisions without a valid CSRF token', async () => {
    const token = await register()
    const { id } = (await upload(token, packExample('writing-coach'))).json()
    const { cookie } = await adminSession()
    const res = await app.inject({
      method: 'POST',
      url: `/admin/submissions/${id}/decision`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ csrf: 'forged', decision: 'approve-community' }),
    })
    expect(res.statusCode).toBe(403)
    expect(core.submission(id)!.status).toBe('in-review')
  })

  it('needs a verified publisher for the Verified tier', async () => {
    const token = await register()
    const { id } = (await upload(token, packExample('writing-coach'))).json()
    expect(() => core.approve(id, 'reviewer', 'verified')).toThrow(/verified publisher/)
    core.setPublisherFlag('aipg', 'verified', true)
    expect(core.approve(id, 'reviewer', 'verified').release.publisher.verified).toBe(true)
  })

  it('lets a publisher re-upload the same version after changes are requested', async () => {
    const token = await register()
    const { id } = (await upload(token, packExample('writing-coach'))).json()
    expect(() => core.requestChanges(id, 'reviewer', '')).toThrow(/why/)
    core.requestChanges(id, 'reviewer', 'Please shorten the system prompt')
    const status = await app.inject({
      method: 'GET',
      url: `/v1/me/submissions/${id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(status.json()).toMatchObject({
      status: 'changes-requested',
      reviewNote: 'Please shorten the system prompt',
    })
    expect((await upload(token, packExample('writing-coach'))).statusCode).toBe(201)
  })

  it('requires each new version to be newer than the published one', async () => {
    const token = await register()
    const { id } = (await upload(token, packExample('writing-coach'))).json()
    core.approve(id, 'reviewer', 'community')
    const same = await upload(token, packExample('writing-coach'))
    expect(same.json().issues.map((i: { code: string }) => i.code)).toContain('policy/version')
    expect(
      (await upload(token, packExample('writing-coach', { version: '1.1.0' }))).statusCode,
    ).toBe(201)
  })

  it('revokes: the plugin leaves the index and the revocation is signed into it', async () => {
    const token = await register()
    const { id } = (await upload(token, packExample('writing-coach'))).json()
    core.approve(id, 'reviewer', 'community')
    core.revoke('aipg.writing-coach', '1.0.0', 'Prompt injection found in the system prompt')
    const { index } = core.signedIndex()
    expect(index.plugins).toEqual([])
    expect(index.revoked).toMatchObject([{ id: 'aipg.writing-coach', version: '1.0.0' }])
    expect(index.seq).toBe(2)
  })
})

describe('mirror endpoints', () => {
  it('serve the feed only to a registered mirror with a valid signature', async () => {
    const { mirror, secret } = core.addMirror({ name: 'eu', url: 'http://mirror.test' })
    const path = '/v1/mirror/feed?since=0'
    expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(401)
    const wrong = hmacHeaders(mirror.id, 'not-the-secret', 'GET', path)
    expect((await app.inject({ method: 'GET', url: path, headers: wrong })).statusCode).toBe(401)
    const ok = await app.inject({
      method: 'GET',
      url: path,
      headers: hmacHeaders(mirror.id, secret, 'GET', path),
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().index.index.formatVersion).toBe(1)
  })

  it('accumulates download stats sent by mirrors', async () => {
    const { mirror, secret } = core.addMirror({ name: 'eu', url: 'http://mirror.test' })
    const body = JSON.stringify({ counts: { 'aipg.writing-coach': 3, bogus: -5 } })
    const headers = {
      'content-type': 'application/json',
      ...hmacHeaders(mirror.id, secret, 'POST', '/v1/mirror/stats', body),
    }
    const res = await app.inject({
      method: 'POST',
      url: '/v1/mirror/stats',
      payload: body,
      headers,
    })
    expect(res.statusCode).toBe(200)
    expect(core.downloads()).toEqual({ 'aipg.writing-coach': 3 })
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/mirror/stats',
      payload: body,
      headers,
    })
    expect(replay.statusCode).toBe(401)
    expect(core.downloads()).toEqual({ 'aipg.writing-coach': 3 })
  })
})

describe('hardening', () => {
  const login = (headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/admin/login',
      remoteAddress: '198.51.100.7',
      payload: 'username=reviewer&password=wrong-password',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    })

  it('rate-limits sign-in per client even when it forges X-Forwarded-For', async () => {
    for (let i = 0; i < 10; i++) await login({ 'x-forwarded-for': `203.0.113.${i}` })
    const blocked = await login({ 'x-forwarded-for': '203.0.113.200' })
    expect(decodeURIComponent(String(blocked.headers.location))).toContain('Too many attempts')
  })

  it('sends security headers on admin pages', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/login' })
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('limits registrations per address and waiting submissions per publisher', async () => {
    const results = []
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/publishers/register',
        remoteAddress: '198.51.100.9',
        payload: { id: `pub${i}`, name: 'P', email: 'p@example.com' },
      })
      results.push(res.statusCode)
    }
    expect(results).toEqual([201, 201, 201, 201, 201, 429])

    const token = await register()
    for (let v = 1; v <= 10; v++)
      expect(
        (await upload(token, packExample('writing-coach', { version: `1.0.${v}` }))).statusCode,
      ).toBe(201)
    const over = await upload(token, packExample('writing-coach', { version: '1.0.11' }))
    expect(over.statusCode).toBe(429)
  })
})
