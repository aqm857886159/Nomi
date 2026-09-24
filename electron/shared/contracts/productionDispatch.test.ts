import { describe, expect, it } from 'vitest'

import type { ProductionGenerationPlan, ProductionJob, ProductionJobStatus } from '../../productionRun/productionRunTypes'
import { isCurrentRequestDispatched, isNodeInDispatchedScope, jobAwaitsHuman } from './productionDispatch'

const NOW = '2026-09-24T00:00:00.000Z'
const CANDIDATE = { candidateId: 'c', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'gpt-image-2', mode: 'text_to_image', prompt: '', parameters: {}, references: [] }

function job(status: ProductionJobStatus): ProductionJob {
  return { jobId: `job-${status}`, stageId: 'generate', status, attempt: 1, provider: 'apimart', model: 'm', idempotencyKey: 'k', createdAt: NOW, updatedAt: NOW }
}

function plan(state: ProductionGenerationPlan['state'], extra: Partial<ProductionGenerationPlan> = {}): ProductionGenerationPlan {
  return { operationId: 'op-1', state, candidate: CANDIDATE, updatedAt: NOW, ...extra }
}

const ALL_JOB_STATUSES: ProductionJobStatus[] = [
  'planned', 'authorization_required', 'authorized', 'submit_intent_persisted', 'submitting', 'provider_accepted', 'polling',
  'retry_wait', 'downloading', 'validating_technical', 'validating_content', 'ready', 'adopted', 'submission_unknown',
  'reconciling', 'needs_attention', 'cancel_requested', 'cancelled_remote', 'detached', 'too_late',
]

describe('jobAwaitsHuman', () => {
  it('只有 planned / authorization_required 还停在人工门前', () => {
    expect(ALL_JOB_STATUSES.filter(jobAwaitsHuman)).toEqual(['planned', 'authorization_required'])
  })
})

describe('isCurrentRequestDispatched', () => {
  it('draft_shots 建的草稿（计划 draft、0 个 job）= 没派出', () => {
    expect(isCurrentRequestDispatched({ generationPlan: plan('draft', { cardHidden: true }), jobs: [] })).toBe(false)
  })

  it('报价卡在等人（sealed，job 停在 authorization_required）= 没派出', () => {
    expect(isCurrentRequestDispatched({ generationPlan: plan('sealed'), jobs: [job('authorization_required')] })).toBe(false)
  })

  it('计划已 submitted = 派出了', () => {
    expect(isCurrentRequestDispatched({ generationPlan: plan('submitted'), jobs: [] })).toBe(true)
  })

  it('单镜「批准 → 供应商受理」之间：计划还没 submitted，但 job 已过人工门 = 派出了', () => {
    for (const status of ['authorized', 'submit_intent_persisted', 'submitting'] as const) {
      expect(isCurrentRequestDispatched({ generationPlan: plan('sealed'), jobs: [job(status)] }), status).toBe(true)
    }
  })

  it('同一份计划重新出价：上一批已落定的 job 不算这一轮派出', () => {
    const settled: ProductionJobStatus[] = ['ready', 'adopted', 'needs_attention', 'cancelled_remote', 'detached', 'too_late']
    expect(isCurrentRequestDispatched({ generationPlan: plan('draft'), jobs: settled.map(job) })).toBe(false)
  })

  it('没有生成计划的 Run（老 playbook）：只看 job', () => {
    expect(isCurrentRequestDispatched({ jobs: [] })).toBe(false)
    expect(isCurrentRequestDispatched({ jobs: [job('authorization_required')] })).toBe(false)
    expect(isCurrentRequestDispatched({ jobs: [job('polling')] })).toBe(true)
  })
})

describe('isNodeInDispatchedScope', () => {
  const shots = [
    { shotId: 's1', nodeId: 'n1', candidate: CANDIDATE, updatedAt: NOW },
    { shotId: 's2', nodeId: 'n2', included: false, candidate: CANDIDATE, updatedAt: NOW },
  ]

  it('计划没提交：任何节点都不在范围里', () => {
    for (const state of ['draft', 'sealed', 'cancelled'] as const) {
      expect(isNodeInDispatchedScope({ generationPlan: plan(state, { shots }) }, 'n1'), state).toBe(false)
    }
  })

  it('多镜已提交：勾进这一批的镜在范围里，勾掉的不在，没绑镜的节点不在', () => {
    const run = { generationPlan: plan('submitted', { shots }) }
    expect(isNodeInDispatchedScope(run, 'n1')).toBe(true)
    expect(isNodeInDispatchedScope(run, 'n2')).toBe(false)
    expect(isNodeInDispatchedScope(run, 'unbound')).toBe(false)
  })

  it('单镜已提交：按顶层 nodeId 认', () => {
    const run = { generationPlan: plan('submitted', { nodeId: 'n1' }) }
    expect(isNodeInDispatchedScope(run, 'n1')).toBe(true)
    expect(isNodeInDispatchedScope(run, 'n2')).toBe(false)
  })

  it('没有生成计划：不在范围里', () => {
    expect(isNodeInDispatchedScope({}, 'n1')).toBe(false)
  })
})
