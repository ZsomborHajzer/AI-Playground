import fs from 'node:fs'
import path from 'node:path'
import { trustProxyFromEnv } from '../master/config.ts'

export type MirrorConfig = {
  host: string
  port: number
  dataDir: string
  mirrorId: string
  mirrorSecret: string
  masterUrl: string
  masterPublicKeyPem: string
  catchUpIntervalMs: number
  statsFlushIntervalMs: number
  trustProxy?: string | boolean
}

export function mirrorConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MirrorConfig {
  const required = (key: string) => {
    const value = env[key]
    if (!value) throw new Error(`${key} is required (see deploy/mirror.env.example)`)
    return value
  }
  const keyFile = env.MASTER_PUBLIC_KEY_FILE
  const masterPublicKeyPem =
    env.MASTER_PUBLIC_KEY ?? (keyFile ? fs.readFileSync(path.resolve(keyFile), 'utf8') : '')
  if (!masterPublicKeyPem.includes('BEGIN PUBLIC KEY')) {
    throw new Error(
      'Set MASTER_PUBLIC_KEY_FILE (or MASTER_PUBLIC_KEY) to the master public key PEM',
    )
  }
  return {
    host: env.MIRROR_HOST ?? '0.0.0.0',
    port: Number(env.MIRROR_PORT ?? 8090),
    dataDir: path.resolve(env.MIRROR_DATA_DIR ?? 'data/mirror'),
    mirrorId: required('MIRROR_ID'),
    mirrorSecret: required('MIRROR_SECRET'),
    masterUrl: required('MASTER_URL').replace(/\/+$/, ''),
    masterPublicKeyPem,
    catchUpIntervalMs: Number(env.CATCHUP_INTERVAL_SECONDS ?? 600) * 1000,
    statsFlushIntervalMs: Number(env.STATS_FLUSH_SECONDS ?? 300) * 1000,
    trustProxy: trustProxyFromEnv(env.TRUST_PROXY),
  }
}
