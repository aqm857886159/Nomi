// 验收线提供的确认缝回归。真 runStoryboardAction / runStoryboardBatch / generateShotRow / confirmAndRunPlan /
// confirmAndRunNode / 队列 / 咽喉 runGenerationNode；只假执行器和主进程 IPC。断言写「该有的样子」，红 = 复现。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStoryboardActionGuard, runStoryboardAction } from './storyboardActionGuard'
import { generateAnchorCard, generateShotRow, runStoryboardBatch, regenerateShotRow } from './storyboardRowActions'
import { deriveAnchorCardRuntimes, deriveStoryboardBatch, deriveStoryboardRowRuntimes } from './storyboardRowStatus'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { useGenerationQueueStore } from '../../../generationCanvas/runner/generationQueueStore'
import { useSpendConfirmStore } from '../../../generationCanvas/spend/spendConfirm'
import { useWorkbenchStore } from '../../../workbenchStore'
import { withCanvasGestureContext, type CanvasGestureContext } from '../../../generationCanvas/events/canvasGestureContext'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../../project/projectSessionTestHarness'
import { confirmAndRunNode } from '../../../generationCanvas/runner/generationRunController'
import { RecoverableTimeoutError } from '../../../generationCanvas/runner/recoverableTimeout'
import { encodeStructuredErrorMessage } from '../../../../../electron/vendor/vendorHttp'
import { generationFailureActions } from '../../../observability/generationFailureActions'
import type { GenerationCanvasNode, GenerationNodeResult } from '../../../generationCanvas/model/generationCanvasTypes'
import type { StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'

const calls = vi.hoisted(() => ({ execute: vi.fn(), disk: new Map<string, unknown>(), mint: vi.fn(), consent: vi.fn(), unknown: vi.fn(), release: vi.fn(async (_input: { runRecordId: string }) => undefined), withdraw: vi.fn(), notify: vi.fn() }))
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
/** 执行器一次交回这一镜的全部结果（这里一张）。 */
const imageRun = (id: string) => [imageResult(id)] as const
const plan = (shots = 2): StoryboardPlan => ({
  title: 'Lock', anchors: [{ id: 'actor', name: 'Actor', kind: 'character', carrier: 'visual', description: 'Actor' }],
  shots: Array.from({ length: shots }, (_, i) => i + 1).map(index => ({ index, shotId: `shot-${index}`, shotKind: 'image' as const, durationSec: 2, anchorIds: ['actor'], prompt: `Actor walks ${index}` })),
})
const store = () => useGenerationCanvasStore.getState()
const nodes = () => store().nodes
const nodeOfShot = (shotId: string) => nodes().find(node => node.meta?.shotId === shotId && !node.meta?.storyboardKeyframe) as GenerationCanvasNode
const assetNode = () => nodes().find(node => node.meta?.anchorId === 'actor') as GenerationCanvasNode
const sends = (shotId: string) => calls.execute.mock.calls.filter(([node]) => (node as GenerationCanvasNode).meta?.shotId === shotId && !(node as GenerationCanvasNode).meta?.storyboardKeyframe).length
const sendsOf = (id: string) => calls.execute.mock.calls.filter(([node]) => (node as GenerationCanvasNode).id === id).length
const assetSends = () => calls.execute.mock.calls.filter(([node]) => (node as GenerationCanvasNode).meta?.anchorId === 'actor').length
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
  useWorkbenchStore.setState({ activeDocumentId: 'doc', activeStoryboardId: 'design', storyboardDesignsByDocumentId: { doc: [{ id: 'design', plan: current, documentId: 'doc', title: 'design', committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 } as never] } })
}
const readCurrentPlan = () => useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc[0].plan as StoryboardPlan
const rowsOf = (current: StoryboardPlan) => deriveStoryboardRowRuntimes({ plan: current, designId: 'design', nodes: nodes(), imageModelOptions: [], videoModelOptions: [] })
const addShot = (shotId: string, extra: Record<string, unknown> = {}, kind: 'image' | 'video' = 'image') => store().addNode({ kind, prompt: shotId, meta: { storyboardDesignId: 'design', shotId, ...extra } })
function holdAnchors() {
  const hold = deferred()
  calls.execute.mockImplementation(async (node: GenerationCanvasNode) => {
    if (node.meta?.anchorId) await hold.promise
    return imageRun(node.id)
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
const heldCards = (autoFirst = 0) => {
  const pending: Array<(value: boolean) => void> = []
  let seen = 0
  useSpendConfirmStore.setState({ requestConfirm: (request: never) => { confirmCards.push(request); seen += 1; if (seen <= autoFirst) return Promise.resolve(true); return new Promise<boolean>(resolve => { pending.push(resolve) }) } } as never)
  return pending
}
const priceChange = (shotId: string, resolution = '4k') => { const latest = readCurrentPlan(); useWorkbenchStore.getState().setStoryboardPlan({ ...latest, shots: latest.shots.map(shot => shot.shotId === shotId ? { ...shot, params: { resolution } } : shot) }, 'doc', 'design') }
const notified = () => calls.notify.mock.calls.map(([input]) => ({ reason: input.reason, type: input.type, message: input.message, actionLabel: input.actionLabel }))

describe('二-1 带关键帧的镜', () => {
  const videoPlan = () => { const current = plan(); current.shots[1] = { ...current.shots[1], shotKind: 'video', keyframe: { enabled: true } }; return current }
  it('T1a 关键帧早已出图：批量只发主节点一次，关键帧 0 次', async () => {
    const current = videoPlan(); seed(current)
    const main = addShot('shot-2'), key = addShot('shot-2', { storyboardKeyframe: true })
    store().appendNodeRun(key.id, { id: 'key-run', status: 'success' }); store().addNodeResult(key.id, imageResult('key'))
    const keyResult = nodes().find(n => n.id === key.id)!.result?.id
    const release = holdAnchors(), batch = editor(current).runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    release(); await batch; await quiet()
    facts.T1a = { main: sendsOf(main.id), keyframe: sendsOf(key.id), keyResultKept: nodes().find(n => n.id === key.id)!.result?.id === keyResult, order: calls.execute.mock.calls.map(([n]) => (n as GenerationCanvasNode).meta?.storyboardKeyframe ? 'keyframe' : (n as GenerationCanvasNode).meta?.anchorId ?? (n as GenerationCanvasNode).meta?.shotId), failures: [...failures] }
    expect(sendsOf(main.id)).toBe(1); expect(sendsOf(key.id)).toBe(0)
  })
  it('T1b 关键帧没出过图：先关键帧、后主节点，各一次', async () => {
    const current = videoPlan(); seed(current)
    const main = addShot('shot-2'), key = addShot('shot-2', { storyboardKeyframe: true })
    useGenerationCanvasStore.setState(state => ({ edges: [...state.edges, { id: 'kf-edge', source: key.id, target: main.id } as never] }))
    const release = holdAnchors(), batch = editor(current).runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    release(); await batch; await quiet()
    const order = calls.execute.mock.calls.map(([n]) => (n as GenerationCanvasNode).id)
    facts.T1b = { main: sendsOf(main.id), keyframe: sendsOf(key.id), keyBeforeMain: order.indexOf(key.id) < order.indexOf(main.id) }
    expect(sendsOf(key.id)).toBe(1); expect(sendsOf(main.id)).toBe(1); expect(order.indexOf(key.id)).toBeLessThan(order.indexOf(main.id))
  })
  it('T1c 关键帧失败后整批再跑：关键帧重发，主节点也发', async () => {
    const current = videoPlan(); seed(current)
    const main = addShot('shot-2'), key = addShot('shot-2', { storyboardKeyframe: true })
    store().appendNodeRun(key.id, { id: 'key-failed', status: 'error' }); store().setNodeStatus(key.id, 'error', 'HTTP 500')
    const release = holdAnchors(), batch = editor(current).runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    release(); await batch; await quiet()
    facts.T1c = { main: sendsOf(main.id), keyframe: sendsOf(key.id) }
    expect(sendsOf(key.id)).toBe(1); expect(sendsOf(main.id)).toBe(1)
  })
  it('H-C 关了关键帧、残留关键帧节点可找回：这一镜不该被吞', async () => {
    const current = plan(); seed(current)
    const main = addShot('shot-2'), key = addShot('shot-2', { storyboardKeyframe: true })
    store().appendNodeRun(key.id, { id: 'key-rec', status: 'running', taskId: 'old' }); store().setNodeStatus(key.id, 'recoverable', 'late')
    const release = holdAnchors(), batch = editor(current).runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    release(); await batch; await quiet()
    facts['H-C'] = { main: sendsOf(main.id), leftover: sendsOf(key.id), cardRows: confirmCards[0]?.planRows?.map(r => r.id), failures: [...failures], notified: notified() }
    expect(sendsOf(main.id)).toBe(1)
  })
  it('H-B 主节点失败 + 关键帧可找回：行进卡、卡上有它，然后被过滤（有没有提示）', async () => {
    const current = videoPlan(); seed(current)
    const main = addShot('shot-2'), key = addShot('shot-2', { storyboardKeyframe: true })
    store().appendNodeRun(main.id, { id: 'main-failed', status: 'error' }); store().setNodeStatus(main.id, 'error', 'HTTP 500')
    store().appendNodeRun(key.id, { id: 'key-rec', status: 'running', taskId: 'old' }); store().setNodeStatus(key.id, 'recoverable', 'late')
    const row = rowsOf(current).find(r => r.shot.shotId === 'shot-2')!
    const release = holdAnchors(), batch = editor(current).runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    release(); await batch; await quiet()
    facts['H-B'] = { rowStatus: row.exec.status, runnable: deriveStoryboardBatch([row]).runnable.length, cardRows: confirmCards[0]?.planRows?.map(r => r.id), main: sendsOf(main.id), notified: notified() }
  })
})

describe('二-3 记 run 号在第一张卡关闭之后', () => {
  it('T2a 卡开着，这一镜单发并跑完：确认后不得再发', async () => {
    const current = plan(); seed(current)
    const cards = heldCards()
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => imageRun(node.id))
    const ui = editor(current), batch = ui.runBatch()
    await vi.waitFor(() => expect(cards.length).toBe(1))
    await ui.clickRow('shot-2')
    expect(sends('shot-2')).toBe(1)
    const owned = nodeOfShot('shot-2').result?.id
    cards[0](true); await batch; await quiet()
    facts.T2a = { shot2: sends('shot-2'), resultReplaced: nodeOfShot('shot-2').result?.id !== owned, runs: nodeOfShot('shot-2').runs?.length, cards: confirmCards.length }
    expect(sends('shot-2')).toBe(1)
  })
  it('T2p 同一轮点行又点整批（prep 重叠，行的 await 还没走完卡就开了）：确认后不得再发', async () => {
    const current = plan(); seed(current)
    const cards = heldCards()
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => imageRun(node.id))
    const ui = editor(current)
    const single = ui.clickRow('shot-2'), batch = ui.runBatch()
    await vi.waitFor(() => expect(cards.length).toBe(1))
    await single
    const cardListedShot2 = confirmCards[0].planRows?.some(row => row.id === 'shot:shot-2')
    const owned = nodeOfShot('shot-2').result?.id
    cards[0](true); await batch; await quiet()
    facts.T2p = { cardListedShot2, shot2: sends('shot-2'), resultReplaced: nodeOfShot('shot-2').result?.id !== owned }
    expect(sends('shot-2')).toBe(1)
  })
  it('T2q 两张卡排队：A 卡（Agent 只发这一镜）确认跑完后再确认 B 卡（Agent 整批）：这一镜不得再发', async () => {
    const current = plan(); seed(current)
    const cards = heldCards()
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => imageRun(node.id))
    const placed = addShot('shot-2')
    const single = confirmAndRunNode(placed.id, { initiator: 'agent' })
    await vi.waitFor(() => expect(cards.length).toBe(1))
    const batch = editor(current).runBatch()
    await vi.waitFor(() => expect(cards.length).toBe(2))
    cards[0](true); await single
    expect(sends('shot-2')).toBe(1)
    cards[1](true); await batch; await quiet()
    facts.T2q = { shot2: sends('shot-2') }
    expect(sends('shot-2')).toBe(1)
  })
  it('T2b 第二张卡开着，这一镜单发并跑完：确认后不得再发', async () => {
    const current = plan(3); seed(current)
    const cards = heldCards(1)
    const release = holdAnchors()
    const ui = editor(current), batch = ui.runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    priceChange('shot-1')
    release()
    await vi.waitFor(() => expect(cards.length).toBe(1))
    await ui.clickRow('shot-2')
    expect(sends('shot-2')).toBe(1)
    const rowsOnCard = confirmCards[1].planRows?.map(row => ({ id: row.id, checked: row.checked }))
    cards[0](true); await batch; await quiet()
    facts.T2b = { rowsOnCard, shot2: sends('shot-2') }
    expect(sends('shot-2')).toBe(1)
  })
  it('T12 卡开着，这张资产卡单发并跑完：确认后资产不得再发', async () => {
    const current = plan(); seed(current)
    const cards = heldCards()
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => imageRun(node.id))
    const ui = editor(current), batch = ui.runBatch()
    await vi.waitFor(() => expect(cards.length).toBe(1))
    await ui.clickAnchor()
    expect(assetSends()).toBe(1)
    const owned = assetNode().result?.id
    cards[0](true); await batch; await quiet()
    facts.T12 = { asset: assetSends(), resultReplaced: assetNode().result?.id !== owned }
    expect(assetSends()).toBe(1)
  })
  it('T12b 过滤到入队的缝：资产波的 consent 卡住时单发资产并跑完：资产不得再发', async () => {
    const current = plan(); seed(current)
    const hold = deferred()
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => imageRun(node.id))
    let consents = 0
    calls.consent.mockImplementation(async (input: { shots: Array<{ runRecordId: string }> }) => { consents += 1; if (consents === 1) await hold.promise; return input.shots.map(shot => `canvas-${shot.runRecordId}`) })
    const ui = editor(current), batch = ui.runBatch()
    await vi.waitFor(() => expect(consents).toBe(1))
    await ui.clickAnchor()
    hold.resolve(); await batch; await quiet()
    facts.T12b = { asset: assetSends() }
    expect(assetSends()).toBe(1)
  })
})

