import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { attachShotResult, materializeShots } from './multiShotCanvasLanding'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { resetClientIdRegistry } from '../generationCanvas/agent/applyCanvasToolCall'
import * as modelLookup from '../generationCanvas/agent/availableModels'
import * as projectPersistence from '../project/workbenchProjectSession'
import * as canvasTools from '../generationCanvas/agent/applyCanvasToolCall'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../project/projectSessionTestHarness'
import { readShotTable } from '../../../electron/shared/canvas/shotTable'
import { useWorkbenchStore } from '../workbenchStore'

// P4 S5 — attach-shot-result 的运行时断言（result.url 必须 nomi-local://）+ 节点已删静默跳过。

function shotNode(id: string): GenerationCanvasNode {
  return { id, kind: 'video', title: id, position: { x: 0, y: 0 }, prompt: '', categoryId: 'shots' }
}

describe('materializeShots preserves the reading viewport on existing content', () => {
  const materializationOperationId = 'canvas-landing:viewport'
  const runId = 'viewport-run'
  const shots = [1, 2, 3].map(index => ({
    shotId: `shot-${index}`, kind: 'image' as const, prompt: `原提示词 ${index}`,
    candidate: { candidateId: `candidate-${index}`, revision: 1 },
  }))
  const land = (items = shots) => materializeShots({ materializationOperationId, runId, shots: items })

  beforeEach(() => {
    resetClientIdRegistry()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
    useWorkbenchStore.setState({ canvasFitNonce: 0, canvasFitCategoryId: null, activeCategoryId: 'shots' })
  })

  it('rebinds only shot 2 without requesting fit or changing node/table selection or active category', async () => {
    const initial = await land()
    const store = useGenerationCanvasStore.getState()
    const secondId = initial.bindings[1].nodeId
    store.selectNode(secondId)
    const table = store.nodes.find(node => node.id === initial.shotTableNodeId)!
    const document = readShotTable(table.meta)!
    store.updateNode(table.id, { meta: { ...table.meta, shotTable: { ...document, view: { ...document.view, selectedRowIds: [secondId] } } } })
    // A background projection must not navigate out of a category the user opened.
    useWorkbenchStore.setState({ activeCategoryId: 'cast' })
    const beforeFit = useWorkbenchStore.getState().canvasFitNonce
    const beforeSelection = [...useGenerationCanvasStore.getState().selectedNodeIds]
    const result = await land(shots.map((shot, index) => index === 1
      ? { ...shot, prompt: '逆光下的侧脸', candidate: { ...shot.candidate, revision: 2 } } : shot))

    expect(result.createdNodeIds).toEqual([])
    expect(result.bindings.map(binding => binding.nodeId)).toEqual(initial.bindings.map(binding => binding.nodeId))
    const after = useGenerationCanvasStore.getState()
    expect(initial.bindings.map(binding => after.nodes.find(node => node.id === binding.nodeId)?.prompt))
      .toEqual(['原提示词 1', '逆光下的侧脸', '原提示词 3'])
    expect(after.selectedNodeIds).toEqual(beforeSelection)
    expect(readShotTable(after.nodes.find(node => node.id === table.id)?.meta)?.view.selectedRowIds).toEqual([secondId])
    expect(useWorkbenchStore.getState().canvasFitNonce).toBe(beforeFit)
    expect(useWorkbenchStore.getState().activeCategoryId).toBe('cast')
  })

  it.each(['replay', 'result'] as const)('%s on existing shots does not issue a navigation request', async mode => {
    const initial = await land()
    const beforeFit = useWorkbenchStore.getState().canvasFitNonce
    const items = mode === 'result' ? shots.map(shot => ({ ...shot, result: {
      id: `result-${shot.shotId}`, type: 'image' as const, url: `nomi-local://test/${shot.shotId}.png`, createdAt: 1,
    } })) : shots
    await land(items)
    if (mode === 'result') {
      expect(useGenerationCanvasStore.getState().nodes.find(node => node.id === initial.bindings[0].nodeId)?.result?.url)
        .toBe('nomi-local://test/shot-1.png')
    }
    expect(useWorkbenchStore.getState().canvasFitNonce).toBe(beforeFit)
  })

  // 2026-09-25 用户：「付费卡点击之后画布就闪动一下，然后我就找不到那个镜头生成去哪里了」。落地（新建镜头、组、
  // 分镜表，单镜变多镜）一律不请求适应、不切分类；屏外的新东西由画布边缘提示指路。
  it('reported case: paid-card landing creates nodes, group and table without moving the viewport', async () => {
    const activeBefore = useWorkbenchStore.getState().activeCategoryId
    const result = await land()
    expect(result.createdNodeIds).toHaveLength(3)
    expect(result.groupId).toBeTruthy()
    expect(result.shotTableNodeId).toBeTruthy()
    expect(useWorkbenchStore.getState().canvasFitNonce).toBe(0)
    expect(useWorkbenchStore.getState().activeCategoryId).toBe(activeBefore)
  })

  it('class: adding a group or growing a single shot into a multi-shot plan never requests a fit', async () => {
    const first = await land(shots.slice(0, 1))
    expect(first.shotTableNodeId).toBeNull()
    const next = await land()
    expect(next.createdNodeIds).toHaveLength(2)
    expect(next.shotTableNodeId).toBeTruthy()
    useGenerationCanvasStore.setState({ groups: [] })
    const regrouped = await land()
    expect(regrouped.groupId).toBeTruthy()
    expect(useWorkbenchStore.getState().canvasFitNonce).toBe(0)
  })
})

