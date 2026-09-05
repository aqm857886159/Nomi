import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_READ_CAPABILITY } from '../../../../electron/shared/agentCapabilities/canvasRead'
import type { ToolCallEvent } from '../../ai/workbenchAgentRunner'
import { captureCanvasReadResult } from './canvasReadResultSeal'

const deps = vi.hoisted(() => ({
  send: vi.fn(),
  apply: vi.fn(),
  read: vi.fn(),
  lockContext: vi.fn(),
  activeProjectId: 'A' as string | null,
  uiTitle: 'different UI plan',
}))
vi.mock('./generationCanvasAgentClient', () => ({ sendGenerationCanvasAgentMessage: deps.send }))
vi.mock('./generationCanvasTools', () => ({ readGenerationCanvasSnapshot: deps.read }))
vi.mock('./applyCanvasToolCall', () => ({ applyCanvasToolCall: deps.apply }))
vi.mock('./gate', () => ({ evaluateGate: () => ({ outcome: 'allow' }) }))
vi.mock('./lockGateContext', () => ({ buildLockGateContext: deps.lockContext }))
vi.mock('../../project/workbenchProjectSession', () => ({ getActiveWorkbenchProjectId: () => deps.activeProjectId }))
import { runStoryboardPlanner } from './runStoryboardPlanner'

const plan = {
  title: 'this operation',
  anchors: [],
  shots: [{ index: 1, durationSec: 3, anchorIds: [], prompt: 'rain' }],
}
const capturedCanvasReadSnapshot = Object.freeze({
  version: 1 as const,
  handleId: 'captured-a',
  nonce: 'captured-nonce-a',
})
const base = () => ({ storyText: 'story', projectId: 'A', target: 'creation' as const, canWrite: () => true })

