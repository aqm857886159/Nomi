import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTurnHandle } from '../../ai/agentTurnLifecycle'
import type { TimelineClip } from '../../timeline/timelineTypes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
const deps = vi.hoisted(() => ({ catalog: vi.fn(), clip: vi.fn() }))
vi.mock('./availableModels', () => ({ listAvailableModelsForAgent: deps.catalog }))
vi.mock('../../timeline/buildGenerationNodeTimelineClip', () => ({ buildGenerationNodeTimelineClip: deps.clip }))
import { applyCanvasToolCall } from './applyCanvasToolCall'
import { applyProposalBatch, type ProposalStep, type ProposalOutcome } from './proposalTxn'
import { useCanvasTurnStore } from './canvasTurnController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { createDefaultTimeline } from '../../timeline/timelineMath'
import { resetAdoptionRegistry } from '../../adoption/adoptionProposalRegistry'
import { __resetCanvasUndoJournalForTests, getHistoryFlags } from '../events/canvasUndoJournal'
import { setCanvasEventSinkForTests, type CanvasShadowEvent } from '../events/canvasEventEmitter'

// Widening a callable with an optional owner lets the pre-change implementation
// run normally in RED; these assertions fail on real post-await store effects.
const guardedApply: (name: string, args: unknown, gesture: undefined, canWrite: () => boolean) => Promise<unknown> = applyCanvasToolCall
const guardedBatch: (steps: ProposalStep[], turn: Pick<AgentTurnHandle, 'canWrite' | 'isCurrent'>) => Promise<ProposalOutcome> = applyProposalBatch
const node = (title: string): GenerationCanvasNode => ({ id: 'same-id', kind: 'video', title, prompt: title, position: { x: 0, y: 0 }, categoryId: 'shots', shotIndex: 1 })
const captured: CanvasShadowEvent[] = []

beforeEach(() => {
  vi.clearAllMocks()
  deps.catalog.mockResolvedValue([])
  useCanvasTurnStore.getState().abandon()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node('A')], edges: [], groups: [] })
  useWorkbenchStore.setState({ timeline: createDefaultTimeline(), timelineUndoStack: [], timelineRedoStack: [] })
  __resetCanvasUndoJournalForTests()
  resetAdoptionRegistry()
  captured.length = 0
  setCanvasEventSinkForTests((events) => captured.push(...events))
})
afterEach(() => { useCanvasTurnStore.getState().abandon(); setCanvasEventSinkForTests(null) })