describe('二-4 全部被单独发过', () => {
  const allTaken = async (spendChanged: boolean, viaAgent: boolean) => {
    const current = plan(); seed(current)
    const release = holdAnchors()
    const onConsented = vi.fn()
    let batch: Promise<unknown>
    const ui = editor(current)
    if (viaAgent) {
      const guard = createStoryboardActionGuard({ plan: current, designId: 'design', shotIds: current.shots.map(s => s.shotId!), readPlan: async () => readCurrentPlan(), writePlan: next => useWorkbenchStore.getState().setStoryboardPlan(next, 'doc', 'design') })
      batch = runStoryboardBatch({ initiator: 'agent', documentId: 'doc', designId: 'design', plan: current, actionGuard: guard, assertCurrent: () => guard.assertCurrent(), assertAuthorCurrent: guard.assertAuthorCurrent }, rowsOf(current), undefined, onConsented)
    } else batch = runStoryboardAction({ projectId: 'project-a', documentId: 'doc', designId: 'design', plan: current, activeKeys: new Set(), onPendingChange: () => undefined, onStart: () => undefined, onFailure: (error: unknown) => { failures.push(String(error)) }, unavailable: (): never => { throw new Error('unavailable') }, shotIds: current.shots.map(s => s.shotId!), actionKey: 'table', action: context => runStoryboardBatch(context, rowsOf(current)) })
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    await ui.clickRow('shot-1'); await ui.clickRow('shot-2')
    if (spendChanged) priceChange('shot-1')
    const cardsBefore = confirmCards.length
    release()
    const outcome = await Promise.race([batch, new Promise(resolve => setTimeout(() => resolve('HUNG'), 1500))])
    await quiet()
    return { outcome, s1: sends('shot-1'), s2: sends('shot-2'), extraCards: confirmCards.length - cardsBefore, onConsented: onConsented.mock.calls.length, notified: notified(), failures: [...failures] }
  }
  it('T3a 普通路', async () => { const fact = await allTaken(false, false); facts.T3a = fact; expect(fact.outcome).not.toBe('HUNG'); expect(fact.notified.filter(n => n.type === 'error')).toEqual([]) })
  it('T3b spendChanged 路', async () => { const fact = await allTaken(true, false); facts.T3b = fact; expect(fact.outcome).not.toBe('HUNG'); expect(fact.notified.filter(n => n.type === 'error')).toEqual([]) })
  it('T3c Agent：onConsented 不触发时不会一直等', async () => { const fact = await allTaken(false, true); facts.T3c = fact; expect(fact.outcome).not.toBe('HUNG') })
  it('H-F 选中的全在队列里：Agent 被告知「用户拒绝」？', async () => {
    const current = plan(); seed(current)
    const a = addShot('shot-1'), b = addShot('shot-2')
    const anchor = store().addNode({ kind: 'image', prompt: 'actor', meta: { storyboardDesignId: 'design', anchorId: 'actor' } })
    store().appendNodeRun(anchor.id, { id: 'done', status: 'success' }); store().addNodeResult(anchor.id, imageResult('a'))
    useGenerationQueueStore.getState().enqueueBatch([[a.id, b.id]], 'project-a')
    const rows = rowsOf(current)
    const outcome = await runStoryboardBatch({ initiator: 'agent', documentId: 'doc', designId: 'design', plan: current }, rows)
    facts['H-F'] = { outcome, rowStatus: rows.map(r => r.exec.status), runnable: deriveStoryboardBatch(rows).runnable.length, cards: confirmCards.length }
    expect(outcome).not.toBe('declined')
  })
})

