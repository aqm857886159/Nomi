import { describe, expect, it } from 'vitest'
import { canRetryCameraMoveCapture, decideCameraMoveRetry, DEFAULT_CAMERA_MOVE_RETRY, type CameraMoveRetryConfig } from './cameraMoveCaptureRetry'

const cfg: CameraMoveRetryConfig = { maxAttempts: 3, retryDelayMs: 800, attemptTimeoutMs: 30_000 }

describe('canRetryCameraMoveCapture', () => {
  it('到上限前允许、到上限不再、maxAttempts<1 兜底为 1', () => {
    expect(canRetryCameraMoveCapture(1, cfg)).toBe(true)
    expect(canRetryCameraMoveCapture(2, cfg)).toBe(true)
    expect(canRetryCameraMoveCapture(3, cfg)).toBe(false)
    expect(canRetryCameraMoveCapture(1, { ...cfg, maxAttempts: 0 })).toBe(false)
  })
})

describe('decideCameraMoveRetry', () => {
  it('ok → done；null / timeout 有次数 → retry（attempt+1、带延迟）；到上限 → giveUp', () => {
    expect(decideCameraMoveRetry('ok', 3, cfg)).toEqual({ kind: 'done' })
    expect(decideCameraMoveRetry('null', 1, cfg)).toEqual({ kind: 'retry', nextAttempt: 2, delayMs: 800 })
    expect(decideCameraMoveRetry('timeout', 2, cfg)).toEqual({ kind: 'retry', nextAttempt: 3, delayMs: 800 })
    expect(decideCameraMoveRetry('null', 3, cfg)).toEqual({ kind: 'giveUp' })
  })

  it('两次都失败到底 → 最终 giveUp（首次 + 2 次重试）', () => {
    let attempt = 1
    let decision = decideCameraMoveRetry('timeout', attempt, cfg)
    while (decision.kind === 'retry') {
      attempt = decision.nextAttempt
      decision = decideCameraMoveRetry('timeout', attempt, cfg)
    }
    expect(decision.kind).toBe('giveUp')
    expect(attempt).toBe(3)
  })

  it('默认 3 次 / 800ms；负延迟夹到 0', () => {
    expect(DEFAULT_CAMERA_MOVE_RETRY).toMatchObject({ maxAttempts: 3, retryDelayMs: 800 })
    expect(decideCameraMoveRetry('null', 1, { ...cfg, retryDelayMs: -50 })).toEqual({ kind: 'retry', nextAttempt: 2, delayMs: 0 })
  })
})
