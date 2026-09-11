import { listAvailableModelsForAgent } from "../../generationCanvas/agent/availableModels"
// Composer intent and input remain local; the lane owns execution and approvals.
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { DocumentAnchorRef, PreconditionSet, TargetRef } from '../../../../electron/shared/capabilityTargeting'
import { laneClient, type LaneCommandResult } from '../lane/laneClient'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { timelineRevision } from '../../timeline/kernel/timelineKernel'
import type { CreationDocumentTools } from '../../workbenchTypes'
import { projectAgentAttachmentClaims, composerAttachmentsFromProjectAgentRefs } from '../projectAgentAttachments'
import { buildResidentContextSnapshot, type AgentContextSnapshot } from '../resident/residentContextSnapshot'
import { composeResidentSystemPrompt } from '../resident/residentPromptSelection'
import { friendlyError, type ResidentSurface } from '../resident/residentShellDisplay'
import { LaneCommandFailure } from '../lane/laneCommandFailure'
import { buildStaticAgentSystemPrompt } from '../../generationCanvas/agent/canvasSystemPrompt'
import { getCreationAiMode } from '../../creation/creationAiModes'
import { runProposalUndo, getCommittedProposal } from '../../generationCanvas/agent/proposalUndo'
import { undoableLaneToolCallId } from '../lane/laneReceiptUndo'
import type { PermissionTier } from './agentPanelV4Types'
import { approvalPolicyForTier } from './agentPanelV4Logic'
import type { AgentPanelV4Data } from './useAgentPanelV4Data'
import type { LibraryPrompt } from '../../api/promptLibraryApi'

const isDocumentSurface = (surface: ResidentSurface): boolean => surface === 'creation' || surface === 'storyboard'

type ResidentSendContext = Readonly<{
  snapshot: AgentContextSnapshot
  activeDocumentId: string
  selectedNodeIds: readonly string[]
  selectedClipIds: readonly string[]
  documentState?: Readonly<{ revision: number; contentHash: string; anchor: DocumentAnchorRef }>
}>

/**
 * 在 enqueue **前的同一个同步回合里**把所有域选中读一遍。
 * composer 绝不能发一个「用户打字期间已经变了的」渲染期选中：这份快照由纯构造器冻结，
 * 随请求一起走。
 */
function captureSendContext(surface: ResidentSurface, creationDocumentTools: CreationDocumentTools | null): ResidentSendContext {
  const workbench = useWorkbenchStore.getState()
  const canvas = useGenerationCanvasStore.getState()
  const activeDocumentId = workbench.activeDocumentId
  const document = workbench.workbenchDocuments.find((item) => item.id === activeDocumentId)
  // 编辑器桥只在创作面活着时权威。生成/预览面可能在编辑器拆掉之后仍然挂着面板，
  // 在那里探这座桥会让一次本来合法的发送失败，或者抓到一个陈旧的锚点。
  const documentState = isDocumentSurface(surface) ? creationDocumentTools?.readState() : undefined
  const selectedNodeIds = surface === 'generation' ? Object.freeze([...canvas.selectedNodeIds]) : Object.freeze([])
  const selectedClipIds = surface === 'preview' ? Object.freeze([...workbench.selectedTimelineClipIds]) : Object.freeze([])
  const snapshot = buildResidentContextSnapshot({
    document: document
      ? {
          id: document.id,
          revision: documentState?.revision ?? workbench.persistRevision,
          anchor: documentState?.anchor ?? { kind: 'whole-document' },
          title: document.title,
        }
      : null,
    canvas: surface === 'generation'
      ? { revision: canvas.persistRevision, nodes: canvas.nodes, selectedNodeIds }
      : null,
    timeline: surface === 'preview'
      ? {
          revision: timelineRevision(workbench.timeline),
          fps: workbench.timeline.fps,
          clips: workbench.timeline.tracks.flatMap((track) => track.clips),
          selectedClipIds,
        }
      : null,
  })
  return Object.freeze({ snapshot, activeDocumentId, selectedNodeIds, selectedClipIds, ...(documentState ? { documentState } : {}) })
}