describe('二-5 过滤之后到入队之间的缝', () => {
  it('T4 consent 卡住时单发这一镜并跑完：不得再发', async () => {
    const current = plan(3); seed(current)
    const hold = deferred()
    const release = holdAnchors()
    let consents = 0
    calls.consent.mockImplementation(async (input: { shots: Array<{ runRecordId: string }> }) => { consents += 1; if (consents === 2) await hold.promise; return input.shots.map(shot => `canvas-${shot.runRecordId}`) })
    const ui = editor(current), batch = ui.runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    release()
    await vi.waitFor(() => expect(consents).toBe(2))
    await ui.clickRow('shot-2')
    expect(sends('shot-2')).toBe(1)
    const owned = nodeOfShot('shot-2').result?.id
    hold.resolve(); await batch; await quiet()
    facts.T4 = { shot2: sends('shot-2'), resultReplaced: nodeOfShot('shot-2').result?.id !== owned, consentedForShot2: true }
    expect(sends('shot-2')).toBe(1)
  })
  it('T4b consent 卡住时单发，单发还在飞：批次那一发被主进程拒，节点结局如何', async () => {
    const current = plan(3); seed(current)
    const hold = deferred()
    const single = deferred()
    let shot2Calls = 0
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => {
      if (node.meta?.shotId === 'shot-2') { shot2Calls += 1; if (shot2Calls === 1) { await single.promise; return imageRun(node.id) } throw refusal() }
      return imageRun(node.id)
    })
    let consents = 0
    calls.consent.mockImplementation(async (input: { shots: Array<{ runRecordId: string }> }) => { consents += 1; if (consents === 2) await hold.promise; return input.shots.map(shot => `canvas-${shot.runRecordId}`) })
    const ui = editor(current), batch = ui.runBatch()
    await vi.waitFor(() => expect(consents).toBe(2))
    const click = ui.clickRow('shot-2')
    await vi.waitFor(() => expect(shot2Calls).toBe(1))
    hold.resolve(); await batch
    const midway = { status: nodeOfShot('shot-2').status, error: String(nodeOfShot('shot-2').error ?? '').slice(0, 60), runs: nodeOfShot('shot-2').runs?.map(r => r.status) }
    single.resolve(); await click; await quiet()
    const end = nodeOfShot('shot-2')
    facts.T4b = { midway, endStatus: end.status, endError: String(end.error ?? '').slice(0, 60), hasResult: Boolean(end.result?.id), runs: end.runs?.map(r => ({ status: r.status, resultId: Boolean(r.resultId) })), notified: notified() }
  })
})

