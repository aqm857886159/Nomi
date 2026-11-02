// 验收线提供的确认缝回归。真 runStoryboardAction / runStoryboardBatch / generateShotRow / confirmAndRunPlan /
// confirmAndRunNode / 队列 / 咽喉 runGenerationNode；只假执行器和主进程 IPC。断言写「该有的样子」，红 = 复现。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runStoryboardAction } from './storyboardActionGuard'
import { generateAnchorCard, generateShotRow, runStoryboardBatch, regenerateShotRow } from './storyboardRowActions'
import { deriveStoryboardBatch, deriveStoryboardRowRuntimes } from './storyboardRowStatus'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { useGenerationQueueStore } from '../../../generationCanvas/runner/generationQueueStore'
import { useSpendConfirmStore } from '../../../generationCanvas/spend/spendConfirm'
import { useWorkbenchStore } from '../../../workbenchStore'
import { withCanvasGestureContext, type CanvasGestureContext } from '../../../generationCanvas/events/canvasGestureContext'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../../project/projectSessionTestHarness'
import { encodeStructuredErrorMessage } from '../../../../../electron/vendor/vendorHttp'
import type { GenerationCanvasNode, GenerationNodeResult } from '../../../generationCanvas/model/generationCanvasTypes'
import type { StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'

const calls = vi.hoisted(() => ({ execute: vi.fn(), disk: new Map<string, unknown>(), mint: vi.fn(), consent: vi.fn(), unknown: vi.fn(), release: vi.fn(async () => undefined), withdraw: vi.fn(), notify: vi.fn() }))
vi.mock('../../../../desktop/bridge', () => ({ getDesktopBridge: () => ({ projects: { applyCanvasNodePatch: vi.fn(async () => ({ applied: true })) } }) }))
vi.mock('../../../library/localProjectStore', () => ({
  readLocalProjectAsync: async (id: string) => structuredClone(calls.disk.get(id) ?? null),
  saveLocalProject: async (id: string, payload: unknown, name: string) => ({ id, name, version: 1, payload }),
}))
vi.mock('../../../api/taskApi', () => ({ canvasOpenRuns: calls.unknown, mintSpendGrant: calls.mint, consentCanvasShots: calls.consent, withdrawCanvasShots: calls.withdraw, releaseCanvasShotRun: calls.release }))
vi.mock('../../../generationCanvas/runner/generationNodeExecutor', () => ({ generationNodeExecutor: calls.execute }))
vi.mock('../../../generationCanvas/runner/assetUploadConsent', async original => ({ ...await original<typeof import('../../../generationCanvas/runner/assetUploadConsent')>(), resolveAssetUploadConsent: async () => ({ allowed: true, needsConfirmation: false }) }))
vi.mock('../../../generationCanvas/runner/nodeModelHealth', () => ({ recordNodeModelFailure: vi.fn(), recordNodeModelSuccess: vi.fn() }))
vi.mock('../../../../config/useModelOptions', () => ({ preloadModelOptions: async () => [] }))
vi.mock('../../../../ui/notificationPolicy', async original => ({ ...await original<typeof import('../../../../ui/notificationPolicy')>(), notify: calls.notify }))
vi.mock('../../../generationCanvas/agent/availableModels', async importOriginal => ({
  ...await importOriginal<typeof import('../../../generationCanvas/agent/availableModels')>(),
  resolveStoryboardImageDefault: async () => ({}), resolveStoryboardVideoDefault: async () => ({}), listAvailableModelsForAgent: async () => [],
}))
vi.mock('../../../generationCanvas/agent/applyCanvasToolCall', () => ({
  applyCanvasToolCall: async (_tool: string, args: { nodes: { clientId: string; prompt?: string; storyboardKeyframe?: boolean; metadata?: Record<string, unknown> }[] }, gesture?: CanvasGestureContext) => {
    const write = () => {
      const clientIdToNodeId: Record<string, string> = {}
      for (const node of args.nodes) {
        clientIdToNodeId[node.clientId] = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: node.prompt ?? 'fixture', meta: { ...node.metadata, ...(node.storyboardKeyframe ? { storyboardKeyframe: true } : {}) } }).id
      }
      return { clientIdToNodeId }
    }
    return gesture ? withCanvasGestureContext(gesture, write) : write()
  },
}))

