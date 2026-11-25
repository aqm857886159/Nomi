import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeShotVerifyDeps } from './shotVerifyJudge'

const g = globalThis as { window?: { nomiDesktop?: unknown } }
let prevWindow: { nomiDesktop?: unknown } | undefined

describe('makeShotVerifyDeps().visionAvailable', () => {
  beforeEach(() => {
    prevWindow = g.window
    g.window = {}
  })

  afterEach(() => {
    if (prevWindow === undefined) delete g.window
    else g.window = prevWindow
  })

  it('returns false when textBrain reports imageInput: unsupported', async () => {
    const textBrain = vi.fn().mockResolvedValue({
      ok: true,
      brain: { vendor: 'vendor-a', modelKey: 'text-only' },
      imageInput: 'unsupported',
    })
    g.window = { nomiDesktop: { promptLibrary: { textBrain } } }

    const deps = makeShotVerifyDeps('proj-1')
    expect(await deps.visionAvailable()).toBe(false)
    expect(textBrain).toHaveBeenCalledTimes(1)
  })

  it('returns true when textBrain reports imageInput: supported or unknown', async () => {
    const textBrain = vi.fn()
      .mockResolvedValueOnce({ ok: true, brain: { vendor: 'vendor-a', modelKey: 'vision' }, imageInput: 'supported' })
      .mockResolvedValueOnce({ ok: true, brain: { vendor: 'vendor-a', modelKey: 'custom' }, imageInput: 'unknown' })
    g.window = { nomiDesktop: { promptLibrary: { textBrain } } }

    const deps = makeShotVerifyDeps('proj-1')
    expect(await deps.visionAvailable()).toBe(true)
    expect(await deps.visionAvailable()).toBe(true)
  })

  it('returns false when textBrain is missing, not ok, or rejects', async () => {
    g.window = {}
    expect(await makeShotVerifyDeps('proj-1').visionAvailable()).toBe(false)

    g.window = {
      nomiDesktop: { promptLibrary: { textBrain: vi.fn().mockResolvedValue({ ok: false }) } },
    }
    expect(await makeShotVerifyDeps('proj-1').visionAvailable()).toBe(false)

    g.window = {
      nomiDesktop: { promptLibrary: { textBrain: vi.fn().mockRejectedValue(new Error('ipc down')) } },
    }
    expect(await makeShotVerifyDeps('proj-1').visionAvailable()).toBe(false)
  })
})
