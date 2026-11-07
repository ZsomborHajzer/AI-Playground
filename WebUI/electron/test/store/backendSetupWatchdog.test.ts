import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackendServiceSetupProgressListener } from '@/assets/js/store/backendServices'

describe('setup watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('stays quiet once a finished run has been consumed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const listener = new BackendServiceSetupProgressListener('ai-backend')
    const run = listener.beginRun()
    listener.addData({
      serviceName: 'ai-backend',
      step: 'end',
      status: 'success',
      debugMessage: '',
    })
    const result = listener.awaitFinalizationAndResetData()
    await vi.advanceTimersByTimeAsync(0)
    expect((await result).success).toBe(true)

    listener.onInvocationSettled(run)
    await vi.advanceTimersByTimeAsync(2500)

    expect(error).not.toHaveBeenCalled()
  })

  it('still reports a run that never sent a terminal update', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const listener = new BackendServiceSetupProgressListener('ai-backend')
    const run = listener.beginRun()
    const result = listener.awaitFinalizationAndResetData()

    listener.onInvocationSettled(run, 'registry not ready')
    await vi.advanceTimersByTimeAsync(2500)

    expect(error).toHaveBeenCalledOnce()
    expect((await result).success).toBe(false)
  })
})