const facts: Record<string, unknown> = {}
const imageResult = (id: string): GenerationNodeResult => ({ id: 'result-' + id + '-' + Math.random(), type: 'image', url: 'https://fixture.invalid/' + id + '.png', createdAt: 1 })
const plan = (shots = 2): StoryboardPlan => ({
  title: 'Lock', anchors: [{ id: 'actor', name: 'Actor', kind: 'character', carrier: 'visual', description: 'Actor' }],
  shots: Array.from({ length: shots }, (_, i) => i + 1).map(index => ({ index, shotId: `shot-${index}`, shotKind: 'image' as const, durationSec: 2, anchorIds: ['actor'], prompt: `Actor walks ${index}` })),
})
const store = () => useGenerationCanvasStore.getState()
const nodes = () => store().nodes
const nodeOfShot = (shotId: string) => nodes().find(node => node.meta?.shotId === shotId && !node.meta?.storyboardKeyframe) as GenerationCanvasNode
const sends = (shotId: string) => calls.execute.mock.calls.filter(([node]) => (node as GenerationCanvasNode).meta?.shotId === shotId && !(node as GenerationCanvasNode).meta?.storyboardKeyframe).length
const sendsOf = (id: string) => calls.execute.mock.calls.filter(([node]) => (node as GenerationCanvasNode).id === id).length
const refusal = () => new Error(encodeStructuredErrorMessage({ code: 'node_generation_in_flight', reason: 'in_flight' }, 'node_generation_in_flight: x'))
const deferred = () => { let resolve!: (value?: unknown) => void, reject!: (error: unknown) => void; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const quiet = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await vi.waitFor(() => expect(Object.values(useGenerationQueueStore.getState().batches).every(b => (b as { finishedAt?: number }).finishedAt)).toBe(true)) }

let session: ProjectSessionTestHarness
const confirmCards: Array<{ title?: string; planRows?: Array<{ id?: string; checked?: boolean }>; message?: string }> = []
const failures: unknown[] = []
beforeEach(async () => {
  vi.clearAllMocks()
  confirmCards.length = 0
  failures.length = 0
  calls.unknown.mockReset().mockResolvedValue([])
  calls.execute.mockReset()
  calls.mint.mockReset().mockResolvedValue('approved')
  calls.consent.mockReset().mockImplementation(async (input: { shots: Array<{ runRecordId: string }> }) => input.shots.map(shot => `canvas-${shot.runRecordId}`))
  session = createProjectSessionTestHarness()
  await session.open('project-a')
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  useGenerationQueueStore.setState({ entries: [], batches: {} })
  useSpendConfirmStore.setState({ pending: null, queue: [], requestConfirm: async (request: never) => { confirmCards.push(request); return true } } as never)
})
afterEach(() => { session.dispose(); vi.restoreAllMocks() })

