// Turns an .aipgx file, its bytes, or a plugin folder into the entries the shared
// validator checks, and back into a zip for upload.
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { LIMITS, isSafeEntryPath, type PackageEntry } from '@marketplace-shared'

export function entriesFromZip(bytes: Uint8Array): PackageEntry[] {
  let zip: AdmZip
  try {
    zip = new AdmZip(Buffer.from(bytes))
  } catch (e) {
    throw new Error(`Not a valid plugin package: ${(e as Error).message}`)
  }
  const files = zip.getEntries().filter((e) => !e.isDirectory)
  if (files.length > LIMITS.files) throw new Error(`More than ${LIMITS.files} files in the package`)
  const declared = files.reduce((sum, e) => sum + e.header.size, 0)
  if (declared > LIMITS.totalBytes) throw new Error('The package unpacks to more than 20 MB')
  return files.map((entry) => ({
    path: entry.entryName,
    size: entry.header.size,
    read: () => {
      const data = entry.getData()
      // The header size is only a claim; refuse an entry that inflates past it.
      if (data.length > Math.max(entry.header.size, 0))
        throw new Error(`${entry.entryName} is corrupt`)
      return new Uint8Array(data)
    },
  }))
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
  const zip = new AdmZip()
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    zip.addFile(entry.path, Buffer.from(entry.read()))
  }
  return new Uint8Array(zip.toBuffer())
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
