// The one zip reader and writer for packages, used by the master, the CLI and the app.
// Reviewers and users must see the same files, so the reader is strict: every byte of the
// file belongs to exactly one local entry, the central directory, or the end record, and
// each local header agrees with its directory entry. A zip that two parsers could read
// differently is refused instead of guessed at.
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'
import { LIMITS, type PackageEntry } from './package.ts'

export type ZipReadResult = { entries: PackageEntry[] } | { error: string }

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_END = 0x06054b50
const SIG_DESCRIPTOR = 0x08074b50
const END_SIZE = 22
const FLAG_ENCRYPTED = 0x1
const FLAG_DESCRIPTOR = 0x8
const FLAG_UTF8 = 0x800
const nameDecoder = new TextDecoder('utf-8', { fatal: true })

type CentralEntry = {
  name: string
  nameBytes: Uint8Array
  flags: number
  method: number
  crc: number
  compressedSize: number
  size: number
  offset: number
}

export function readPackageZip(data: Uint8Array): ZipReadResult {
  try {
    return { entries: readStrict(data) }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

function readStrict(data: Uint8Array): PackageEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const u16 = (at: number) => view.getUint16(at, true)
  const u32 = (at: number) => view.getUint32(at, true)
  const fail = (message: string): never => {
    throw new Error(`Not a valid package zip: ${message}`)
  }

  if (data.length < END_SIZE) fail('too short')
  const end = data.length - END_SIZE
  if (u32(end) !== SIG_END) fail('archive comments and trailing data are not allowed')
  const count = u16(end + 10)
  const cdSize = u32(end + 12)
  const cdOffset = u32(end + 16)
  if (u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== count)
    fail('multi-part archives are not supported')
  if (count === 0) fail('the zip file is empty')
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
    fail('zip64 is not supported')
  if (count > LIMITS.files * 2) fail(`more than ${LIMITS.files} files`)
  if (cdOffset + cdSize !== end) fail('the central directory is not where the end record says')

  const central: CentralEntry[] = []
  let at = cdOffset
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(at) !== SIG_CENTRAL) fail('corrupt central directory')
    const nameLength = u16(at + 28)
    const extraLength = u16(at + 30)
    const commentLength = u16(at + 32)
    const nameBytes = data.subarray(at + 46, at + 46 + nameLength)
    let name = ''
    try {
      name = nameDecoder.decode(nameBytes)
    } catch {
      fail('file names must be UTF-8')
    }
    central.push({
      name,
      nameBytes,
      flags: u16(at + 8),
      method: u16(at + 10),
      crc: u32(at + 16),
      compressedSize: u32(at + 20),
      size: u32(at + 24),
      offset: u32(at + 42),
    })
    at += 46 + nameLength + extraLength + commentLength
  }
  if (at !== end) fail('unexpected bytes after the central directory')

  const names = new Set<string>()
  let declaredTotal = 0
  for (const entry of central) {
    if (names.has(entry.name)) fail(`duplicate entry ${entry.name}`)
    names.add(entry.name)
    if (entry.flags & FLAG_ENCRYPTED) fail(`${entry.name} is encrypted`)
    if (entry.flags & ~(FLAG_DESCRIPTOR | FLAG_UTF8 | 0x6))
      fail(`${entry.name} uses unsupported zip features`)
    if (entry.method !== 0 && entry.method !== 8)
      fail(`${entry.name} uses an unsupported compression method`)
    if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff)
      fail('zip64 is not supported')
    if (entry.size > LIMITS.fileBytes)
      fail(`${entry.name} unpacks to more than ${LIMITS.fileBytes} bytes`)
    declaredTotal += entry.size
  }
  if (declaredTotal > LIMITS.totalBytes)
    fail(`the package unpacks to more than ${LIMITS.totalBytes} bytes`)

  // Local entries must tile the file from byte 0 up to the central directory, in order.
  const byOffset = [...central].sort((a, b) => a.offset - b.offset)
  let cursor = 0
  const entries: PackageEntry[] = []
  for (const entry of byOffset) {
    if (entry.offset !== cursor) fail(`gap or overlap before ${entry.name}`)
    if (entry.offset + 30 > cdOffset || u32(entry.offset) !== SIG_LOCAL)
      fail(`missing local header for ${entry.name}`)
    const flags = u16(entry.offset + 6)
    const nameLength = u16(entry.offset + 26)
    const extraLength = u16(entry.offset + 28)
    const localName = data.subarray(entry.offset + 30, entry.offset + 30 + nameLength)
    if (
      flags !== entry.flags ||
      u16(entry.offset + 8) !== entry.method ||
      !sameBytes(localName, entry.nameBytes)
    )
      fail(`local header of ${entry.name} disagrees with the central directory`)
    if (!(flags & FLAG_DESCRIPTOR)) {
      if (
        u32(entry.offset + 14) !== entry.crc ||
        u32(entry.offset + 18) !== entry.compressedSize ||
        u32(entry.offset + 22) !== entry.size
      )
        fail(`local header of ${entry.name} disagrees with the central directory`)
    }
    const dataStart = entry.offset + 30 + nameLength + extraLength
    let next = dataStart + entry.compressedSize
    if (next > cdOffset) fail(`${entry.name} runs past the end of the data`)
    if (flags & FLAG_DESCRIPTOR) {
      const signed = next + 4 <= cdOffset && u32(next) === SIG_DESCRIPTOR ? 4 : 0
      const d = next + signed
      if (
        d + 12 > cdOffset ||
        u32(d) !== entry.crc ||
        u32(d + 4) !== entry.compressedSize ||
        u32(d + 8) !== entry.size
      )
        fail(`data descriptor of ${entry.name} disagrees with the central directory`)
      next = d + 12
    }
    cursor = next

    const raw = data.subarray(dataStart, dataStart + entry.compressedSize)
    let bytes: Uint8Array
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.size) fail(`${entry.name} has inconsistent sizes`)
      bytes = raw
    } else {
      try {
        bytes = new Uint8Array(inflateRawSync(raw, { maxOutputLength: Math.max(entry.size, 1) }))
      } catch {
        fail(`${entry.name} is corrupt or larger than it claims`)
      }
    }
    if (bytes!.length !== entry.size || crc32(bytes!) >>> 0 !== entry.crc)
      fail(`${entry.name} is corrupt`)
    const content = bytes!
    if (entry.name.endsWith('/')) {
      if (entry.size !== 0) fail(`directory entry ${entry.name} has content`)
      continue
    }
    entries.push({ path: entry.name, size: entry.size, read: () => content })
  }
  if (cursor !== cdOffset) fail('unexpected bytes before the central directory')
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** 2000-01-01 00:00 in DOS format: a fixed timestamp keeps a package's sha256 reproducible. */
const DOS_DATE = ((2000 - 1980) << 9) | (1 << 5) | 1
const encoder = new TextEncoder()