describe('二-6 吞掉本该发的镜', () => {
  it('T5 资产阶段删了节点：批次重建后这一镜发不发、有没有提示', async () => {
    const current = plan(); seed(current)
    const placed = addShot('shot-2')
    store().appendNodeRun(placed.id, { id: 'old', status: 'success' }); store().addNodeResult(placed.id, imageResult('old'))
    const release = holdAnchors(), batch = editor(current).runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    store().deleteNode(placed.id)
    release(); await batch; await quiet()
    const rebuilt = nodeOfShot('shot-2')
    facts.T5 = { rebuiltExists: Boolean(rebuilt), sameId: rebuilt?.id === placed.id, shot2: sends('shot-2'), notified: notified(), failures: [...failures] }
    expect(sends('shot-2')).toBe(1)
  })
  it('T6 用户复制出同镜号的节点（带 meta）：批次发给谁', async () => {
    const current = plan(); seed(current)
    const original = addShot('shot-2')
    const copy = addShot('shot-2')
    const release = holdAnchors(), batch = editor(current).runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    release(); await batch; await quiet()
    facts.T6 = { original: sendsOf(original.id), copy: sendsOf(copy.id) }
    expect(sendsOf(original.id) + sendsOf(copy.id)).toBe(1)
  })
  it('T13a 失败行重试照常发', async () => {
    const current = plan(); seed(current)
    const placed = addShot('shot-2')
    store().appendNodeRun(placed.id, { id: 'failed', status: 'error' }); store().setNodeStatus(placed.id, 'error', 'HTTP 429 concurrency limit exceeded')
    const release = holdAnchors(), batch = editor(current).runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    release(); await batch; await quiet()
    facts.T13a = { shot2: sends('shot-2'), status: nodeOfShot('shot-2').status }
    expect(sends('shot-2')).toBe(1)
  })
  it('T13b 资产阶段切了别的方案：批次不串、镜头按原方案发', async () => {
    const current = plan(); seed(current)
    const release = holdAnchors(), batch = editor(current).runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    useWorkbenchStore.setState({ activeStoryboardId: 'other-design' })
    release(); await batch; await quiet()
    facts.T13b = { s1: sends('shot-1'), s2: sends('shot-2'), failures: [...failures], metaDesign: [...new Set(nodes().map(n => n.meta?.storyboardDesignId))] }
    expect(sends('shot-1')).toBe(1)
  })
  it('T13c 资产阶段删了方案：不发、一句人话（不吞）', async () => {
    const current = plan(); seed(current)
    const release = holdAnchors(), batch = editor(current).runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    useWorkbenchStore.setState({ storyboardDesignsByDocumentId: { doc: [] } })
    release(); await batch.catch(error => failures.push(String(error))); await quiet()
    facts.T13c = { s1: sends('shot-1'), s2: sends('shot-2'), failures: [...failures], notified: notified() }
    expect(sends('shot-1') + sends('shot-2')).toBe(0)
    expect(failures.length + calls.notify.mock.calls.length).toBeGreaterThan(0)
  })
  it('T13d 资产阶段切了项目：不往新项目写、不发', async () => {
    const current = plan(); seed(current)
    const release = holdAnchors(), batch = editor(current).runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    await session.open('project-b')
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
    release(); await batch.catch(error => failures.push(String(error))); await quiet().catch(() => undefined)
    facts.T13d = { s1: sends('shot-1'), s2: sends('shot-2'), nodesInB: nodes().length, failures: [...failures].map(f => String(f).slice(0, 100)), notified: notified() }
    expect(sends('shot-1') + sends('shot-2')).toBe(0)
    expect(nodes().length).toBe(0)
  })
  it('T10 过滤前的 materialize 碰到别人在跑的节点：在跑节点的提示词 / 引用不被批次改', async () => {
    const current = plan(); seed(current)
    const single = deferred()
    const hold = deferred()
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => {
      if (node.meta?.anchorId) await hold.promise
      if (node.meta?.shotId === 'shot-2') await single.promise
      return imageRun(node.id)
    })
    const ui = editor(current), batch = ui.runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    const click = ui.clickRow('shot-2')
    await vi.waitFor(() => expect(sends('shot-2')).toBe(1))
    const before = structuredClone(nodeOfShot('shot-2'))
    hold.resolve(); await batch
    const after = nodeOfShot('shot-2')
    facts.T10 = { samePrompt: before.prompt === after.prompt, sameRefs: JSON.stringify(before.references ?? []) === JSON.stringify(after.references ?? []), sameMeta: JSON.stringify(before.meta) === JSON.stringify(after.meta), promptBefore: before.prompt, promptAfter: after.prompt }
    single.resolve(); await click; await quiet()
    expect(before.prompt).toBe(after.prompt)
  })
  it('T11 资产单发在跑时点整批：镜头发不发、带不带参考', async () => {
    const current = plan(); seed(current)
    const hold = deferred()
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => { if (node.meta?.anchorId) await hold.promise; return imageRun(node.id) })
    const ui = editor(current)
    const single = ui.clickAnchor()
    await vi.waitFor(() => expect(assetSends()).toBe(1))
    const batch = ui.runBatch()
    const outcome = await Promise.race([batch, new Promise(resolve => setTimeout(() => resolve('STILL-RUNNING'), 300))])
    const midway = { outcome, s1: sends('shot-1'), s2: sends('shot-2'), cardRows: confirmCards[0]?.planRows?.map(r => r.id), s1Refs: nodeOfShot('shot-1')?.references, s1Prompt: nodeOfShot('shot-1')?.prompt }
    hold.resolve(); await single; await batch; await quiet()
    facts.T11 = { midway, assetSends: assetSends(), end: { s1: sends('shot-1'), s2: sends('shot-2') } }
  })
})

