import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFolder } from '../lib/folder.ts'
import { writeZip } from '../lib/zip.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const examplePath = (name: string) => path.join(root, 'examples', name)

export function manifestFor(example: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(examplePath(example), 'aipg-plugin.json'), 'utf8'))
}

/** The example folder as an .aipgx, optionally with manifest fields overridden. */
export function packExample(example: string, overrides: Record<string, unknown> = {}): Uint8Array {
  const files = readFolder(examplePath(example)).map((e) => ({ path: e.path, data: e.read() }))
  if (Object.keys(overrides).length) {
    const manifest = { ...manifestFor(example), ...overrides }
    const at = files.findIndex((f) => f.path === 'aipg-plugin.json')
    files[at] = {
      path: 'aipg-plugin.json',
      data: new TextEncoder().encode(JSON.stringify(manifest)),
    }
  }
  return writeZip(files)
}

export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix))
}
