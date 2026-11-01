import { mentionUrlsInOrder } from '../assets/promptMentions'
vi.mock('../generationCanvas/runner/runProjectDelivery', async original => ({ ...await original<typeof import('../generationCanvas/runner/runProjectDelivery')>(), isRunTargetLoaded: () => true }))
import { beforeEach, expect, it, vi } from 'vitest'
import { presentStoryboard } from './storyboardPresent'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useSpendConfirmStore } from '../generationCanvas/spend/spendConfirm'
import { withCanvasGestureContext, type CanvasGestureContext } from '../generationCanvas/events/canvasGestureContext'
import type { StoryboardPlan } from '../generationCanvas/agent/storyboardPlan'

const calls = vi.hoisted(() => ({ preload: vi.fn(), defaults: vi.fn(), confirm: vi.fn(), spend: vi.fn(), single: vi.fn(), current: true }))
vi.mock('../../config/useModelOptions', () => ({ preloadModelOptions: calls.preload }))
vi.mock('../project/projectCanvasReadSurface', () => ({ withProjectAction: (action: (value: unknown) => unknown) => action({ binding: { projectId: 'p' }, signal: new AbortController().signal, assertCurrent: () => { if (!calls.current) throw new Error('changed project') } }) }))
vi.mock('../generationCanvas/components/batchPlanPreview', () => ({ confirmAndRunPlan: calls.confirm }))
vi.mock('../generationCanvas/runner/generationRunController', () => ({ confirmAndRunNode: calls.single, regenerateNodeInPlace: vi.fn() }))
vi.mock('../generationCanvas/agent/availableModels', async importOriginal => ({
  ...await importOriginal<typeof import('../generationCanvas/agent/availableModels')>(),
  resolveStoryboardImageDefault: async () => { calls.defaults(); return {} }, resolveStoryboardVideoDefault: async () => ({}), listAvailableModelsForAgent: async () => [],
}))
vi.mock('../generationCanvas/agent/applyCanvasToolCall', () => ({
  applyCanvasToolCall: async (_tool: string, args: { nodes: { clientId: string; kind?: string; metadata?: Record<string, unknown> }[] }, gesture?: CanvasGestureContext) => {
    const write = () => {
      const clientIdToNodeId: Record<string, string> = {}
      for (const node of args.nodes) clientIdToNodeId[node.clientId] = useGenerationCanvasStore.getState().addNode({ kind: 'image', meta: node.metadata }).id
      return { clientIdToNodeId }
    }
    return gesture ? withCanvasGestureContext(gesture, write) : write()
  },
}))
const plan: StoryboardPlan = { title: 'Original editor', anchors: [], shots: [1, 2].map(index => ({ index, shotId: `shot-${index}`, shotKind: 'image', durationSec: 2, anchorIds: [], prompt: `Prompt ${index}` })) }
/** 方案正本住在项目记录里：这里改的就是用户侧栏那一行背后的那份，没有第二份可以改。 */
function design() {
  return useWorkbenchStore.getState().storyboardDesignsByDocumentId['doc'][0]
}
function editPlan(mutate: (plan: StoryboardPlan) => void) {
  const next = structuredClone(design().plan)
  mutate(next)
  useWorkbenchStore.getState().setStoryboardPlan(next, 'doc', 'run')
}
function input(shotIds = ['shot-1']) { return { projectId: 'p', designId: 'run', sourceDocumentId: 'doc', shotIds } }
/** 方案写入会顺带建它的分镜表视图（与手建方案同一条路）；这里数的是生成类节点。 */
const shotNodes = () => useGenerationCanvasStore.getState().nodes.filter(node => node.kind !== 'shot_table')
beforeEach(() => {
  vi.clearAllMocks(); calls.current = true; calls.defaults.mockReset()
  calls.preload.mockResolvedValue([])
  // The agent path shows the shared checklist before the paid batch runner.
  // Answer both gates explicitly and notify the handoff callback at consent time.
  calls.spend.mockResolvedValue(true)
  calls.confirm.mockImplementation(async (batch, options) => {
    options?.onConsented?.(batch.waves.flat())
    return 'started'
  })
  vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockImplementation(calls.spend)
  calls.single.mockResolvedValue('started')
  const store = useWorkbenchStore.getState()
  store.hydrateWorkbenchDocuments([{ id: 'doc', version: 1, title: 'Doc', updatedAt: 1, contentJson: { type: 'doc', content: [] } }], 'doc')
  store.hydrateStoryboardDesigns({})
  store.addStoryboardDesign({ initiator: 'agent', documentId: 'doc', source: structuredClone(plan), identity: { id: 'run', title: plan.title } })
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
})
it('executes the original materializer and batch action for exact scope, and reports that he approved', async () => {
  const result = await presentStoryboard(input())
  expect(result).toMatchObject({ status: 'presented', designId: 'run', shotIds: ['shot-1'], decision: 'started' })
  expect(result.operations).toHaveLength(1)
  expect(shotNodes().map(node => node.meta?.shotId)).toEqual(['shot-1'])
  expect(calls.spend).toHaveBeenCalledOnce()
  expect(calls.spend.mock.calls[0][0].planRows).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'shot:shot-1', checked: true }),
  ]))
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(calls.confirm.mock.calls[0][0].waves.flat()).toEqual(shotNodes().map(node => node.id))
})

