// 文稿方案「先放到画布、再确认」：那一镜已经经分镜行落过节点，确认时按镜头身份认那个节点、绑到 Run 上——
// 画布上这一镜仍只有 1 个节点，供应商恰好被调 1 次（协调会话 10-09：遗留风险 1 现在修）。
//
// 这条测试把真的两半接在一起：主进程的准入 / 调度器 / 提交出口（真仓库 + 假供应商）
// ↔ 渲染层真的 materializeShots（真画布 store）。中间只差一条 IPC，这里直接调。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { compileExecutionContract, type PlanCandidate } from '../../../electron/capabilityCore/executionContract'
import type { GenerationProvider } from '../../../electron/capabilityCore/generationRuntimeAdapter'
import { createModuleRegistry } from '../../../electron/capabilityCore/moduleRegistry'
import { createCanvasLandingHost } from '../../../electron/productionRun/canvasLandingHost'
import { createMultiShotBatchScheduler } from '../../../electron/productionRun/multiShotBatchScheduler'
import { createProductionGenerationSubmission } from '../../../electron/productionRun/productionGenerationSubmission'
import { sealAndApproveProductionGeneration } from '../../../electron/productionRun/productionGenerationAuthorizationTestUtils'
import { createProductionRunRepository } from '../../../electron/productionRun/productionRunRepository'
import type { ProductionGenerationShot } from '../../../electron/productionRun/productionRunTypes'
import { materializeShots, type MaterializeShotsPayload } from './multiShotCanvasLanding'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { resetClientIdRegistry } from '../generationCanvas/agent/applyCanvasToolCall'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../project/projectSessionTestHarness'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import * as modelLookup from '../generationCanvas/agent/availableModels'
import * as vendorPreference from '../api/vendorPreferenceApi'

const NOW = '2026-10-09T00:00:00.000Z'
const PROJECT = 'project-a'
// 文稿方案的 id 就是 Run 的 id（草稿与方案同一套 id）。
const RUN = 'plan-doc-1'
const SHOT = 'shot-rain'
const roots: string[] = []

const registry = createModuleRegistry([{
  moduleId: 'generation.single-shot', version: '1.0.0', inputKinds: ['text'], outputKinds: ['image'], modes: ['text-to-image'],
  parameterSchema: { aspectRatio: { type: 'string' } }, assetInputSchema: { references: { kind: 'image', max: 4 } },
  providers: [{ providerId: 'apimart', models: [{ modelId: 'image-model', modes: ['text-to-image'], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }] }],
}])

function shotEntry(shotId: string): ProductionGenerationShot {
  const candidate: PlanCandidate = { candidateId: `cand-${shotId}`, revision: 1, moduleId: 'generation.single-shot', providerId: 'apimart', modelId: 'image-model',
    mode: 'text-to-image', prompt: '雨夜街口', parameters: { aspectRatio: '16:9' }, references: [] }
  const contract = compileExecutionContract(candidate, registry)
  return { shotId, kind: 'image', candidate: { ...candidate, sealedContractHash: contract.contractHash }, contract, approvedReceiptId: 'receipt-plan', updatedAt: NOW } as ProductionGenerationShot
}

function documentRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-doc-land-once-'))
  roots.push(root)
  const repository = createProductionRunRepository({ projectDirResolver: (projectId) => (projectId === PROJECT ? root : null), now: () => NOW,
    randomId: (() => { let n = 0; return () => `id-${++n}` })() })
  const shots = [shotEntry(SHOT)]
  repository.createGenerationDraft({
    operationId: RUN, projectId: PROJECT, candidate: shots[0].candidate, shots,
    origin: { host: 'nomi', sourceDocument: { documentId: 'doc-1', revision: 1, contentHash: 'hash' } },
    policy: { trustedHosts: ['nomi'], allowedProviders: ['apimart'], allowedModels: ['image-model'], maxSpend: null, maxAttemptsPerJob: 2 },
  })
  sealAndApproveProductionGeneration({
    repository, projectId: PROJECT, operationId: RUN, immutableProjectUuid: 'project-uuid-1', projectGeneration: 1, projectRevision: 0,
    candidate: shots[0].candidate, contract: shots[0].contract!,
    providers: [{ providerId: 'apimart', capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true }, buildRequest: (input) => input, submit: async () => ({ providerTaskId: 'unused' }) }],
    multiShot: { shots, scope: [SHOT], planHash: 'plan-hash-doc' }, resolveShotPrice: () => ({ known: true, amount: 1 }), receiptId: 'receipt-plan', now: NOW,
  })
  const sealed = repository.read(PROJECT, RUN)!
  repository.execute(PROJECT, RUN, { commandId: `generation.submit:${RUN}`, expectedRevision: sealed.revision, type: 'generation.submit', payload: {}, issuedAt: NOW })
  return { root, repository }
}

