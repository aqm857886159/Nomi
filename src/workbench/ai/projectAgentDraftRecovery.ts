import type { LaneConversationRef } from '../../../electron/shared/agentLane/laneContracts'
import type { LaneDraftIntent, LaneRestoredDesktopInput } from '../../../electron/shared/agentLane/laneDesktopContracts'
import type { LibraryPrompt } from '../api/promptLibraryApi'
import { useWorkbenchStore, type ProjectAgentReference } from '../workbenchStore'
import type { ComposerAttachment } from './composer/composerAttachmentTypes'
import { composerAttachmentsFromProjectAgentRefs } from './projectAgentAttachments'
import { isProjectExecutionContextCurrent, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'

type DraftBuffer = {
  text: string
  displayText: string | null
  skill: { key: string; contentHash?: string } | null
  template: LibraryPrompt | null
  attachments: ComposerAttachment[]
  references: ProjectAgentReference[]
  intent: LaneDraftIntent | null
}
export type RecoveredAgentDraft = DraftBuffer & { id: string; projectUuid: string; conversation: LaneConversationRef }
/** These are editable, unsent inputs in the existing project composer, never lane history or a second queue. */
export type ProjectAgentDraftRecoveryState = {
  projectAgentRecoveredDrafts: RecoveredAgentDraft[]
  projectAgentDraftIntent: LaneDraftIntent | null
  projectAgentDraftDisplayText: string | null
  /** Only the catalog/IPC admission wait; lane execution remains independently cancellable. */
  projectAgentAdmissionId: string | null
}

function currentBuffer(): DraftBuffer {
  const state = useWorkbenchStore.getState()
  return { text: state.projectAgentDraft, displayText: state.projectAgentDraftDisplayText,
    skill: state.creationActiveSkill, template: state.selectedLibraryPrompt,
    attachments: state.projectAgentAttachments, references: state.projectAgentReferences,
    intent: state.projectAgentDraftIntent }
}
function occupied(draft: DraftBuffer): boolean {
  return Boolean(draft.text.trim() || draft.skill || draft.template || draft.attachments.length || draft.references.length || draft.intent)
}
function bufferPatch(draft: DraftBuffer) {
  return { projectAgentDraft: draft.text, projectAgentDraftDisplayText: draft.displayText,
    creationActiveSkill: draft.skill, selectedLibraryPrompt: draft.template,
    projectAgentAttachments: draft.attachments, projectAgentReferences: draft.references,
    projectAgentDraftIntent: draft.intent }
}
export function restoreProjectAgentInputs(projectUuid: string, conversation: LaneConversationRef, inputs: readonly LaneRestoredDesktopInput[], isCurrent: boolean): void {
  if (!inputs.length) return
  const recovered: RecoveredAgentDraft[] = inputs.map(input => ({
    id: crypto.randomUUID(), projectUuid, conversation, text: input.text, displayText: input.displayText ?? null,
    skill: input.skillKey ? { key: input.skillKey,
      ...(input.skillSnapshot ? { contentHash: input.skillSnapshot.contentHash } : {}) } : null,
    template: null, references: [], intent: input.intent ?? null,
    attachments: composerAttachmentsFromProjectAgentRefs(input.attachments ?? []),
  }))
  const state = useWorkbenchStore.getState()
  const first = isCurrent && !state.projectAgentAdmissionId && !occupied(currentBuffer()) ? recovered.shift() : undefined
  useWorkbenchStore.setState({
    projectAgentRecoveredDrafts: [...state.projectAgentRecoveredDrafts, ...recovered],
    ...(first ? { ...bufferPatch(first), projectAgentDraftRevision: state.projectAgentDraftRevision + 1 } : {}),
  })
}

/** Taking back a draft swaps complete buffers, so current text, skill and files remain available. */
export function takeRecoveredAgentDraft(id: string, projectUuid: string, conversation: LaneConversationRef): void {
  const state = useWorkbenchStore.getState()
  if (state.projectAgentAdmissionId) return
  const picked = state.projectAgentRecoveredDrafts.find(draft => draft.id === id)
  if (!picked || picked.projectUuid !== projectUuid || picked.conversation.sessionId !== conversation.sessionId || picked.conversation.laneName !== conversation.laneName) return
  const remaining = state.projectAgentRecoveredDrafts.filter(draft => draft.id !== id)
  const current = currentBuffer()
  if (occupied(current)) remaining.push({ ...current, id: crypto.randomUUID(), projectUuid, conversation })
  useWorkbenchStore.setState({ ...bufferPatch(picked), projectAgentRecoveredDrafts: remaining,
    projectAgentDraftRevision: state.projectAgentDraftRevision + 1 })
}

export function discardRecoveredAgentDraft(id: string, projectUuid: string, conversation: LaneConversationRef): void {
  useWorkbenchStore.setState(state => ({ projectAgentRecoveredDrafts: state.projectAgentRecoveredDrafts.filter(draft =>
    draft.id !== id || draft.projectUuid !== projectUuid || draft.conversation.sessionId !== conversation.sessionId
      || draft.conversation.laneName !== conversation.laneName) }))
}

/** Upload settlement follows the unique attachment in its original project, even after a buffer swap. */
export function settleProjectAgentAttachment(context: ProjectExecutionContext, id: string, update: (item: ComposerAttachment) => ComposerAttachment): void {
  useWorkbenchStore.setState(state => {
    const settle = (items: ComposerAttachment[]) => items.some(item => item.id === id)
      ? items.map(item => item.id === id ? update(item) : item) : items
    const attachments = isProjectExecutionContextCurrent(context) ? settle(state.projectAgentAttachments) : state.projectAgentAttachments
    return {
      projectAgentAttachments: attachments,
      projectAgentDraftRevision: state.projectAgentDraftRevision + (attachments === state.projectAgentAttachments ? 0 : 1),
      projectAgentRecoveredDrafts: state.projectAgentRecoveredDrafts.map(draft =>
        draft.projectUuid === context.binding.immutableProjectUuid
          ? { ...draft, attachments: settle(draft.attachments) } : draft),
    }
  })
}