export type AgentPanelV4Actions = Readonly<{
  error: string
  clearError: () => void
  /** True means the lane accepted the input, not that the model or generation succeeded. */
  send: (text: string, options?: { skillKey?: string; displayText?: string; continueFromEntryId?: string; choice?: 'primary' | 'secondary' }) => Promise<boolean>
  stop: () => void
  approve: () => void
  reject: (reason?: string) => void
  /** Allow this capability for this lane session; never widens project policy. */
  stopAsking: () => void
  answerOption: (option: string) => void
  queueAction: (rowIndex: number, action: string) => void
  queueInterrupt: (rowIndex: number) => void
  newThread: () => void
  activateThread: (threadId: string) => void
  removeThread: (threadId: string) => void
  undoTool: (toolCallId: string) => void
  selectedLibraryPrompt: LibraryPrompt | null
  setSelectedLibraryPrompt: (prompt: LibraryPrompt | null) => void
  permission: PermissionTier
  setPermission: (tier: PermissionTier) => void
}>

export function useAgentPanelV4Actions(surface: ResidentSurface, data: AgentPanelV4Data): AgentPanelV4Actions {
  const { t } = useTranslation()
  const [error, setError] = React.useState('')
  const selectedLibraryPrompt = useWorkbenchStore((state) => state.selectedLibraryPrompt)
  const setSelectedLibraryPrompt = useWorkbenchStore((state) => state.setSelectedLibraryPrompt)
  const setDraft = useWorkbenchStore((state) => state.setProjectAgentDraft)
  const approvalPolicy = useWorkbenchStore((state) => state.projectAgentApprovalPolicy)
  const setApprovalPolicy = useWorkbenchStore((state) => state.setProjectAgentApprovalPolicy)
  const owner = laneClient.context()
  const checked = React.useCallback(async (command: Promise<LaneCommandResult>) => {
    const result = await command
    if (!result.ok) throw new LaneCommandFailure(result.code, result.diagnostic)
    if (result.restoredInput?.length) {
      const draft = useWorkbenchStore.getState().projectAgentDraft
      setDraft([draft, ...result.restoredInput.map((entry) => entry.text)].filter(Boolean).join('\n'))
      const restored = composerAttachmentsFromProjectAgentRefs(result.restoredInput.flatMap((entry) => [...entry.attachments ?? []]))
      useWorkbenchStore.getState().setProjectAgentAttachments((existing) => {
        const byId = new Map(existing.map((attachment) => [attachment.id, attachment]))
        for (const attachment of restored) byId.set(attachment.id, attachment)
        return [...byId.values()]
      })
    }
    return result
  }, [setDraft])
  const run = React.useCallback((command: () => Promise<unknown>) => {
    void command().catch((caught: unknown) => setError(friendlyError(caught, t)))
  }, [t])

  const send = React.useCallback(async (rawText: string, options?: { skillKey?: string; displayText?: string; continueFromEntryId?: string; choice?: 'primary' | 'secondary' }) => {
    const text = rawText.trim()
    if (!text) return false
    setError('')
    const state = useWorkbenchStore.getState()
    const owner = laneClient.context()
    if (state.projectAgentAttachments.some((attachment) => attachment.status === 'uploading')) {
      setError(t('creationAi.attachmentsUploading'))
      return false
    }
    try {
      const captured = captureSendContext(surface, state.creationDocumentTools)
      const availableModels = await listAvailableModelsForAgent()
      if (laneClient.context() !== owner) return false
      let target: TargetRef
      let preconditions: PreconditionSet | undefined
      if (isDocumentSurface(surface)) {
        target = { kind: 'document', documentId: captured.activeDocumentId,
          anchor: captured.documentState?.anchor ?? { kind: 'whole-document' } }
        if (captured.documentState) preconditions = { document: {
          revision: captured.documentState.revision, contentHash: captured.documentState.contentHash,
        } }
      } else if (surface === 'preview') target = { kind: 'timeline', clipIds: captured.selectedClipIds }
      else target = { kind: 'canvas', nodeIds: captured.selectedNodeIds }
      const surfacePrompt = surface === 'generation' ? buildStaticAgentSystemPrompt('agent')
        : surface === 'preview' ? buildStaticAgentSystemPrompt('agent', 'timeline')
          : !state.creationActiveSkill ? getCreationAiMode(state.creationAiModeId).prompt : undefined
      await checked(laneClient.say(text, options?.choice ?? 'primary', {
        ...(data.selectedModel ? { model: { vendorKey: data.selectedModel.vendorKey, modelKey: data.selectedModel.modelKey } } : {}),
        approvalPolicy: state.projectAgentApprovalPolicy,
        documentId: captured.activeDocumentId,
        target, preconditions,
        contextSnapshot: captured.snapshot,
        availableModels,
        attachments: projectAgentAttachmentClaims(state.projectAgentAttachments),
        systemPrompt: composeResidentSystemPrompt(surfacePrompt, state.creationActiveSkill ? null : selectedLibraryPrompt),
        skillKey: options?.skillKey ?? state.creationActiveSkill?.key,
        displayText: options?.displayText,
        ...(options?.continueFromEntryId ? { continueFromEntryId: options.continueFromEntryId } : {}),
      }))
      if (laneClient.context() !== owner) return false
      const sentIds = new Set(state.projectAgentAttachments.map((attachment) => attachment.id))
      state.setProjectAgentAttachments((current) => current.filter((attachment) => !sentIds.has(attachment.id)))
      // 技能 / 提示词是**随这条消息发出去的引用**（和 @ 素材、附件同语义），不是一个常驻开关。
      // 挂着不摘，用户读到的是「以后每条都得用这个技能」（2026-09-10 用户看走查截图后的反馈）。
      // 它进没进这一轮由转录自己作证（用户气泡的 chip + 回复头上的凭据），不靠 composer 挂着。
      // **只在成功那条路上摘**：发失败了那句话还得重发，把他刚选的东西撤掉是让他白干一遍。
      state.setCreationActiveSkill(null)
      if (useWorkbenchStore.getState().projectAgentDraft.trim() === text) setDraft('')
      return true
    } catch (caught) { setError(friendlyError(caught, t)); return false }
  }, [checked, data.selectedModel, selectedLibraryPrompt, setDraft, surface, t])

  const answer = (action: 'allow-once' | 'allow-session' | 'deny', reason?: string) => {
    const pending = data.primaryPending
    if (!pending) return
    run(() => checked(action === 'deny' ? laneClient.deny(pending.toolCallId, reason)
      : action === 'allow-session' ? laneClient.approveForSession(pending.toolCallId)
        : laneClient.approve(pending.toolCallId)))
  }
  const cancelQueued = async (rowIndex: number) => {
    const queued = data.snapshot.active.queues[rowIndex]
    if (!queued) return
    const result = await checked(laneClient.cancelQueued(queued.entryId))
    if (result.cancelQueued !== 'cancelled') {
      throw new Error(t(result.cancelQueued === 'already_consumed'
        ? 'agentPanelV4.queueAlreadyConsumed' : 'agentPanelV4.queueNotFound'))
    }
  }
  const newLaneName = () => {
    const names = new Set(laneClient.lanes().map((lane) => lane.laneName))
    let number = names.size + 1
    while (names.has(t('agentPanelV4.newConversation', { number }))) number += 1
    return t('agentPanelV4.newConversation', { number })
  }
  return {
    error, clearError: () => setError(''), send,
    stop: () => run(() => checked(laneClient.abort())),
    approve: () => answer('allow-once'),
    reject: (reason) => answer('deny', reason),
    stopAsking: () => answer('allow-session'),
    answerOption: (option) => { setDraft(option) },
    queueAction: (index) => run(() => cancelQueued(index)),
    queueInterrupt: (index) => run(() => cancelQueued(index)),
    newThread: () => run(() => checked(laneClient.createLane(newLaneName()))),
    activateThread: (name) => run(() => checked(laneClient.selectLane(name))),
    removeThread: (name) => run(async () => {
      if (laneClient.projection().lane === name) {
        const other = laneClient.lanes().find((lane) => lane.laneName !== name)
        await checked(other ? laneClient.selectLane(other.laneName) : laneClient.createLane(newLaneName()))
      }
      await checked(laneClient.deleteLane(name))
    }),
    undoTool: (toolCallId) => {
      const current = laneClient.context()
      if (!owner || current?.subscriptionId !== owner.subscriptionId
        || laneClient.projection().lane !== data.snapshot.active.lane) return
      const record = getCommittedProposal()
      if (record && undoableLaneToolCallId(laneClient.projection().parts, record) === toolCallId) {
        run(() => runProposalUndo(record))
      }
    },
    selectedLibraryPrompt, setSelectedLibraryPrompt,
    permission: approvalPolicy.mode,
    setPermission: (tier) => run(async () => {
      const policy = approvalPolicyForTier(tier)
      await checked(laneClient.setPolicy(policy))
      setApprovalPolicy(policy)
    }),
  }
}
