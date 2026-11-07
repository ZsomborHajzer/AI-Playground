// Where installed plugins live and the record of what is installed:
//   <root>/installed.json         PluginState
//   <root>/<id>/<version>/        the unpacked package
import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { PluginPermission, TrustTier } from '@marketplace-shared'
import { atomicWriteJson, readJson } from './fsJsonStore'

export type InstalledRecord = {
  id: string
  version: string
  name: string
  enabled: boolean
  trust: TrustTier | 'local'
  permissions: PluginPermission[]
  /** Preset files, relative to the version folder. */
  presetFiles: string[]
  presetNames: string[]
  installedAt: string
  sha256?: string
  /** Kept on disk after an update so a failed one can be rolled back. */
  previousVersion?: string
  revoked?: { reason: string }
}

export type PluginState = {
  schemaVersion: 1
  /** Highest catalog seq seen; an older catalog from a mirror is refused. */
  lastSeq: number
  plugins: Record<string, InstalledRecord>
}

export const emptyPluginState = (): PluginState => ({ schemaVersion: 1, lastSeq: 0, plugins: {} })

export const pluginVersionDir = (root: string, id: string, version: string) =>
  path.join(root, id, version)

export async function readPluginState(root: string): Promise<PluginState> {
  const read = await readJson(path.join(root, 'installed.json'), 'plugins')
  if (read.status !== 'ok') return emptyPluginState()
  const value = read.value as Partial<PluginState>
  if (value?.schemaVersion !== 1 || typeof value.plugins !== 'object') return emptyPluginState()
  return { schemaVersion: 1, lastSeq: value.lastSeq ?? 0, plugins: value.plugins ?? {} }
}

export function writePluginState(root: string, state: PluginState): Promise<void> {
  return atomicWriteJson(path.join(root, 'installed.json'), state)
}

/** The publisher token, encrypted at rest like the cloud provider keys. */
export function createPublisherTokenStore(file: string) {
  return {
    read(): string | null {
      try {
        const blob = JSON.parse(fs.readFileSync(file, 'utf8')) as { data: number[] }
        return safeStorage.decryptString(Buffer.from(blob.data))
      } catch {
        return null
      }
    },
    write(token: string | null) {
      if (!token) {
        fs.rmSync(file, { force: true })
        return
      }
      fs.writeFileSync(file, JSON.stringify(safeStorage.encryptString(token).toJSON()), 'utf8')
    },
  }
}
