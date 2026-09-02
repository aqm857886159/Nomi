import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentsChatResponseDto } from '../../../api/desktopClient'
import type { RunWorkbenchAgentInput, ToolCallEvent } from '../../ai/workbenchAgentRunner'
import type { TimelineClip } from '../../timeline/timelineTypes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
const deps = vi.hoisted(() => ({ run: vi.fn(), catalog: vi.fn(), clip: vi.fn() }))
vi.mock('../../ai/workbenchAgentRunner', () => ({ runWorkbenchAgent: deps.run }))
vi.mock('./availableModels', () => ({ listAvailableModelsForAgent: deps.catalog, formatAvailableModelsForPrompt: () => '' }))
vi.mock('../../timeline/buildGenerationNodeTimelineClip', () => ({ buildGenerationNodeTimelineClip: deps.clip }))
import { sendGenerationCanvasAgentMessage } from './generationCanvasAgentClient'
import { claimCanvasApprovalBatch, resolveCanvasApprovalSteps } from './canvasApprovalSteps'
import { applyProposalBatch } from './proposalTxn'
import { useCanvasTurnStore } from './canvasTurnController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { createDefaultTimeline } from '../../timeline/timelineMath'
import { releaseWorkbenchProjectRuntimeState } from '../../project/releaseWorkbenchProjectSession'
import { resetAdoptionRegistry } from '../../adoption/adoptionProposalRegistry'
import { setDesktopActiveProjectId } from '../../../desktop/activeProject'
import { __resetCanvasUndoJournalForTests, getHistoryFlags } from '../events/canvasUndoJournal'
import { setCanvasEventSinkForTests, type CanvasShadowEvent } from '../events/canvasEventEmitter'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
const node = (): GenerationCanvasNode => ({ id: 'existing', kind: 'video', title: 'original', prompt: 'original', position: { x: 0, y: 0 }, categoryId: 'shots', shotIndex: 1 })
const finished: AgentsChatResponseDto = { id: 'response', status: 'finished', text: 'done', toolCalls: [], artifacts: [], finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, totalTokens: 0 } }
const captured: CanvasShadowEvent[] = []

beforeEach(() => {
  vi.clearAllMocks()
  deps.catalog.mockResolvedValue([])
  setDesktopActiveProjectId('project-A')
  useCanvasTurnStore.getState().abandon()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node()], edges: [], groups: [] })
  useWorkbenchStore.setState({ timeline: createDefaultTimeline(), timelineUndoStack: [], timelineRedoStack: [] })
  __resetCanvasUndoJournalForTests()
  resetAdoptionRegistry()
  captured.length = 0
  setCanvasEventSinkForTests((events) => captured.push(...events))
})
afterEach(() => { useCanvasTurnStore.getState().abandon(); setDesktopActiveProjectId(null); setCanvasEventSinkForTests(null) })

