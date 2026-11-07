import fs from 'node:fs'
import path from 'node:path'
import type { PackageEntry } from '../shared/index.ts'

const SKIPPED = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db'])

/** A plugin source folder as package entries (dotfiles and VCS folders left out). */
export function readFolder(root: string): PackageEntry[] {
  const entries: PackageEntry[] = []
  const walk = (dir: string) => {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIPPED.has(dirent.name) || dirent.name.startsWith('.')) continue
      const full = path.join(dir, dirent.name)
      if (dirent.isSymbolicLink())
        throw new Error(`Symbolic links are not allowed in a plugin: ${full}`)
      if (dirent.isDirectory()) walk(full)
      else if (dirent.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join('/')
        if (rel.endsWith('.aipgx')) continue
        const size = fs.statSync(full).size
        entries.push({ path: rel, size, read: () => new Uint8Array(fs.readFileSync(full)) })
      }
    }
  }
  walk(root)
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}