describe('attachShotResult', () => {
  beforeEach(() => {
    resetClientIdRegistry()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [shotNode('node-1')], edges: [], groups: [] })
  })

  it('本地 url（nomi-local://）→ 回填成功，节点拿到 result', () => {
    const outcome = attachShotResult({
      nodeId: 'node-1',
      result: { id: 'production-job-s1', type: 'video', url: 'nomi-local://production-preview/p/r/a/x.mp4?preview=t', createdAt: 1 },
    })
    expect(outcome).toEqual({ attached: true, nodeId: 'node-1' })
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === 'node-1')?.result?.url).toContain('nomi-local://')
  })

  it('非本地 url（https CDN）→ **当场抛**（R17 运行时断言，grep 棘轮抓不住）', () => {
    expect(() => attachShotResult({
      nodeId: 'node-1',
      result: { id: 'r', type: 'video', url: 'https://cdn.example.com/x.mp4', createdAt: 1 },
    })).toThrow(/nomi-local/)
    // 断言拦下 → 节点不该被写入脏 url。
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === 'node-1')?.result).toBeUndefined()
  })

  it('节点已删（整批撤销）→ 静默跳过（返回 skipped:node-removed），不抛', () => {
    const outcome = attachShotResult({
      nodeId: 'node-gone',
      result: { id: 'r', type: 'video', url: 'nomi-local://x', createdAt: 1 },
    })
    expect(outcome).toEqual({ skipped: 'node-removed' })
  })

  it('无 result → skipped:no-result', () => {
    expect(attachShotResult({ nodeId: 'node-1' })).toEqual({ skipped: 'no-result' })
  })

  it('文本结果（无 url）→ 放行（不强制本地协议）', () => {
    const outcome = attachShotResult({
      nodeId: 'node-1',
      result: { id: 'r', type: 'text', text: '一段字', createdAt: 1 } as never,
    })
    expect(outcome).toEqual({ attached: true, nodeId: 'node-1' })
  })
})

describe('materializeShots undo transaction', () => {
  beforeEach(() => {
    resetClientIdRegistry()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
  })

  it('removes every materialized node and its group with one undo', async () => {
    const operationId = 'canvas-landing:unit-undo'
    const result = await materializeShots({
      materializationOperationId: operationId,
      planName: '一批镜头',
      shots: [
        { shotId: 'anchor-1', role: 'anchor', kind: 'image' },
        { shotId: 'shot-1', role: 'shot', kind: 'video' },
        { shotId: 'shot-2', role: 'shot', kind: 'video' },
        { shotId: 'shot-3', role: 'shot', kind: 'video' },
      ],
    })

    expect(result.createdNodeIds).toHaveLength(4)
    expect(result.groupId).toBeTruthy()
    expect(useGenerationCanvasStore.getState().canUndo).toBe(true)

    // Real generation cards normalize model/archetype/aspect metadata after mount.
    // Those lifecycle writes belong to the materialization step and must not split Undo.
    for (const nodeId of result.createdNodeIds) {
      useGenerationCanvasStore.getState().updateNode(nodeId, {
        meta: {
          ...(useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.meta || {}),
          modelKey: 'auto-selected-model',
          modelVendor: 'auto-selected-provider',
          aspect_ratio: '16:9',
        },
      }, { history: false })
    }

    const shotNodeId = result.bindings.find((binding) => binding.shotId === 'shot-1')?.nodeId
    expect(shotNodeId).toBeTruthy()
    attachShotResult({
      nodeId: shotNodeId,
      result: { id: 'shot-1-result', type: 'video', url: 'nomi-local://shot-1.mp4', createdAt: 1 },
    })

    useGenerationCanvasStore.getState().undo()
    const afterUndo = useGenerationCanvasStore.getState()
    expect(afterUndo.nodes.filter((node) => node.meta?.materializationOperationId === operationId)).toEqual([])
    expect(afterUndo.groups.filter((group) => group.materializationOperationId === operationId)).toEqual([])
  })
})

