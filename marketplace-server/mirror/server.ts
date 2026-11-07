import { buildMirrorApp } from './app.ts'
import { mirrorConfigFromEnv } from './config.ts'

const config = mirrorConfigFromEnv()
const { app, store } = await buildMirrorApp(config, {
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
})

const catchUp = () =>
  store
    .catchUp()
    .then((seq) => app.log.info(`in sync with master at seq ${seq}`))
    .catch((e: Error) => app.log.warn(`catch-up from master failed: ${e.message}`))

const timers = [
  setInterval(() => void catchUp(), config.catchUpIntervalMs),
  setInterval(
    () =>
      void store.flushStats().catch((e: Error) => app.log.warn(`stats flush failed: ${e.message}`)),
    config.statsFlushIntervalMs,
  ),
]
for (const timer of timers) timer.unref()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    timers.forEach(clearInterval)
    void store
      .flushStats()
      .catch(() => undefined)
      .finally(() => app.close().then(() => process.exit(0)))
  })
}

await app.listen({ host: config.host, port: config.port })
app.log.info(`Mirror ${config.mirrorId} serving on port ${config.port}, master ${config.masterUrl}`)
void catchUp()
