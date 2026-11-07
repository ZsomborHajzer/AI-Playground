// Pushes new events to every mirror. A mirror that is down keeps its last acked seq
// and is retried with backoff; it also pulls the same feed itself when it starts.
import { hmacHeaders, type ReplicationBatch } from '../shared/index.ts'
import type { MasterCore } from './core.ts'
import type { MirrorRow } from './db.ts'

export const REPLICATE_PATH = '/v1/replicate'

export async function pushToMirror(core: MasterCore, mirror: MirrorRow, timeoutMs = 15_000) {
  const batch: ReplicationBatch = core.batchSince(mirror.last_acked_seq)
  const body = JSON.stringify(batch)
  try {
    const response = await fetch(`${mirror.url}${REPLICATE_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...hmacHeaders(mirror.id, mirror.secret, 'POST', REPLICATE_PATH, body),
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
    const { seq } = JSON.parse(text) as { seq: number }
    core.mirrorContact(mirror.id, { ackedSeq: seq })
    return { ok: true as const, seq }
  } catch (e) {
    const error = (e as Error).message
    core.mirrorContact(mirror.id, { error })
    return { ok: false as const, error }
  }
}

export function startReplication(core: MasterCore, intervalMs: number, log: (msg: string) => void) {
  let running = false
  const tick = async (force = false) => {
    if (running) return
    running = true
    try {
      const seq = core.currentSeq()
      for (const mirror of core.mirrors()) {
        const due = force || Date.now() >= mirror.next_attempt_at
        if (mirror.last_acked_seq >= seq || !due) continue
        const result = await pushToMirror(core, mirror)
        if (!result.ok) log(`replication to ${mirror.id} failed: ${result.error}`)
      }
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  timer.unref()
  core.onChange(() => setTimeout(() => void tick(true), 50).unref())
  return { stop: () => clearInterval(timer), tick }
}
