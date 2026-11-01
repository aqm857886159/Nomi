// B6: real runStoryboardAction / runStoryboardBatch / generateShotRow / confirmAndRunPlan /
// confirmAndRunNode / 队列 / 咽喉 runGenerationNode；只假执行器（按节点数次数）和主进程 IPC。
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runStoryboardAction } from './storyboardActionGuard'
import { generateShotRow, runStoryboardBatch } from './storyboardRowActions'
import { deriveStoryboardRowRuntimes } from './storyboardRowStatus'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { useGenerationQueueStore } from '../../../generationCanvas/runner/generationQueueStore'
import { useSpendConfirmStore } from '../../../generationCanvas/spend/spendConfirm'
import { useWorkbenchStore } from '../../../workbenchStore'
import { withCanvasGestureContext, type CanvasGestureContext } from '../../../generationCanvas/events/canvasGestureContext'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../../project/projectSessionTestHarness'
import type { GenerationCanvasNode, GenerationNodeResult } from '../../../generationCanvas/model/generationCanvasTypes'
import type { StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'

const calls = vi.hoisted(() => ({ execute: vi.fn(), disk: new Map<string, unknown>(), confirm: vi.fn(), mint: vi.fn(), consent: vi.fn(), unknown: vi.fn() }))
vi.mock('../../../../desktop/bridge', () => ({ getDesktopBridge: () => ({ projects: { applyCanvasNodePatch: vi.fn(async () => ({ applied: true })) } }) }))
vi.mock('../../../library/localProjectStore', () => ({
  readLocalProjectAsync: async (id: string) => structuredClone(calls.disk.get(id) ?? null),
  saveLocalProject: async (id: string, payload: unknown, name: string) => ({ id, name, version: 1, payload }),
}))
vi.mock('../../../api/taskApi', () => ({ canvasUnknownRuns: calls.unknown, mintSpendGrant: calls.mint, consentCanvasShots: calls.consent, withdrawCanvasShots: vi.fn(), releaseCanvasShotRun: vi.fn(async () => undefined) }))
vi.mock('../../../generationCanvas/runner/generationNodeExecutor', () => ({ generationNodeExecutor: calls.execute }))
vi.mock('../../../generationCanvas/runner/assetUploadConsent', async original => ({ ...await original<typeof import('../../../generationCanvas/runner/assetUploadConsent')>(), resolveAssetUploadConsent: async () => ({ allowed: true, needsConfirmation: false }) }))
vi.mock('../../../generationCanvas/runner/nodeModelHealth', () => ({ recordNodeModelFailure: vi.fn(), recordNodeModelSuccess: vi.fn() }))
vi.mock('../../../../config/useModelOptions', () => ({ preloadModelOptions: async () => [] }))
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

const imageResult = (id: string): GenerationNodeResult => ({ id: 'result-' + id + '-' + Math.random(), type: 'image', url: 'https://fixture.invalid/' + id + '.png', createdAt: 1 })
const plan = (): StoryboardPlan => ({
  title: 'Lock', anchors: [{ id: 'actor', name: 'Actor', kind: 'character', carrier: 'visual', description: 'Actor' }],
  shots: [1, 2].map(index => ({ index, shotId: `shot-${index}`, shotKind: 'image' as const, durationSec: 2, anchorIds: ['actor'], prompt: `Actor walks ${index}` })),
})
const nodes = () => useGenerationCanvasStore.getState().nodes
const nodeOfShot = (shotId: string) => nodes().find(node => node.meta?.shotId === shotId) as GenerationCanvasNode
const sends = (shotId: string) => calls.execute.mock.calls.filter(([node]) => (node as GenerationCanvasNode).meta?.shotId === shotId).length

let session: ProjectSessionTestHarness
const confirmCards: unknown[] = []
const failures: unknown[] = []
beforeEach(async () => {
  vi.clearAllMocks()
  confirmCards.length = 0
  failures.length = 0
  calls.mint.mockReset().mockResolvedValue('approved')
  calls.consent.mockReset().mockImplementation(async (input: { shots: Array<{ runRecordId: string }> }) => input.shots.map(shot => `canvas-${shot.runRecordId}`))
  session = createProjectSessionTestHarness()
  await session.open('project-a')
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  useGenerationQueueStore.setState({ entries: [], batches: {} })
  useSpendConfirmStore.setState({ pending: null, queue: [], requestConfirm: async (request: unknown) => { confirmCards.push(request); return true } })
})
afterEach(() => { session.dispose(); vi.restoreAllMocks() })

function seed(current: StoryboardPlan) {
  useWorkbenchStore.setState({ activeDocumentId: 'doc', activeStoryboardId: 'design', storyboardDesignsByDocumentId: { doc: [{ id: 'design', plan: current, documentId: 'doc' } as never] } })
}
const readCurrentPlan = () => useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc[0].plan as StoryboardPlan
const rowsOf = (current: StoryboardPlan) => deriveStoryboardRowRuntimes({ plan: current, designId: 'design', nodes: nodes(), imageModelOptions: [], videoModelOptions: [] })

function holdAnchors() {
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  calls.execute.mockImplementation(async (node: GenerationCanvasNode) => {
    if (node.meta?.anchorId) await hold
    return imageResult(node.id)
  })
  return release
}

/** 编辑器上的同一套接线：整批 actionKey='table'，单行 actionKey='shot:<id>'，两者不互斥（本 PR 新增）。 */
function editor(current: StoryboardPlan) {
  const activeKeys = new Set<string>()
  const common = { projectId: 'project-a', documentId: 'doc', designId: 'design', plan: current, activeKeys, onPendingChange: () => undefined, onStart: () => undefined, onFailure: (error: unknown) => { failures.push(error) }, unavailable: (): never => { throw new Error('unavailable') } }
  return {
    runBatch: () => runStoryboardAction({ ...common, shotIds: current.shots.map(shot => shot.shotId!), actionKey: 'table', action: context => runStoryboardBatch(context, rowsOf(current)) }),
    clickRow: (shotId: string) => {
      const shot = current.shots.find(value => value.shotId === shotId)!
      return runStoryboardAction({ ...common, shotIds: [shotId], actionKey: `shot:${shotId}`, action: context => generateShotRow(context, shot, null) })
    },
  }
}

it('资产阶段单点一镜：跑完后批次第二阶段不得再发同一镜（合同 ★1 场景六、★4、B3、E4）', async () => {
  const current = plan(); seed(current)
  const release = holdAnchors()
  const ui = editor(current)
  const batch = ui.runBatch()
  await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
  expect((calls.execute.mock.calls[0][0] as GenerationCanvasNode).meta?.anchorId).toBe('actor')
  const cardsAfterFirst = confirmCards.length
  // 这一刻分镜行状态：确实可点（不是 generating / done），queue 里也没有这张镜头
  const row = rowsOf(readCurrentPlan()).find(value => value.shot.shotId === 'shot-2')!
  console.log('REPRO row status during asset phase =', row.exec.status)
  await ui.clickRow('shot-2')
  expect(sends('shot-2')).toBe(1)
  const firstResult = nodeOfShot('shot-2').result?.id
  console.log('REPRO after single click: sends=', sends('shot-2'), 'status=', nodeOfShot('shot-2').status)
  release()
  await batch
  console.log('REPRO after batch: sends(shot-1)=', sends('shot-1'), 'sends(shot-2)=', sends('shot-2'), 'confirmCards=', confirmCards.length - cardsAfterFirst, 'failures=', failures)
  console.log('REPRO result replaced =', nodeOfShot('shot-2').result?.id !== firstResult)
  expect(sends('shot-1')).toBe(1)
  expect(sends('shot-2')).toBe(1)
})

it('同一窗口·单点后还锁定了：批次第二阶段不得覆盖已锁定的结果', async () => {
  const { toggleNodeLock } = await import('./storyboardRowActions')
  const current = plan(); seed(current)
  const release = holdAnchors()
  const ui = editor(current)
  const batch = ui.runBatch()
  await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
  await ui.clickRow('shot-2')
  const firstResult = nodeOfShot('shot-2').result?.id
  toggleNodeLock(nodeOfShot('shot-2').id)
  release()
  await batch
  console.log('REPRO locked: sends(shot-2)=', sends('shot-2'), 'result replaced =', nodeOfShot('shot-2').result?.id !== firstResult)
  expect(sends('shot-2')).toBe(1)
  expect(nodeOfShot('shot-2').result?.id).toBe(firstResult)
})

it('同一窗口·已放进画布的镜头在画布上点 ↑（confirmAndRunNode，底线也有这条路）：批次第二阶段不得再发', async () => {
  const { confirmAndRunNode } = await import('../../../generationCanvas/runner/generationRunController')
  const current = plan(); seed(current)
  const placed = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: current.shots[1].prompt, meta: { storyboardDesignId: 'design', shotId: 'shot-2' } })
  const release = holdAnchors()
  const ui = editor(current)
  const batch = ui.runBatch()
  await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
  // 咽喉循环这一刻看不到它：镜头还没进队列
  console.log('REPRO queue entries for placed shot =', useGenerationQueueStore.getState().entries.filter(entry => entry.nodeId === placed.id).length)
  await confirmAndRunNode(placed.id, { initiator: 'user' })
  release()
  await batch
  console.log('REPRO canvas: sends(shot-2)=', sends('shot-2'))
  expect(sends('shot-2')).toBe(1)
})

