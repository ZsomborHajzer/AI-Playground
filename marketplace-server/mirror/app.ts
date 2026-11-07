import fs from 'node:fs'
import Fastify, { type FastifyServerOptions } from 'fastify'
import {
  HMAC_HEADERS,
  keyId,
  verifyHmac,
  type Listing,
  type ReplicationBatch,
} from '../shared/index.ts'
import type { MirrorConfig } from './config.ts'
import { createMirrorStore } from './store.ts'

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer
  }
}

const SORTS = ['popular', 'recent', 'name'] as const
const REPLICATE_BODY_LIMIT = 64 * 1024 * 1024
const HMAC_MAX_SKEW_MS = 5 * 60 * 1000

export async function buildMirrorApp(
  config: MirrorConfig,
  options: { logger?: FastifyServerOptions['logger']; fetchImpl?: typeof fetch } = {},
) {
  const store = createMirrorStore(config, options.fetchImpl)
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 64 * 1024,
    trustProxy: config.trustProxy ?? 'loopback,uniquelocal',
  })
  const masterKeyId = keyId(config.masterPublicKeyPem)

  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    request.rawBody = body as Buffer
    try {
      done(null, (body as Buffer).length ? JSON.parse((body as Buffer).toString('utf8')) : {})
    } catch {
      done(Object.assign(new Error('Body is not valid JSON'), { statusCode: 400 }), undefined)
    }
  })

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const status = error.statusCode ?? 500
    if (status >= 500) request.log.error(error)
    reply.code(status).send({ error: status >= 500 ? 'Internal server error' : error.message })
  })

  app.get('/healthz', async () => ({
    ok: true,
    mirrorId: config.mirrorId,
    seq: store.seq(),
    plugins: store.index()?.index.plugins.length ?? 0,
    masterKeyId,
  }))

  // ── from the master ──────────────────────────────────────────────────────

  // Refuse obvious strangers before reading a body of up to 64 MB; the HMAC is checked after.
  const fromMaster = (headers: Record<string, unknown>) =>
    headers[HMAC_HEADERS.mirror] === config.mirrorId &&
    typeof headers[HMAC_HEADERS.signature] === 'string' &&
    Math.abs(Date.now() - Number(headers[HMAC_HEADERS.timestamp])) <= HMAC_MAX_SKEW_MS

  app.post(
    '/v1/replicate',
    {
      bodyLimit: REPLICATE_BODY_LIMIT,
      onRequest: async (request, reply) => {
        if (!fromMaster(request.headers))
          return reply.code(401).send({ error: 'Replication authentication failed' })
      },
    },
    async (request, reply) => {
      const ok =
        request.headers[HMAC_HEADERS.mirror] === config.mirrorId &&
        verifyHmac(
          config.mirrorSecret,
          'POST',
          request.url,
          request.rawBody ?? '',
          request.headers[HMAC_HEADERS.timestamp] as string | undefined,
          request.headers[HMAC_HEADERS.signature] as string | undefined,
        )
      if (!ok) return reply.code(401).send({ error: 'Replication authentication failed' })
      try {
        const seq = await store.applyBatch(request.body as ReplicationBatch)
        return { seq }
      } catch (e) {
        request.log.warn(`replication batch refused: ${(e as Error).message}`)
        return reply.code(422).send({ error: (e as Error).message })
      }
    },
  )

  // ── public catalog ───────────────────────────────────────────────────────

  app.get('/v1/index', async (request, reply) => {
    const index = store.index()
    if (!index) return reply.code(503).send({ error: 'This mirror has not received a catalog yet' })
    const etag = `"seq-${index.index.seq}"`
    reply.header('etag', etag).header('cache-control', 'public, max-age=60')
    if (request.headers['if-none-match'] === etag) return reply.code(304).send()
    return index
  })

  app.get<{
    Querystring: {
      q?: string
      category?: string
      trust?: string
      sort?: string
      page?: string
      pageSize?: string
    }
  }>('/v1/plugins', async (request, reply) => {
    const index = store.index()
    if (!index) return reply.code(503).send({ error: 'This mirror has not received a catalog yet' })
    const { q = '', category, trust } = request.query
    const sort = SORTS.includes(request.query.sort as (typeof SORTS)[number])
      ? request.query.sort
      : 'popular'
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize ?? 50) || 50))
    const page = Math.max(1, Number(request.query.page ?? 1) || 1)
    const needle = q.trim().toLowerCase()
    const listings: Listing[] = index.index.plugins
      .map((entry) => ({ ...entry, downloads: store.downloads(entry.latest.release.id) }))
      .filter(({ latest: { release } }) => {
        if (category && release.manifest.category !== category) return false
        if (trust && release.trust !== trust) return false
        if (!needle) return true
        return [
          release.id,
          release.manifest.name,
          release.manifest.description,
          release.publisher.name,
          ...(release.manifest.tags ?? []),
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      })
      .sort((a, b) =>
        sort === 'name'
          ? a.latest.release.manifest.name.localeCompare(b.latest.release.manifest.name)
          : sort === 'recent'
            ? b.latest.release.publishedAt.localeCompare(a.latest.release.publishedAt)
            : b.downloads - a.downloads,
      )
    reply.header('cache-control', 'public, max-age=30')
    return {
      seq: index.index.seq,
      total: listings.length,
      page,
      pageSize,
      items: listings.slice((page - 1) * pageSize, page * pageSize),
    }
  })

  app.get<{ Params: { id: string } }>('/v1/plugins/:id', async (request, reply) => {
    const entry = store
      .index()
      ?.index.plugins.find((p) => p.latest.release.id === request.params.id)
    if (!entry) return reply.code(404).send({ error: 'No such plugin on this mirror' })
    return {
      ...entry,
      downloads: store.downloads(request.params.id),
      releases: store.releasesOf(request.params.id),
    }
  })

  app.get<{ Params: { sha256: string } }>('/v1/packages/:sha256', async (request, reply) => {
    const file = store.packagePath(request.params.sha256)
    const release = store.releaseForPackage(request.params.sha256)
    if (!file || !release) return reply.code(404).send({ error: 'No such package' })
    if (store.isRevoked(release.release.id, release.release.version)) {
      return reply.code(410).send({ error: 'This version was revoked' })
    }
    store.countDownload(request.params.sha256, request.ip)
    reply
      .header('content-type', 'application/zip')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header(
        'content-disposition',
        `attachment; filename="${release.release.id}-${release.release.version}.aipgx"`,
      )
    return reply.send(fs.createReadStream(file))
  })

  return { app, store }
}
