import Fastify, { type FastifyServerOptions } from 'fastify'
import formbody from '@fastify/formbody'
import multipart from '@fastify/multipart'
import { registerAdminRoutes } from './admin.ts'
import { registerApiRoutes } from './api.ts'
import type { MasterConfig } from './config.ts'
import { createMasterCore, httpError, type HttpError } from './core.ts'
import { openDatabase } from './db.ts'
import { loadOrCreateKeys } from './keys.ts'

export async function buildMasterApp(
  config: MasterConfig,
  logger: FastifyServerOptions['logger'] = false,
) {
  const db = openDatabase(config.dataDir)
  const keys = loadOrCreateKeys(config.dataDir)
  const core = createMasterCore({ db, keys, dataDir: config.dataDir })
  const app = Fastify({
    logger,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: config.trustProxy ?? 'loopback,uniquelocal',
  })

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff')
    reply.header('referrer-policy', 'no-referrer')
    reply.header('x-frame-options', 'DENY')
    if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) {
      reply.header(
        'content-security-policy',
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      )
    }
    if (request.url.startsWith('/admin') || request.url.startsWith('/register'))
      reply.header('cache-control', 'no-store')
    return payload
  })

  // Keep the exact bytes of JSON bodies: mirror requests are HMAC-signed over them.
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const raw = body as Buffer
    request.rawBody = raw
    if (raw.length === 0) return done(null, {})
    try {
      done(null, JSON.parse(raw.toString('utf8')))
    } catch {
      done(httpError(400, 'Body is not valid JSON'), undefined)
    }
  })
  await app.register(formbody)
  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5 },
  })

  app.setErrorHandler((error: HttpError, request, reply) => {
    const status = error.statusCode ?? 500
    if (status >= 500) request.log.error(error)
    reply.code(status).send({
      error: status >= 500 ? 'Internal server error' : error.message,
      issues: error.details,
    })
  })

  registerApiRoutes(app, core, config, db)
  registerAdminRoutes(app, core, config, db)
  app.addHook('onClose', async () => db.close())
  return { app, core, db }
}