/** 用户先在分镜行上点了「放到画布」：那一镜的节点带着分镜绑定键（方案 id × 镜头 id）。 */
function placedStoryboardNode(): GenerationCanvasNode {
  return { id: 'node-from-storyboard-row', kind: 'image', title: '雨夜街口', prompt: '雨夜街口', position: { x: 0, y: 0 }, categoryId: 'shots',
    meta: { storyboardDesignId: RUN, shotId: SHOT, creationDocumentId: 'doc-1', materializationOperationId: `storyboard:${RUN}`, materializationClientId: SHOT } }
}

let project: ProjectSessionTestHarness
beforeEach(async () => {
  resetClientIdRegistry()
  // 测试里没有桌面端的模型目录：候选模型查不到时落地照样建节点（只是不铺档案参数），与生产「模型此刻不可用」同一支。
  vi.spyOn(modelLookup, 'listAvailableModelsForAgent').mockResolvedValue([])
  vi.spyOn(vendorPreference, 'getVendorPreference').mockResolvedValue({ orderedVendorKeys: [] } as never)
  project = createProjectSessionTestHarness()
  await project.open(PROJECT)
})
afterEach(() => {
  vi.restoreAllMocks()
  project.dispose()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('a document plan shot already placed from its storyboard row lands once', () => {
  it('reported case: placed first, then confirmed → still one node for that shot, the Run binds it, the provider is called exactly once', async () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [placedStoryboardNode()], edges: [], groups: [] }, PROJECT)
    const { root, repository } = documentRun()
    const submit = vi.fn(async () => ({ providerTaskId: `task-${submit.mock.calls.length}` }))
    const provider: GenerationProvider = {
      providerId: 'apimart', capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
      buildRequest: (input) => input, submit: submit as unknown as GenerationProvider['submit'],
      query: async (providerTaskId) => ({ status: 'processing', raw: { id: providerTaskId } }),
    }
    const submission = createProductionGenerationSubmission({ repository, beforeDispatch: () => undefined, projectRoot: root,
      immutableProjectUuid: 'project-uuid-1', projectGeneration: 1, intentMacKey: 'test-intent-key', provider, now: () => NOW })
    const host = createCanvasLandingHost({
      readRun: (projectId, runId) => repository.read(projectId, runId),
      command: async (projectId, runId, command) => repository.execute(projectId, runId, command as Parameters<typeof repository.execute>[2]),
      requestRenderer: async (_op, payload) => materializeShots(payload as MaterializeShotsPayload),
      resolveProjectRoot: () => root,
      isProjectOpen: (projectId) => projectId === PROJECT,
    })

    await createMultiShotBatchScheduler({ repository, submission, landShots: host.landBeforeDispatch, projectId: PROJECT, runId: RUN,
      now: () => NOW, options: { pollHorizonMs: 0 } }).runToQuiescence()

    const nodesForShot = useGenerationCanvasStore.getState().nodes.filter((node) => {
      const meta = (node.meta ?? {}) as Record<string, unknown>
      return meta.shotId === SHOT || meta.productionShotId === SHOT || meta.materializationClientId === SHOT
    })
    expect(nodesForShot.map((node) => node.id)).toEqual(['node-from-storyboard-row'])
    expect(repository.read(PROJECT, RUN)!.generationPlan!.shots![0].nodeId).toBe('node-from-storyboard-row')
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('control: without a placed row node the confirm lands a new node (and only one)', async () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] }, PROJECT)
    const { root, repository } = documentRun()
    const submit = vi.fn(async () => ({ providerTaskId: 'task-1' }))
    const provider: GenerationProvider = {
      providerId: 'apimart', capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
      buildRequest: (input) => input, submit: submit as unknown as GenerationProvider['submit'],
      query: async (providerTaskId) => ({ status: 'processing', raw: { id: providerTaskId } }),
    }
    const submission = createProductionGenerationSubmission({ repository, beforeDispatch: () => undefined, projectRoot: root,
      immutableProjectUuid: 'project-uuid-1', projectGeneration: 1, intentMacKey: 'test-intent-key', provider, now: () => NOW })
    const host = createCanvasLandingHost({
      readRun: (projectId, runId) => repository.read(projectId, runId),
      command: async (projectId, runId, command) => repository.execute(projectId, runId, command as Parameters<typeof repository.execute>[2]),
      requestRenderer: async (_op, payload) => materializeShots(payload as MaterializeShotsPayload),
      resolveProjectRoot: () => root,
      isProjectOpen: (projectId) => projectId === PROJECT,
    })

    await createMultiShotBatchScheduler({ repository, submission, landShots: host.landBeforeDispatch, projectId: PROJECT, runId: RUN,
      now: () => NOW, options: { pollHorizonMs: 0 } }).runToQuiescence()

    expect(repository.read(PROJECT, RUN)!.stop).toBeUndefined()
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
