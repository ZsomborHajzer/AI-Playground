// One log per dev run: everything the main process and the renderer print, plus
// crashes, each line classified (logClassification.ts) so real bugs stand out.
// Layout under `root`:
//   latest/session.log    every line, with a BUG/ERROR/WARN/NOISE/LOG column
//   latest/issues.jsonl   bugs, errors and warnings as JSON (first 20 of each kind)
//   latest/summary.md     issues grouped by fingerprint, bugs first, kept current
//   latest/session.json   run metadata and counts
// The previous `latest/` is renamed to its start time; the newest `keep` survive.
import fs from 'node:fs'
import path from 'node:path'
import { format } from 'node:util'
import type { App, WebContents } from 'electron'
import {
  addToGroups,
  classify,
  fingerprint,
  summarizeIssues,
  type Issue,
  type IssueGroup,
  type LogClass,
  type LogEntry,
  type LogLevel,
  stripAnsi,
} from './logClassification'

export type DevSessionLog = {
  dir: string
  record(entry: Omit<LogEntry, 'ts'> & { ts?: string }): void
  teeConsole(target: Console): void
  watchWebContents(webContents: WebContents): void
  watchProcess(app: App): void
  flush(): void
  close(): void
}

type Options = {
  root: string
  keep?: number
  meta?: Record<string, unknown>
  redact?: (message: string) => string
  flushIntervalMs?: number
}

const MAX_SESSION_LOG_BYTES = 50 * 1024 * 1024
const MAX_ISSUE_LINES_PER_FINGERPRINT = 20
const ECHO_TTL_MS = 60_000
const CLASS_LABEL: Record<LogClass, string> = {
  bug: 'BUG',
  error: 'ERROR',
  warning: 'WARN',
  noise: 'NOISE',
  log: 'LOG',
}

const stamp = (iso: string) => iso.replace(/[:.]/g, '-')

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** Moves the previous run out of `latest/` and prunes old runs. Returns the dir to write to. */
export function rotateSessions(root: string, keep: number, startedAt: string): string {
  fs.mkdirSync(root, { recursive: true })
  const latest = path.join(root, 'latest')
  let target = latest
  if (fs.existsSync(latest)) {
    const metaFile = path.join(latest, 'session.json')
    const meta = readJson(metaFile)
    if (meta && !meta.endedAt) {
      fs.writeFileSync(metaFile, JSON.stringify({ ...meta, endedCleanly: false }, null, 2))
    }
    const previousStart =
      typeof meta?.startedAt === 'string' ? meta.startedAt : fs.statSync(latest).mtime.toISOString()
    let archive = path.join(root, stamp(previousStart))
    for (let i = 1; fs.existsSync(archive); i++)
      archive = `${path.join(root, stamp(previousStart))}-${i}`
    try {
      fs.renameSync(latest, archive)
    } catch {
      target = path.join(root, stamp(startedAt))
    }
  }
  const archived = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-/.test(d.name))
    .map((d) => d.name)
    .sort()
  for (const name of archived.slice(0, Math.max(0, archived.length - keep))) {
    fs.rmSync(path.join(root, name), { recursive: true, force: true })
  }
  fs.mkdirSync(target, { recursive: true })
  return target
}

function shortSource(sourceId: string): string {
  return sourceId.replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '')
}

function splitSource(text: string): { source?: string; message: string } {
  const match = /^\[([^\]\n]+)\]:? ([\s\S]*)$/.exec(text)
  return match ? { source: match[1], message: match[2] } : { message: text }
}

