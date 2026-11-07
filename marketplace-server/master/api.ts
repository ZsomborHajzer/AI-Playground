import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { HMAC_HEADERS, verifyHmac } from '../shared/index.ts'
import { bearerToken, publisherForToken, rateLimiter } from './auth.ts'
import type { MasterConfig } from './config.ts'
import { httpError, type MasterCore } from './core.ts'
import type { PublisherRow } from './db.ts'
import { page, h } from './html.ts'

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer
  }
}

type Db = Parameters<typeof publisherForToken>[0]

function requirePublisher(db: Db, request: FastifyRequest): PublisherRow {
  const owner = publisherForToken(db, bearerToken(request.headers.authorization))
  if (!owner) throw httpError(401, 'Missing or invalid publisher token')
  return owner
}

// Signatures seen inside the HMAC clock window; a captured POST cannot be sent twice.
const seenSignatures = new Map<string, number>()

function requireMirror(core: MasterCore, request: FastifyRequest) {
  const id = request.headers[HMAC_HEADERS.mirror] as string | undefined
  const signature = request.headers[HMAC_HEADERS.signature] as string | undefined
  const mirror = id ? core.mirror(id) : undefined
  const ok =
    mirror &&
    verifyHmac(
      mirror.secret,
      request.method,
      request.url,
      request.rawBody ?? '',
      request.headers[HMAC_HEADERS.timestamp] as string | undefined,
      signature,
    )
  if (!ok || !mirror || !signature) throw httpError(401, 'Mirror authentication failed')
  if (request.method === 'POST') {
    const now = Date.now()
    for (const [sig, at] of seenSignatures) if (now - at > 11 * 60_000) seenSignatures.delete(sig)
    if (seenSignatures.has(signature)) throw httpError(401, 'Mirror request was replayed')
    seenSignatures.set(signature, now)
  }
  return mirror
}

export function registerApiRoutes(
  app: FastifyInstance,
  core: MasterCore,
  config: MasterConfig,
  db: Db,
) {
  const registerLimiter = rateLimiter(5, 60 * 60_000)
  const uploadLimiter = rateLimiter(30, 60 * 60_000)
  const checkRegisterRate = (ip: string) => {
    if (!registerLimiter(ip)) throw httpError(429, 'Too many registrations from this address')
  }

  app.get('/healthz', async () => ({ ok: true, seq: core.currentSeq(), keyId: core.keys.keyId }))

  app.get('/v1/public-key', async () => ({
    keyId: core.keys.keyId,
    publicKeyPem: core.keys.publicKeyPem,
  }))

  // ── publishers ───────────────────────────────────────────────────────────

  app.post('/v1/publishers/register', async (request, reply) => {
    if (config.registration !== 'open') {
      throw httpError(403, 'Registration is invite-only; ask a marketplace admin for a token')
    }
    checkRegisterRate(request.ip)
    const body = (request.body ?? {}) as { id: string; name: string; email: string }
    const { publisher, token } = core.registerPublisher(body)
    reply.code(201)
    return { publisherId: publisher.id, token }
  })

  app.get('/v1/me', async (request) => {
    const owner = requirePublisher(db, request)
    return { id: owner.id, name: owner.name, verified: !!owner.verified }
  })

  app.post('/v1/submissions', async (request, reply) => {
    const owner = requirePublisher(db, request)
    if (!uploadLimiter(owner.id)) throw httpError(429, 'Too many uploads; try again in an hour')
    const file = await request.file()
    if (!file) throw httpError(400, 'Send the .aipgx as a multipart field named "package"')
    const bytes = await file.toBuffer()
    if (file.file.truncated) throw httpError(413, 'Package is larger than the upload limit')
    const submission = core.submit(owner, new Uint8Array(bytes))
    reply.code(201)
    return submission
  })

  app.get('/v1/me/submissions', async (request) => {
    const owner = requirePublisher(db, request)
    return { submissions: core.submissionsFor(owner.id) }
  })

  app.get<{ Params: { id: string } }>('/v1/me/submissions/:id', async (request) => {
    const owner = requirePublisher(db, request)
    const row = core.submission(Number(request.params.id))
    if (!row || row.publisher_id !== owner.id) throw httpError(404, 'No such submission')
    return core.view(row)
  })

  // ── mirrors (HMAC) ───────────────────────────────────────────────────────

  app.get<{ Querystring: { since?: string } }>('/v1/mirror/feed', async (request) => {
    const mirror = requireMirror(core, request)
    const since = Math.max(0, Number(request.query.since ?? 0) || 0)
    core.mirrorContact(mirror.id, { ackedSeq: since })
    return core.batchSince(since)
  })

  app.get<{ Params: { sha256: string } }>(
    '/v1/mirror/packages/:sha256',
    async (request, reply: FastifyReply) => {
      requireMirror(core, request)
      const published = core.releases().some((r) => r.sha256 === request.params.sha256)
      const bytes = published ? core.readPackage(request.params.sha256) : undefined
      if (!bytes) throw httpError(404, 'No published package with that hash')
      reply.header('content-type', 'application/zip')
      return reply.send(Buffer.from(bytes))
    },
  )

  app.post('/v1/mirror/stats', async (request) => {
    requireMirror(core, request)
    const { counts } = (request.body ?? {}) as { counts?: Record<string, unknown> }
    core.addDownloads(counts ?? {})
    return { ok: true }
  })

  // ── self-service registration page ───────────────────────────────────────

  app.get('/register', async (_request, reply) => {
    reply.type('text/html')
    if (config.registration !== 'open') {
      return page(
        'Register',
        '<p>Registration is invite-only. Ask a marketplace admin for a publisher token.</p>',
      )
    }
    return page(
      'Register as a publisher',
      `<form method="post" action="/register" class="card">
         <label>Publisher id <input name="id" required pattern="[a-z0-9][a-z0-9-]{1,38}" placeholder="acme"></label>
         <small>Lowercase letters, digits and dashes. Every plugin you publish is named <code>&lt;id&gt;.plugin-name</code>.</small>
         <label>Display name <input name="name" required maxlength="60"></label>
         <label>Email <input name="email" type="email" required></label>
         <button>Create publisher and token</button>
       </form>`,
    )
  })

  app.post('/register', async (request, reply) => {
    reply.type('text/html')
    if (config.registration !== 'open') throw httpError(403, 'Registration is invite-only')
    try {
      checkRegisterRate(request.ip)
      const { publisher, token } = core.registerPublisher(
        (request.body ?? {}) as { id: string; name: string; email: string },
      )
      return page(
        'Your publisher token',
        `<div class="card"><p>Publisher <strong>${h(publisher.id)}</strong> created. This token is shown once — store it now.</p>
         <pre class="token">${h(token)}</pre>
         <p>Paste it into AI Playground (Marketplace → Publish), or use it with the CLI:</p>
         <pre>export AIPG_MASTER_URL=${h(config.publicUrl)}\nexport AIPG_PUBLISHER_TOKEN=${h(token)}\nnpx aipg-plugin publish ./my-plugin</pre></div>`,
      )
    } catch (e) {
      reply.code((e as { statusCode?: number }).statusCode ?? 400)
      return page(
        'Registration failed',
        `<p class="error">${h((e as Error).message)}</p><p><a href="/register">Try again</a></p>`,
      )
    }
  })
}
