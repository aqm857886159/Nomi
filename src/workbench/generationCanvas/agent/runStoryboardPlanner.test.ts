import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolCallEvent } from '../../ai/workbenchAgentRunner'

const deps = vi.hoisted(() => ({ send: vi.fn(), apply: vi.fn(), uiTitle: 'different UI plan' }))
vi.mock('./generationCanvasAgentClient', () => ({ sendGenerationCanvasAgentMessage: deps.send }))
vi.mock('./generationCanvasTools', () => ({ generationCanvasTools: { read_canvas: () => ({ nodes: [], edges: [], groups: [] }) } }))
vi.mock('./applyCanvasToolCall', () => ({ applyCanvasToolCall: deps.apply }))
vi.mock('./gate', () => ({ evaluateGate: () => ({ outcome: 'allow' }) }))
vi.mock('./lockGateContext', () => ({ buildLockGateContext: () => ({}) }))
import { runStoryboardPlanner } from './runStoryboardPlanner'

const plan = { title: 'this operation', anchors: [], shots: [{ index: 1, durationSec: 3, anchorIds: [], prompt: 'rain' }] }
const history = { kind: 'persistent' as const, binding: { sessionKey: 'nomi:workbench:A:creation', threadId: 'creation-thread' } }
const base = () => ({ storyText: 'story', projectId: 'A', history, target: 'creation' as const, canWrite: () => true })

beforeEach(() => {
  vi.clearAllMocks()
  deps.uiTitle = 'different UI plan'
  deps.apply.mockImplementation(async (_name, args) => {
    deps.uiTitle = args.title
    return { status: 'applied', documentId: 'doc-1', storyboardDesignId: 'storyboard-1', message: 'ok' }
  })
  deps.send.mockResolvedValue({ response: { text: 'answer', status: 'finished' } })
})

describe('storyboard planner scope and projection', () => {
  it('inline planner inherits the creation thread and grants only storyboard capability', async () => {
    const input = { ...base(), skill: { key: 'brand.promo', name: 'custom method' } }
    await runStoryboardPlanner(input)
    expect(deps.send.mock.calls[0][0]).toMatchObject({ history, projectId: 'A', capability: 'storyboard' })
  })

  it('production returns its own parsed plan and never steals the current UI plan or view', async () => {
    const confirm = vi.fn(async () => {})
    deps.send.mockImplementation(async (input: { onToolCall: (event: ToolCallEvent) => void | Promise<void> }) => {
      deps.uiTitle = 'project B after async switch'
      await input.onToolCall({ toolCallId: 'proposal', toolName: 'propose_storyboard_plan', args: plan, isPending: () => true, confirm })
      await vi.waitFor(() => expect(confirm).toHaveBeenCalled())
      return { response: { text: 'my plan', status: 'finished' } }
    })
    const input = { ...base(), target: 'production' as const, history: { kind: 'ephemeral' as const }, snapshot: { nodes: [], edges: [], groups: [] }, featureKey: 'nomi:production-planner:A:run-1:plan' }
    const result = await runStoryboardPlanner(input)
    expect(result).toEqual({ text: 'my plan', status: 'finished', plan })
    expect(deps.apply).not.toHaveBeenCalled()
    expect(deps.uiTitle).toBe('project B after async switch')
    expect(deps.send.mock.calls[0][0]).toMatchObject({ history: { kind: 'ephemeral' }, capability: 'storyboard', featureKey: input.featureKey })
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ ok: true, silent: true }))
  })

  it('cancelled planner remains cancelled instead of reporting plan complete', async () => {
    deps.send.mockResolvedValue({ response: { text: 'partial', status: 'cancelled' } })
    expect(await runStoryboardPlanner(base())).toEqual({ text: 'partial', status: 'cancelled' })
  })

  it('returns the exact design application accepted by the creation store', async () => {
    const confirm = vi.fn(async () => {})
    deps.send.mockImplementation(async (input: { onToolCall: (event: ToolCallEvent) => void | Promise<void> }) => {
      await input.onToolCall({ toolCallId: 'proposal', toolName: 'propose_storyboard_plan', args: plan, isPending: () => true, confirm })
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
      await input.onToolCall({ toolCallId: 'proposal', toolName: 'propose_storyboard_plan', args: plan, isPending: () => true, confirm })
      return { response: { text: 'done', status: 'finished' } }
    })

    const result = await runStoryboardPlanner(base())
    expect(result.plan).toBeUndefined()
    expect(result.application).toMatchObject({ status: 'obsolete', storyboardDesignId: 'deleted' })
  })

  it('a stopped parent turn cannot apply or approve a late plan', async () => {
    const confirm = vi.fn(async () => {})
    let writable = true
    deps.send.mockImplementation(async (input: { onToolCall: (event: ToolCallEvent) => void | Promise<void> }) => {
      writable = false
      await input.onToolCall({ toolCallId: 'late-plan', toolName: 'propose_storyboard_plan', args: plan, isPending: () => true, confirm })
      await vi.waitFor(() => expect(confirm).toHaveBeenCalled())
      return { response: { text: '', status: 'cancelled' } }
    })
    await runStoryboardPlanner({ ...base(), canWrite: () => writable })
    expect(deps.apply).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ ok: false, denied: true }))
  })
})
