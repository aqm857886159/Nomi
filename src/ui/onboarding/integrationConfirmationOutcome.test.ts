import { describe, expect, it } from 'vitest'
import { integrationConfirmationOutcome } from './integrationConfirmationOutcome'

/**
 * 矩阵真机报告 §BUG-2 的后半段：认证失败时弹层**直接关掉跳回模型首页**，一个字都不说。
 * 这里钉死「主进程说 failed 就必须留在原地把原因念出来」。
 */
describe('integrationConfirmationOutcome', () => {
  it('keeps the panel open and names the blocking reason when main reports a failed stage', () => {
    const outcome = integrationConfirmationOutcome({
      stage: 'failed',
      blockingReason: { code: 'certification_unavailable' },
    })

    expect(outcome).toEqual({ done: false, reasonCode: 'certification_unavailable' })
  })

  it('still reports a failure that arrives without a reason code', () => {
    expect(integrationConfirmationOutcome({ stage: 'failed' })).toEqual({ done: false, reasonCode: null })
  })

  it('closes the panel on every non-failed stage', () => {
    for (const stage of ['certifying', 'completed', 'partial', 'awaiting_confirmation']) {
      expect(integrationConfirmationOutcome({ stage })).toEqual({ done: true })
    }
  })

  it('closes the panel when main returns no projection at all', () => {
    expect(integrationConfirmationOutcome(null)).toEqual({ done: true })
    expect(integrationConfirmationOutcome('nope')).toEqual({ done: true })
  })
})