describe('final asynchronous Agent mutation boundary', () => {
  it('Stop after a tool applies but before its await resumes compensates that completed step', async () => {
    const turn = useCanvasTurnStore.getState().begin()
    const pending = guardedBatch([
      { toolCallId: 'edit', toolName: 'set_node_prompt', effectiveArgs: { nodeId: 'same-id', prompt: 'A edited' } },
    ], turn)
    expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('A edited')
    useCanvasTurnStore.getState().requestUserCancel()
    expect((await pending).status).toBe('aborted')
    expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('A')
    expect(captured.some((event) => event.type === 'agent.txn.committed')).toBe(false)
  })

  it('a synchronous new-turn subscriber cannot leave a late old event in the new Undo/Redo history', async () => {
    // Unlike the mutation-only tests, Undo needs the real restored journal base.
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node('A')], edges: [], groups: [] })
    const turn = useCanvasTurnStore.getState().begin()
    let started = false
    let replacement: Promise<ProposalOutcome> | undefined
    const unsubscribe = useGenerationCanvasStore.subscribe((state) => {
      if (started || state.nodes[0]?.prompt !== 'A edited') return
      started = true
      const next = useCanvasTurnStore.getState().begin()
      replacement = guardedBatch([
        { toolCallId: 'new', toolName: 'set_node_prompt', effectiveArgs: { nodeId: 'same-id', prompt: 'new approved edit' } },
      ], next)
      void replacement.catch(() => {})
    })
    try {
      const previous = guardedBatch([
        { toolCallId: 'old', toolName: 'set_node_prompt', effectiveArgs: { nodeId: 'same-id', prompt: 'A edited' } },
      ], turn)
      expect((await previous).status).toBe('aborted')
      expect((await replacement)?.status).toBe('committed')
      expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('new approved edit')
      useGenerationCanvasStore.getState().undo()
      expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('A')
      useGenerationCanvasStore.getState().redo()
      expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('new approved edit')
    } finally { unsubscribe() }
  })

  it('closes compensation before a synchronous subscriber starts the replacement proposal', async () => {
    const source = { ...node('A'), result: { id: 'result-A', type: 'video' as const, url: 'https://fixture.invalid/A.mp4', createdAt: 1 } }
    const other = { ...node('other'), id: 'other', prompt: 'other original' }
    // Restore again after the suite reset so Undo starts from this real document.
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [source, other], edges: [], groups: [] })
    let releaseClip!: () => void
    let enteredClip!: () => void
    const clipEntered = new Promise<void>((resolve) => { enteredClip = resolve })
    deps.clip.mockImplementationOnce(() => {
      enteredClip()
      return new Promise<TimelineClip>((resolve) => {
        releaseClip = () => resolve({
          id: 'clip-A', type: 'video', sourceNodeId: source.id, label: 'A', url: source.result.url,
          startFrame: 0, endFrame: 24, frameCount: 24, offsetStartFrame: 0, offsetEndFrame: 0,
        })
      })
    })

    const oldTurn = useCanvasTurnStore.getState().begin()
    const oldProposal = guardedBatch([
      { toolCallId: 'old-edit', toolName: 'set_node_prompt', effectiveArgs: { nodeId: source.id, prompt: 'A edited' } },
      { toolCallId: 'old-arrange', toolName: 'arrange_storyboard_to_timeline', effectiveArgs: { nodeIds: [source.id] } },
    ], oldTurn)
    await clipEntered
    expect(useGenerationCanvasStore.getState().nodes.find((item) => item.id === source.id)?.prompt).toBe('A edited')

    let started = false
    let replacement: Promise<ProposalOutcome> | undefined
    const unsubscribe = useGenerationCanvasStore.subscribe((state) => {
      const prompt = state.nodes.find((item) => item.id === source.id)?.prompt
      if (started || prompt !== 'A') return
      started = true
      const nextTurn = useCanvasTurnStore.getState().begin()
      replacement = guardedBatch([
        { toolCallId: 'replacement', toolName: 'set_node_prompt', effectiveArgs: { nodeId: source.id, prompt: 'new approved edit' } },
      ], nextTurn)
      void replacement.catch(() => {})
    })

    try {
      // This user edit cancels the pending proposal. The subscriber above runs
      // synchronously from its compensation write and attempts a new proposal.
      useGenerationCanvasStore.getState().setNodeLocked('other', true)
      await vi.waitFor(() => expect(replacement).toBeDefined())
      expect((await replacement)?.status).toBe('committed')
      releaseClip()
      expect((await oldProposal).status).toBe('aborted')

      const state = useGenerationCanvasStore.getState()
      expect(state.nodes.find((item) => item.id === source.id)?.prompt).toBe('new approved edit')
      expect(state.nodes.find((item) => item.id === 'other')?.locked).toBe(true)
      expect(getHistoryFlags().canUndo).toBe(true)
      const promptEvents = captured
        .filter((event) => event.type === 'canvas.node.prompt-changed' && event.payload.nodeId === source.id)
        .map((event) => event.payload.prompt)
      expect(promptEvents).toEqual(['A edited', 'A', 'new approved edit'])

      useGenerationCanvasStore.getState().undo()
      expect(useGenerationCanvasStore.getState().nodes.find((item) => item.id === source.id)?.prompt).toBe('A')
      expect(useGenerationCanvasStore.getState().nodes.find((item) => item.id === 'other')?.locked).toBe(true)
      useGenerationCanvasStore.getState().redo()
      expect(useGenerationCanvasStore.getState().nodes.find((item) => item.id === source.id)?.prompt).toBe('new approved edit')
    } finally {
      releaseClip?.()
      await oldProposal.catch(() => undefined)
      unsubscribe()
    }
  })

  it('lets the latest of two cleanup-time replacement proposals win without leaking an initialization error', async () => {
    const source = { ...node('A'), result: { id: 'result-A', type: 'video' as const, url: 'https://fixture.invalid/A.mp4', createdAt: 1 } }
    const other = { ...node('other'), id: 'other', prompt: 'other original' }
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [source, other], edges: [], groups: [] })
    let releaseClip!: () => void
    let enteredClip!: () => void
    const clipEntered = new Promise<void>((resolve) => { enteredClip = resolve })
    deps.clip.mockImplementationOnce(() => {
      enteredClip()
      return new Promise<TimelineClip>((resolve) => {
        releaseClip = () => resolve({
          id: 'clip-A', type: 'video', sourceNodeId: source.id, label: 'A', url: source.result.url,
          startFrame: 0, endFrame: 24, frameCount: 24, offsetStartFrame: 0, offsetEndFrame: 0,
        })
      })
    })

    const oldTurn = useCanvasTurnStore.getState().begin()
    const oldProposal = guardedBatch([
      { toolCallId: 'old-edit', toolName: 'set_node_prompt', effectiveArgs: { nodeId: source.id, prompt: 'A edited' } },
      { toolCallId: 'old-arrange', toolName: 'arrange_storyboard_to_timeline', effectiveArgs: { nodeIds: [source.id] } },
    ], oldTurn)
    await clipEntered

    let firstReplacement: Promise<ProposalOutcome> | undefined
    let secondReplacement: Promise<ProposalOutcome> | undefined
    const firstSubscriber = useGenerationCanvasStore.subscribe((state) => {
      if (firstReplacement || state.nodes.find((item) => item.id === source.id)?.prompt !== 'A') return
      const turn = useCanvasTurnStore.getState().begin()
      firstReplacement = guardedBatch([
        { toolCallId: 'first-replacement', toolName: 'set_node_prompt', effectiveArgs: { nodeId: source.id, prompt: 'first replacement' } },
      ], turn)
      void firstReplacement.catch(() => {})
    })
    const secondSubscriber = useGenerationCanvasStore.subscribe((state) => {
      if (secondReplacement || state.nodes.find((item) => item.id === source.id)?.prompt !== 'A') return
      const turn = useCanvasTurnStore.getState().begin()
      secondReplacement = guardedBatch([
        { toolCallId: 'second-replacement', toolName: 'set_node_prompt', effectiveArgs: { nodeId: source.id, prompt: 'second replacement' } },
      ], turn)
      void secondReplacement.catch(() => {})
    })

    try {
      useGenerationCanvasStore.getState().setNodeLocked('other', true)
      await vi.waitFor(() => {
        expect(firstReplacement).toBeDefined()
        expect(secondReplacement).toBeDefined()
      })
      const [first, second] = await Promise.all([firstReplacement!, secondReplacement!])
      expect(first.status).toBe('aborted')
      expect(second.status).toBe('committed')
      releaseClip()
      expect((await oldProposal).status).toBe('aborted')

      expect(useGenerationCanvasStore.getState().nodes.find((item) => item.id === source.id)?.prompt).toBe('second replacement')
      expect(useGenerationCanvasStore.getState().nodes.find((item) => item.id === 'other')?.locked).toBe(true)
      expect(getHistoryFlags().canUndo).toBe(true)
      useGenerationCanvasStore.getState().undo()
      expect(useGenerationCanvasStore.getState().nodes.find((item) => item.id === source.id)?.prompt).toBe('A')
      expect(useGenerationCanvasStore.getState().nodes.find((item) => item.id === 'other')?.locked).toBe(true)
      useGenerationCanvasStore.getState().redo()
      expect(useGenerationCanvasStore.getState().nodes.find((item) => item.id === source.id)?.prompt).toBe('second replacement')
    } finally {
      releaseClip?.()
      await oldProposal.catch(() => undefined)
      firstSubscriber()
      secondSubscriber()
    }
  })

  it('releases a queued replacement that is stopped before it acquires the canvas', async () => {
    const source = { ...node('A'), result: { id: 'result-A', type: 'video' as const, url: 'https://fixture.invalid/A.mp4', createdAt: 1 } }
    const other = { ...node('other'), id: 'other', prompt: 'other original' }
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [source, other], edges: [], groups: [] })
    let releaseClip!: () => void
    let enteredClip!: () => void
    const clipEntered = new Promise<void>((resolve) => { enteredClip = resolve })
    deps.clip.mockImplementationOnce(() => {
      enteredClip()
      return new Promise<TimelineClip>((resolve) => {
        releaseClip = () => resolve({
          id: 'clip-A', type: 'video', sourceNodeId: source.id, label: 'A', url: source.result.url,
          startFrame: 0, endFrame: 24, frameCount: 24, offsetStartFrame: 0, offsetEndFrame: 0,
        })
      })
    })

    const oldTurn = useCanvasTurnStore.getState().begin()
    const oldProposal = guardedBatch([
      { toolCallId: 'old-edit', toolName: 'set_node_prompt', effectiveArgs: { nodeId: source.id, prompt: 'A edited' } },
      { toolCallId: 'old-arrange', toolName: 'arrange_storyboard_to_timeline', effectiveArgs: { nodeIds: [source.id] } },
    ], oldTurn)
    await clipEntered

    let replacement: Promise<ProposalOutcome> | undefined
    const unsubscribe = useGenerationCanvasStore.subscribe((state) => {
      if (replacement || state.nodes.find((item) => item.id === source.id)?.prompt !== 'A') return
      const queuedTurn = useCanvasTurnStore.getState().begin()
      replacement = guardedBatch([
        { toolCallId: 'stopped-replacement', toolName: 'set_node_prompt', effectiveArgs: { nodeId: source.id, prompt: 'must not land' } },
      ], queuedTurn)
      void replacement.catch(() => {})
      useCanvasTurnStore.getState().requestUserCancel()
    })

    try {
      useGenerationCanvasStore.getState().setNodeLocked('other', true)
      await vi.waitFor(() => expect(replacement).toBeDefined())
      expect((await replacement)?.status).toBe('aborted')
      const abortedBeforeManual = captured.filter((event) => event.type === 'agent.txn.aborted').length
      expect(abortedBeforeManual).toBe(2)

      useGenerationCanvasStore.getState().updateNodePrompt(source.id, 'manual after stopped replacement')
      expect(useGenerationCanvasStore.getState().nodes.find((item) => item.id === source.id)?.prompt)
        .toBe('manual after stopped replacement')
      expect(captured.filter((event) => event.type === 'agent.txn.aborted')).toHaveLength(abortedBeforeManual)

      releaseClip()
      expect((await oldProposal).status).toBe('aborted')
      expect(captured.filter((event) => event.type === 'agent.txn.aborted')).toHaveLength(abortedBeforeManual)
    } finally {
      releaseClip?.()
      await oldProposal.catch(() => undefined)
      unsubscribe()
    }
  })

  it.each(['stop', 'project-change'] as const)('%s during catalog cannot create nodes after it resolves', async (action) => {
    let release!: () => void
    deps.catalog.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]) }))
    const turn = useCanvasTurnStore.getState().begin()
    const pending = guardedApply('create_canvas_nodes', { nodes: [{ clientId: 'new', kind: 'image', title: 'late A', prompt: 'p', modelKey: 'fake' }] }, undefined, turn.canWrite)
    if (action === 'stop') useCanvasTurnStore.getState().requestUserCancel()
    else {
      useCanvasTurnStore.getState().abandon()
      useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node('B')], edges: [], groups: [] })
    }
    const before = useGenerationCanvasStore.getState().readDocumentSnapshot()
    release()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(useGenerationCanvasStore.getState().readDocumentSnapshot()).toEqual(before)
  })

  it('a failed old proposal never compensates against the new project with colliding node IDs', async () => {
    let fail!: () => void
    deps.catalog.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = () => reject(new Error('catalog failed')) }))
    const turn = useCanvasTurnStore.getState().begin()
    const pending = guardedBatch([
      { toolCallId: 'edit', toolName: 'set_node_prompt', effectiveArgs: { nodeId: 'same-id', prompt: 'A edited' } },
      { toolCallId: 'create', toolName: 'create_canvas_nodes', effectiveArgs: { nodes: [{ clientId: 'new', kind: 'image', title: 'late A', prompt: 'p', modelKey: 'fake' }] } },
    ], turn)
    await vi.waitFor(() => expect(deps.catalog).toHaveBeenCalledTimes(1))
    useCanvasTurnStore.getState().abandon()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node('B')], edges: [], groups: [] })
    captured.length = 0
    fail()
    expect((await pending).status).toBe('aborted')
    expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('B')
    expect(captured).toEqual([])
  })

  it.each(['stop', 'project-change'] as const)('%s during media probing never publishes a timeline or undo record', async (action) => {
    const source = { ...node('A'), result: { id: 'result-A', type: 'video' as const, url: 'https://fixture.invalid/A.mp4', createdAt: 1 } }
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [source], edges: [], groups: [] })
    let release!: () => void
    deps.clip.mockImplementationOnce(() => new Promise<TimelineClip>((resolve) => { release = () => resolve({
      id: 'clip-A', type: 'video', sourceNodeId: source.id, label: 'A', url: source.result.url,
      startFrame: 0, endFrame: 24, frameCount: 24, offsetStartFrame: 0, offsetEndFrame: 0,
    }) }))
    const turn = useCanvasTurnStore.getState().begin()
    const pending = guardedApply('arrange_storyboard_to_timeline', { nodeIds: [source.id] }, undefined, turn.canWrite)
    expect(deps.clip).toHaveBeenCalledTimes(1)
    if (action === 'stop') useCanvasTurnStore.getState().requestUserCancel()
    else {
      useCanvasTurnStore.getState().abandon()
      useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node('B')], edges: [], groups: [] })
    }
    const before = { ...createDefaultTimeline(), playheadFrame: 48 }
    useWorkbenchStore.setState({ timeline: before, timelineUndoStack: [] })
    release()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(useWorkbenchStore.getState().timeline).toEqual(before)
    expect(useWorkbenchStore.getState().timelineUndoStack).toEqual([])
  })
})
