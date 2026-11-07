import path from 'node:path'

export type MasterConfig = {
  host: string
  port: number
  dataDir: string
  publicUrl: string
  registration: 'open' | 'invite'
  maxUploadBytes: number
  replicationIntervalMs: number
  secureCookies: boolean
}

export function masterConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MasterConfig {
  const publicUrl = (
    env.MASTER_PUBLIC_URL ?? `http://localhost:${env.MASTER_PORT ?? 8080}`
  ).replace(/\/+$/, '')
  return {
    host: env.MASTER_HOST ?? '0.0.0.0',
    port: Number(env.MASTER_PORT ?? 8080),
    dataDir: path.resolve(env.MASTER_DATA_DIR ?? 'data/master'),
    publicUrl,
    registration: env.REGISTRATION === 'invite' ? 'invite' : 'open',
    maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024,
    replicationIntervalMs: Number(env.REPLICATION_INTERVAL_SECONDS ?? 15) * 1000,
    secureCookies: env.SECURE_COOKIES
      ? env.SECURE_COOKIES === 'true'
      : publicUrl.startsWith('https://'),
  }
}