// ── 结局必须往回送（2026-09-22）─────────────────────────────────────────────────────
//
// 这里原来写的是「cancellation is only presented」——确认和取消**一律**回 `{status:'presented'}`。
// 那正是 run5 发现 ③ 的成因：用户在全屏 `SpendConfirmDialog` 上答了，主进程却读不到任何结论，
// `generate` 只好以 `generation_approval_unavailable`（「this host did not wait for his answer」）
// 的错误形状回给模型并进熔断（A1 一次、A3 两次，与答框次数一一对应）。
// 文稿方案没有出价账（设计卡 2026-10-27 §三 渲染层那一格）：不点名 = 显式「没有当前出价」→ 这一轮的锚卡与镜头全集，
// 再照旧只跑可跑的行；点名只认方案里有的镜，点错了在落任何节点之前拒绝。
it('点名 shot-2：批量与确认框只含 shot-2', async () => {
  const result = await presentStoryboard(input(['shot-2']))
  expect(result).toMatchObject({ status: 'presented', shotIds: ['shot-2'], decision: 'started' })
  expect(shotNodes().map(node => node.meta?.shotId)).toEqual(['shot-2'])
  expect(calls.confirm.mock.calls[0][0].waves.flat()).toEqual(shotNodes().map(node => node.id))
})
it('不点名：没有当前出价 → 这一轮可跑的全部', async () => {
  const result = await presentStoryboard({ projectId: 'p', designId: 'run', sourceDocumentId: 'doc' })
  expect(result).toMatchObject({ status: 'presented', shotIds: ['shot-1', 'shot-2'], decision: 'started' })
  expect(shotNodes().map(node => node.meta?.shotId).sort()).toEqual(['shot-1', 'shot-2'])
})
it('点名不在方案里的镜 → 拒绝，一个节点都不落、确认框不出', async () => {
  await expect(presentStoryboard(input(['shot-9']))).rejects.toThrow('shot-9 is not one of the shots you can name here. Shots you can name: shot-1, shot-2.')
  expect(shotNodes()).toHaveLength(0)
  expect(calls.confirm).not.toHaveBeenCalled()
})

it('他点了取消 → 回包带 declined，画布和方案都不动', async () => {
  calls.spend.mockResolvedValue(false)
  const result = await presentStoryboard(input())
  expect(result).toMatchObject({ status: 'presented', designId: 'run', shotIds: ['shot-1'], decision: 'declined' })
  // 取消不撤占位：占位属于草稿，不属于这一次出价（2026-09-22 用户拍板的同一条）。
  expect(shotNodes()).toHaveLength(0)
  expect(design().plan.shots.map(shot => shot.prompt)).toEqual(['Prompt 1', 'Prompt 2'])
})

