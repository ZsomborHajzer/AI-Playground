import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rotateSessions, startDevSessionLog } from '../../observability/devSessionLog'

const roots: string[] = []
const tempRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aipg-devlog-'))
  roots.push(root)
  return root
}
const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), 'utf8')

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('startDevSessionLog', () => {
  it('writes every line and only issues to issues.jsonl', () => {
    const log = startDevSessionLog({ root: tempRoot(), flushIntervalMs: 60_000 })
    log.record({ level: 'info', origin: 'main', source: 'ai-backend', message: 'starting' })
    log.record({ level: 'error', origin: 'main', source: 'ai-backend', message: 'unzip failed' })
    log.record({ level: 'warn', origin: 'renderer', message: 'Electron Security Warning' })
    log.close()

    const session = read(log.dir, 'session.log')
    expect(session).toMatch(/LOG\s+main\s+\[ai-backend\] starting/)
    expect(session).toMatch(/ERROR\s+main\s+\[ai-backend\] unzip failed/)
    expect(session).toMatch(/NOISE\s+renderer/)

    const issues = read(log.dir, 'issues.jsonl')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ kind: 'error', source: 'ai-backend' })

    const meta = JSON.parse(read(log.dir, 'session.json'))
    expect(meta.endedCleanly).toBe(true)
    expect(meta.counts).toMatchObject({ log: 1, error: 1, noise: 1 })
    expect(read(log.dir, 'summary.md')).toContain('unzip failed')
  })

  it('writes bugs to disk immediately, before any flush interval', () => {
    const log = startDevSessionLog({ root: tempRoot(), flushIntervalMs: 60_000 })
    log.record({ level: 'error', origin: 'main', message: 'TypeError: x', crash: true })
    expect(read(log.dir, 'session.log')).toMatch(/BUG/)
    expect(read(log.dir, 'summary.md')).toContain('TypeError: x')
    log.close()
  })

  it('tees console output and redacts it', () => {
    const log = startDevSessionLog({
      root: tempRoot(),
      flushIntervalMs: 60_000,
      redact: (m) => m.replace('secret', '<redacted>'),
    })
    const sink: unknown[] = []
    const fake = { ...console, error: (...a: unknown[]) => sink.push(a), info: () => {} }
    log.teeConsole(fake as Console)
    fake.error('[comfyui-backend]: token secret leaked')
    log.close()
    expect(sink).toHaveLength(1)
    const session = read(log.dir, 'session.log')
    expect(session).toContain('[comfyui-backend] token <redacted> leaked')
    expect(session).not.toContain('secret')
  })
})

describe('rotateSessions', () => {
  it('archives the previous run, marks it unclean if it never closed, and prunes', () => {
    const root = tempRoot()
    for (const name of ['2026-01-01T00-00-00-000Z', '2026-01-02T00-00-00-000Z']) {
      fs.mkdirSync(path.join(root, name))
    }
    fs.mkdirSync(path.join(root, 'latest'))
    fs.writeFileSync(
      path.join(root, 'latest', 'session.json'),
      JSON.stringify({ startedAt: '2026-01-03T00:00:00.000Z' }),
    )

    const dir = rotateSessions(root, 2, '2026-01-04T00:00:00.000Z')

    expect(dir).toBe(path.join(root, 'latest'))
    expect(fs.readdirSync(dir)).toEqual([])
    const archived = path.join(root, '2026-01-03T00-00-00-000Z')
    expect(JSON.parse(read(archived, 'session.json')).endedCleanly).toBe(false)
    expect(fs.readdirSync(root).sort()).toEqual([
      '2026-01-02T00-00-00-000Z',
      '2026-01-03T00-00-00-000Z',
      'latest',
    ])
  })
})
