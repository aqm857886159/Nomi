// 失败卡「重试」走回跑过它的那一台（D2 第③步：一台发动机）。付费卡交给画布、在画布上失败的那一镜，
// 以前只因「是多镜 Run」就走返工链（制作流程的付费门 + 调度器 = 第二台发动机）；现在重试就是节点上再生成一次。
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const actions = vi.hoisted(() => ({ rework: vi.fn() }))
vi.mock('../../production/productionShotActions', () => ({ reworkProductionShot: actions.rework }))

import { useProductionNodeRetry } from './useProductionNodeRetry'
import { useProductionCanvasLandingStore } from '../../production/productionCanvasLandingStore'
import { createReactTestRenderer } from '../../ai/v4/testReactRenderer'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { GenerationHandOver, ProductionJob, ProductionRun } from '../../../../electron/shared/contracts/productionRunTypes'
import { IN_APP_AGENT_ORIGIN_HOST } from '../../../../electron/shared/productionGenerationPresentation'

const NOW = '2026-10-24T00:00:00.000Z'
const failedNode = {
  id: 'node-1', kind: 'video', title: '镜 1', position: { x: 0, y: 0 }, prompt: 'p', categoryId: 'shots', status: 'error', error: 'provider failed',
  meta: { productionRunId: 'op-1', productionShotId: 'shot-1' },
} as GenerationCanvasNode

function run(opts: { host?: string; handOver?: boolean; job?: boolean }): ProductionRun {
  const candidate = { candidateId: 'cand-1', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'video', mode: 't2v', prompt: '', parameters: {}, references: [] }
  const handOvers: GenerationHandOver[] = opts.handOver ? [{ shotId: 'shot-1', by: 'gesture', at: NOW, canvasRunId: 'canvas-run-1', settled: { at: NOW, outcome: 'accepted' } }] : []
  const jobs: ProductionJob[] = opts.job ? [{
    jobId: 'job-1', stageId: 'generate', status: 'needs_attention', errorCode: 'provider_failed', attempt: 1, provider: 'apimart', model: 'video',
    idempotencyKey: 'k-1', metadata: { shotId: 'shot-1' }, createdAt: NOW, updatedAt: NOW,
  }] : []
  return {
    schemaVersion: 1, runId: 'op-1', projectId: 'project-a', revision: 1, status: 'running', stageId: 'generate',
    playbook: { name: 'generation.multi-shot', version: '1.0.0' }, origin: { host: opts.host ?? IN_APP_AGENT_ORIGIN_HOST },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
    planVersion: 1, snapshotCursor: 0, stages: [], gates: [], jobs, artifacts: [],
    generationPlan: {
      operationId: 'op-1', state: opts.handOver ? 'draft' : 'submitted', candidate,
      ...(opts.handOver ? { presentations: [{ shotIds: ['shot-1', 'shot-2'], openedAt: NOW, fromGate: 0, closed: { by: 'handed_to_canvas', at: NOW }, handOvers }] } : {}),
      shots: ['shot-1', 'shot-2'].map((shotId) => ({ shotId, nodeId: shotId === 'shot-1' ? 'node-1' : 'node-2', candidate: { ...candidate, candidateId: shotId }, updatedAt: NOW })),
      updatedAt: NOW,
    },
    createdAt: NOW, updatedAt: NOW,
  } as ProductionRun
}

let retry: (() => void) | null = null
function Probe(): null {
  retry = useProductionNodeRetry(failedNode, () => undefined)
  return null
}

function retryFor(cached: ProductionRun): (() => void) | null {
  useProductionCanvasLandingStore.getState().setRuns('project-a', { 'op-1': cached })
  const renderer = createReactTestRenderer()
  renderer.render(React.createElement(Probe))
  renderer.close()
  return retry
}

afterEach(() => {
  useProductionCanvasLandingStore.getState().reset()
  actions.rework.mockReset()
  retry = null
})

describe('useProductionNodeRetry：失败卡的「重试」走回跑过它的那一台', () => {
  it('付费卡交给画布、在画布上失败的那一镜 → 不走返工链（节点上再生成一次）', () => {
    expect(retryFor(run({ handOver: true }))).toBeNull()
  })

  it('交接之前制作流程跑过一次也一样：这一次是画布跑的', () => {
    expect(retryFor(run({ handOver: true, job: true }))).toBeNull()
  })

  it('制作流程自己派过作业的那一镜（外部宿主 / 调度器）→ 返工链，带着这一镜', () => {
    const onRetry = retryFor(run({ host: 'semantic-mcp', job: true }))
    expect(onRetry).toBeTypeOf('function')
    onRetry!()
    expect(actions.rework).toHaveBeenCalledWith('project-a', 'op-1', 'shot-1', expect.any(Function))
  })

  it('一笔都没派过（节点上生成的）→ 不走返工链', () => {
    expect(retryFor(run({}))).toBeNull()
  })
})
