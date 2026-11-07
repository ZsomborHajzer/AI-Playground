// Zip reading and writing for the servers and the CLI. Reading streams each entry
// and stops at the package limits, because a zip's declared sizes can lie.
import { Unzip, UnzipInflate, UnzipPassThrough, zipSync, type Zippable } from 'fflate'
import { LIMITS, type PackageEntry } from '../shared/index.ts'

export type ZipReadResult = { entries: PackageEntry[] } | { error: string }

export function readZip(data: Uint8Array): ZipReadResult {
  const chunksByName = new Map<string, Uint8Array[]>()
  const sizes = new Map<string, number>()
  let total = 0
  let failure: string | undefined

  const unzip = new Unzip((file) => {
    if (failure) return
    if (chunksByName.has(file.name)) {
      failure = `Duplicate entry ${file.name}`
      return
    }
    chunksByName.set(file.name, [])
    sizes.set(file.name, 0)
    if (chunksByName.size > LIMITS.files + 1) failure = `More than ${LIMITS.files} files`
    file.ondata = (err, chunk) => {
      if (failure) return
      if (err) {
        failure = `Corrupt entry ${file.name}: ${err.message}`
        return
      }
      const size = sizes.get(file.name)! + chunk.length
      total += chunk.length
      if (size > LIMITS.fileBytes)
        failure = `${file.name} unpacks to more than ${LIMITS.fileBytes} bytes`
      else if (total > LIMITS.totalBytes)
        failure = `Package unpacks to more than ${LIMITS.totalBytes} bytes`
      if (failure) {
        file.terminate()
        return
      }
      sizes.set(file.name, size)
      chunksByName.get(file.name)!.push(chunk)
    }
    try {
      file.start()
    } catch (e) {
      failure = `Unsupported compression in ${file.name}: ${(e as Error).message}`
    }
  })
  unzip.register(UnzipInflate)
  unzip.register(UnzipPassThrough)
  try {
    unzip.push(data, true)
  } catch (e) {
    return { error: `Not a valid zip file: ${(e as Error).message}` }
  }
  if (failure) return { error: failure }
  if (chunksByName.size === 0) return { error: 'The zip file is empty' }

  const entries: PackageEntry[] = []
  for (const [path, chunks] of chunksByName) {
    const bytes = concat(chunks)
    entries.push({ path, size: bytes.length, read: () => bytes })
  }
  return { entries }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

const FIXED_MTIME = new Date('2000-01-01T00:00:00Z')

/** Same files in, same bytes out: sorted paths and a fixed timestamp, so a package's sha256 is reproducible. */
export function writeZip(files: { path: string; data: Uint8Array }[]): Uint8Array {
  const zippable: Zippable = {}
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    zippable[file.path] = [file.data, { mtime: FIXED_MTIME, level: 9 }]
  }
  return zipSync(zippable)
}