async function startApprovalTurn() {
  const ready = deferred<void>()
  const completion = deferred<AgentsChatResponseDto>()
  let wire!: RunWorkbenchAgentInput
  const confirmTool = vi.fn(async (_toolCallId: string, _decision: Parameters<ToolCallEvent['confirm']>[0]) => {})
  const liveCalls = new Map<string, { pending: boolean; identity: object }>()
  let ended = false
  const expireAll = () => {
    ended = true
    for (const call of liveCalls.values()) call.pending = false
    liveCalls.clear()
  }
  const hostTurnId = 'host-approval-turn'
  const pending = new Map<string, ToolCallEvent>()
  const turn = useCanvasTurnStore.getState().begin()
  deps.run.mockImplementationOnce((input: RunWorkbenchAgentInput) => {
    wire = input
    wire.onCancelReady?.(expireAll)
    ready.resolve()
    return completion.promise.finally(expireAll)
  })
  const input = {
    message: 'edit the canvas', projectId: 'project-A', history: { kind: 'ephemeral' as const }, capability: 'canvas-agent' as const,
    snapshot: useGenerationCanvasStore.getState().readDocumentSnapshot(), selectedNodes: [], canWrite: turn.canWrite,
    onToolCall: (call: ToolCallEvent) => { pending.set(call.toolCallId, call) },
    onToolError: ({ toolCallId }: { toolCallId: string }) => { pending.delete(toolCallId) },
    onCancelReady: (cancel: () => void) => useCanvasTurnStore.getState().attachCancel(turn.id, cancel),
  }
  const running = sendGenerationCanvasAgentMessage(input)
  await ready.promise
  const emit = (event:
    | { event: 'content'; data: { delta: string } }
    | { event: 'tool-error'; data: { toolCallId: string; toolName: string; message: string; denied?: boolean; cancelled?: boolean } }
    | { event: 'done'; data: { reason: 'finished' | 'cancelled' | 'error' } }
    | { event: 'error'; data: { message: string } }
    | { event: 'result'; data: { response: AgentsChatResponseDto } }) => {
    if (event.event === 'content') wire.onContent?.(event.data.delta, event.data.delta)
    else if (event.event === 'tool-error') {
      const live = liveCalls.get(event.data.toolCallId)
      if (live) live.pending = false
      liveCalls.delete(event.data.toolCallId)
      wire.onToolError?.(event.data)
    } else if (event.event === 'done' || event.event === 'error' || event.event === 'result') expireAll()
  }
  const call = (id: string, toolName = 'set_node_prompt', args: unknown = { nodeId: 'existing', prompt: 'edited' }) => {
    if (ended) return
    const identity = {}
    const previous = liveCalls.get(id)
    if (previous) previous.pending = false
    const live = { pending: true, identity }
    liveCalls.set(id, live)
    const event: ToolCallEvent = {
      turnId: hostTurnId,
      toolCallId: id,
      toolName,
      args,
      isPending: () => !ended && live.pending && liveCalls.get(id)?.identity === identity,
      confirm: async (decision) => {
        if (!event.isPending()) throw new DOMException('Agent tool call is no longer pending', 'AbortError')
        live.pending = false
        liveCalls.delete(id)
        await confirmTool(id, decision)
      },
    }
    void wire.onToolCall?.(event)
  }
  const expire = (id: string) => emit({ event: 'tool-error', data: { toolCallId: id, toolName: 'set_node_prompt', message: 'confirmation timed out', denied: true } })
  const finish = async () => { completion.resolve(finished); await running }
  // The panel uses this same claim/preparation/executor pipeline. Only external
  // transport, model-catalog I/O and media probing are controlled by the test.
  const approve = async (ids: string[]) => {
    const approval = claimCanvasApprovalBatch(ids.map((toolCallId) => ({ toolCallId })), pending, turn, hostTurnId)
    if (!approval) return
    const steps = await resolveCanvasApprovalSteps(approval.rawSteps, approval.owner.canWrite)
    const outcome = await applyProposalBatch(steps, approval.owner)
    if (outcome.status === 'committed') {
      for (let index = 0; index < steps.length; index += 1) await steps[index].transport({ ok: true, result: outcome.results[index] })
    }
    return outcome
  }
  return { turn, pending, call, expire, approve, emit, finish, confirmTool }
}

