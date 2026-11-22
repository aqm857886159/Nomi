// 分镜批量「这一批生成谁」：真实 runStoryboardBatch → confirmStoryboardPlanBatch（读卡上的行）→ confirmAndRunPlan → 咽喉；
// 只假执行器、主进程 IPC 与付费卡的点击。成员由共用主人（generationShotScope）定，这里钉入口读到的结论。
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { runStoryboardBatch } from './storyboardRowActions'
import { deriveStoryboardRowRuntimes } from './storyboardRowStatus'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { useGenerationQueueStore } from '../../../generationCanvas/runner/generationQueueStore'
import { useSpendConfirmStore } from '../../../generationCanvas/spend/spendConfirm'
import { useWorkbenchStore } from '../../../workbenchStore'
import { withCanvasGestureContext, type CanvasGestureContext } from '../../../generationCanvas/events/canvasGestureContext'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../../project/projectSessionTestHarness'
import type { GenerationCanvasNode, GenerationNodeResult } from '../../../generationCanvas/model/generationCanvasTypes'
import type { StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import type { PlanRow } from '../../../shared/PlanRows'

const calls = vi.hoisted(() => ({ execute: vi.fn(), consent: vi.fn(), open: vi.fn() }))
vi.mock('../../../../desktop/bridge', () => ({ getDesktopBridge: () => ({ projects: { applyCanvasNodePatch: vi.fn(async () => ({ applied: true })) } }) }))
vi.mock('../../../library/localProjectStore', () => ({
  readLocalProjectAsync: async () => null,
  saveLocalProject: async (id: string, payload: unknown, name: string) => ({ id, name, version: 1, payload }),
}))
vi.mock('../../../api/taskApi', () => ({ canvasOpenRuns: calls.open, mintSpendGrant: vi.fn(async () => 'approved'), consentCanvasShots: calls.consent, withdrawCanvasShots: vi.fn(), releaseCanvasShotRun: vi.fn(async () => undefined) }))
vi.mock('../../../generationCanvas/runner/generationNodeExecutor', () => ({ generationNodeExecutor: calls.execute }))
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

const result = (id: string): GenerationNodeResult => ({ id: `result-${id}`, type: 'image', url: `https://fixture.invalid/${id}.png`, createdAt: 1 })

let session: ProjectSessionTestHarness
const cards: Array<{ planRows?: readonly PlanRow[] }> = []
beforeEach(async () => {
  vi.clearAllMocks()
  cards.length = 0
  calls.open.mockReset().mockResolvedValue([])
  calls.consent.mockReset().mockImplementation(async (input: { shots: Array<{ runRecordId: string }> }) => input.shots.map(shot => `canvas-${shot.runRecordId}`))
  calls.execute.mockReset().mockImplementation(async (node: GenerationCanvasNode) => [result(node.id)])
  session = createProjectSessionTestHarness()
  await session.open('project-a')
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  useGenerationQueueStore.setState({ entries: [], batches: {} })
  // 卡开了就点「取消」：这里只读卡上的行，不跑。
  useSpendConfirmStore.setState({ pending: null, queue: [], requestConfirm: async (request: { planRows?: readonly PlanRow[] }) => { cards.push(request); return false } })
})
afterEach(() => { session.dispose(); vi.restoreAllMocks() })

function seed(current: StoryboardPlan) {
  useWorkbenchStore.setState({ activeDocumentId: 'doc', activeStoryboardId: 'design', storyboardDesignsByDocumentId: { doc: [{ id: 'design', plan: current, documentId: 'doc', title: 'design', committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 } as never] } })
}
const rowsOf = (current: StoryboardPlan) => deriveStoryboardRowRuntimes({ plan: current, designId: 'design', nodes: useGenerationCanvasStore.getState().nodes, imageModelOptions: [], videoModelOptions: [] })
const context = (current: StoryboardPlan) => ({ documentId: 'doc', designId: 'design', plan: current, initiator: 'user' as const })
const anchorRows = () => (cards[0]?.planRows ?? []).filter(row => row.id?.startsWith('anchor:')).map(row => row.id)

function anchorNode(anchorId: string, patch: Partial<GenerationCanvasNode>): void {
  const store = useGenerationCanvasStore.getState()
  const id = store.addNode({ kind: 'image', prompt: anchorId, meta: { storyboardDesignId: 'design', anchorId, referenceSheet: true } }).id
  store.updateNode(id, patch)
}

const twoAnchors = (prompt: string): StoryboardPlan => ({
  title: 'Scope',
  anchors: [
    { id: 'hero', name: 'Hero', kind: 'character', carrier: 'visual', description: 'Hero' },
    { id: 'castle', name: 'Castle', kind: 'scene', carrier: 'visual', description: 'Castle' },
  ],
  shots: [{ index: 1, shotId: 'shot-1', shotKind: 'image', durationSec: 2, anchorIds: ['hero', 'castle'], prompt }],
})

it('可找回的参考卡不进分镜批量卡（已经付过钱，出路是免费找回）——旧漏洞：只看有没有图，会列进来再付一次', async () => {
  const current = twoAnchors('Hero walks into the Castle')
  seed(current)
  anchorNode('hero', { status: 'recoverable', error: 'poll timed out' })
  await runStoryboardBatch(context(current), rowsOf(current))
  expect(cards).toHaveLength(1)
  expect(anchorRows()).toEqual(['anchor:castle'])
})

it('已出图的参考卡、生成中的参考卡不进分镜批量卡', async () => {
  const current = twoAnchors('Hero walks into the Castle')
  seed(current)
  anchorNode('hero', { status: 'success', result: result('hero') })
  anchorNode('castle', { status: 'running' })
  await runStoryboardBatch(context(current), rowsOf(current))
  expect(anchorRows()).toEqual([])
})

// 参考卡波次（anchor-wave）的「空闲有结果」格 = 不上卡：出过图、之后回到空闲的参考卡，分镜批量照旧不算它（「生成未生成的」），要重做得单发。
it('出过图、现在空闲的参考卡不进分镜批量卡（照今天的样子）', async () => {
  const current = twoAnchors('Hero walks into the Castle')
  seed(current)
  anchorNode('hero', { status: 'idle', result: result('hero') })
  await runStoryboardBatch(context(current), rowsOf(current))
  expect(anchorRows()).toEqual(['anchor:castle'])
})

// 定妆（meta.frozen）照旧：定了妆的参考卡不再进批量卡重跑（原判据 `!card.locked`，现由主人的「已有结果」格子给出同一结论）。
it('定了妆的参考卡不进分镜批量卡（定妆规则行为不变）', async () => {
  const current = twoAnchors('Hero walks into the Castle')
  seed(current)
  anchorNode('hero', { status: 'success', result: result('hero'), meta: { storyboardDesignId: 'design', anchorId: 'hero', referenceSheet: true, frozen: { at: 1, by: 'user' } } as never })
  await runStoryboardBatch(context(current), rowsOf(current))
  expect(anchorRows()).toEqual(['anchor:castle'])
})

// 已知问题（现状钉住，另做）：参考卡成员按 anchorIds 算；这一镜提示词里没提它的名字时，它出图后自动引用不会把它绑进任何一镜
// （storyboardAutoReference 按名字补），所以这一份钱白花。改法另议，这里只钉住今天的行为，改了这条会红、提醒去看待办。
it('已知问题：anchorIds 里有、提示词没提名字的参考卡仍被列进批量卡（出图后不会被绑进任何一镜）', async () => {
  const current = twoAnchors('Hero stands alone in a field')
  seed(current)
  await runStoryboardBatch(context(current), rowsOf(current))
  expect(anchorRows()).toEqual(['anchor:hero', 'anchor:castle'])
})