// 分镜表 = Run 落地节点的表格表示版（2026-09-18 单一账本）。表与节点同生、同一个撤销步、每 Run 一张。
describe('production shot table is born with the landed nodes', () => {
  const runId = 'run-table-1'
  const operationId = `canvas-landing:${runId}`
  const shots = [
    { shotId: 'shot-1', role: 'shot' as const, kind: 'image' as const, prompt: '一' },
    { shotId: 'shot-2', role: 'shot' as const, kind: 'image' as const, prompt: '二' },
    { shotId: 'shot-3', role: 'shot' as const, kind: 'image' as const, prompt: '三' },
  ]
  const tables = () => useGenerationCanvasStore.getState().nodes.filter((node) => node.kind === 'shot_table')

  beforeEach(() => {
    resetClientIdRegistry()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
  })

  it('落地 N≥2 镜 → 一张 shot_table(production) 指向这个 Run，标题 = 计划名，行零缓存', async () => {
    const result = await materializeShots({ materializationOperationId: operationId, runId, planName: '旧书店', shots })
    expect(result.shotTableNodeId).toBeTruthy()
    const [table] = tables()
    expect(table.title).toBe('旧书店')
    expect(readShotTable(table.meta)?.source).toEqual({ kind: 'production', runId, materializationOperationId: operationId })
    expect(table.meta?.shotTable).not.toHaveProperty('rows')
  })

  it('补齐重放（节点已在）不建第二张；用户删掉表后重放也不复活它——删表只是删视图', async () => {
    await materializeShots({ materializationOperationId: operationId, runId, planName: '旧书店', shots })
    await materializeShots({ materializationOperationId: operationId, runId, planName: '旧书店', shots })
    expect(tables()).toHaveLength(1)
    useGenerationCanvasStore.getState().deleteNode(tables()[0].id)
    const replay = await materializeShots({ materializationOperationId: operationId, runId, planName: '旧书店', shots })
    expect(tables()).toHaveLength(0)
    expect(replay.shotTableNodeId).toBeNull()
    expect(replay.createdNodeIds).toHaveLength(0)
  })

  it('单镜草稿不建表（没有「分镜」可表）', async () => {
    await materializeShots({ materializationOperationId: operationId, runId, planName: '一张图', shots: shots.slice(0, 1) })
    expect(tables()).toHaveLength(0)
  })

  it('表、节点、组同一个撤销步：一次 undo 三者全退', async () => {
    await materializeShots({ materializationOperationId: operationId, runId, planName: '旧书店', shots })
    expect(tables()).toHaveLength(1)
    useGenerationCanvasStore.getState().undo()
    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.filter((node) => node.meta?.materializationOperationId === operationId)).toEqual([])
    expect(state.groups.filter((group) => group.materializationOperationId === operationId)).toEqual([])
    expect(tables()).toHaveLength(0)
  })
})

it('document reconciliation only updates existing nodes and cannot recreate deleted structure', async () => {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
  await materializeShots({ runId: 'run', materializationOperationId: 'canvas-landing:run', existingOnly: true,
    shots: [{ shotId: 'a', prompt: 'A' }, { shotId: 'b', prompt: 'B' }] })
  expect(useGenerationCanvasStore.getState().nodes).toEqual([])
  expect(useGenerationCanvasStore.getState().groups).toEqual([])
})


let landingProject: ProjectSessionTestHarness
beforeEach(async () => { landingProject = createProjectSessionTestHarness(); await landingProject.open('project-a') })
afterEach(() => { vi.restoreAllMocks(); landingProject.dispose() })

function pauseLanding() {
  let resume!: () => void
  let enter!: () => void
  const waiting = new Promise<void>(resolve => { resume = resolve })
  const entered = new Promise<void>(resolve => { enter = resolve })
  return { entered, resume, wait: async () => { enter(); await waiting } }
}

