import { setImmediate } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentChatV2Session, AgentsChatResponseDto, AgentsChatStreamEvent } from '../../../api/desktopClient'
import type { WorkbenchAiStreamHandlers } from '../../ai/workbenchAiClient'
import type { ToolCallEvent } from '../../ai/workbenchAgentRunner'
import type { TimelineClip } from '../../timeline/timelineTypes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
const deps = vi.hoisted(() => ({ send: vi.fn(), catalog: vi.fn(), clip: vi.fn(), grant: vi.fn(), consent: vi.fn(), dispatch: vi.fn() }))
vi.mock('../../ai/workbenchAiClient', () => ({ sendWorkbenchAiMessage: deps.send }))
vi.mock('../../ai/assistantModelPref', () => ({ getAssistantModelPref: () => null }))
vi.mock('./availableModels', () => ({ listAvailableModelsForAgent: deps.catalog, formatAvailableModelsForPrompt: () => '' }))
vi.mock('../../timeline/buildGenerationNodeTimelineClip', () => ({ buildGenerationNodeTimelineClip: deps.clip }))
vi.mock('../../api/taskApi', () => ({ mintSpendGrant: deps.grant }))
vi.mock('../runner/generationRunController', () => ({ resolveAutonomousUploadConsent: deps.consent }))
vi.mock('../components/batchPlanPreview', () => ({ runPlanWithToasts: deps.dispatch }))
vi.mock('../../../api/desktopClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/desktopClient')>(), seedWorkbenchAgentSession: vi.fn(async () => {}),
}))
import { sendGenerationCanvasAgentMessage } from './generationCanvasAgentClient'
import { claimCanvasApprovalBatch, resolveCanvasApprovalSteps } from './canvasApprovalSteps'
import { applyProposalBatch } from './proposalTxn'
import { useCanvasTurnStore } from './canvasTurnController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { createDefaultTimeline } from '../../timeline/timelineMath'
import { initConversationPersistence, startNewConversation } from '../../ai/conversationPersistence'
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
let disposeConversations: () => void

beforeEach(() => {
  vi.clearAllMocks()
  deps.catalog.mockResolvedValue([])
  deps.grant.mockResolvedValue('grant-A')
  deps.consent.mockResolvedValue('not-needed')
  deps.dispatch.mockResolvedValue(undefined)
  setDesktopActiveProjectId('project-A')
  useCanvasTurnStore.getState().abandon()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node()], edges: [], groups: [] })
  useWorkbenchStore.setState({ timeline: createDefaultTimeline(), timelineUndoStack: [], timelineRedoStack: [] })
  __resetCanvasUndoJournalForTests()
  resetAdoptionRegistry()
  captured.length = 0
  setCanvasEventSinkForTests((events) => captured.push(...events))
  disposeConversations = initConversationPersistence(() => 'project-A')
})
afterEach(() => { disposeConversations(); useCanvasTurnStore.getState().abandon(); setDesktopActiveProjectId(null); setCanvasEventSinkForTests(null) })

async function startApprovalTurn() {
  const ready = deferred<void>()
  const completion = deferred<AgentsChatResponseDto>()
  let wire!: WorkbenchAiStreamHandlers
  const confirmTool = vi.fn<AgentChatV2Session['confirmTool']>(async () => {})
  const pending = new Map<string, ToolCallEvent & { turnId: number }>()
  const turn = useCanvasTurnStore.getState().begin()
  deps.send.mockImplementationOnce((_input, handlers: WorkbenchAiStreamHandlers) => {
    wire = handlers
    wire.onSession?.({ sessionId: 'session', cancel: async () => {}, confirmTool })
    ready.resolve()
    return completion.promise
  })
  const input = {
    message: 'edit the canvas', projectId: 'project-A', history: { kind: 'ephemeral' as const }, capability: 'canvas-agent' as const,
    snapshot: useGenerationCanvasStore.getState().readDocumentSnapshot(), selectedNodes: [], canWrite: turn.canWrite,
    onToolCall: (call: ToolCallEvent) => { pending.set(call.toolCallId, { ...call, turnId: turn.id }) },
    onToolError: ({ toolCallId }: { toolCallId: string }) => { pending.delete(toolCallId) },
    onCancelReady: (cancel: () => void) => useCanvasTurnStore.getState().attachCancel(turn.id, cancel),
  }
  const running = sendGenerationCanvasAgentMessage(input)
  await ready.promise
  const emit = (event: AgentsChatStreamEvent) => wire.onEvent?.(event)
  const call = (id: string, toolName = 'set_node_prompt', args: unknown = { nodeId: 'existing', prompt: 'edited' }) => {
    emit({ event: 'tool-call', data: { sessionId: 'session', toolCallId: id, toolName, args } })
  }
  const expire = (id: string) => emit({ event: 'tool-error', data: { toolCallId: id, toolName: 'set_node_prompt', message: 'confirmation timed out', denied: true } })
  const finish = async () => { completion.resolve(finished); await running }
  // The panel uses this same claim/preparation/executor pipeline. Only external
  // transport, model-catalog I/O and media probing are controlled by the test.
  const approve = async (ids: string[]) => {
    const approval = claimCanvasApprovalBatch(ids.map((toolCallId) => ({ toolCallId })), pending, turn)
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
    if (expiredId === 'new-thread') startNewConversation('generation')
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
    if (action === 'new-thread') startNewConversation('generation')
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
    else if (action === 'new-thread') startNewConversation('generation')
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
    else if (action === 'new-thread') startNewConversation('generation')
    else releaseWorkbenchProjectRuntimeState()
    const before = useGenerationCanvasStore.getState().readDocumentSnapshot()
    catalog.resolve([])
    await approval
    expect(useGenerationCanvasStore.getState().readDocumentSnapshot()).toEqual(before)
    expect(captured.some((event) => event.type === 'agent.txn.committed')).toBe(false)
    await session.finish()
  })

  it('a legitimately approved generation handoff survives confirmation and normal Agent finish', async () => {
    const session = await startApprovalTurn()
    const grant = deferred<string>()
    deps.grant.mockReturnValueOnce(grant.promise)
    session.call('generate', 'run_generation_batch', { nodeIds: ['existing'] })
    const generation = session.pending.get('generate')!
    expect((await session.approve(['generate']))?.status).toBe('committed')
    expect(generation.isPending()).toBe(false)
    expect(deps.grant).toHaveBeenCalledExactlyOnceWith(['existing'])
    await session.finish()
    useCanvasTurnStore.getState().finish(session.turn.id)
    grant.resolve('approved-grant')
    await setImmediate()
    expect(deps.dispatch).toHaveBeenCalledExactlyOnceWith(
      { waves: [['existing']], blocked: [], edgesUsed: [] },
      { grantId: 'approved-grant', assetUploadConsent: 'not-needed' },
    )
  })
})
