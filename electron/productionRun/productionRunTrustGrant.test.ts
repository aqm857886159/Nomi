import { describe, expect, it } from 'vitest'

import { readTrustGrantBinding, TrustGrantUnavailableError } from './productionRunTrustGrant'
import type { ProductionRun } from './productionRunTypes'

/**
 * 「以后 ¥X 内别再逐镜问」绑在什么上，只有这一份定义。这些用例钉的是它的**诚实边界**：
 * 那个 X 只能从已封存授权算出来；算不出就抛，绝不凑一个数字去问用户批准。
 */
function runWith(plan: Record<string, unknown> | undefined): ProductionRun {
  return { runId: 'run-1', generationPlan: plan } as unknown as ProductionRun
}

function sealedPlan(
  { envelope = {}, ...planOverrides }: { envelope?: Record<string, unknown>; costCertainty?: string } = {},
): Record<string, unknown> {
  return {
    authorizationDigest: 'digest-trust',
    costCertainty: 'known',
    ...planOverrides,
    authorizationEnvelope: {
      immutableProjectUuid: 'uuid-1',
      projectGeneration: 1,
      projectRevision: 2,
      runId: 'run-1',
      planVersion: 1,
      budget: { currency: 'CNY', maximum: 9, ledgerCeiling: 20 },
      jobs: [
        { shotId: 'shot-1', providerId: 'apimart', modelId: 'kling-v2', mode: 'i2v', price: { currency: 'CNY', maximum: 4 } },
        { shotId: 'shot-2', providerId: 'apimart', modelId: 'kling-v2', price: { currency: 'CNY', maximum: 5 } },
      ],
      ...envelope,
    },
  }
}

describe('productionRun/productionRunTrustGrant', () => {
  it('binds the ceiling to run + currency + amount, and keeps trust receipts out of real gates', () => {
    const binding = readTrustGrantBinding(runWith(sealedPlan()))

    // 上限编在串里 ⇒ 改上限或换 run 的收据一律失配。这就是「绑死」的全部机制。
    expect(binding.costScope).toBe('trust.budget-only:run-1:CNY:9')
    expect(binding.maximum).toBe(9)
    expect(binding.digest).toBe('digest-trust')
    // 刻意不用 `gate-` 前缀：一张信任收据永远落不进 gate.decide 的 gateId 比对。
    expect(binding.gateId.startsWith('gate-')).toBe(false)
    expect(binding.shots.map((shot) => `${shot.index} ${shot.providerModelText} ${shot.price}`))
      .toEqual(['1 apimart · kling-v2（i2v） 4', '2 apimart · kling-v2 5'])
  })

  it('refuses to state a ceiling it cannot derive, instead of approximating one', () => {
    // ① 还没封存 —— 「别再问我」问得比计划还早，没有可绑的事实。
    expect(() => readTrustGrantBinding(runWith(undefined))).toThrowError(TrustGrantUnavailableError)
    // ② 有镜头没定价 —— 报出去的合计会少算，用户会以为他批的是全部。
    expect(() => readTrustGrantBinding(runWith(sealedPlan({ costCertainty: 'partial' }))))
      .toThrowError(TrustGrantUnavailableError)
    // ③ 合计不是正数 —— 「¥0 内不再逐镜问」是句没有意义的话，拒绝比问更诚实。
    expect(() => readTrustGrantBinding(runWith(sealedPlan({
      envelope: { budget: { currency: 'CNY', maximum: 0, ledgerCeiling: 0 } },
    })))).toThrowError(TrustGrantUnavailableError)
  })
})