it.each(['same', 'switch', 'reopen'] as const)('model-await landing keeps the captured project lifetime: %s', async change => {
  const operation = 'landing-project-lease'
  const makeNodes = (prompt: string) => [1, 2].map(index => ({ ...shotNode(`shared-${index}`), prompt,
    meta: { materializationOperationId: operation, materializationClientId: `shot-${index}`, productionCandidateRevision: 1 } }))
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: makeNodes('project-a'), edges: [], groups: [] })
  const paused = pauseLanding()
  vi.spyOn(modelLookup, 'listAvailableModelsForAgent').mockImplementation(async () => { await paused.wait(); return [] })
  const landing = materializeShots({ projectId: 'project-a', materializationOperationId: operation,
    shots: [1, 2].map(index => ({ shotId: `shot-${index}`, prompt: 'new-author-text',
      candidate: { candidateId: `candidate-${index}`, revision: 2, modelKey: 'model' },
      result: { id: `result-${index}`, type: 'video' as const, url: 'nomi-local://fixture/result.mp4', createdAt: 1 } })) })
  await paused.entered
  if (change !== 'same') {
    await landingProject.open('project-b')
    if (change === 'reopen') await landingProject.open('project-a')
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: makeNodes('new-project-sentinel'), edges: [], groups: [] })
  }
  paused.resume()
  if (change === 'same') {
    await expect(landing).resolves.toMatchObject({ bindings: expect.any(Array) })
    expect(useGenerationCanvasStore.getState().nodes.map(node => node.prompt)).toEqual(['new-author-text', 'new-author-text'])
  } else {
    await expect(landing).rejects.toThrow()
    const canvas = useGenerationCanvasStore.getState()
    expect(canvas.nodes.map(node => node.prompt)).toEqual(['new-project-sentinel', 'new-project-sentinel'])
    expect(canvas.nodes.every(node => !node.result)).toBe(true)
    expect(canvas.groups).toEqual([])
  }
})

it('project switch after node creation cannot add the old group table or result to the new canvas', async () => {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
  const paused = pauseLanding()
  const original = canvasTools.applyCanvasToolCall
  vi.spyOn(canvasTools, 'applyCanvasToolCall').mockImplementation(async (...args) => {
    const result = await original(...args)
    await paused.wait()
    return result
  })
  const landing = materializeShots({ projectId: 'project-a', runId: 'run-a', materializationOperationId: 'landing-creation-lease',
    shots: [{ shotId: 'shot-1', kind: 'image' }, { shotId: 'shot-2', kind: 'image' }] })
  await paused.entered
  expect(useGenerationCanvasStore.getState().nodes).toHaveLength(2)
  await landingProject.open('project-b')
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [shotNode('new-project-sentinel')], edges: [], groups: [] })
  paused.resume()
  await expect(landing).rejects.toThrow()
  expect(useGenerationCanvasStore.getState().nodes.map(node => node.id)).toEqual(['new-project-sentinel'])
  expect(useGenerationCanvasStore.getState().groups).toEqual([])
})


it('does not publish stale node bindings when project changes during captured persistence', async () => {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
  const paused = pauseLanding()
  vi.spyOn(projectPersistence, 'persistActiveWorkbenchProjectNow').mockImplementation(async () => { await paused.wait(); return null })
  const landing = materializeShots({ projectId: 'project-a', materializationOperationId: 'landing-persist-lease',
    shots: [{ shotId: 'shot-1', kind: 'image' }] })
  await paused.entered
  expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
  await landingProject.open('project-b')
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [shotNode('new-project-sentinel')], edges: [], groups: [] })
  paused.resume()
  await expect(landing).rejects.toThrow()
  expect(useGenerationCanvasStore.getState().nodes.map(node => node.id)).toEqual(['new-project-sentinel'])
})

it('rejects an explicitly different project and an unavailable project before any canvas write', async () => {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [shotNode('entry-sentinel')], edges: [], groups: [] })
  const payload = { projectId: 'project-b', materializationOperationId: 'landing-entry-lease', shots: [{ shotId: 'shot-1', kind: 'image' as const }] }
  await expect(materializeShots(payload)).rejects.toThrow('storyboard_project_changed')
  landingProject.close()
  await expect(materializeShots({ ...payload, projectId: undefined })).rejects.toThrow('storyboard_project_unavailable')
  expect(useGenerationCanvasStore.getState().nodes.map(node => node.id)).toEqual(['entry-sentinel'])
})