function seed(current: StoryboardPlan) {
  useWorkbenchStore.setState({ activeDocumentId: 'doc', activeStoryboardId: 'design', storyboardDesignsByDocumentId: { doc: [{ id: 'design', plan: current, documentId: 'doc' } as never] } })
}
const readCurrentPlan = () => useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc[0].plan as StoryboardPlan
const rowsOf = (current: StoryboardPlan) => deriveStoryboardRowRuntimes({ plan: current, designId: 'design', nodes: nodes(), imageModelOptions: [], videoModelOptions: [] })
const addShot = (shotId: string, extra: Record<string, unknown> = {}, kind: 'image' | 'video' = 'image') => store().addNode({ kind, prompt: shotId, meta: { storyboardDesignId: 'design', shotId, ...extra } })
function holdAnchors() {
  const hold = deferred()
  calls.execute.mockImplementation(async (node: GenerationCanvasNode) => {
    if (node.meta?.anchorId) await hold.promise
    return imageResult(node.id)
  })
  return () => hold.resolve()
}
/** 编辑器上的同一套接线：整批 actionKey='table'，单行 actionKey='shot:<id>'，两者不互斥（本 PR 新增）。 */
function editor(current: StoryboardPlan) {
  const activeKeys = new Set<string>()
  const common = { projectId: 'project-a', documentId: 'doc', designId: 'design', plan: current, activeKeys, onPendingChange: () => undefined, onStart: () => undefined, onFailure: (error: unknown) => { failures.push(String((error as Error)?.message ?? error)) }, unavailable: (): never => { throw new Error('unavailable') } }
  return {
    runBatch: () => runStoryboardAction({ ...common, shotIds: current.shots.map(shot => shot.shotId!), actionKey: 'table', action: context => runStoryboardBatch(context, rowsOf(current)) }),
    clickRow: (shotId: string) => {
      const shot = current.shots.find(value => value.shotId === shotId)!
      return runStoryboardAction({ ...common, shotIds: [shotId], actionKey: `shot:${shotId}`, action: context => generateShotRow(context, shot, null) })
    },
    clickAnchor: () => runStoryboardAction({ ...common, shotIds: [], actionKey: 'anchor:actor', action: context => generateAnchorCard(context, current.anchors[0]) }),
    retryRow: (shotId: string, node: GenerationCanvasNode) => {
      const shot = current.shots.find(value => value.shotId === shotId)!
      return runStoryboardAction({ ...common, shotIds: [shotId], actionKey: `retry:${shotId}`, action: context => regenerateShotRow(context, shot, node, null) })
    },
  }
}
const priceChange = (shotId: string, resolution = '4k') => { const latest = readCurrentPlan(); useWorkbenchStore.getState().setStoryboardPlan({ ...latest, shots: latest.shots.map(shot => shot.shotId === shotId ? { ...shot, params: { resolution } } : shot) }, 'doc', 'design') }
const notified = () => calls.notify.mock.calls.map(([input]) => ({ reason: input.reason, type: input.type, message: input.message, actionLabel: input.actionLabel }))

const anchorDone = () => {
  const anchor = store().addNode({ kind: 'image', prompt: 'actor', meta: { storyboardDesignId: 'design', anchorId: 'actor' } })
  store().appendNodeRun(anchor.id, { id: 'done', status: 'success' }); store().addNodeResult(anchor.id, imageResult('a'))
  return anchor
}
const runSelected = (current: StoryboardPlan, selected: ReturnType<typeof rowsOf>) => runStoryboardAction({ projectId: 'project-a', documentId: 'doc', designId: 'design', plan: current, activeKeys: new Set(), onPendingChange: () => undefined, onStart: () => undefined, onFailure: (error: unknown) => { failures.push(String((error as Error)?.message ?? error)) }, unavailable: (): never => { throw new Error('unavailable') }, shotIds: selected.map(row => row.shot.shotId!), actionKey: 'table', action: context => runStoryboardBatch(context, selected) })
const FROZEN = { at: 1_700_000_000_000, by: 'user' }