describe('A11 第二张卡', () => {
  const guardBatch = (current: StoryboardPlan) => editor(current).runBatch()
  it('H-D1 用户只发1镜：既定单张政策不追加普通付费卡，仍发新清晰度', async () => {
    const current = plan(1); seed(current)
    const release = holdAnchors(), batch = guardBatch(current)
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    priceChange('shot-1')
    release(); await batch; await quiet()
    facts['H-D1'] = { cards: confirmCards.length, shot1: sends('shot-1'), resolutionSent: JSON.stringify(nodeOfShot('shot-1')?.meta ?? null).slice(0, 80) }
    expect(confirmCards.length).toBe(1)
  })
  it('H-D2 两镜整批，其中一镜单发过，另一镜改清晰度：只剩用户单张不追加付费卡', async () => {
    const current = plan(); seed(current)
    const release = holdAnchors(), ui = editor(current), batch = ui.runBatch()
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    await ui.clickRow('shot-2')
    priceChange('shot-1')
    release(); await batch; await quiet()
    facts['H-D2'] = { cards: confirmCards.length, shot1: sends('shot-1'), shot2: sends('shot-2') }
    expect(confirmCards.length).toBe(1)
    expect(sends('shot-1')).toBe(1)
    expect(sends('shot-2')).toBe(1)
  })
  it('H-D3 Agent 发起的一镜整批：Agent 判据下有第二张卡（对照）', async () => {
    const current = plan(1); seed(current)
    const guard = createStoryboardActionGuard({ plan: current, designId: 'design', shotIds: ['shot-1'], readPlan: async () => readCurrentPlan(), writePlan: next => useWorkbenchStore.getState().setStoryboardPlan(next, 'doc', 'design') })
    const release = holdAnchors()
    const batch = runStoryboardBatch({ initiator: 'agent', documentId: 'doc', designId: 'design', plan: current, actionGuard: guard, assertCurrent: () => guard.assertCurrent(), assertAuthorCurrent: guard.assertAuthorCurrent }, rowsOf(current))
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    priceChange('shot-1')
    release(); await batch; await quiet()
    facts['H-D3'] = { cards: confirmCards.length, shot1: sends('shot-1') }
    expect(confirmCards.length).toBe(2)
  })
  it('H-D4 第二张卡：节点已成功的那镜默认不勾，只剩它一镜改价且用户发起：是什么结局', async () => {
    const current = plan(); seed(current)
    const placed = addShot('shot-1')
    store().appendNodeRun(placed.id, { id: 'old', status: 'success' }); store().addNodeResult(placed.id, imageResult('old'))
    const release = holdAnchors()
    const rows = rowsOf(current).filter(row => row.shot.shotId === 'shot-1')
    const batch = runStoryboardAction({ projectId: 'project-a', documentId: 'doc', designId: 'design', plan: current, activeKeys: new Set(), onPendingChange: () => undefined, onStart: () => undefined, onFailure: (error: unknown) => { failures.push(String(error)) }, unavailable: (): never => { throw new Error('unavailable') }, shotIds: ['shot-1'], actionKey: 'table', action: context => runStoryboardBatch(context, rows) })
    await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
    priceChange('shot-1')
    release(); const outcome = await batch; await quiet()
    facts['H-D4'] = { outcome, cards: confirmCards.length, shot1: sends('shot-1'), notified: notified() }
  })
})