it('对照·第二张卡路径：改了花钱口径走 itemized，单点过的已生成镜默认不勾，不会重发', async () => {
  const current = plan(); seed(current)
  const release = holdAnchors()
  const ui = editor(current)
  const batch = ui.runBatch()
  await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
  await ui.clickRow('shot-2')
  const latest = readCurrentPlan()
  useWorkbenchStore.getState().setStoryboardPlan({ ...latest, shots: latest.shots.map(shot => shot.shotId === 'shot-1' ? { ...shot, params: { resolution: '2k' } } : shot) }, 'doc', 'design')
  release()
  await batch
  console.log('REPRO itemized: sends(shot-1)=', sends('shot-1'), 'sends(shot-2)=', sends('shot-2'), 'cards=', confirmCards.length)
  expect(sends('shot-2')).toBe(1)
})

import { startGenerationFromComposer } from '../../../generationCanvas/nodes/composerRun'
import { runGroupGenerate } from '../../../generationCanvas/components/groupGenerate'
import { regenerateShotRow, toggleNodeLock } from './storyboardRowActions'
import { RecoverableTimeoutError } from '../../../generationCanvas/runner/recoverableTimeout'
import { isAnchorFrozen } from '../../../generationCanvas/model/anchorBibleKeys'

const entries = ['row', 'retry', 'canvas', 'list', 'group'] as const
const endings = ['success', 'running', 'error', 'recoverable', 'locked'] as const
it.each(entries.flatMap(entry => endings.map(ending => ({ entry, ending }))))('B6: $entry → $ending owns the confirmed shot before enqueue', async ({ entry, ending }) => {
  const current = plan(); seed(current)
  if (entry !== 'row') {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: current.shots[1].prompt, meta: { storyboardDesignId: 'design', shotId: 'shot-2' } })
    if (entry === 'retry') useGenerationCanvasStore.getState().setNodeStatus(node.id, 'error', 'Previous failure')
  }
  let releaseAnchor!: () => void, releaseTarget!: () => void
  const anchorHold = new Promise<void>(resolve => { releaseAnchor = resolve })
  const targetHold = new Promise<void>(resolve => { releaseTarget = resolve })
  calls.execute.mockImplementation(async (node: GenerationCanvasNode) => {
    if (node.meta?.anchorId) await anchorHold
    if (node.meta?.shotId === 'shot-2') {
      if (ending === 'running') await targetHold
      if (ending === 'error') throw new Error('429 concurrency limit exceeded')
      if (ending === 'recoverable') throw new RecoverableTimeoutError({ taskId: 'accepted', vendor: 'fixture', taskKind: 'text_to_image', modelKey: 'fixture-image' })
    }
    return imageResult(node.id)
  })
  const ui = editor(current), batch = ui.runBatch()
  await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
  let single: Promise<unknown> | undefined
  if (entry === 'row') single = ui.clickRow('shot-2')
  else if (entry === 'retry') single = runStoryboardAction({ projectId: 'project-a', documentId: 'doc', designId: 'design', plan: current, shotIds: ['shot-2'], actionKey: 'retry:shot-2', activeKeys: new Set(), onPendingChange: () => {}, onStart: () => {}, onFailure: error => { failures.push(error) }, unavailable: () => { throw new Error('unavailable') }, action: ctx => regenerateShotRow(ctx, current.shots[1], nodeOfShot('shot-2'), null) })
  else if (entry === 'group') expect(runGroupGenerate([nodeOfShot('shot-2').id])).toBe('started')
  else single = startGenerationFromComposer(nodeOfShot('shot-2'), false)
  await vi.waitFor(() => expect(sends('shot-2')).toBe(1))
  if (ending !== 'running') {
    if (single) await single
    await vi.waitFor(() => expect(nodeOfShot('shot-2').status).toBe(ending === 'locked' ? 'success' : ending))
  }
  if (ending === 'locked') toggleNodeLock(nodeOfShot('shot-2').id)
  const owned = structuredClone(nodeOfShot('shot-2'))
  releaseAnchor()
  try {
    await vi.waitFor(() => expect(sends('shot-1')).toBe(1))
    // Let the shared batch finish admitting its other shot before unblocking the independent run.
    await vi.waitFor(() => expect(nodeOfShot('shot-1').status).toBe('success'))
  } finally { releaseTarget() }
  await batch
  if (single) await single
  await vi.waitFor(() => expect(Object.values(useGenerationQueueStore.getState().batches).every(b => b.finishedAt)).toBe(true))
  expect(sends('shot-2')).toBe(1)
  expect(nodeOfShot('shot-2').runs?.map(r => r.id)).toEqual(owned.runs?.map(r => r.id))
  if (ending !== 'running') expect(nodeOfShot('shot-2').result).toEqual(owned.result)
  if (ending === 'locked') expect(isAnchorFrozen(nodeOfShot('shot-2'))).toBe(true)
  expect(failures).toEqual([])
})