it('范围里一张卡都没弹过 → nothing-to-run，不编一个他没做过的决定', async () => {
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', meta: { storyboardDesignId: 'run', shotId: 'shot-1' } })
  useGenerationCanvasStore.getState().updateNode(node.id, { result: { id: 'r', createdAt: 1, type: 'image', url: 'https://fixture.invalid/r.png' } })
  const result = await presentStoryboard(input())
  expect(result).toMatchObject({ decision: 'nothing-to-run' })
  expect(calls.confirm).not.toHaveBeenCalled()
})
it('rejects a changed target after model preload before any original action writes', async () => {
  calls.preload.mockImplementationOnce(async () => { editPlan(next => { next.title = 'Edited' }); return [] })
  await expect(presentStoryboard(input())).rejects.toThrow('storyboard_content_conflict')
  expect(shotNodes()).toHaveLength(0)
  expect(calls.confirm).not.toHaveBeenCalled()
})
it('preserves project isolation while the original materializer awaits model defaults', async () => {
  calls.defaults.mockImplementationOnce(() => { calls.current = false })
  await expect(presentStoryboard(input())).rejects.toThrow('changed project')
  expect(shotNodes()).toHaveLength(0)
  expect(calls.confirm).not.toHaveBeenCalled()
})
it('must not include a locked completed shot in the Agent batch', async () => {
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', meta: { storyboardDesignId: 'run', shotId: 'shot-1', frozen: { at: 1, by: 'user' } } })
  useGenerationCanvasStore.getState().updateNode(node.id, { result: { id: 'result', createdAt: 1, type: 'image', url: 'https://fixture.invalid/result.png' } })
  await presentStoryboard(input())
  expect(calls.confirm.mock.calls.flatMap(call => call[0].waves.flat())).not.toContain(node.id)
})
it('must stop when the plan changes during original materializer awaits', async () => {
  calls.defaults.mockImplementationOnce(() => { editPlan(next => { next.title = 'Changed after last read' }) })
  await expect(presentStoryboard(input())).rejects.toThrow()
  expect(calls.confirm).not.toHaveBeenCalled()
})

it('passes a persistent source check separately from the foreground materialization guard', async () => {
  await presentStoryboard(input())
  const guards = calls.confirm.mock.calls[0][1]
  calls.current = false
  await expect(guards.assertCurrent()).rejects.toThrow('changed project')
  await expect(guards.assertAuthorCurrent({ nodes: shotNodes(), edges: [] }, shotNodes()[0].id)).resolves.toBeUndefined()
  editPlan(next => { next.shots[0].prompt = 'changed source after approval' })
  await expect(guards.assertAuthorCurrent({ nodes: shotNodes(), edges: [] }, shotNodes()[0].id)).rejects.toThrow('storyboard_content_conflict')
})


it('A10: another shot changing during preload does not invalidate this shot approval', async () => {
  calls.preload.mockImplementationOnce(async () => { editPlan(next => { next.shots[1].prompt = 'Another shot changed' }); return [] })
  await expect(presentStoryboard(input(['shot-1']))).resolves.toMatchObject({ decision: 'started' })
})
it('A9: runtime author validation targets only the executing node', async () => {
  await presentStoryboard(input(['shot-1', 'shot-2']))
  const guards = calls.confirm.mock.calls[0][1]
  const nodes = shotNodes()
  editPlan(next => { next.shots[1].prompt = 'Changed while queued' })
  await expect(guards.assertAuthorCurrent({ nodes, edges: [] }, nodes.find(n => n.meta?.shotId === 'shot-1')!.id)).resolves.toBeUndefined()
  await expect(guards.assertAuthorCurrent({ nodes, edges: [] }, nodes.find(n => n.meta?.shotId === 'shot-2')!.id)).rejects.toThrow('storyboard_content_conflict')
})
it('A5: Agent explicitly refreshes reference images and modes between anchor and shot phases without an editor', async () => {
  editPlan(next => {
    next.anchors = [{ id: 'actor', kind: 'character', carrier: 'visual', name: 'Actor', description: 'Actor' }]
    next.shots = next.shots.map(s => ({ ...s, anchorIds: ['actor'], prompt: 'Actor walks', modelKey: 'seedance-2-5', modelVendor: 'kie', modeId: 't2v' }))
  })
  calls.single.mockImplementation(async (_id, guards) => {
    const id = await guards.deferredMaterialization.materialize()
    useGenerationCanvasStore.getState().addNodeResult(id, { id: 'ready-actor', type: 'image', url: 'https://fixture.invalid/actor.png', createdAt: 1 })
    return 'started'
  })
  await presentStoryboard({ projectId: 'p', designId: 'run', sourceDocumentId: 'doc' })
  expect(design().plan.shots.every(s => mentionUrlsInOrder(s.prompt).includes('https://fixture.invalid/actor.png'))).toBe(true)
  expect(design().plan.shots.every(s => s.modeId === 'omni')).toBe(true)
})
