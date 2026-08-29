import { beforeEach, describe, expect, it, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  project: 'A',
  send: vi.fn(),
  frame: vi.fn(),
  planner: vi.fn(),
  landing: vi.fn(),
  captureSurface: vi.fn(),
  sealSurfaceSnapshot: vi.fn(),
}))
vi.mock('./workbenchAgentRunner', () => ({ runWorkbenchAgent: deps.send }))
vi.mock('../windowUrlParam', () => ({ readWindowUrlParam: () => deps.project }))
vi.mock('../project/workbenchProjectSession', () => ({ getActiveWorkbenchProjectId: () => deps.project }))
vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: () => ({ video: { extractFrame: deps.frame } }) }))
vi.mock('../generationCanvas/agent/runStoryboardPlanner', () => ({ runStoryboardPlanner: deps.planner }))
vi.mock('../capability/multiShotCanvasLanding', () => ({ handleMultiShotCanvasLandingOp: deps.landing }))
vi.mock('../project/projectCanvasReadSurface', () => ({
  captureCurrentProjectCanvasReadSurfaceBinding: deps.captureSurface,
  sealCurrentProjectCanvasReadSnapshot: deps.sealSurfaceSnapshot,
}))
import { runDirectionPlanner } from '../generationCanvas/agent/runDirectionPlanner'
import { makeShotVerifyDeps } from '../generationCanvas/agent/shotVerifyJudge'
import { handleCapabilityApply } from '../capability/capabilityApplyHandler'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'

const plan = { title: 'this operation', anchors: [], shots: [{ index: 1, shotId: 'shot-1', shotKind: 'video' as const, durationSec: 3, anchorIds: [], prompt: 'rain' }] }
const candidates = [{ key: 'a', title: 'first', oneLiner: 'one' }, { key: 'b', title: 'second', oneLiner: 'two' }]
const snapshot = (id: string) => ({
  nodes: [{ id, title: id, kind: 'image' as const, prompt: id, position: { x: 0, y: 0 } }],
  edges: [],
  groups: [],
  selectedNodeIds: [id],
})

beforeEach(() => {
  vi.clearAllMocks()
  deps.project = 'A'
  deps.landing.mockResolvedValue(null)
  deps.captureSurface.mockReturnValue({
    version: 1,
    bindingId: 'binding-A',
    binding: { projectId: 'A', immutableProjectUuid: 'uuid-A', projectGeneration: 1 },
    webContentsId: 1,
    processId: 2,
    frameRoutingId: 3,
    origin: 'file://',
    surfaceInstanceId: 'surface-A',
    portRevision: 1,
    nonce: 'binding-nonce-A',
  })
  deps.sealSurfaceSnapshot.mockResolvedValue({
    version: 1,
    handleId: 'captured-A',
    nonce: 'captured-nonce-A',
  })
  deps.send.mockResolvedValue({ id: 'r', status: 'finished', text: 'actual', toolCalls: [], artifacts: [], finishReason: 'stop',
    usage: { promptTokens: 2, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 3 } })
  useGenerationCanvasStore.getState().restoreSnapshot(snapshot('A-node'))
  useGenerationCanvasStore.setState({ selectedNodeIds: ['A-node'] })
  useWorkbenchStore.setState({ storyboardPlans: { 'doc-a': { plan: { ...plan, title: 'unrelated UI plan' }, committed: false } }, workspaceMode: 'creation' })
})

describe('remaining production callers use the explicit shared Agent profile', () => {
  it('direction uses the supplied project, one-shot ephemeral history and original domain parsing', async () => {
    deps.send.mockResolvedValueOnce({ text: JSON.stringify({ candidates }) })
    deps.project = 'different-ui-project'
    expect(await runDirectionPlanner({ projectId: 'explicit-project', brief: { goal: 'launch goal' } })).toEqual({ candidates })
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'explicit-project', featureKey: 'nomi:production-directions:explicit-project',
      capability: 'single-shot', history: { kind: 'ephemeral' },
    }))
  })

  it('shot verification captures project before frame extraction and keeps its image attached', async () => {
    let release!: (value: { url: string }) => void
    deps.frame.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    const judge = makeShotVerifyDeps()
    const extracting = judge.extractFrame('nomi-local://video')
    deps.project = 'B'
    release({ url: 'nomi-local://frame-A' })
    await judge.judge('check A', await extracting)
    expect(deps.frame).toHaveBeenCalledWith({ videoUrl: 'nomi-local://video', which: 'first', projectId: 'A' })
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'A', featureKey: 'nomi:shot-verify:A',
      capability: 'single-shot', history: { kind: 'ephemeral' }, attachments: [
        { url: 'nomi-local://frame-A', contentType: 'image/png', fileName: 'shot-frame.png', kind: 'image' },
      ],
    }))
  })

  it.each(['production.plan-script', 'production.revise-script', 'production.revise-storyboard'])('%s uses ephemeral zero-tool text capability', async (operation) => {
    deps.send.mockResolvedValueOnce({ text: operation.endsWith('storyboard') ? JSON.stringify(plan) : 'actual script' })
    const result = await handleCapabilityApply(operation, { projectId: 'A', runId: 'run-A', brief: { goal: 'goal' }, sourceContent: 'source', instruction: 'revise' })
    expect(result).toEqual(operation.endsWith('storyboard') ? { plan } : { text: 'actual script' })
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'A', capability: 'single-shot',
      featureKey: 'nomi:production-script:A', history: { kind: 'ephemeral' },
    }))
  })

  it('production storyboard keeps the launch snapshot/run attribution and returns its own plan after UI project changes', async () => {
    let release!: () => void
    deps.landing.mockReturnValueOnce(new Promise((resolve) => { release = () => resolve(null) }))
    deps.planner.mockResolvedValueOnce({ status: 'finished', text: 'own text', plan })
    const pending = handleCapabilityApply('production.plan-storyboard', { projectId: 'A', runId: 'run-A', operationId: 'operation-A', brief: { goal: 'goal' } })
    expect(deps.captureSurface).toHaveBeenCalledOnce()
    expect(deps.sealSurfaceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ binding: expect.objectContaining({ projectId: 'A' }) }),
      expect.objectContaining({
        nodes: [expect.objectContaining({ id: 'A-node', title: 'A-node' })],
        selectedNodeIds: [],
      }),
    )
    expect(deps.landing).not.toHaveBeenCalled()
    deps.project = 'B'
    useGenerationCanvasStore.getState().restoreSnapshot(snapshot('B-node'))
    useWorkbenchStore.setState({ storyboardPlans: { 'doc-a': { plan: { ...plan, title: 'B plan' }, committed: false } } })
    release()
    expect(await pending).toEqual({ text: 'own text', plan })
    expect(deps.planner).toHaveBeenCalledWith(expect.objectContaining({ target: 'production', projectId: 'A',
      history: { kind: 'ephemeral' }, featureKey: 'nomi:production-planner:A:run-A:operation-A',
      snapshot: expect.objectContaining({
        nodes: [expect.objectContaining({ id: 'A-node' })],
        selectedNodeIds: [],
      }),
      capturedCanvasReadSnapshot: { version: 1, handleId: 'captured-A', nonce: 'captured-nonce-A' },
    }))
    expect(deps.planner.mock.calls[0]![0].snapshot).toBe(deps.sealSurfaceSnapshot.mock.calls[0]![1])
    expect(useWorkbenchStore.getState()).toMatchObject({ workspaceMode: 'creation', storyboardPlans: { 'doc-a': { plan: { title: 'B plan' } } } })
    expect(useGenerationCanvasStore.getState().nodes[0].id).toBe('B-node')
  })
})