it.each(['main', 'keyframe'] as const)('B6: taking over the %s with a run excludes the entire keyframe/main shot', async part => {
  const current = plan(); current.shots[1] = { ...current.shots[1], shotKind: 'video', keyframe: { enabled: true } }; seed(current)
  const main = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'main', meta: { storyboardDesignId: 'design', shotId: 'shot-2' } })
  const key = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'key', meta: { storyboardDesignId: 'design', shotId: 'shot-2', storyboardKeyframe: true } })
  const release = holdAnchors(), batch = editor(current).runBatch()
  await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
  await startGenerationFromComposer(part === 'main' ? main : key, false)
  const owned = structuredClone(nodes().filter(n => n.id === main.id || n.id === key.id))
  release(); await batch
  expect(calls.execute.mock.calls.filter(([n]) => n.id === (part === 'main' ? key.id : main.id))).toHaveLength(0)
  expect(nodes().filter(n => n.id === main.id || n.id === key.id).map(n => n.runs)).toEqual(owned.map(n => n.runs))
})

it('B6: a previously completed shot explicitly checked on the first card still reruns', async () => {
  const current = plan(); seed(current)
  const n = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: current.shots[1].prompt, meta: { storyboardDesignId: 'design', shotId: 'shot-2' } })
  useGenerationCanvasStore.getState().appendNodeRun(n.id, { id: 'before-confirmation', status: 'success' })
  useGenerationCanvasStore.getState().addNodeResult(n.id, imageResult('before'))
  const release = holdAnchors(), batch = editor(current).runBatch()
  await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1)); release(); await batch
  expect(sends('shot-2')).toBe(1)
  expect(nodeOfShot('shot-2').runs?.[0].id).not.toBe('before-confirmation')
})

