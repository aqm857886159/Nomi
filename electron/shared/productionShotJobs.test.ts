import { describe, expect, it } from 'vitest'

import { anySubmissionMayHaveReachedProvider, jobEndedBeforeAcceptance, jobMayHaveReachedProvider } from './productionShotJobs'
import type { ProductionJob } from '../productionRun/productionRunTypes'

// 「有没有可能到过供应商」的唯一判据：面板付费卡的失败文案、Agent generate 的失败码、这一次出价的逐镜结局都只读它。
// 宁可让人多核对一次，也不许把一笔可能的扣费说成没花钱——所以只有三种情况算「没被受理」。

const job = (status: ProductionJob['status'], errorCode?: string): Pick<ProductionJob, 'status' | 'errorCode'> => ({ status, ...(errorCode ? { errorCode } : {}) })

describe('jobMayHaveReachedProvider', () => {
  it('还没跨过提交边界（计划中 / 等授权 / 已授权）：没到过', () => {
    for (const status of ['planned', 'authorization_required', 'authorized'] as const) {
      expect(jobMayHaveReachedProvider(job(status)), status).toBe(false)
    }
  })

  it('跨过之后被证明一个字节都没写出去（provider_not_reached）：没到过', () => {
    expect(jobEndedBeforeAcceptance(job('needs_attention', 'provider_not_reached'))).toBe(true)
    expect(jobMayHaveReachedProvider(job('needs_attention', 'provider_not_reached'))).toBe(false)
  })

  it('供应商当场明确拒绝（provider_rejected，F3）：没被受理、没花钱', () => {
    expect(jobEndedBeforeAcceptance(job('needs_attention', 'provider_rejected'))).toBe(true)
    expect(jobMayHaveReachedProvider(job('needs_attention', 'provider_rejected'))).toBe(false)
  })

  it('其余一律按「可能到过」：提交意图落盘了、在等结果、失败但原因不是没写出去', () => {
    expect(jobMayHaveReachedProvider(job('submit_intent_persisted'))).toBe(true)
    expect(jobMayHaveReachedProvider(job('polling'))).toBe(true)
    expect(jobMayHaveReachedProvider(job('needs_attention', 'provider_timeout'))).toBe(true)
    expect(jobMayHaveReachedProvider(job('needs_attention'))).toBe(true)
  })

  it('一个账本：任何一笔可能到过就算可能到过', () => {
    expect(anySubmissionMayHaveReachedProvider([job('authorized'), job('needs_attention', 'provider_not_reached')])).toBe(false)
    expect(anySubmissionMayHaveReachedProvider([job('authorized'), job('polling')])).toBe(true)
    expect(anySubmissionMayHaveReachedProvider([])).toBe(false)
  })
})