/** Same files in, same bytes out: sorted paths, fixed timestamps, no extra fields. */
export function writePackageZip(files: { path: string; data: Uint8Array }[]): Uint8Array {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of sorted) {
    const name = encoder.encode(file.path)
    const deflated = new Uint8Array(deflateRawSync(file.data, { level: 9 }))
    const stored = deflated.length >= file.data.length
    const body = stored ? file.data : deflated
    const method = stored ? 0 : 8
    const crc = crc32(file.data) >>> 0

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, SIG_LOCAL, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, FLAG_UTF8, true)
    lv.setUint16(8, method, true)
    lv.setUint16(10, 0, true)
    lv.setUint16(12, DOS_DATE, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, body.length, true)
    lv.setUint32(22, file.data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, SIG_CENTRAL, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, FLAG_UTF8, true)
    cv.setUint16(10, method, true)
    cv.setUint16(14, DOS_DATE, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, body.length, true)
    cv.setUint32(24, file.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)

    locals.push(local, body)
    centrals.push(central)
    offset += local.length + body.length
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0)
  const endRecord = new Uint8Array(END_SIZE)
  const ev = new DataView(endRecord.buffer)
  ev.setUint32(0, SIG_END, true)
  ev.setUint16(8, sorted.length, true)
  ev.setUint16(10, sorted.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)

  const out = new Uint8Array(offset + cdSize + END_SIZE)
  let at = 0
  for (const part of [...locals, ...centrals, endRecord]) {
    out.set(part, at)
    at += part.length
  }
  return out
}