describe('T8 上锁标记（正确形状）', () => {
  it('T8a 主节点上锁、没有结果：行状态、上不上卡、发不发、有没有提示', async () => {
    const current = plan(); seed(current); anchorDone()
    const frozen = addShot('shot-2', { frozen: FROZEN })
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => imageResult(node.id))
    const rows = rowsOf(current)
    const outcome = await editor(current).runBatch(); await quiet()
    facts.T8a = { outcome, rowStatus: rows.find(r => r.shot.shotId === 'shot-2')!.exec.status, onCard: confirmCards[0]?.planRows?.some(r => r.id === 'shot:shot-2'), sends: sendsOf(frozen.id), s1: sends('shot-1'), notified: notified().filter(n => n.message) }
  })
  it('T8b 主节点上锁、有结果：行 locked，不进 runnable，不发', async () => {
    const current = plan(); seed(current); anchorDone()
    const frozen = addShot('shot-2', { frozen: FROZEN })
    store().appendNodeRun(frozen.id, { id: 'r', status: 'success' }); store().addNodeResult(frozen.id, imageResult('x'))
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => imageResult(node.id))
    const rows = rowsOf(current)
    await editor(current).runBatch(); await quiet()
    facts.T8b = { rowStatus: rows.find(r => r.shot.shotId === 'shot-2')!.exec.status, runnable: deriveStoryboardBatch(rows).runnable.map(r => r.shot.shotId), onCard: confirmCards[0]?.planRows?.some(r => r.id === 'shot:shot-2'), sends: sendsOf(frozen.id) }
    expect(sendsOf(frozen.id)).toBe(0)
  })
  it('T8c 关键帧带上锁标记（只有 Agent metadata 透传才写得到）：整镜吞不吞', async () => {
    const current = plan(); current.shots[1] = { ...current.shots[1], shotKind: 'video', keyframe: { enabled: true } }; seed(current); anchorDone()
    const main = addShot('shot-2'), key = addShot('shot-2', { storyboardKeyframe: true, frozen: FROZEN })
    store().appendNodeRun(key.id, { id: 'kr', status: 'success' }); store().addNodeResult(key.id, imageResult('k'))
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => imageResult(node.id))
    const rows = rowsOf(current)
    const outcome = await editor(current).runBatch(); await quiet()
    facts.T8c = { outcome, rowStatus: rows.find(r => r.shot.shotId === 'shot-2')!.exec.status, onCard: confirmCards[0]?.planRows?.some(r => r.id === 'shot:shot-2'), main: sendsOf(main.id), key: sendsOf(key.id), notified: notified().filter(n => n.message) }
  })
})

describe('T9 选中入口', () => {
  it('T9a 选中已上锁有结果的镜：不发，节点不被写', async () => {
    const current = plan(); current.shots[1] = { ...current.shots[1], prompt: 'Changed after lock' }; seed(current); anchorDone()
    const frozen = addShot('shot-2', { frozen: FROZEN }); store().updateNode(frozen.id, { prompt: 'Locked prompt' })
    store().appendNodeRun(frozen.id, { id: 'r', status: 'success' }); store().addNodeResult(frozen.id, imageResult('x'))
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => imageResult(node.id))
    const selected = rowsOf(current).filter(r => r.shot.shotId === 'shot-2')
    const before = nodes().find(n => n.id === frozen.id)!
    const outcome = await runSelected(current, selected); await quiet()
    const after = nodes().find(n => n.id === frozen.id)!
    facts.T9a = { rowStatus: selected[0].exec.status, outcome, cards: confirmCards.length, onCard: confirmCards[0]?.planRows?.map(r => r.id), sends: sendsOf(frozen.id), promptBefore: before.prompt, promptAfter: after.prompt, resultKept: after.result?.id === before.result?.id, stillFrozen: Boolean((after.meta as Record<string, unknown>)?.frozen), notified: notified().filter(n => n.message), failures: [...failures] }
    expect(sendsOf(frozen.id)).toBe(0); expect(after.prompt).toBe('Locked prompt')
  })
  it('T9b 选中已生成没上锁的镜：卡上有、确认后发一次（重生成）', async () => {
    const current = plan(); seed(current); anchorDone()
    const done = addShot('shot-2')
    store().appendNodeRun(done.id, { id: 'r', status: 'success' }); store().addNodeResult(done.id, imageResult('x'))
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => imageResult(node.id))
    const selected = rowsOf(current).filter(r => r.shot.shotId === 'shot-2')
    const outcome = await runSelected(current, selected); await quiet()
    facts.T9b = { rowStatus: selected[0].exec.status, outcome, cards: confirmCards.length, onCard: confirmCards[0]?.planRows?.map(r => r.id), sends: sendsOf(done.id), failures: [...failures] }
  })
})

