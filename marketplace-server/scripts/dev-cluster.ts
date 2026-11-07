// npm run dev:cluster [-- --seed]
// A master and two mirrors in one process on localhost, for developing the app and
// plugins. Not for production: the admin password is fixed and there is no HTTPS.
// Writes ../WebUI/external/marketplace.local.json so `npm run dev` uses this cluster.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMasterApp } from '../master/app.ts'
import { createAdmin } from '../master/auth.ts'
import { startReplication } from '../master/replication.ts'
import { buildMirrorApp } from '../mirror/app.ts'
import { readFolder } from '../lib/folder.ts'
import { writeZip } from '../lib/zip.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(root, 'data', 'dev-cluster')
const secretsFile = path.join(dataDir, 'cluster.json')
const MASTER_PORT = 7480
const MIRROR_PORTS = [7481, 7482]
const ADMIN = { username: 'admin', password: 'dev-cluster-password' }

if (!fs.existsSync(secretsFile)) fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(dataDir, { recursive: true })
const {
  app: master,
  core,
  db,
} = await buildMasterApp(
  {
    host: '127.0.0.1',
    port: MASTER_PORT,
    dataDir: path.join(dataDir, 'master'),
    publicUrl: `http://127.0.0.1:${MASTER_PORT}`,
    registration: 'open',
    maxUploadBytes: 20 * 1024 * 1024,
    replicationIntervalMs: 5_000,
    secureCookies: false,
  },
  { level: 'warn' },
)
createAdmin(db, ADMIN.username, ADMIN.password)

type Saved = { mirrors: { id: string; secret: string; port: number }[]; publisherToken: string }
let saved: Saved | undefined = fs.existsSync(secretsFile)
  ? (JSON.parse(fs.readFileSync(secretsFile, 'utf8')) as Saved)
  : undefined
if (!saved) {
  const mirrors = MIRROR_PORTS.map((port, i) => {
    const { mirror, secret } = core.addMirror({
      name: `local-${i + 1}`,
      url: `http://127.0.0.1:${port}`,
    })
    return { id: mirror.id, secret, port }
  })
  const { token } = core.registerPublisher({
    id: 'aipg',
    name: 'AI Playground',
    email: 'dev@example.com',
  })
  core.setPublisherFlag('aipg', 'verified', true)
  saved = { mirrors, publisherToken: token }
  fs.writeFileSync(secretsFile, JSON.stringify(saved, null, 2))
}

await master.listen({ host: '127.0.0.1', port: MASTER_PORT })
for (const m of saved.mirrors) {
  const { app, store } = await buildMirrorApp(
    {
      host: '127.0.0.1',
      port: m.port,
      dataDir: path.join(dataDir, m.id),
      mirrorId: m.id,
      mirrorSecret: m.secret,
      masterUrl: `http://127.0.0.1:${MASTER_PORT}`,
      masterPublicKeyPem: core.keys.publicKeyPem,
      catchUpIntervalMs: 60_000,
      statsFlushIntervalMs: 30_000,
    },
    { logger: { level: 'warn' } },
  )
  await app.listen({ host: '127.0.0.1', port: m.port })
  setInterval(() => void store.flushStats().catch(() => undefined), 30_000).unref()
}
startReplication(core, 5_000, (msg) => console.warn(msg))

if (process.argv.includes('--seed')) {
  const owner = core.publisher('aipg')!
  for (const example of ['writing-coach', 'upscale-workflow']) {
    const files = readFolder(path.join(root, 'examples', example)).map((e) => ({
      path: e.path,
      data: e.read(),
    }))
    try {
      const view = core.submit(owner, writeZip(files))
      core.approve(view.id, ADMIN.username, example === 'writing-coach' ? 'verified' : 'community')
      console.log(`seeded ${view.pluginId}@${view.version}`)
    } catch (e) {
      console.log(`skipped ${example}: ${(e as Error).message}`)
    }
  }
}

const appConfig = {
  mirrors: saved.mirrors.map((m) => `http://127.0.0.1:${m.port}`),
  masterUrl: `http://127.0.0.1:${MASTER_PORT}`,
  publicKeyPem: core.keys.publicKeyPem,
}
const appConfigFile = path.resolve(root, '..', 'WebUI', 'external', 'marketplace.local.json')
fs.writeFileSync(appConfigFile, JSON.stringify(appConfig, null, 2) + '\n')

console.log(`
Dev marketplace cluster is running.
  Master   http://127.0.0.1:${MASTER_PORT}   admin: http://127.0.0.1:${MASTER_PORT}/admin  (${ADMIN.username} / ${ADMIN.password})
  Mirrors  ${appConfig.mirrors.join('   ')}
  Publisher "aipg" (verified), token:
    ${saved.publisherToken}
  App config written to ${path.relative(process.cwd(), appConfigFile)}; restart \`npm run dev\` to use it.
Ctrl+C to stop. Data lives in ${path.relative(process.cwd(), dataDir)}.`)
