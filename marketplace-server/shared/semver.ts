// Just enough semver for plugin versions and `engines.aipg` ranges, so this module
// (and everything that imports it, including the app) needs no npm dependency.

export const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

export type ParsedVersion = { major: number; minor: number; patch: number; pre?: string }

export function parseVersion(version: string): ParsedVersion | undefined {
  const match = SEMVER_PATTERN.exec(version.trim())
  if (!match) return undefined
  return { major: +match[1], minor: +match[2], patch: +match[3], pre: match[4] }
}

/** Negative when a < b, 0 when equal, positive when a > b. A pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return a.localeCompare(b)
  const diff = pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch
  if (diff !== 0) return diff
  if (pa.pre === pb.pre) return 0
  if (pa.pre === undefined) return 1
  if (pb.pre === undefined) return -1
  return pa.pre.localeCompare(pb.pre, undefined, { numeric: true })
}

function satisfiesComparator(version: string, comparator: string): boolean {
  if (comparator === '*' || comparator === '') return true
  const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(comparator)
  if (!match) return false
  const [, op = '=', target] = match
  const parsedTarget = parseVersion(target)
  if (!parsedTarget) return false
  const cmp = compareVersions(version, target)
  switch (op) {
    case '>=':
      return cmp >= 0
    case '<=':
      return cmp <= 0
    case '>':
      return cmp > 0
    case '<':
      return cmp < 0
    case '^': {
      if (cmp < 0) return false
      const v = parseVersion(version)!
      if (parsedTarget.major > 0) return v.major === parsedTarget.major
      if (parsedTarget.minor > 0) return v.major === 0 && v.minor === parsedTarget.minor
      return v.major === 0 && v.minor === 0 && v.patch === parsedTarget.patch
    }
    case '~': {
      if (cmp < 0) return false
      const v = parseVersion(version)!
      return v.major === parsedTarget.major && v.minor === parsedTarget.minor
    }
    default:
      return cmp === 0
  }
}

/** Supports `*`, exact, `>= > <= < = ^ ~`, space-separated AND and `||` OR. */
export function satisfiesRange(version: string, range: string): boolean {
  if (!parseVersion(version)) return false
  return range.split('||').some((set) =>
    set
      .trim()
      .split(/\s+/)
      .every((comparator) => satisfiesComparator(version, comparator)),
  )
}

export function isValidRange(range: string): boolean {
  if (!range.trim()) return false
  return range.split('||').every((set) =>
    set
      .trim()
      .split(/\s+/)
      .every((c) => c === '*' || /^(>=|<=|>|<|=|\^|~)?\s*\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(c)),
  )
}