import { createStoryboardActionGuard } from './storyboardActionGuard'
it.each(['user', 'agent'] as const)('B6: %s uses the same ownership filter for a changed-price second card', async initiator => {
  const current = plan(); current.shots.push({ ...current.shots[0], index: 3, shotId: 'shot-3' }); seed(current)
  const guard = createStoryboardActionGuard({ plan: current, designId: 'design', shotIds: current.shots.map(s => s.shotId!), readPlan: async () => readCurrentPlan(), writePlan: next => useWorkbenchStore.getState().setStoryboardPlan(next, 'doc', 'design') })
  const release = holdAnchors(), onConsented = vi.fn()
  const batch = runStoryboardBatch({ initiator, documentId: 'doc', designId: 'design', plan: current, actionGuard: guard, assertCurrent: () => guard.assertCurrent(), assertAuthorCurrent: guard.assertAuthorCurrent }, rowsOf(current), undefined, onConsented)
  await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
  await editor(current).clickRow('shot-2')
  const owned = structuredClone(nodeOfShot('shot-2'))
  const latest = readCurrentPlan()
  useWorkbenchStore.getState().setStoryboardPlan({ ...latest, shots: latest.shots.map(s => s.shotId === 'shot-1' ? { ...s, params: { resolution: '4k' } } : s) }, 'doc', 'design')
  release(); await batch
  expect(sends('shot-1')).toBe(1); expect(sends('shot-3')).toBe(1); expect(sends('shot-2')).toBe(1)
  expect(nodeOfShot('shot-2').result).toEqual(owned.result)
  expect(confirmCards).toHaveLength(2)
  const last = confirmCards[1] as { planRows: Array<{ id: string }> }
  expect(last.planRows.map(r => r.id)).toHaveLength(2)
  expect(last.planRows.map(r => r.id)).not.toContain(owned.id)
  expect(onConsented).toHaveBeenCalledOnce()
  expect(onConsented.mock.calls[0][0]).not.toContain(owned.id)
})