describe('H-E2 拒绝之后点「重试失败的 N 个」', () => {
  it('批次那发被拒、原任务接着成功，通知按钮还在：点了不得再花一次钱', async () => {
    const current = plan(3); seed(current)
    const hold = deferred(), single = deferred()
    let shot2Calls = 0
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => {
      if (node.meta?.shotId === 'shot-2') { shot2Calls += 1; if (shot2Calls === 1) { await single.promise; return imageResult(node.id) } if (shot2Calls === 2) throw refusal() }
      return imageResult(node.id)
    })
    let consents = 0
    calls.consent.mockImplementation(async (input: { shots: Array<{ runRecordId: string }> }) => { consents += 1; if (consents === 2) await hold.promise; return input.shots.map(shot => `canvas-${shot.runRecordId}`) })
    const ui = editor(current), batch = ui.runBatch()
    await vi.waitFor(() => expect(consents).toBe(2))
    const click = ui.clickRow('shot-2')
    await vi.waitFor(() => expect(shot2Calls).toBe(1))
    hold.resolve(); await batch
    expect(notified().filter(n => n.reason === 'generation-failed')).toHaveLength(0)
    single.resolve(); await click; await quiet()
    const landed = nodeOfShot('shot-2').result?.id
    const stale = nodes().find(n => n.id === nodeOfShot('shot-2').id)!
    const note = calls.notify.mock.calls.map(([input]) => input).find(input => input.reason === 'generation-failed')
    const sendsBefore = sends('shot-2')
    const cardsBefore = confirmCards.length
    if (note?.onAction) { await note.onAction(); await quiet() }
    facts['H-E2'] = { statusBeforeClick: stale.status, hasResultBeforeClick: Boolean(landed), label: note?.actionLabel, sendsBefore, sendsAfter: sends('shot-2'), cardsAdded: confirmCards.length - cardsBefore, resultReplaced: nodeOfShot('shot-2').result?.id !== landed }
    expect(sends('shot-2')).toBe(sendsBefore)
  })
})

describe('T4c 默认并发 6、8 镜：单发落在过滤到入队的缝', () => {
  it('最后一镜被批次排在 6 个之后，单发先跑完：批次不得再发', async () => {
    const current = plan(8); seed(current)
    const hold = deferred(), gate = deferred()
    const release = holdAnchors()
    const base = calls.execute.getMockImplementation()!
    calls.execute.mockImplementation(async (node: GenerationCanvasNode, ctx: never) => {
      if (node.meta?.shotId && node.meta?.shotId !== 'shot-8' && consents >= 2) await gate.promise
      return base(node, ctx)
    })
    let consents = 0
    calls.consent.mockImplementation(async (input: { shots: Array<{ runRecordId: string }> }) => { consents += 1; if (consents === 2) await hold.promise; return input.shots.map(shot => `canvas-${shot.runRecordId}`) })
    const ui = editor(current), batch = ui.runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    release()
    await vi.waitFor(() => expect(consents).toBe(2))
    await ui.clickRow('shot-8')
    expect(sends('shot-8')).toBe(1)
    const owned = nodeOfShot('shot-8').result?.id
    hold.resolve()
    await vi.waitFor(() => expect(useGenerationQueueStore.getState().entries.some(entry => entry.nodeId === nodeOfShot('shot-8').id)).toBe(true))
    const entryAfterSingle = useGenerationQueueStore.getState().entries.filter(entry => entry.nodeId === nodeOfShot('shot-8').id).map(entry => entry.state)
    gate.resolve(); await batch; await quiet()
    facts.T4c = { entryAfterSingle, ...{} }
    facts.T4c ={ shot8: sends('shot-8'), resultReplaced: nodeOfShot('shot-8').result?.id !== owned, order: calls.execute.mock.calls.map(([n]) => (n as GenerationCanvasNode).meta?.anchorId ?? (n as GenerationCanvasNode).meta?.shotId) }
    expect(sends('shot-8')).toBe(1)
  })
})
