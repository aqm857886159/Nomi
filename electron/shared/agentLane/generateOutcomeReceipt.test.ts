import { describe, expect, it } from 'vitest'

import { describeGenerateOutcome } from './generateOutcomeReceipt'
import type { GeneratePresentationOutcome } from '../productionGenerationPresentation'

// generate 回执只渲染宿主给的逐镜结局，不自己加判断（2026-09-30 付费卡逐镜）。以前批准一支写死
// 「generation has started… No card is waiting…」：卡上只点了 1 张，Agent 也告诉用户两张都在生成。

function outcome(extra: Partial<GeneratePresentationOutcome>): GeneratePresentationOutcome {
  return { closedBy: 'resolved', generating: [], failedBeforeSending: [], removed: [], takenByCanvas: [], undecided: [], ...extra }
}

describe('describeGenerateOutcome', () => {
  it('每一镜都在生成时才说「都在生成」', () => {
    const receipt = describeGenerateOutcome(outcome({ generating: ['s1', 's2'] }))
    expect(receipt.kind).toBe('job_running')
    expect(receipt.userSees).toContain('All 2 shot(s) on the card are generating')
    expect(receipt.userSees).toContain('Do not call generate again for the shots that are generating.')
  })

  it('生成 1 张、× 关掉时第 2 张没决定：不说「都」，逐镜说对，第 2 张没生成、没花钱', () => {
    const receipt = describeGenerateOutcome(outcome({ closedBy: 'user_closed', generating: ['s1'], undecided: [{ shotId: 's2', reason: 'user_closed' }] }))
    expect(receipt.kind).toBe('job_running')
    expect(receipt.userSees).not.toMatch(/\bAll\b/)
    expect(receipt.userSees).not.toMatch(/generation has started|no card is waiting/i)
    expect(receipt.userSees).toContain('Generating now, because the user clicked generate for each of them: s1.')
    expect(receipt.userSees).toContain('Not generated and nothing spent for s2: the user closed the card (×) before deciding them.')
  })

  it('用户去掉的说是他去掉的；一张都没在生成时下一步是问他，不是自己重来', () => {
    const receipt = describeGenerateOutcome(outcome({ removed: ['s1'], undecided: [{ shotId: 's2', reason: 'user_wrote' }], closedBy: 'user_wrote' }))
    expect(receipt.kind).toBe('none')
    expect(receipt.userSees).toContain('The user removed s1 from the card: they will not be generated')
    expect(receipt.userSees).toContain('the user wrote a message instead of deciding them')
    expect(receipt.userSees).toContain('ask him what he would like instead')
  })

  it('点了但发出前就失败：说没发出去、没花钱，不算在生成', () => {
    const receipt = describeGenerateOutcome(outcome({ failedBeforeSending: ['s1'] }))
    expect(receipt.kind).toBe('none')
    expect(receipt.userSees).toContain('it failed before the provider accepted it (it was never sent, or the provider refused it on the spot): nothing was generated and nothing was spent')
    expect(receipt.userSees).not.toContain('Generating now')
  })

  it('画布接手的单独交代：由画布生成，不归这一次请求', () => {
    const receipt = describeGenerateOutcome(outcome({ generating: ['s1'], takenByCanvas: ['s2'] }))
    expect(receipt.userSees).toContain('s2 were taken over on the canvas while the card was open')
    expect(receipt.userSees).not.toMatch(/\bAll\b/)
  })

  it('同一个值永远是同一句话', () => {
    const value = outcome({ generating: ['s1'], removed: ['s2'], undecided: [{ shotId: 's3', reason: 'stopped' }], closedBy: 'stopped' })
    expect(describeGenerateOutcome(value)).toEqual(describeGenerateOutcome(value))
  })
})
