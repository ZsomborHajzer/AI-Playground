import { describe, expect, it } from 'vitest'
import {
  addToGroups,
  classify,
  fingerprint,
  normalizeMessage,
  parseAppError,
  stripAnsi,
  summarizeIssues,
  type Issue,
  type IssueGroup,
  type LogEntry,
} from '../../observability/logClassification'

const entry = (overrides: Partial<LogEntry>): LogEntry => ({
  ts: '2026-11-07T14:27:44.073Z',
  level: 'info',
  origin: 'main',
  message: '',
  ...overrides,
})

describe('classify', () => {
  it('treats crashes as bugs whatever their level', () => {
    expect(classify(entry({ level: 'warn', crash: true, message: 'gone' })).kind).toBe('bug')
  })

  it('reads the AppError prefix the renderer error sink prints', () => {
    const line = '[AppError error] [backend] backend/start-failed: llama-server exited'
    expect(parseAppError(line)).toEqual({
      severity: 'error',
      category: 'backend',
      code: 'backend/start-failed',
    })
    expect(classify(entry({ level: 'error', origin: 'renderer', message: line })).kind).toBe(
      'error',
    )
    const uncaught = '[AppError error] [unknown] global/unhandled-rejection: boom'
    expect(classify(entry({ level: 'error', origin: 'renderer', message: uncaught })).kind).toBe(
      'bug',
    )
    const warning = '[AppError warning] [network] net/slow: retrying'
    expect(classify(entry({ level: 'error', message: warning })).kind).toBe('warning')
  })

  it('marks uncaught renderer exceptions as bugs', () => {
    const message = "Uncaught TypeError: Cannot read properties of undefined (reading 'id')"
    expect(classify(entry({ level: 'error', origin: 'renderer', message })).kind).toBe('bug')
  })

  it('demotes known dev noise even at error level', () => {
    const message =
      'Failed to detect NVIDIA GPUs via nvidia-smi {"stderr":"spawn nvidia-smi.exe ENOENT"}'
    expect(classify(entry({ level: 'error', message })).kind).toBe('noise')
    expect(
      classify(entry({ level: 'warn', message: 'Electron Security Warning (CSP)' })).kind,
    ).toBe('noise')
  })

  it('uses the level a child process states instead of its stderr', () => {
    const stderr = (message: string) =>
      classify(entry({ level: 'error', source: 'comfyui-backend', message })).kind
    expect(stderr('[INFO] Starting server')).toBe('log')
    expect(stderr("[WARNING] Cannot import nodes_glsl.py: No module named 'comfy_angle'")).toBe(
      'warning',
    )
    expect(stderr('[ERROR] !!! Exception during processing !!!')).toBe('error')
    expect(stderr(" * Serving Flask app 'web_api'")).toBe('log')
    expect(stderr('Traceback (most recent call last):')).toBe('error')
  })

  it('only counts uv error and warning lines as issues', () => {
    const uv = (message: string) =>
      classify(entry({ level: 'error', source: 'uv.check.service', message })).kind
    expect(uv('UV Error: Resolved 110 packages in 1ms')).toBe('log')
    expect(uv('UV Error:')).toBe('log')
    expect(uv('UV Error: error: The environment is outdated; run `uv sync`')).toBe('error')
    expect(uv('UV Error: warning: `VIRTUAL_ENV` does not match')).toBe('warning')
  })

  it('strips terminal colour codes', () => {
    const esc = String.fromCharCode(27)
    expect(stripAnsi(`${esc}[32m[INFO]${esc}[0m ready`)).toBe('[INFO] ready')
  })

  it('falls back to the console level', () => {
    expect(classify(entry({ level: 'error', message: 'x' })).kind).toBe('error')
    expect(classify(entry({ level: 'warn', message: 'x' })).kind).toBe('warning')
    expect(classify(entry({ level: 'info', message: 'x' })).kind).toBe('log')
  })
})

describe('fingerprint', () => {
  it('groups occurrences that differ only in paths, numbers and ids', () => {
    const a = entry({
      level: 'error',
      source: 'ai-backend',
      message: 'Unzip error: Command failed: "C:\\a\\7zr.exe" x port 49123 took 12ms',
    })
    const b = {
      ...a,
      message: 'Unzip error: Command failed: "D:\\b\\7zr.exe" x port 49999 took 7ms',
    }
    expect(fingerprint(a)).toBe(fingerprint(b))
    expect(fingerprint(a)).not.toBe(fingerprint({ ...a, source: 'comfyui-backend' }))
  })

  it('keeps only the first line', () => {
    expect(normalizeMessage('Error: boom\n    at foo (/x/y/z.ts:1:2)')).toBe('Error: boom')
  })
})

describe('summarizeIssues', () => {
  it('lists bugs before errors and counts repeats', () => {
    const groups = new Map<string, IssueGroup>()
    const issue = (kind: Issue['kind'], message: string): Issue => {
      const e = entry({ level: 'error', message })
      return { ...e, kind, fingerprint: fingerprint(e) }
    }
    addToGroups(groups, issue('error', 'setup failed'))
    addToGroups(groups, issue('error', 'setup failed'))
    addToGroups(groups, issue('bug', 'Uncaught TypeError'))
    const text = summarizeIssues(groups.values(), {
      startedAt: '2026-11-07T14:00:00.000Z',
      noise: 3,
      lines: 10,
    })
    expect(text.indexOf('Uncaught TypeError')).toBeLessThan(text.indexOf('setup failed'))
    expect(text).toContain('**×2**')
    expect(text).toContain('3 known-noise lines')
  })
})