describe('在途拒绝卡的出路（要 R1 的渲染层 worker 还活着）', () => {
  const inFlightPair = async () => {
    const current = plan(); seed(current)
    const placed = addShot('shot-2')
    const r1 = deferred()
    let shot2Calls = 0
    let r1Ctx: { onProgress?: (p: { phase: string; message: string; taskId?: string }) => void } = {}
    calls.execute.mockImplementation(async (node: GenerationCanvasNode, ctx: typeof r1Ctx) => {
      if (node.meta?.shotId === 'shot-2') {
        shot2Calls += 1
        if (shot2Calls === 1) { r1Ctx = ctx; ctx.onProgress?.({ phase: 'running', message: 'running', taskId: 'task-1' }); await r1.promise; return imageRun(node.id) }
        throw refusal()
      }
      return imageRun(node.id)
    })
    const first = confirmAndRunNode(placed.id, { initiator: 'user' })
    await vi.waitFor(() => expect(shot2Calls).toBe(1))
    vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValueOnce(false)
    await confirmAndRunNode(placed.id, { initiator: 'user' })
    expect(shot2Calls).toBe(2)
    return { current, placed, r1, first, r1Ctx: () => r1Ctx, shot2Calls: () => shot2Calls }
  }
  const look = (node: GenerationCanvasNode) => {
    const run = node.runs?.[0]
    const actions = generationFailureActions(String(node.error ?? ''), run as never)
    return { status: node.status, error: String(node.error ?? '').slice(0, 70), hasResult: Boolean(node.result?.id), runs: node.runs?.map(r => ({ id: r.id.slice(-6), status: r.status, taskId: r.taskId ?? null, resultId: Boolean(r.resultId) })), kind: actions.kind, primary: actions.primary, secondary: actions.secondary, canRetry: actions.canRetry }
  }
  it('H-A 拒绝卡进了批次，资产阶段原任务晚成功：批次不得再发', async () => {
    const { current, placed, r1, first, shot2Calls } = await inFlightPair()
    const beforeBatch = look(nodes().find(n => n.id === placed.id)!)
    const rowStatus = rowsOf(current).find(r => r.shot.shotId === 'shot-2')!.exec.status
    const hold = deferred()
    const original = calls.execute.getMockImplementation()!
    calls.execute.mockImplementation(async (node: GenerationCanvasNode, ctx: never) => { if (node.meta?.anchorId) await hold.promise; return node.meta?.shotId === 'shot-2' && shot2Calls() >= 2 ? (calls.execute.mock.calls.length, imageRun(node.id)) : original(node, ctx) })
    const ui = editor(current), batch = ui.runBatch()
    await vi.waitFor(() => expect(assetSends()).toBe(1))
    r1.resolve(); await first
    const afterLate = look(nodes().find(n => n.id === placed.id)!)
    hold.resolve(); await batch; await quiet()
    facts['H-A'] = { beforeBatch, rowStatus, afterLate, cardRows: confirmCards[0]?.planRows?.map(r => r.id), sendsShot2: sends('shot-2'), expected: 2 }
    expect(sends('shot-2')).toBe(2)
  })
  it('I1 原任务先完成、拒绝后写入：有结果但一直说还在生成，出路', async () => {
    const current = plan(); seed(current)
    const placed = addShot('shot-2')
    const r2 = deferred()
    let shot2Calls = 0
    const r1 = deferred()
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => {
      if (node.meta?.shotId === 'shot-2') { shot2Calls += 1; if (shot2Calls === 1) { await r1.promise; return imageRun(node.id) } await r2.promise; throw refusal() }
      return imageRun(node.id)
    })
    const first = confirmAndRunNode(placed.id, { initiator: 'user' })
    await vi.waitFor(() => expect(shot2Calls).toBe(1))
    const second = confirmAndRunNode(placed.id, { initiator: 'user' })
    await vi.waitFor(() => expect(shot2Calls).toBe(2))
    r1.resolve(); await first
    r2.resolve(); await second
    const node = nodes().find(n => n.id === placed.id)!
    const row = rowsOf(current).find(r => r.shot.shotId === 'shot-2')!
    facts.I1 = { ...look(node), rowStatus: row.exec.status, batchRunnable: deriveStoryboardBatch(rowsOf(current)).runnable.map(r => r.shot.shotId) }
    expect(node.status).not.toBe('error')
  })
  it('I2 拒绝后原任务轮询 tick：拒绝文案被清掉、错误动作变成什么', async () => {
    const { placed, r1, first, r1Ctx } = await inFlightPair()
    const refused = look(nodes().find(n => n.id === placed.id)!)
    r1Ctx().onProgress?.({ phase: 'polling', message: 'still polling', taskId: 'task-1' })
    const afterTick = look(nodes().find(n => n.id === placed.id)!)
    const progress = nodes().find(n => n.id === placed.id)!.progress
    r1.resolve(); await first; await quiet()
    const end = look(nodes().find(n => n.id === placed.id)!)
    facts.I2 = { refused, afterTick, progress, end }
    expect(afterTick.status).toBe('running')
    expect(afterTick.error).toBeFalsy()
    expect(progress?.taskId).toBe('task-1')
  })
  it('I3 渲染层：拒绝之后 R1 超时变可找回，放手放的是 R1', async () => {
    const current = plan(); seed(current)
    const placed = addShot('shot-2')
    const r1 = deferred()
    let shot2Calls = 0
    calls.execute.mockImplementation(async (node: GenerationCanvasNode, ctx: { canvasRun?: { runRecordId: string } }) => {
      shot2Calls += 1
      if (shot2Calls === 1) { facts.I3r1 = ctx.canvasRun?.runRecordId ?? null; await r1.promise; return imageRun(node.id) }
      throw refusal()
    })
    const first = confirmAndRunNode(placed.id, { initiator: 'user' })
    await vi.waitFor(() => expect(shot2Calls).toBe(1))
    // R1 的号由它自己报（执行器拿到的运行记录号）：花钱的那次在主进程准入之前不在运行记录里（归属规则 D1）。
    const r1Id = facts.I3r1
    await confirmAndRunNode(placed.id, { initiator: 'user' })
    r1.reject(new RecoverableTimeoutError({ taskId: 'accepted', vendor: 'fixture', taskKind: 'text_to_image', modelKey: 'fixture-image' }))
    await first
    await vi.waitFor(() => expect(nodes().find(n => n.id === placed.id)!.status).toBe('recoverable'))
    const released = calls.release.mock.calls.map(args => (args[0] as unknown as { runRecordId: string }).runRecordId)
    const node = nodes().find(n => n.id === placed.id)!
    facts.I3 = { r1Id, released, runs: node.runs?.map(r => r.id), status: node.status, error: String(node.error ?? '').slice(0, 60), statusOfRuns: node.runs?.map(r => r.status) }
    expect(released).toContain(r1Id)
    void current
  })
  it('H-E 批次里被拒的那张只给跳过信息，不给付费重试', async () => {
    const current = plan(); seed(current)
    const refusedNode = addShot('shot-1'), ok = addShot('shot-2')
    const anchor = store().addNode({ kind: 'image', prompt: 'actor', meta: { storyboardDesignId: 'design', anchorId: 'actor' } })
    store().appendNodeRun(anchor.id, { id: 'done', status: 'success' }); store().addNodeResult(anchor.id, imageResult('a'))
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => { if (node.id === refusedNode.id) throw refusal(); return imageRun(node.id) })
    await editor(current).runBatch(); await quiet()
    const note = notified()
    const sendsBefore = sendsOf(refusedNode.id)
    facts['H-E'] = { note, sendsBefore, sendsAfterRetry: sendsOf(refusedNode.id), okSends: sendsOf(ok.id) }
    expect(note.filter(n => n.reason === 'generation-failed')).toEqual([])
    expect(note.some(n => n.reason === 'generation-skipped' && n.type === 'info')).toBe(true)
    expect(sendsOf(refusedNode.id)).toBe(sendsBefore)
  })
  it('T8 主节点已上锁且没有结果（老数据）：行是什么状态、批次吞不吞', async () => {
    const current = plan(); seed(current)
    const frozen = addShot('shot-2', { frozen: true })
    const anchor = store().addNode({ kind: 'image', prompt: 'actor', meta: { storyboardDesignId: 'design', anchorId: 'actor' } })
    store().appendNodeRun(anchor.id, { id: 'done', status: 'success' }); store().addNodeResult(anchor.id, imageResult('a'))
    calls.execute.mockImplementation(async (node: GenerationCanvasNode) => imageRun(node.id))
    const rows = rowsOf(current)
    await editor(current).runBatch(); await quiet()
    facts.T8 = { rowStatus: rows.find(r => r.shot.shotId === 'shot-2')!.exec.status, onCard: confirmCards[0]?.planRows?.some(r => r.id === 'shot:shot-2'), sends: sendsOf(frozen.id), notified: notified(), anchorCards: deriveAnchorCardRuntimes({ plan: current, designId: 'design', nodes: nodes() }).length }
  })
})