beforeEach(() => {
  vi.clearAllMocks()
  deps.activeProjectId = 'A'
  deps.read.mockReturnValue({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  deps.lockContext.mockReturnValue({})
  deps.uiTitle = 'different UI plan'
  deps.apply.mockImplementation(async (_name, args) => {
    deps.uiTitle = args.title
    return { status: 'applied', documentId: 'doc-1', storyboardDesignId: 'storyboard-1', message: 'ok' }
  })
  deps.send.mockResolvedValue({ response: { text: 'answer', status: 'finished' } })
})

describe('storyboard planner scope and projection', () => {
  it('inline planner inherits the creation thread and grants only storyboard capability', async () => {
    const input = {
      ...base(),
      turnId: 'turn-creation-preallocated',
      displayPrompt: '拆成镜头',
      skill: { key: 'brand.promo', name: 'custom method' },
    }
    await runStoryboardPlanner(input)
    expect(deps.send.mock.calls[0][0]).toMatchObject({
      turnId: input.turnId,
      displayMessage: input.displayPrompt,
      projectId: 'A',
      capability: 'storyboard',
    })
  })

  it('fails closed if a main-owned read unexpectedly reaches the creation renderer callback', async () => {
    deps.read.mockReturnValue({
      nodes: [{ id: 'node-a', kind: 'image', title: 'Launch A', prompt: 'prompt', position: { x: 0, y: 0 } }],
      edges: [],
      groups: [],
      selectedNodeIds: ['node-a'],
    })
    const confirm = vi.fn(async (_decision: unknown) => {})
    deps.send.mockImplementation(async (input: { onToolCall: (event: ToolCallEvent) => void | Promise<void> }) => {
      await input.onToolCall({
        turnId: 'turn-storyboard-test',
        executionToken: 'execution-storyboard-test',
        toolCallId: 'read-live',
        toolName: CANVAS_READ_CAPABILITY.aliases.pi,
        args: {},
        isPending: () => true,
        confirm,
      })
      return { response: { text: 'answer', status: 'finished' } }
    })

    await runStoryboardPlanner(base())
    expect(deps.read).toHaveBeenCalledTimes(1)
    expect(deps.lockContext).not.toHaveBeenCalled()
    expect(deps.apply).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        denied: true,
      }),
    )
  })

  it('fails closed if a main-owned read unexpectedly reaches the production renderer callback', async () => {
    deps.read.mockReturnValue({
      nodes: [{ id: 'node-b', kind: 'image', title: 'Later live B', position: { x: 0, y: 0 } }],
      edges: [],
      groups: [],
    })
    const confirm = vi.fn(async (_decision: unknown) => {})
    deps.send.mockImplementation(async (input: { onToolCall: (event: ToolCallEvent) => void | Promise<void> }) => {
      deps.activeProjectId = 'B'
      await input.onToolCall({
        turnId: 'turn-storyboard-test',
        executionToken: 'execution-storyboard-test',
        toolCallId: 'read-captured',
        toolName: CANVAS_READ_CAPABILITY.aliases.pi,
        args: {},
        isPending: () => true,
        confirm,
      })
      return { response: { text: 'answer', status: 'finished' } }
    })
    const snapshot = captureCanvasReadResult({
      nodes: [
        {
          id: 'node-a',
          kind: 'image' as const,
          title: 'Captured A',
          prompt: 'safe prompt',
          position: { x: 0, y: 0 },
          result: { id: 'result-a', type: 'image' as const, url: 'https://secret.invalid/result.png', createdAt: 1 },
        },
      ],
      edges: [],
      groups: [],
      selectedNodeIds: [],
    })

    await runStoryboardPlanner({
      ...base(),
      target: 'production',
      snapshot,
      capturedCanvasReadSnapshot,
    })
    expect(deps.read).not.toHaveBeenCalled()
    expect(deps.apply).not.toHaveBeenCalled()
    const decision = confirm.mock.calls[0]![0]
    expect(decision).toMatchObject({ ok: false, denied: true })
  })

  it('production returns its own parsed plan and never steals the current UI plan or view', async () => {
    const confirm = vi.fn(async (_decision: unknown) => {})
    deps.send.mockImplementation(async (input: { onToolCall: (event: ToolCallEvent) => void | Promise<void> }) => {
      deps.uiTitle = 'project B after async switch'
      await input.onToolCall({
        turnId: 'turn-storyboard-test',
        executionToken: 'execution-storyboard-test',
        toolCallId: 'proposal',
        toolName: 'propose_storyboard_plan',
        args: plan,
        isPending: () => true,
        confirm,
      })
      await vi.waitFor(() => expect(confirm).toHaveBeenCalled())
      return { response: { text: 'my plan', status: 'finished' } }
    })
    const input = {
      ...base(),
      target: 'production' as const,
      snapshot: captureCanvasReadResult({ nodes: [], edges: [], groups: [], selectedNodeIds: [] }),
      capturedCanvasReadSnapshot,
      featureKey: 'nomi:production-planner:A:run-1:plan',
    }
    const result = await runStoryboardPlanner(input)
    expect(result).toEqual({ text: 'my plan', status: 'finished', plan })
    expect(deps.apply).not.toHaveBeenCalled()
    expect(deps.uiTitle).toBe('project B after async switch')
    expect(deps.send.mock.calls[0][0]).toMatchObject({
      capability: 'storyboard',
      featureKey: input.featureKey,
    })
    expect(deps.send.mock.calls[0][0]).toMatchObject({ capturedCanvasReadSnapshot })
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ ok: true, silent: true }))
  })

  it('cancelled planner remains cancelled instead of reporting plan complete', async () => {
    deps.send.mockResolvedValue({ response: { text: 'partial', status: 'cancelled' } })
    expect(await runStoryboardPlanner(base())).toEqual({ text: 'partial', status: 'cancelled' })
  })

  it('returns the exact design application accepted by the creation store', async () => {
    const confirm = vi.fn(async () => {})
    deps.send.mockImplementation(async (input: { onToolCall: (event: ToolCallEvent) => void | Promise<void> }) => {
      await input.onToolCall({ turnId: 'turn-storyboard-test', toolCallId: 'proposal', toolName: 'propose_storyboard_plan', args: plan, isPending: () => true, confirm })
      return { response: { text: 'done', status: 'finished' } }
    })

    await expect(runStoryboardPlanner(base())).resolves.toMatchObject({
      plan,
      application: { status: 'applied', documentId: 'doc-1', storyboardDesignId: 'storyboard-1' },
    })
  })

  it('reports an obsolete revision without presenting the late plan as applied', async () => {
    const confirm = vi.fn(async () => {})
    deps.apply.mockResolvedValue({ status: 'obsolete', documentId: 'doc-1', storyboardDesignId: 'deleted', message: 'obsolete' })
    deps.send.mockImplementation(async (input: { onToolCall: (event: ToolCallEvent) => void | Promise<void> }) => {
      await input.onToolCall({ turnId: 'turn-storyboard-test', toolCallId: 'proposal', toolName: 'propose_storyboard_plan', args: plan, isPending: () => true, confirm })
      return { response: { text: 'done', status: 'finished' } }
    })

    const result = await runStoryboardPlanner(base())
    expect(result.plan).toBeUndefined()
    expect(result.application).toMatchObject({ status: 'obsolete', storyboardDesignId: 'deleted' })
  })

  it('a stopped parent turn cannot apply or approve a late plan', async () => {
    const confirm = vi.fn(async (_decision: unknown) => {})
    let writable = true
    deps.send.mockImplementation(async (input: { onToolCall: (event: ToolCallEvent) => void | Promise<void> }) => {
      writable = false
      await input.onToolCall({
        turnId: 'turn-storyboard-test',
        executionToken: 'execution-storyboard-test',
        toolCallId: 'late-plan',
        toolName: 'propose_storyboard_plan',
        args: plan,
        isPending: () => true,
        confirm,
      })
      await vi.waitFor(() => expect(confirm).toHaveBeenCalled())
      return { response: { text: '', status: 'cancelled' } }
    })
    await runStoryboardPlanner({ ...base(), canWrite: () => writable })
    expect(deps.apply).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ ok: false, denied: true }))
  })
})