// 2026-09-25：制作的「生成中 / 失败 / 结果」写进节点自己的运行记录——与普通生成同一份状态，
// 于是同一个 NodeGeneratingOverlay / NodeErrorReport 画它（以前另画一套「整卡模糊 + N 字标」、另判一份真相）。
describe('materializeShots writes each shot\'s run state into the node itself', () => {
  const materializationOperationId = 'canvas-landing:run-state'
  const runId = 'run-state'
  const base = { shotId: 'shot-1', role: 'shot' as const, kind: 'video' as const, prompt: '巨龙攻击村子' }
  const land = (shot: Record<string, unknown> = {}, existingOnly = false) =>
    materializeShots({ materializationOperationId, runId, existingOnly, shots: [{ ...base, ...shot }] })
  const node = (id: string) => useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)!
  const running = { state: 'running' as const, runRecordId: 'production-job-1', startedAt: 1_000 }

  beforeEach(() => {
    resetClientIdRegistry()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
  })

  it('受理后 → 节点 running（普通生成的等待画面据此出现）；出片 → success + 结果，同一条运行记录收尾', async () => {
    const { bindings } = await land({ generation: running })
    const id = bindings[0].nodeId
    expect(node(id).status).toBe('running')
    expect(node(id).runs?.[0]).toMatchObject({ id: 'production-job-1', status: 'running' })

    await land({ result: { id: 'production-job-1', type: 'video', url: 'nomi-local://asset/p/v.mp4', createdAt: 2_000 } }, true)
    expect(node(id).status).toBe('success')
    expect(node(id).result?.url).toBe('nomi-local://asset/p/v.mp4')
    expect(node(id).runs?.[0]).toMatchObject({ id: 'production-job-1', status: 'success' })
    expect(node(id).runs).toHaveLength(1)
  })

  it('失败 → 节点 error（普通生成的失败卡）；用户关掉失败卡之后，下一次跟随不把它重新弹出来', async () => {
    const { bindings } = await land({ generation: running })
    const id = bindings[0].nodeId
    await land({ generation: { state: 'failed', runRecordId: 'production-job-1', startedAt: 1_000, message: '供应商拒绝了这次生成' } }, true)
    expect(node(id).status).toBe('error')
    expect(node(id).error).toBe('供应商拒绝了这次生成')
    useGenerationCanvasStore.getState().dismissNodeError(id)
    await land({ generation: { state: 'failed', runRecordId: 'production-job-1', startedAt: 1_000, message: '供应商拒绝了这次生成' } }, true)
    expect(node(id).status).toBe('idle')
  })

  it('不在跑了（排队 / 已停）→ 只收掉本制作挂上的「生成中」；用户自己在节点上跑的那一次不动', async () => {
    const { bindings } = await land({ generation: running })
    const id = bindings[0].nodeId
    await land({ generation: { state: 'ended' } }, true)
    expect(node(id).status).toBe('idle')

    useGenerationCanvasStore.getState().appendNodeRun(id, { id: 'user-run', status: 'running' })
    await land({ generation: { state: 'ended' } }, true)
    await land({ generation: running }, true)
    expect(node(id).status).toBe('running')
    expect(node(id).runs?.[0].id).toBe('user-run')
  })

  it('同一份产物只回填一次：用户切回别的版本之后，下一次跟随不把制作那一版硬塞回当前结果', async () => {
    const result = { id: 'production-job-1', type: 'video' as const, url: 'nomi-local://asset/p/v.mp4', createdAt: 2_000 }
    const { bindings } = await land({ result })
    const id = bindings[0].nodeId
    useGenerationCanvasStore.getState().addNodeResult(id, { id: 'manual-2', type: 'video', url: 'nomi-local://asset/p/v2.mp4', createdAt: 3_000 })
    await land({ result }, true)
    expect(node(id).result?.id).toBe('manual-2')
  })

  it('重开项目时幽灵转圈被收成 cancelled；补齐说这一次任务还在跑 → 照常续上「生成中」', async () => {
    const { bindings } = await land({ generation: running })
    const id = bindings[0].nodeId
    useGenerationCanvasStore.getState().setNodeStatus(id, 'idle') // = 重开项目时的收敛（running → cancelled）
    await land({ generation: running }, true)
    expect(node(id).status).toBe('running')
  })
})