it('B6: placing an unrun node during the asset phase does not claim its generation', async () => {
  const current = plan(); seed(current)
  const release = holdAnchors(), batch = editor(current).runBatch()
  await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
  const placed = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: current.shots[1].prompt, meta: { storyboardDesignId: 'design', shotId: 'shot-2' } })
  release(); await batch
  expect(nodeOfShot('shot-2').id).toBe(placed.id)
  expect(sends('shot-2')).toBe(1)
})

it.each(['running', 'queued', 'recoverable', 'locked'] as const)('B6: %s without a new run identity still withdraws the whole shot', async state => {
  const current = plan(); seed(current)
  const n = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: current.shots[1].prompt, meta: { storyboardDesignId: 'design', shotId: 'shot-2' } })
  useGenerationCanvasStore.getState().appendNodeRun(n.id, { id: 'prior-result', status: 'success' })
  useGenerationCanvasStore.getState().addNodeResult(n.id, imageResult('prior'))
  const release = holdAnchors(), batch = editor(current).runBatch()
  await vi.waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1))
  if (state === 'locked') toggleNodeLock(n.id)
  else if (state === 'queued') useGenerationQueueStore.getState().enqueueBatch([[n.id]], 'project-a')
  else useGenerationCanvasStore.getState().setNodeStatus(n.id, state)
  const owned = structuredClone(nodeOfShot('shot-2'))
  release(); await batch
  expect(sends('shot-1')).toBe(1); expect(sends('shot-2')).toBe(0)
  expect(nodeOfShot('shot-2').result).toEqual(owned.result)
  expect(nodeOfShot('shot-2').runs?.[0].id).toBe('prior-result')
})