describe('tool-call approval lifetime at real mutation boundaries', () => {
  it('tool-error followed by more streaming never lets the expired card mutate the canvas', async () => {
    const session = await startApprovalTurn()
    session.call('expired')
    session.expire('expired')
    session.emit({ event: 'content', data: { delta: 'I can try something else' } })
    expect(session.turn.canWrite()).toBe(true)
    await session.approve(['expired'])
    expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('original')
    expect(captured.some((event) => event.type === 'agent.txn.committed')).toBe(false)
    await session.finish()
  })

  it('expiry while approved model-catalog preparation is held causes zero final writes', async () => {
    const session = await startApprovalTurn()
    const catalog = deferred<[]>()
    deps.catalog.mockReturnValueOnce(catalog.promise)
    session.call('create', 'create_canvas_nodes', { nodes: [{ clientId: 'new', kind: 'image', title: 'late', prompt: 'late', modelKey: 'model-A' }] })
    const approval = session.approve(['create']).catch(() => undefined)
    session.expire('create')
    catalog.resolve([])
    await approval
    expect(useGenerationCanvasStore.getState().nodes.map((item) => item.id)).toEqual(['existing'])
    expect(captured.some((event) => event.type === 'agent.txn.committed')).toBe(false)
    await session.finish()
  })

  it('expiry during media probing never publishes a timeline or its undo record', async () => {
    const source = { ...node(), result: { id: 'result', type: 'video' as const, url: 'https://fixture.invalid/video.mp4', createdAt: 1 } }
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [source], edges: [], groups: [] })
    const session = await startApprovalTurn()
    const probing = deferred<TimelineClip>()
    const entered = deferred<void>()
    deps.clip.mockImplementationOnce(() => { entered.resolve(); return probing.promise })
    session.call('arrange', 'arrange_storyboard_to_timeline', { nodeIds: ['existing'] })
    const approval = session.approve(['arrange']).catch(() => undefined)
    await entered.promise
    session.expire('arrange')
    probing.resolve({ id: 'clip', type: 'video', sourceNodeId: source.id, label: 'late', url: source.result.url,
      startFrame: 0, endFrame: 24, frameCount: 24, offsetStartFrame: 0, offsetEndFrame: 0 })
    await approval
    expect(useWorkbenchStore.getState().timeline).toEqual(createDefaultTimeline())
    expect(useWorkbenchStore.getState().timelineUndoStack).toEqual([])
    expect(captured.some((event) => event.type === 'agent.txn.committed')).toBe(false)
    await session.finish()
  })

  it('a batch containing an expired call cannot silently approve only its remaining calls', async () => {
    const session = await startApprovalTurn()
    session.call('live')
    session.call('expired', 'set_node_prompt', { nodeId: 'existing', prompt: 'second' })
    session.expire('expired')
    await session.approve(['live', 'expired'])
    expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('original')
    expect(session.confirmTool).not.toHaveBeenCalled()
    await session.finish()
  })

  it('valid approval applies and confirms exactly once even if the user double-approves', async () => {
    const session = await startApprovalTurn()
    session.call('valid')
    const first = session.approve(['valid'])
    const second = session.approve(['valid'])
    await Promise.all([first, second])
    expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('edited')
    expect(session.confirmTool).toHaveBeenCalledTimes(1)
    expect(captured.filter((event) => event.type === 'agent.txn.committed')).toHaveLength(1)
    await session.finish()
  })

  it('a valid multi-call batch commits once before each call is independently confirmed', async () => {
    const session = await startApprovalTurn()
    session.call('first')
    session.call('second', 'set_node_prompt', { nodeId: 'existing', prompt: 'final edit' })
    expect((await session.approve(['first', 'second']))?.status).toBe('committed')
    expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('final edit')
    expect(session.confirmTool.mock.calls.map(([id]) => id)).toEqual(['first', 'second'])
    expect(captured.filter((event) => event.type === 'agent.txn.committed')).toHaveLength(1)
    await session.finish()
  })

  it.each(['edit', 'arrange', 'new-thread'] as const)('invalidation by %s during a later step rolls back the whole batch without a partial commit', async (expiredId) => {
    const source = { ...node(), result: { id: 'result', type: 'video' as const, url: 'https://fixture.invalid/video.mp4', createdAt: 1 } }
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [source], edges: [], groups: [] })
    const before = useGenerationCanvasStore.getState().readDocumentSnapshot()
    const session = await startApprovalTurn()
    const probing = deferred<TimelineClip>()
    const entered = deferred<void>()
    deps.clip.mockImplementationOnce(() => { entered.resolve(); return probing.promise })
    session.call('edit')
    session.call('arrange', 'arrange_storyboard_to_timeline', { nodeIds: ['existing'] })
    const approval = session.approve(['edit', 'arrange'])
    await entered.promise
    expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('edited')
    if (expiredId === 'new-thread') useCanvasTurnStore.getState().abandon()
    else session.expire(expiredId)
    probing.resolve({ id: 'clip', type: 'video', sourceNodeId: source.id, label: 'late', url: source.result.url,
      startFrame: 0, endFrame: 24, frameCount: 24, offsetStartFrame: 0, offsetEndFrame: 0 })
    expect((await approval)?.status).toBe('aborted')
    expect(useGenerationCanvasStore.getState().readDocumentSnapshot()).toEqual(before)
    expect(useWorkbenchStore.getState().timeline).toEqual(createDefaultTimeline())
    expect(useWorkbenchStore.getState().timelineUndoStack).toEqual([])
    expect(captured.some((event) => event.type === 'agent.txn.committed')).toBe(false)
    await session.finish()
  })

  it.each(['project-change', 'same-project-reload'] as const)('%s during a later step never compensates into the newly loaded canvas', async (action) => {
    const source = { ...node(), result: { id: 'result', type: 'video' as const, url: 'https://fixture.invalid/video.mp4', createdAt: 1 } }
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [source], edges: [], groups: [] })
    const session = await startApprovalTurn()
    const probing = deferred<TimelineClip>()
    const entered = deferred<void>()
    deps.clip.mockImplementationOnce(() => { entered.resolve(); return probing.promise })
    session.call('edit')
    session.call('arrange', 'arrange_storyboard_to_timeline', { nodeIds: ['existing'] })
    const approval = session.approve(['edit', 'arrange'])
    await entered.promise
    expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('edited')
    releaseWorkbenchProjectRuntimeState()
    if (action === 'project-change') setDesktopActiveProjectId('project-B')
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [{ ...source, prompt: 'loaded revision' }], edges: [], groups: [] })
    const before = useGenerationCanvasStore.getState().readDocumentSnapshot()
    captured.length = 0
    probing.resolve({ id: 'clip', type: 'video', sourceNodeId: source.id, label: 'late', url: source.result.url,
      startFrame: 0, endFrame: 24, frameCount: 24, offsetStartFrame: 0, offsetEndFrame: 0 })
    expect((await approval)?.status).toBe('aborted')
    expect(useGenerationCanvasStore.getState().readDocumentSnapshot()).toEqual(before)
    expect(useWorkbenchStore.getState().timeline).toEqual(createDefaultTimeline())
    expect(captured).toEqual([])
    await session.finish()
  })

  it.each([
    ['new-thread', 'existing'], ['new-thread', 'other'],
    ['same-turn', 'existing'], ['same-turn', 'other'],
    ['manual', 'existing'], ['manual', 'other'],
  ] as const)('an old aborted batch preserves a %s edit to %s and its clean Undo/Redo baseline', async (action, targetId) => {
    const source = { ...node(), result: { id: 'result', type: 'video' as const, url: 'https://fixture.invalid/video.mp4', createdAt: 1 } }
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [source, { ...node(), id: 'other', prompt: 'other original' }], edges: [], groups: [] })
    const old = await startApprovalTurn()
    const probing = deferred<TimelineClip>()
    const entered = deferred<void>()
    deps.clip.mockImplementationOnce(() => { entered.resolve(); return probing.promise })
    old.call('old-edit')
    old.call('old-arrange', 'arrange_storyboard_to_timeline', { nodeIds: ['existing'] })
    const oldApproval = old.approve(['old-edit', 'old-arrange'])
    await entered.promise
    if (action === 'new-thread') useCanvasTurnStore.getState().abandon()
    const replacement = action === 'new-thread' ? await startApprovalTurn() : old
    try {
      if (action === 'manual') useGenerationCanvasStore.getState().updateNodePrompt(targetId, 'new thread approved edit')
      else {
        replacement.call('new-edit', 'set_node_prompt', { nodeId: targetId, prompt: 'new thread approved edit' })
        expect((await replacement.approve(['new-edit']))?.status).toBe('committed')
      }
      // Neither a fresh conversation nor the next document edit waits for the
      // obsolete media request. Its partial edit must already be unwound.
      expect(useGenerationCanvasStore.getState().nodes.find((item) => item.id === 'existing')?.prompt)
        .toBe(targetId === 'existing' ? 'new thread approved edit' : 'original')
      expect(getHistoryFlags().canUndo).toBe(true)
      probing.resolve({ id: 'clip', type: 'video', sourceNodeId: source.id, label: 'late', url: source.result.url,
        startFrame: 0, endFrame: 24, frameCount: 24, offsetStartFrame: 0, offsetEndFrame: 0 })
      expect((await oldApproval)?.status).toBe('aborted')
      const prompts = () => Object.fromEntries(useGenerationCanvasStore.getState().nodes.map((item) => [item.id, item.prompt]))
      const latest = { existing: 'original', other: 'other original', [targetId]: 'new thread approved edit' }
      expect(prompts()).toEqual(latest)
      expect(getHistoryFlags().canUndo).toBe(true)
      useGenerationCanvasStore.getState().undo()
      expect(prompts()).toEqual({ existing: 'original', other: 'other original' })
      useGenerationCanvasStore.getState().redo()
      expect(prompts()).toEqual(latest)
      expect(useWorkbenchStore.getState().timeline).toEqual(createDefaultTimeline())
    } finally {
      probing.resolve({ id: 'clip', type: 'video', sourceNodeId: source.id, label: 'late', url: source.result.url,
        startFrame: 0, endFrame: 24, frameCount: 24, offsetStartFrame: 0, offsetEndFrame: 0 })
      await oldApproval.catch(() => undefined)
      await old.finish()
      if (replacement !== old) await replacement.finish()
    }
  })

  it.each(['reject', 'stop', 'terminal', 'new-thread', 'project-change'] as const)('%s makes even a stale visible card unable to mutate', async (action) => {
    const session = await startApprovalTurn()
    session.call('stale')
    const stale = session.pending.get('stale')!
    if (action === 'reject') await stale.confirm({ ok: false, message: 'rejected by user' })
    else if (action === 'stop') useCanvasTurnStore.getState().requestUserCancel()
    else if (action === 'terminal') session.emit({ event: 'done', data: { reason: 'finished' } })
    else if (action === 'new-thread') useCanvasTurnStore.getState().abandon()
    else {
      releaseWorkbenchProjectRuntimeState()
      useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [{ ...node(), title: 'project B', prompt: 'project B' }], edges: [], groups: [] })
    }
    const before = useGenerationCanvasStore.getState().readDocumentSnapshot()
    await session.approve(['stale'])
    expect(useGenerationCanvasStore.getState().readDocumentSnapshot()).toEqual(before)
    expect(captured.some((event) => event.type === 'agent.txn.committed')).toBe(false)
    expect(session.confirmTool.mock.calls.some(([, decision]) => decision.ok)).toBe(false)
    await session.finish()
  })

  it.each(['stop', 'terminal', 'new-thread', 'project-change'] as const)('%s after approval but before preflight resolves prevents final writes', async (action) => {
    const session = await startApprovalTurn()
    const catalog = deferred<[]>()
    deps.catalog.mockReturnValueOnce(catalog.promise)
    session.call('create', 'create_canvas_nodes', { nodes: [{ clientId: 'new', kind: 'image', title: 'late', prompt: 'late', modelKey: 'model-A' }] })
    const approval = session.approve(['create']).catch(() => undefined)
    if (action === 'stop') useCanvasTurnStore.getState().requestUserCancel()
    else if (action === 'terminal') session.emit({ event: 'done', data: { reason: 'finished' } })
    else if (action === 'new-thread') useCanvasTurnStore.getState().abandon()
    else releaseWorkbenchProjectRuntimeState()
    const before = useGenerationCanvasStore.getState().readDocumentSnapshot()
    catalog.resolve([])
    await approval
    expect(useGenerationCanvasStore.getState().readDocumentSnapshot()).toEqual(before)
    expect(captured.some((event) => event.type === 'agent.txn.committed')).toBe(false)
    await session.finish()
  })

})
