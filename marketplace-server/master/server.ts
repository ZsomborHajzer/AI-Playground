import { buildMasterApp } from './app.ts'
import { masterConfigFromEnv } from './config.ts'
import { startReplication } from './replication.ts'

const config = masterConfigFromEnv()
const { app, core, db } = await buildMasterApp(config, { level: process.env.LOG_LEVEL ?? 'info' })

const admins = (db.prepare('SELECT COUNT(*) AS n FROM admins').get() as { n: number }).n
if (admins === 0) {
  app.log.warn('No admin account yet. Create one with: npm run admin:create -- <username>')
}

const replication = startReplication(core, config.replicationIntervalMs, (msg) => app.log.warn(msg))

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    replication.stop()
    void app.close().then(() => process.exit(0))
  })
}

await app.listen({ host: config.host, port: config.port })
app.log.info(
  `Master ready at ${config.publicUrl} (signing key ${core.keys.keyId}, registration ${config.registration})`,
)
