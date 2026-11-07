// Turns an .aipgx file, its bytes, or a plugin folder into the entries the shared
// validator checks, and back into a zip for upload.
import fs from 'node:fs'
import path from 'node:path'
import {
  isSafeEntryPath,
  readPackageZip,
  writePackageZip,
  type PackageEntry,
} from '@marketplace-shared'

/** The master's own strict reader, so the app installs exactly the files reviewers saw. */
export function entriesFromZip(bytes: Uint8Array): PackageEntry[] {
  const result = readPackageZip(bytes)
  if ('error' in result) throw new Error(result.error)
  return result.entries
}

const SKIPPED = new Set(['.git', 'node_modules'])

export function entriesFromFolder(root: string): PackageEntry[] {
  const entries: PackageEntry[] = []
  const walk = (dir: string) => {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIPPED.has(dirent.name) || dirent.name.startsWith('.')) continue
      const full = path.join(dir, dirent.name)
      if (dirent.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${full}`)
      if (dirent.isDirectory()) walk(full)
      else if (dirent.isFile() && !dirent.name.endsWith('.aipgx')) {
        entries.push({
          path: path.relative(root, full).split(path.sep).join('/'),
          size: fs.statSync(full).size,
          read: () => new Uint8Array(fs.readFileSync(full)),
        })
      }
    }
  }
  walk(root)
  return entries
}

export function entriesFromPath(target: string): PackageEntry[] {
  if (!fs.existsSync(target)) throw new Error(`Not found: ${target}`)
  return fs.statSync(target).isDirectory()
    ? entriesFromFolder(target)
    : entriesFromZip(new Uint8Array(fs.readFileSync(target)))
}

export function zipEntries(entries: PackageEntry[]): Uint8Array {
  return writePackageZip(entries.map((entry) => ({ path: entry.path, data: entry.read() })))
}

/** Writes validated entries under `dir`; paths were checked by the validator, and again here. */
export function writeEntries(entries: PackageEntry[], dir: string) {
  const base = path.resolve(dir)
  for (const entry of entries) {
    if (!isSafeEntryPath(entry.path)) throw new Error(`Unsafe path in package: ${entry.path}`)
    const target = path.resolve(base, ...entry.path.split('/'))
    if (!target.startsWith(base + path.sep)) {
      throw new Error(`Unsafe path in package: ${entry.path}`)
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, entry.read())
  }
}
