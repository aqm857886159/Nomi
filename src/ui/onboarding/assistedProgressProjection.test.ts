import { describe, expect, it } from 'vitest'

import { INTEGRATION_STAGES, type IntegrationStage } from '../../../electron/shared/integrationContract'
import {
  ASSISTED_PROGRESS_STAGES,
  ASSISTED_PROGRESS_STEPS,
  projectAssistedProgress,
} from './assistedProgressProjection'

describe('assisted integration progress projection', () => {
  // 12 个真实 stage 一个都不许掉在地上：漏一个 = 用户在那一刻看到「刚开头」，而它其实快跑完了。
  it('accounts for every stage in the shared lifecycle vocabulary', () => {
    const claimed = new Set(ASSISTED_PROGRESS_STEPS.flatMap((step) => [...ASSISTED_PROGRESS_STAGES[step]]))
    const terminal: readonly IntegrationStage[] = ['failed', 'partial', 'cancelled']
    for (const stage of INTEGRATION_STAGES) {
      expect(claimed.has(stage) || terminal.includes(stage), stage).toBe(true)
    }
  })

  it('walks the five steps forward as the real stage advances', () => {
    expect(projectAssistedProgress({ stage: 'draft' }).rows.map((row) => row.state))
      .toEqual(['active', 'pending', 'pending', 'pending', 'pending'])
    expect(projectAssistedProgress({ stage: 'discovering' }).rows.map((row) => row.state))
      .toEqual(['done', 'done', 'active', 'pending', 'pending'])
    expect(projectAssistedProgress({ stage: 'certifying' }).rows.map((row) => row.state))
      .toEqual(['done', 'done', 'done', 'active', 'pending'])
  })

  it('reports completion as every step done', () => {
    const view = projectAssistedProgress({ stage: 'completed' })
    expect(view.outcome).toBe('completed')
    expect(view.rows.every((row) => row.state === 'done')).toBe(true)
  })

  // 失败/取消没有自己的步号。用出事前那一步说「卡在哪」，说不出来就退回第一步——
  // 宁可说「刚开头就没成」，也不假装它走到过后面。
  it('pins a terminal failure to the step it was on', () => {
    const failed = projectAssistedProgress({ stage: 'failed', lastLiveStage: 'certifying' })
    expect(failed.outcome).toBe('failed')
    expect(failed.currentStep).toBe('certifying')
    expect(projectAssistedProgress({ stage: 'failed' }).currentStep).toBe('session')
    expect(projectAssistedProgress({ stage: 'cancelled', lastLiveStage: 'needs_selection' })).toMatchObject({
      outcome: 'cancelled',
      currentStep: 'proposal',
    })
  })

  // `partial` = 模型没进列表，不许显示成一颗绿勾。
  it('treats partial as not connected', () => {
    expect(projectAssistedProgress({ stage: 'partial', lastLiveStage: 'committing' }).outcome).toBe('failed')
  })
})