export function startDevSessionLog(options: Options): DevSessionLog {
  const startedAt = new Date().toISOString()
  const keep = options.keep ?? 30
  const redact = options.redact ?? ((message: string) => message)
  const dir = rotateSessions(options.root, keep, startedAt)
  const files = {
    log: path.join(dir, 'session.log'),
    issues: path.join(dir, 'issues.jsonl'),
    summary: path.join(dir, 'summary.md'),
    meta: path.join(dir, 'session.json'),
  }

  const counts: Record<LogClass, number> = { bug: 0, error: 0, warning: 0, noise: 0, log: 0 }
  const groups = new Map<string, IssueGroup>()
  // The main logger mirrors each line to the renderer, which prints it again;
  // remembering what main printed lets the renderer copy be dropped.
  const echoes = new Map<string, number>()
  let logLines: string[] = []
  let issueLines: string[] = []
  let logBytes = 0
  let truncatedNoted = false
  let dirty = true
  let closed = false
  let endedAt: string | undefined

  function writeMeta(endedCleanly?: boolean) {
    fs.writeFileSync(
      files.meta,
      JSON.stringify(
        { startedAt, endedAt, endedCleanly, pid: process.pid, ...options.meta, counts },
        null,
        2,
      ),
    )
  }

  function flush() {
    try {
      if (logLines.length) fs.appendFileSync(files.log, logLines.join('\n') + '\n')
      if (issueLines.length) fs.appendFileSync(files.issues, issueLines.join('\n') + '\n')
      logLines = []
      issueLines = []
      if (dirty) {
        const lines = Object.values(counts).reduce((a, b) => a + b, 0)
        fs.writeFileSync(
          files.summary,
          summarizeIssues(groups.values(), { startedAt, endedAt, noise: counts.noise, lines }),
        )
        writeMeta(endedAt ? true : undefined)
        dirty = false
      }
    } catch {
      // Logging must never take the app down.
    }
  }

  function record(input: Omit<LogEntry, 'ts'> & { ts?: string }) {
    if (closed) return
    const message = stripAnsi(redact(input.message)).trimEnd()
    if (!message.trim()) return
    const entry: LogEntry = { ...input, ts: input.ts ?? new Date().toISOString(), message }
    const { kind, appError } = classify(entry)
    counts[kind]++
    dirty = true

    const isIssue = kind === 'bug' || kind === 'error' || kind === 'warning'
    if (logBytes < MAX_SESSION_LOG_BYTES || isIssue) {
      const where = entry.source ? `[${entry.source}] ` : ''
      const at = entry.location ? `  (${entry.location})` : ''
      const line = `${entry.ts.slice(11, 23)} ${CLASS_LABEL[kind].padEnd(5)} ${entry.origin.padEnd(8)} ${where}${entry.message.replace(/\n/g, '\n' + ' '.repeat(28))}${at}`
      logLines.push(line)
      logBytes += line.length + 1
    } else if (!truncatedNoted) {
      truncatedNoted = true
      logLines.push(`-- session.log reached its size cap; only issues are written from here on --`)
    }

    if (isIssue) {
      const issue: Issue = { ...entry, kind, fingerprint: fingerprint(entry), appError }
      const group = addToGroups(groups, issue)
      if (group.count <= MAX_ISSUE_LINES_PER_FINGERPRINT) {
        issueLines.push(JSON.stringify({ ...issue, message: issue.message.slice(0, 4000) }))
      }
    }
    if (kind === 'bug') flush()
  }

  function teeConsole(target: Console) {
    const methods: [keyof Console & ('debug' | 'log' | 'info' | 'warn' | 'error'), LogLevel][] = [
      ['debug', 'debug'],
      ['log', 'info'],
      ['info', 'info'],
      ['warn', 'warn'],
      ['error', 'error'],
    ]
    for (const [method, level] of methods) {
      const original = target[method].bind(target)
      target[method] = (...args: unknown[]) => {
        original(...args)
        try {
          const text = format(...args)
          const loggerLine = /^\[([^\]\n]+)\]: ([\s\S]*)$/.exec(text)
          if (loggerLine)
            echoes.set(`[${loggerLine[1]}] ${loggerLine[2]}`, Date.now() + ECHO_TTL_MS)
          record({ level, origin: 'main', ...splitSource(text) })
        } catch {
          // see flush()
        }
      }
    }
  }

  function isEcho(message: string): boolean {
    const expiry = echoes.get(message)
    if (expiry === undefined) return false
    echoes.delete(message)
    if (echoes.size > 2000) {
      const now = Date.now()
      for (const [key, until] of echoes) if (until < now) echoes.delete(key)
    }
    return expiry >= Date.now()
  }

  function watchWebContents(webContents: WebContents) {
    webContents.on('console-message', (event) => {
      if (isEcho(event.message)) return
      const level: LogLevel =
        event.level === 'warning'
          ? 'warn'
          : event.level === 'error'
            ? 'error'
            : event.level === 'debug'
              ? 'debug'
              : 'info'
      record({
        level,
        origin: 'renderer',
        ...splitSource(event.message),
        location: event.sourceId ? `${shortSource(event.sourceId)}:${event.lineNumber}` : undefined,
      })
    })
    webContents.on('render-process-gone', (_event, details) => {
      record({
        level: 'error',
        origin: 'renderer',
        source: 'render-process-gone',
        message: `Renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`,
        crash: details.reason !== 'clean-exit',
      })
    })
    webContents.on('preload-error', (_event, preloadPath, error) => {
      record({
        level: 'error',
        origin: 'renderer',
        source: 'preload',
        message: `Preload failed (${preloadPath}): ${error.stack ?? error.message}`,
        crash: true,
      })
    })
    webContents.on('unresponsive', () => {
      record({ level: 'warn', origin: 'renderer', message: 'Window became unresponsive' })
    })
  }

  function watchProcess(app: App) {
    process.on('uncaughtExceptionMonitor', (error, origin) => {
      record({
        level: 'error',
        origin: 'main',
        source: origin,
        message: error instanceof Error ? (error.stack ?? error.message) : String(error),
        crash: true,
      })
    })
    app.on('child-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return
      record({
        level: details.reason === 'killed' ? 'warn' : 'error',
        origin: 'process',
        source: details.name ?? details.type,
        message: `Child process gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`,
        crash: details.reason !== 'killed',
      })
    })
  }

  function close() {
    if (closed) return
    endedAt = new Date().toISOString()
    dirty = true
    clearInterval(timer)
    flush()
    closed = true
    try {
      writeMeta(true)
    } catch {
      // see flush()
    }
  }

  const timer = setInterval(flush, options.flushIntervalMs ?? 500)
  timer.unref?.()
  writeMeta()

  return { dir, record, teeConsole, watchWebContents, watchProcess, flush, close }
}
