// Pure classification for the dev session log (devSessionLog.ts): decides whether a
// line is a bug, an error, a warning, known noise or ordinary output.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogOrigin = 'main' | 'renderer' | 'process'
export type LogClass = 'bug' | 'error' | 'warning' | 'noise' | 'log'

export type LogEntry = {
  ts: string
  level: LogLevel
  origin: LogOrigin
  source?: string
  message: string
  location?: string
  /** Set by the crash hooks: uncaught exceptions, renderer or child process gone. */
  crash?: boolean
}

export type ParsedAppError = { severity: string; category: string; code: string }

export type Issue = LogEntry & {
  kind: Exclude<LogClass, 'noise' | 'log'>
  fingerprint: string
  appError?: ParsedAppError
}

export type IssueGroup = {
  fingerprint: string
  kind: Issue['kind']
  count: number
  firstSeen: string
  lastSeen: string
  origin: LogOrigin
  source?: string
  message: string
  location?: string
  appError?: ParsedAppError
}

/** Messages that look alarming but are expected in a dev run; kept in session.log as NOISE. */
export const KNOWN_NOISE: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /Electron Security Warning/,
    reason: 'dev-server CSP warning; Electron drops it in packaged builds',
  },
  { pattern: /Lit is in dev mode/, reason: '<model-viewer> dev-build notice' },
  { pattern: /Download the Vue Devtools extension/, reason: 'Vue dev-build notice' },
  {
    pattern: /nvidia-smi[\s\S]*ENOENT/,
    reason: 'nvidia-smi is absent on machines without an NVIDIA driver',
  },
  { pattern: /onednn_verbose/, reason: 'oneDNN trace output on stderr' },
]

/** AppError codes the renderer's global capture uses for failures nothing caught. */
const UNCAUGHT_APP_ERROR_CODES = new Set([
  'global/uncaught-error',
  'global/unhandled-rejection',
  'vue/component-error',
])

const APP_ERROR_LINE = /^\[AppError (\w+)\] \[([^\]]+)\] (\S+?):/

export function parseAppError(message: string): ParsedAppError | undefined {
  const match = APP_ERROR_LINE.exec(message)
  return match ? { severity: match[1], category: match[2], code: match[3] } : undefined
}

export function classify(entry: LogEntry): { kind: LogClass; appError?: ParsedAppError } {
  if (KNOWN_NOISE.some(({ pattern }) => pattern.test(entry.message))) return { kind: 'noise' }
  if (entry.crash) return { kind: 'bug' }

  const appError = parseAppError(entry.message)
  if (appError) {
    if (UNCAUGHT_APP_ERROR_CODES.has(appError.code) || appError.severity === 'fatal') {
      return { kind: 'bug', appError }
    }
    if (appError.severity === 'error') return { kind: 'error', appError }
    if (appError.severity === 'warning') return { kind: 'warning', appError }
    return { kind: 'log', appError }
  }

  if (entry.origin === 'renderer' && entry.level === 'error' && /^Uncaught\b/.test(entry.message)) {
    return { kind: 'bug' }
  }

  // Child processes write progress to stderr, which the backends log at error
  // level. Prefer the level the child stated itself, and otherwise ask for
  // error-like wording before calling a stderr line an error.
  const tagged = EMBEDDED_LEVEL.exec(entry.message)
  if (tagged) return { kind: EMBEDDED_LEVEL_CLASS[tagged[1] ?? tagged[2]] }
  const uv = /^UV Error:\s*([\s\S]*)$/.exec(entry.message)
  if (uv) {
    if (/^\s*error:/i.test(uv[1])) return { kind: 'error' }
    if (/^\s*warning:/i.test(uv[1])) return { kind: 'warning' }
    return { kind: 'log' }
  }
  if (entry.level === 'error' && entry.source?.endsWith('-backend')) {
    return { kind: ERRORISH.test(entry.message) ? 'error' : 'log' }
  }

  if (entry.level === 'error') return { kind: 'error' }
  if (entry.level === 'warn') return { kind: 'warning' }
  return { kind: 'log' }
}

const EMBEDDED_LEVEL =
  /^(?:\[(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)\]|(DEBUG|INFO|WARNING|ERROR|CRITICAL):)/
const EMBEDDED_LEVEL_CLASS: Record<string, LogClass> = {
  DEBUG: 'log',
  INFO: 'log',
  WARNING: 'warning',
  WARN: 'warning',
  ERROR: 'error',
  CRITICAL: 'error',
}
const ERRORISH =
  /error|exception|traceback|fail|fatal|critical|denied|cannot|unable|not found|crash|abort/i

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/** Removes terminal colour codes that child processes put in their output. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '')
}

/** Strips the parts of a message that differ between occurrences of the same problem. */
export function normalizeMessage(message: string): string {
  return message
    .split('\n')[0]
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[A-Za-z]:\\[^\s'"]*/g, '<path>')
    .replace(/(?:\/[\w.@-]+){2,}/g, '<path>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .trim()
    .slice(0, 300)
}

// FNV-1a, so this module needs no imports and stays usable from plain Node scripts.
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function fingerprint(entry: LogEntry): string {
  return hash(`${entry.origin}|${entry.source ?? ''}|${normalizeMessage(entry.message)}`)
}

export function addToGroups(groups: Map<string, IssueGroup>, issue: Issue): IssueGroup {
  const existing = groups.get(issue.fingerprint)
  if (existing) {
    existing.count++
    existing.lastSeen = issue.ts
    return existing
  }
  const group: IssueGroup = {
    fingerprint: issue.fingerprint,
    kind: issue.kind,
    count: 1,
    firstSeen: issue.ts,
    lastSeen: issue.ts,
    origin: issue.origin,
    source: issue.source,
    message: issue.message,
    location: issue.location,
    appError: issue.appError,
  }
  groups.set(issue.fingerprint, group)
  return group
}

const SECTIONS: { kind: IssueGroup['kind']; title: string }[] = [
  { kind: 'bug', title: 'Bugs (crashes and uncaught errors)' },
  { kind: 'error', title: 'Errors' },
  { kind: 'warning', title: 'Warnings' },
]

export function summarizeIssues(
  groups: Iterable<IssueGroup>,
  header: { startedAt: string; endedAt?: string; noise: number; lines: number },
): string {
  const all = [...groups]
  const out = [
    '# Dev session summary',
    '',
    `Started ${header.startedAt}${header.endedAt ? `, ended ${header.endedAt}` : ', still running or ended abruptly'}.`,
    `${header.lines} lines logged, ${header.noise} known-noise lines hidden from this summary.`,
    '',
  ]
  for (const { kind, title } of SECTIONS) {
    const rows = all.filter((g) => g.kind === kind).sort((a, b) => b.count - a.count)
    out.push(`## ${title} (${rows.length})`, '')
    if (rows.length === 0) out.push('None.', '')
    for (const g of rows) {
      const where = [g.origin, g.source].filter(Boolean).join(' / ')
      const code = g.appError ? ` · ${g.appError.category} ${g.appError.code}` : ''
      out.push(
        `- **×${g.count}** \`${g.fingerprint}\` ${where}${code} · first ${g.firstSeen.slice(11, 23)}, last ${g.lastSeen.slice(11, 23)}`,
        `  > ${g.message.split('\n')[0].slice(0, 400)}`,
      )
      if (g.location) out.push(`  at ${g.location}`)
    }
    out.push('')
  }
  return out.join('\n')
}
