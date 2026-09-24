import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentPanelV4Actions, type AgentPanelV4Actions } from './useAgentPanelV4Actions'
import type { AgentPanelV4Data } from './useAgentPanelV4Data'
import type { ProjectAgentCommittedProposalRecord } from '../../../../electron/shared/projectAgentProposalReceipt'
import type { LanePart } from '../../../../electron/shared/agentLane/laneContracts'
import { LANE_RECEIPT_AUTHORITY_NOTE } from '../../../../electron/shared/agentLane/laneReceiptAuthority'
import { buildAgentModelEntries } from '../../generationCanvas/agent/availableModels'
import type { RecoveredAgentDraft } from '../projectAgentDraftRecovery'
import { takeRecoveredAgentDraft } from '../projectAgentDraftRecovery'
import type { LaneDraftIntent } from '../../../../electron/shared/agentLane/laneDesktopContracts'
import type { ComposerAttachment } from '../composer/composerAttachmentTypes'

const fixture = vi.hoisted(() => {
  const state = {
    projectAgentDraft: '', projectAgentDraftRevision: 0, projectAgentAdmissionId: null as string | null, projectAgentReferences: [] as import('../../workbenchStore').ProjectAgentReference[], projectAgentDraftIntent: null as LaneDraftIntent | null, projectAgentDraftDisplayText: null, projectAgentRecoveredDrafts: [] as RecoveredAgentDraft[], projectAgentAttachments: [] as ComposerAttachment[],
    activeDocumentId: 'doc-1', persistRevision: 1,
    storyboardDesignsByDocumentId: {} as Record<string, Array<{ id: string; title: string }>>,
    activeStoryboardId: null as string | null,
    workbenchDocuments: [{ id: 'doc-1', title: 'Current document', updatedAt: 42,
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一句。' }] }] } }],
    creationActiveSkill: null as { key: string; contentHash?: string } | null, selectedLibraryPrompt: null as { id: string } | null,
    projectAgentApprovalPolicy: { mode: 'safe-auto', spend: 'confirm' },
    setProjectAgentDraft(text: string) { state.projectAgentDraft = text; state.projectAgentDraftRevision++ },
    // 真店里这个 setter 一次清掉同一个引用槽的两半（`workbenchStore.setCreationActiveSkill`）。
    setCreationActiveSkill(skill: { key: string; contentHash?: string } | null) {
      state.creationActiveSkill = skill
      state.selectedLibraryPrompt = null
      state.projectAgentDraftRevision++
    },
    setProjectAgentAttachments(update: (current: ComposerAttachment[]) => ComposerAttachment[]) {
      state.projectAgentAttachments = update(state.projectAgentAttachments)
      state.projectAgentDraftRevision++
    },
    setProjectAgentApprovalPolicy: vi.fn(),
  }
  return { state, owner: { subscriptionId: 'workspace-a', binding: { projectId: 'project-a', immutableProjectUuid: 'uuid-a' } } as { subscriptionId: string; binding?: { projectId?: string; immutableProjectUuid: string } } | null, say: vi.fn(), models: vi.fn(),
    cancelQueued: vi.fn(), abort: vi.fn(),
    record: null as ProjectAgentCommittedProposalRecord | null, undo: vi.fn(), projection: { lane: 'main', parts: [] as LanePart[] } }
})
vi.mock('../../generationCanvas/agent/availableModels', async importOriginal => ({
  ...await importOriginal<typeof import('../../generationCanvas/agent/availableModels')>(), listAvailableModelsForAgent: fixture.models,
}))
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('../lane/laneClient', () => ({ laneClient: { context: () => fixture.owner, say: fixture.say,
  prepareInput: async () => fixture.owner ? { workspaceId: (fixture.owner as { subscriptionId: string }).subscriptionId, laneName: fixture.projection.lane, sessionId: 'session-main' } : null,
  conversation: () => fixture.owner ? { workspaceId: (fixture.owner as { subscriptionId: string }).subscriptionId, laneName: fixture.projection.lane, sessionId: 'session-main' } : null,
  projection: () => fixture.projection, cancelQueued: fixture.cancelQueued, abort: fixture.abort } }))
vi.mock('../../workbenchStore', () => ({ useWorkbenchStore: Object.assign(
  (selector: (state: typeof fixture.state) => unknown) => selector(fixture.state), { getState: () => fixture.state, setState: (patch: Partial<typeof fixture.state> | ((state: typeof fixture.state) => Partial<typeof fixture.state>)) => Object.assign(fixture.state, typeof patch === 'function' ? patch(fixture.state) : patch) },
) }))
vi.mock('../../generationCanvas/store/generationCanvasStore', () => ({ useGenerationCanvasStore: {
  getState: () => ({ persistRevision: 1, nodes: [], selectedNodeIds: [] }),
} }))
vi.mock('../../generationCanvas/agent/proposalUndo', () => ({ getCommittedProposal: () => fixture.record, runProposalUndo: fixture.undo }))
vi.mock('../../generationCanvas/agent/canvasSystemPrompt', () => ({ buildStaticAgentSystemPrompt: () => 'generation domain prompt' }))

function mountActions(surface: 'creation' | 'generation' = 'generation') {
  let actions!: AgentPanelV4Actions
  function Consumer() {
    actions = useAgentPanelV4Actions(surface, { snapshot: { workspaceId: 'workspace-a', lanes: [{ laneName: 'main', sessionId: 'session-main' }], active: { lane: 'main', queues: [{ entryId: 'queued-1' }] } } } as unknown as AgentPanelV4Data)
    return null
  }
  renderToStaticMarkup(React.createElement(Consumer))
  return actions
}
function deferred() {
  let resolve!: (result: { ok: true }) => void
  const promise = new Promise<{ ok: true }>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  fixture.owner = { subscriptionId: 'workspace-a', binding: { projectId: 'project-a', immutableProjectUuid: 'uuid-a' } }
  fixture.state.projectAgentDraft = 'keep this draft'
  fixture.state.projectAgentAdmissionId = null
  fixture.state.projectAgentDraftRevision = 0
  fixture.state.projectAgentAttachments = []
  fixture.state.projectAgentRecoveredDrafts = []
  fixture.state.projectAgentDraftIntent = null
  fixture.state.projectAgentDraftDisplayText = null
  fixture.state.creationActiveSkill = null
  fixture.state.selectedLibraryPrompt = null
  fixture.say.mockReset()
  fixture.models.mockReset().mockResolvedValue([])
  fixture.cancelQueued.mockReset()
  fixture.abort.mockReset()
  fixture.record = null
  fixture.projection = { lane: 'main', parts: [] }
  fixture.undo.mockReset().mockResolvedValue(undefined)
})

describe('composer sends commit local cleanup only after current admission', () => {
  it('preserves a new skill selection made while the captured send awaits admission', async () => {
    let release!: (models: never[]) => void
    fixture.models.mockReturnValue(new Promise<never[]>(resolve => { release = resolve }))
    fixture.state.creationActiveSkill = { key: 'original' }
    fixture.say.mockResolvedValue({ ok: true })
    const sending = mountActions().send('keep this draft')
    const next = { key: 'next', name: 'Next' }
    fixture.state.creationActiveSkill = next
    release([])
    expect(await sending).toBe(true)
    expect(fixture.state.creationActiveSkill).toBe(next)
  })
  it('keeps current admission separate from a restored historical target', async () => {
    fixture.state.projectAgentDraftIntent = { target: { kind: 'document', documentId: 'original', anchor: { kind: 'whole-document' } }, systemPrompt: 'Original template' }
    fixture.say.mockResolvedValue({ ok: true })
    expect(await mountActions().send('keep this draft')).toBe(true)
    expect(fixture.say.mock.calls[0][2]).toMatchObject({ target: { kind: 'canvas' },
      restoredIntent: { target: { kind: 'document', documentId: 'original' }, systemPrompt: 'Original template' } })
  })
  it('does not send an A draft into B after the model catalog resolves', async () => {
    let release!: (models: never[]) => void
    fixture.models.mockReturnValue(new Promise<never[]>(resolve => { release = resolve }))
    fixture.say.mockResolvedValue({ ok: true })
    const sending = mountActions().send('keep this draft')
    fixture.projection.lane = 'other'
    release([])
    expect(await sending).toBe(false)
    expect(fixture.say).not.toHaveBeenCalled()
    expect(fixture.state.projectAgentDraft).toBe('keep this draft')
  })

  it('keeps a new draft separate when a queued input is withdrawn', async () => {
    const result = { ok: true, cancelQueued: 'cancelled', restoredInput: [{ text: 'old queued instruction', skillKey: 'old-skill' }] }
    const finished = Promise.resolve(result)
    fixture.cancelQueued.mockReturnValue(finished)
    mountActions().queueAction(0, 'withdraw')
    await finished
    expect(fixture.state.projectAgentDraft).toBe('keep this draft')
    expect(fixture.state.projectAgentRecoveredDrafts).toMatchObject([{ text: 'old queued instruction',
      projectUuid: 'uuid-a', conversation: { laneName: 'main', sessionId: 'session-main' }, skill: { key: 'old-skill' } }])
    expect(fixture.say).not.toHaveBeenCalled()
  })

  it('keeps a late withdrawal with its original project and conversation', async () => {
    let resolve!: (value: { ok: true; restoredInput: { text: string }[] }) => void
    const pending = new Promise<{ ok: true; restoredInput: { text: string }[] }>(done => { resolve = done })
    fixture.abort.mockReturnValue(pending)
    mountActions().stop()
    fixture.owner = { subscriptionId: 'workspace-b', binding: { immutableProjectUuid: 'uuid-b' } }
    fixture.projection.lane = 'other'
    fixture.state.setProjectAgentDraft('B unsent input')
    resolve({ ok: true, restoredInput: [{ text: 'A withdrawn input' }] })
    await pending
    expect(fixture.state.projectAgentDraft).toBe('B unsent input')
    expect(fixture.state.projectAgentRecoveredDrafts).toMatchObject([{ text: 'A withdrawn input', projectUuid: 'uuid-a',
      conversation: { laneName: 'main', sessionId: 'session-main' } }])
    takeRecoveredAgentDraft(fixture.state.projectAgentRecoveredDrafts[0].id, 'uuid-b', { laneName: 'other', sessionId: 'session-main' })
    expect(fixture.state.projectAgentDraft).toBe('B unsent input')
  })

  it('taking back one of several inputs swaps the complete current draft without merging or sending', async () => {
    fixture.state.creationActiveSkill = { key: 'current-skill' }
    const currentAttachment = { id: 'current-file', fileName: 'current.txt', status: 'error' } as ComposerAttachment
    fixture.state.projectAgentAttachments = [currentAttachment]
    const pending = Promise.resolve({ ok: true, restoredInput: [
      { text: 'First', skillKey: 'first', skillSnapshot: { name: 'first', contentHash: 'hash-1' } },
      { text: 'Second', skillKey: 'second' },
    ] })
    fixture.abort.mockReturnValue(pending)
    mountActions().stop()
    await pending
    const first = fixture.state.projectAgentRecoveredDrafts[0]
    takeRecoveredAgentDraft(first.id, 'uuid-a', { laneName: 'main', sessionId: 'session-main' })
    expect(fixture.state.projectAgentDraft).toBe('First')
    expect(fixture.state.creationActiveSkill).toEqual({ key: 'first', contentHash: 'hash-1' })
    expect(fixture.state.projectAgentAttachments).toEqual([])
    expect(fixture.state.projectAgentRecoveredDrafts).toMatchObject([
      { text: 'Second', skill: { key: 'second' } },
      { text: 'keep this draft', skill: { key: 'current-skill' }, attachments: [currentAttachment] },
    ])
    expect(fixture.say).not.toHaveBeenCalled()
  })

  it('restores the selected skill and pinned version along with an empty composer input', async () => {
    fixture.state.projectAgentDraft = ''
    const finished = Promise.resolve({ ok: true, restoredInput: [{ text: 'old queued instruction', skillKey: 'old-skill',
      skillSnapshot: { name: 'old-skill', contentHash: 'old-hash' } }] })
    fixture.abort.mockReturnValue(finished)
    mountActions().stop()
    await finished
    expect(fixture.state.projectAgentDraft).toBe('old queued instruction')
    expect(fixture.state.creationActiveSkill).toEqual({ key: 'old-skill', contentHash: 'old-hash' })
  })

  it('captures the current catalog projection on every send', async () => {
    const entries = buildAgentModelEntries([{ value: 'MiniMax-H3', label: 'MiniMax H3', kind: 'video', vendor: 'apimart' }])
    expect(entries).toHaveLength(1)
    fixture.models.mockResolvedValueOnce(entries).mockResolvedValueOnce([])
    fixture.say.mockResolvedValue({ ok: true })
    const actions = mountActions()
    expect(await actions.send('first')).toBe(true)
    expect(fixture.say.mock.calls[0][2].availableModels).toEqual(entries)
    expect(await actions.send('second', { choice: 'secondary' })).toBe(true)
    expect(fixture.say.mock.calls[0][1]).toBe('primary')
    expect(fixture.say.mock.calls[1][1]).toBe('secondary')
    expect(fixture.say.mock.calls[1][2].availableModels).toEqual([])
    expect(fixture.models).toHaveBeenCalledTimes(2)
  })

  // 站在画布上发消息：文稿前提照样带（owner 给，整篇锚），target 仍是画布。2026-09-17 之前这里
  // 只在创作/分镜面才填前提，于是画布上的 write_script 在 lane 里连渲染层都没到就被判「目标陈旧」。
  it('sends the document preconditions from the session port on the generation surface', async () => {
    fixture.say.mockResolvedValue({ ok: true })
    const actions = mountActions()
    expect(await actions.send('在文稿末尾加一句')).toBe(true)
    const context = fixture.say.mock.calls[0][2]
    expect(context.documentId).toBe('doc-1')
    expect(context.target).toEqual({ kind: 'canvas', nodeIds: [] })
    expect(context.preconditions).toEqual({ document: { revision: 42, contentHash: expect.stringMatching(/^fnv1a-/) } })
    expect(context.contextSnapshot.handles[0]).toMatchObject({ kind: 'document', targetId: 'doc-1', locator: { anchor: { kind: 'whole-document' } } })
  })

  // 技能是**这条消息的引用**，不是常驻开关：发出去就该跟着走，留在 composer 上等于
  // 告诉用户「以后每条都得挂着它」（2026-09-10 反馈）。失败那条路不摘，重发不用重选。
  it('releases the skill reference once the message is admitted', async () => {
    fixture.state.creationActiveSkill = { key: 'workbench-storyboard-planner' }
    fixture.say.mockResolvedValue({ ok: true })
    expect(await mountActions().send('plan the opening')).toBe(true)
    expect(fixture.say.mock.calls[0][2].skillKey).toBe('workbench-storyboard-planner')
    expect(fixture.state.creationActiveSkill).toBeNull()
    expect(fixture.state.selectedLibraryPrompt).toBeNull()
  })

  it.each(['negative-ack', 'exception'])('keeps the skill reference when the send fails with %s', async kind => {
    fixture.state.creationActiveSkill = { key: 'workbench-storyboard-planner' }
    if (kind === 'exception') fixture.say.mockRejectedValue(new Error('lane down'))
    else fixture.say.mockResolvedValue({ ok: false, code: 'agent_lane_execute_failed', diagnostic: 'lane down' })
    expect(await mountActions().send('plan the opening')).toBe(false)
    expect(fixture.state.creationActiveSkill).toEqual({ key: 'workbench-storyboard-planner' })
  })

  it('S24: preserves a newly edited draft even when the user retypes the same text before admission', async () => {
    fixture.state.projectAgentDraft = 'same text'
    const pending = deferred()
    fixture.say.mockReturnValue(pending.promise)
    const actions = mountActions()
    const sending = actions.send('same text')
    fixture.state.setProjectAgentDraft('new thought')
    fixture.state.setProjectAgentDraft('same text')
    pending.resolve({ ok: true })
    expect(await sending).toBe(true)
    expect(fixture.state.projectAgentDraft).toBe('same text')
  })

  it('S24: preserves a newly selected skill and prompt while the captured send is admitted', async () => {
    const original = { key: 'original-skill' }
    fixture.state.creationActiveSkill = original
    const ack = deferred()
    fixture.say.mockReturnValue(ack.promise)
    const sent = mountActions().send('keep this draft')
    const replacement = { key: 'next-skill' }
    fixture.state.creationActiveSkill = replacement
    fixture.state.selectedLibraryPrompt = { id: 'next-prompt' }
    ack.resolve({ ok: true })
    expect(await sent).toBe(true)
    expect(fixture.say.mock.calls[0][2].skillKey).toBe('original-skill')
    expect(fixture.state.creationActiveSkill).toBe(replacement)
    expect(fixture.state.selectedLibraryPrompt).toEqual({ id: 'next-prompt' })
  })

  it('S21: replay carries only the original selector and leaves the new composer untouched', async () => {
    fixture.state.creationActiveSkill = { key: 'unsent-skill' }
    fixture.state.projectAgentAttachments = [{ id: 'upload-next', status: 'uploading' } as ComposerAttachment]
    fixture.say.mockResolvedValue({ ok: true })
    const originalSkill = fixture.state.creationActiveSkill
    const replay = mountActions().send as (text: string, options: { retryFromEntryId: string }) => Promise<boolean>
    expect(await replay('Retry', { retryFromEntryId: 'original-input' })).toBe(true)
    expect(fixture.say.mock.calls[0][2]).toMatchObject({ retryFromEntryId: 'original-input', attachments: [] })
    expect(fixture.say.mock.calls[0][2].skillKey).toBeUndefined()
    expect(fixture.state.creationActiveSkill).toBe(originalSkill)
    expect(fixture.state.projectAgentAttachments).toHaveLength(1)
    expect(fixture.state.projectAgentDraft).toBe('keep this draft')
  })

  it('preserves the draft and sends nothing when catalog capture fails', async () => {
    fixture.models.mockRejectedValue(new Error('catalog unavailable'))
    expect(await mountActions().send('keep this draft')).toBe(false)
    expect(fixture.say).not.toHaveBeenCalled()
    expect(fixture.state.projectAgentDraft).toBe('keep this draft')
  })

  it.each(['negative-ack', 'exception'])('returns false and keeps the draft on %s', async kind => {
    if (kind === 'exception') fixture.say.mockRejectedValue(new Error('missing skill'))
    else fixture.say.mockResolvedValue({ ok: false, code: 'agent_lane_execute_failed', diagnostic: 'missing skill' })
    expect(await mountActions().send('keep this draft')).toBe(false)
    expect(fixture.state.projectAgentDraft).toBe('keep this draft')
  })

  it('retains a pending draft then returns true and clears it on ACK', async () => {
    const ack = deferred()
    fixture.say.mockReturnValue(ack.promise)
    const sent = mountActions().send('keep this draft')
    expect(fixture.state.projectAgentDraft).toBe('keep this draft')
    ack.resolve({ ok: true })
    expect(await sent).toBe(true)
    expect(fixture.state.projectAgentDraft).toBe('')
  })

  it('does not clear text the user edited while admission was pending', async () => {
    const ack = deferred()
    fixture.say.mockReturnValue(ack.promise)
    const sent = mountActions().send('keep this draft')
    fixture.state.projectAgentDraft = 'next unsent thought'
    ack.resolve({ ok: true })
    expect(await sent).toBe(true)
    expect(fixture.state.projectAgentDraft).toBe('next unsent thought')
  })

  it('does not acknowledge a late old-workspace send or clear the new workspace draft', async () => {
    const ack = deferred()
    fixture.say.mockReturnValue(ack.promise)
    const sent = mountActions().send('keep this draft')
    fixture.owner = { subscriptionId: 'workspace-b' }
    ack.resolve({ ok: true })
    expect(await sent).toBe(false)
    expect(fixture.state.projectAgentDraft).toBe('keep this draft')
  })

  it('returns false before sending empty text or uploading attachments', async () => {
    expect(await mountActions().send('  ')).toBe(false)
    fixture.state.projectAgentAttachments = [{ id: 'pending', status: 'uploading' } as ComposerAttachment]
    expect(await mountActions().send('keep this draft')).toBe(false)
    expect(fixture.say).not.toHaveBeenCalled()
    expect(fixture.state.projectAgentDraft).toBe('keep this draft')
  })

  it('sends an explicit interrupted-entry reference without changing the user instruction', async () => {
    fixture.say.mockResolvedValue({ ok: true })
    expect(await mountActions().send('继续', { continueFromEntryId: 'stopped-entry' })).toBe(true)
    expect(fixture.say).toHaveBeenCalledWith('继续', 'primary', expect.objectContaining({ continueFromEntryId: 'stopped-entry' }), expect.objectContaining({ sessionId: 'session-main' }))
    fixture.say.mockClear()
    expect(await mountActions().send('继续')).toBe(true)
    expect(fixture.say.mock.calls[0][2]).not.toHaveProperty('continueFromEntryId')
  })
})


describe('exact receipt undo admission', () => {
  function ready() {
    fixture.record = { proposalId: 'receipt-1', hostApprovalId: 'approval-1', hostActionHash: 'a'.repeat(64),
      summary: 'Created', stepLabels: ['Created'], compensation: [{ kind: 'delete-nodes', nodeIds: ['n1'] }],
      watchNodes: [], reconciliationOk: true }
    fixture.projection.parts = [
      { kind: 'host-note', noteType: LANE_RECEIPT_AUTHORITY_NOTE, data: { receiptProposalId: 'receipt-1',
        approvalId: 'approval-1', actionHash: 'a'.repeat(64), toolCallId: 'call-1' }, sequence: 0, entrySeq: 1, contentIndex: 0 },
      { kind: 'tool-call', toolCallId: 'call-1', toolName: 'nomi_canvas_write', args: {}, running: false, sequence: 1, entrySeq: 2, contentIndex: 0 },
      { kind: 'tool-result', toolCallId: 'call-1', toolName: 'nomi_canvas_write', text: 'Created', isError: false, sequence: 2, entrySeq: 3, contentIndex: 0 },
    ]
    return mountActions()
  }
  it('hands the current exact record to the existing compensating transaction', () => {
    ready().undoTool('call-1')
    expect(fixture.undo).toHaveBeenCalledExactlyOnceWith(fixture.record)
  })
  it.each(['wrong-call', 'new-receipt', 'cleared', 'new-lane', 'new-workspace'])('cannot undo from stale %s', kind => {
    const actions = ready()
    if (kind === 'new-receipt') fixture.record = { ...fixture.record!, proposalId: 'receipt-2' }
    if (kind === 'cleared') fixture.record = null
    if (kind === 'new-lane') fixture.projection.lane = 'other'
    if (kind === 'new-workspace') fixture.owner = { subscriptionId: 'workspace-b' }
    actions.undoTool(kind === 'wrong-call' ? 'other-call' : 'call-1')
    expect(fixture.undo).not.toHaveBeenCalled()
  })
})


describe('independent recovery review probes', () => {
  it('keeps restored selectors separate from the current admission surface', async () => {
    fixture.state.projectAgentDraftIntent = { target: { kind: 'timeline', clipIds: ['old-clip'] }, systemPrompt: 'OLD_TEMPLATE' } as never
    fixture.say.mockResolvedValue({ ok: true })
    expect(await mountActions().send('keep this draft')).toBe(true)
    const context = fixture.say.mock.calls[0][2]
    expect(context.target).toEqual({ kind: 'canvas', nodeIds: [] })
    expect(context.restoredIntent).toMatchObject({ target: { kind: 'timeline', clipIds: ['old-clip'] }, systemPrompt: 'OLD_TEMPLATE' })
  })
  it('does not refill an intentionally cleared composer after a late cancellation ACK', async () => {
    fixture.state.projectAgentDraft = ''
    const ack = deferred()
    fixture.abort.mockReturnValue(ack.promise)
    mountActions().stop()
    fixture.state.setProjectAgentDraft('new thought')
    fixture.state.setProjectAgentDraft('')
    ack.resolve({ ok: true, restoredInput: [{ text: 'old queued input' }] } as never)
    await ack.promise
    expect(fixture.state.projectAgentDraft).toBe('')
    expect(fixture.state.projectAgentRecoveredDrafts).toMatchObject([{ text: 'old queued input' }])
  })
  it('does not label a now-accepted draft as unsent after take-back during catalog admission', async () => {
    fixture.state.projectAgentRecoveredDrafts = [{ id: 'recovered-a', projectUuid: 'uuid-a', conversation: { laneName: 'main', sessionId: 'session-main' }, text: 'Recovered A', displayText: null, skill: null, template: null, attachments: [], references: [], intent: null }]
    let release!: (value: never[]) => void
    fixture.models.mockReturnValue(new Promise<never[]>(resolve => { release = resolve }))
    fixture.say.mockResolvedValue({ ok: true })
    const sending = mountActions().send('keep this draft')
    takeRecoveredAgentDraft('recovered-a', 'uuid-a', { laneName: 'main', sessionId: 'session-main' })
    const afterTake = fixture.state.projectAgentDraft
    release([])
    expect(await sending).toBe(true)
    expect(fixture.state.projectAgentDraft).toBe(afterTake === 'keep this draft' ? '' : 'Recovered A')
    expect(fixture.state.projectAgentRecoveredDrafts.some(entry => entry.text === 'keep this draft')).toBe(false)
    if (afterTake === 'keep this draft') expect(fixture.state.projectAgentRecoveredDrafts.some(entry => entry.id === 'recovered-a')).toBe(true)
  })
})


describe('F12 stop cancels pending input admission', () => {
  it('keeps the draft and never sends after Stop during the model catalog wait', async () => {
    let release!: (models: never[]) => void
    fixture.models.mockReturnValue(new Promise<never[]>(resolve => { release = resolve }))
    fixture.say.mockResolvedValue({ ok: true })
    fixture.abort.mockResolvedValue({ ok: true })
    const actions = mountActions()
    const sending = actions.send('keep this draft')
    actions.stop()
    release([])
    expect(await sending).toBe(false)
    expect(fixture.say).not.toHaveBeenCalled()
    expect(fixture.state.projectAgentDraft).toBe('keep this draft')
    expect(fixture.state.projectAgentAdmissionId).toBeNull()
    expect(await actions.send('keep this draft')).toBe(true)
  })

  it('does not let an old visible conversation Stop cancel another workspace admission', async () => {
    let release!: (models: never[]) => void
    fixture.models.mockReturnValue(new Promise<never[]>(resolve => { release = resolve }))
    fixture.abort.mockResolvedValue({ ok: true })
    const actions = mountActions()
    const sending = actions.send('keep this draft')
    fixture.owner = { subscriptionId: 'workspace-b', binding: { immutableProjectUuid: 'uuid-b' } }
    fixture.state.projectAgentAdmissionId = 'new-workspace-admission'
    actions.stop()
    release([])
    expect(await sending).toBe(false)
    expect(fixture.state.projectAgentAdmissionId).toBe('new-workspace-admission')
    expect(fixture.say).not.toHaveBeenCalled()
  })
})


it('F12: an old cancelled send finally never clears the next same-conversation admission', async () => {
  let releaseOld!: (models: never[]) => void, releaseNew!: (models: never[]) => void
  fixture.models.mockReturnValueOnce(new Promise<never[]>(resolve => { releaseOld = resolve }))
    .mockReturnValueOnce(new Promise<never[]>(resolve => { releaseNew = resolve }))
  fixture.abort.mockResolvedValue({ ok: true })
  fixture.say.mockResolvedValue({ ok: true })
  const actions = mountActions()
  const old = actions.send('keep this draft')
  actions.stop()
  fixture.state.setProjectAgentDraft('new draft')
  const next = actions.send('new draft')
  const nextId = fixture.state.projectAgentAdmissionId
  expect(nextId).not.toBeNull()
  releaseOld([])
  expect(await old).toBe(false)
  expect(fixture.state.projectAgentAdmissionId).toBe(nextId)
  expect(fixture.state.projectAgentDraft).toBe('new draft')
  releaseNew([])
  expect(await next).toBe(true)
  expect(fixture.say).toHaveBeenCalledOnce()
  expect(fixture.say.mock.calls[0][0]).toBe('new draft')
})

it('F12: Stop after IPC dispatch keeps the recovery exchange locked until its admission ACK', async () => {
  let dispatched!: () => void
  const entered = new Promise<void>(resolve => { dispatched = resolve })
  const ack = deferred()
  fixture.say.mockImplementation(() => { dispatched(); return ack.promise })
  fixture.abort.mockResolvedValue({ ok: true })
  fixture.state.projectAgentRecoveredDrafts = [{ id: 'recovered-a', projectUuid: 'uuid-a',
    conversation: { laneName: 'main', sessionId: 'session-main' }, text: 'Recovered A', displayText: null,
    skill: null, template: null, attachments: [], references: [], intent: null }]
  const actions = mountActions()
  const sending = actions.send('keep this draft')
  await entered
  actions.stop()
  takeRecoveredAgentDraft('recovered-a', 'uuid-a', { laneName: 'main', sessionId: 'session-main' })
  ack.resolve({ ok: true })
  expect(await sending).toBe(true)
  expect(fixture.state.projectAgentRecoveredDrafts.some(draft => draft.text === 'keep this draft')).toBe(false)
  expect(fixture.state.projectAgentAdmissionId).toBeNull()
})


describe('creation send-time storyboard target', () => {
  it('keeps the source captured at input time when the document changes before admission', async () => {
    let release!: (models: never[]) => void
    fixture.models.mockReturnValue(new Promise<never[]>(resolve => { release = resolve }))
    fixture.say.mockResolvedValue({ ok: true })
    const sending = mountActions('creation').send('make storyboard')
    fixture.state.activeDocumentId = 'doc-2'
    release([])
    expect(await sending).toBe(true)
    expect(fixture.say.mock.calls[0][2].storyboardTarget).toMatchObject({
      projectId: 'project-a', sourceDocumentId: 'doc-1', targetKind: 'storyboard',
      requestId: expect.any(String), plans: [], sourceDocumentRevision: expect.any(Number),
    })
    // No Run is preallocated any more: a turn that does not name a plan is a turn that has not
    // decided yet, and the model — not the host — decides between creating and editing.
    expect(fixture.say.mock.calls[0][2].storyboardTarget).not.toHaveProperty('targetRunId')
    fixture.state.activeDocumentId = 'doc-1'
  })
  it('hands the model this document\'s existing plans so it can name one', async () => {
    fixture.say.mockResolvedValue({ ok: true })
    fixture.state.storyboardDesignsByDocumentId = { 'doc-1': [{ id: 'op-a', title: 'Seaside' }, { id: 'op-b', title: 'Night' }] }
    await mountActions('creation').send('change the second shot')
    expect(fixture.say.mock.calls[0][2].storyboardTarget.plans)
      .toEqual([{ id: 'op-a', title: 'Seaside' }, { id: 'op-b', title: 'Night' }])
    fixture.state.storyboardDesignsByDocumentId = {}
  })
})

it('captures stable shot references against the plan they name and refuses chips from another plan',async()=>{
  const {buildStoryboardReference}=await import('../resident/residentReferences')
  fixture.state.storyboardDesignsByDocumentId={'doc-1':[{id:'plan-a',title:'A'},{id:'plan-b',title:'B'}]}
  fixture.state.activeStoryboardId='plan-a'
  fixture.state.projectAgentReferences=[buildStoryboardReference('shot',1,'Shot 1','selected',{documentId:'doc-1',designId:'plan-a',shotId:'stable-id'})]
  fixture.say.mockResolvedValue({ok:true})
  const actions=mountActions('creation')
  expect(await actions.send('edit selected')).toBe(true)
  expect(fixture.say.mock.calls[0][2].storyboardTarget.shotIds).toEqual(['stable-id'])
  expect(fixture.say.mock.calls[0][2].storyboardTarget.designId).toBe('plan-a')
  fixture.state.projectAgentReferences=[buildStoryboardReference('shot',1,'Shot 1','selected',{documentId:'doc-1',designId:'plan-a',shotId:'stable-id'})]
  fixture.state.activeStoryboardId='plan-b'
  expect(await actions.send('edit selected')).toBe(false)
  expect(fixture.say).toHaveBeenCalledTimes(1)
  fixture.state.activeStoryboardId=null;fixture.state.storyboardDesignsByDocumentId={};fixture.state.projectAgentReferences=[]
})

it('ACK consumes only captured storyboard references, preserving a newer selection and failed-send references',async()=>{
  const {buildStoryboardReference}=await import('../resident/residentReferences')
  fixture.state.storyboardDesignsByDocumentId={'doc-1':[{id:'plan-a',title:'A'}]}
  fixture.state.activeStoryboardId='plan-a'
  const old=buildStoryboardReference('shot',1,'old','selected',{documentId:'doc-1',designId:'plan-a',shotId:'old'})
  const newer=buildStoryboardReference('shot',2,'new','selected',{documentId:'doc-1',designId:'plan-a',shotId:'new'})
  fixture.state.projectAgentReferences=[old]
  let finish!:(value:{ok:boolean})=>void
  fixture.say.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const actions=mountActions('creation')
  const sending=actions.send('edit old')
  await vi.waitFor(()=>expect(fixture.say).toHaveBeenCalledTimes(1))
  fixture.state.projectAgentReferences=[old,newer]
  finish({ok:true});expect(await sending).toBe(true)
  expect(fixture.state.projectAgentReferences).toEqual([newer])
  fixture.say.mockRejectedValue(new Error('transport failed'))
  expect(await actions.send('edit new')).toBe(false)
  expect(fixture.state.projectAgentReferences).toEqual([newer])
  fixture.state.activeStoryboardId=null;fixture.state.storyboardDesignsByDocumentId={};fixture.state.projectAgentReferences=[]
})
