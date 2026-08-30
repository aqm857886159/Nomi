import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconCheck,
  IconChevronDown,
  IconPaperclip,
  IconPencil,
  IconPlayerStopFilled,
  IconPlus,
  IconSend2,
  IconTrash,
  IconX,
  IconCursorText,
} from '@tabler/icons-react'
import { NomiAILabel, NomiLogoMark, WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import { useWorkbenchStore, type WorkspaceMode } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { runWorkbenchAgent, type ToolCallEvent } from './workbenchAgentRunner'
import { stopProjectAgentTurn } from './projectAgentTurnCommands'
import {
  activateProjectAgentThread,
  createProjectAgentThread,
  editProjectAgentQueueItem,
  removeProjectAgentThread,
} from './projectAgentUiCommands'
import { useProjectAgentSnapshot } from './useProjectAgentThreadMessages'
import { projectAgentAttachmentClaims } from './projectAgentAttachments'
import { useComposerAttachments, COMPOSER_ATTACHMENT_ACCEPT } from './composer/useComposerAttachments'
import { AttachmentRail } from './composer/AttachmentRail'
import { AutoGrowTextarea } from './composer/AutoGrowTextarea'
import AssistantModelPicker from './AssistantModelPicker'
import CreationPromptPicker from './CreationPromptPicker'
import { getCreationAiMode } from '../creation/creationAiModes'
import type { ComposerAttachment } from './composer/composerAttachmentTypes'
import type { ProjectAgentItem, ProjectAgentQueueItem, ProjectAgentStatus } from '../../../electron/shared/projectAgentContracts'
import type { PreconditionSet, TargetRef } from '../../../electron/shared/capabilityTargeting'
import { useProductionRunStore } from '../production/productionRunStore'

type ResidentSurface = Extract<WorkspaceMode, 'creation' | 'generation' | 'preview'>
type Mode = 'agent' | 'chat' | 'refine'

type PendingTool = {
  call: ToolCallEvent
  bindingKey: string
  state: 'pending' | 'approved' | 'denied'
}

// Tool decisions are transport-lifetime state, not transcript state. Keeping the
// tiny pending registry outside the Dock lets a workspace switch remount the
// portal without orphaning an approval callback owned by the Host coordinator.
const residentPendingTools = new Map<string, PendingTool>()
const residentPendingListeners = new Set<() => void>()

function pendingKey(call: Pick<ToolCallEvent, 'turnId' | 'toolCallId'>): string {
  return `${call.turnId}:${call.toolCallId}`
}

function notifyPendingTools(): void {
  residentPendingListeners.forEach((listener) => listener())
}

function clearResidentPendingTools(turnId: string): void {
  let changed = false
  for (const key of residentPendingTools.keys()) {
    if (key.startsWith(`${turnId}:`)) {
      residentPendingTools.delete(key)
      changed = true
    }
  }
  if (changed) notifyPendingTools()
}

function useResidentPendingTools(bindingKey: string | null): PendingTool[] {
  const [, redraw] = React.useState(0)
  React.useEffect(() => {
    const listener = () => redraw((value) => value + 1)
    residentPendingListeners.add(listener)
    return () => {
      residentPendingListeners.delete(listener)
    }
  }, [])
  if (!bindingKey) return []
  return Array.from(residentPendingTools.values()).filter((pending) => pending.bindingKey === bindingKey)
}

function projectBindingKey(binding: { immutableProjectUuid: string; projectGeneration: number }): string {
  return `${binding.immutableProjectUuid}:${binding.projectGeneration}`
}

function isLive(status: ProjectAgentStatus): boolean {
  return status === 'drafting' || status === 'proposed' || status === 'queued' || status === 'running'
}

function surfaceLabel(t: (key: string, options?: Record<string, unknown>) => string, surface: ResidentSurface): string {
  if (surface === 'generation') return t('agentResident.contextGeneration')
  if (surface === 'preview') return t('agentResident.contextPreview')
  return t('agentResident.contextCreation')
}

function statusLabel(t: (key: string, options?: Record<string, unknown>) => string, status: ProjectAgentStatus): string {
  const key = status === 'drafting' || status === 'proposed' ? 'queued' : status === 'declined' ? 'stopped' : status
  return t(`agentResident.${key}`)
}

function friendlyAgentError(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const code = error instanceof Error ? error.message : ''
  if (code === 'project_agent_unavailable' || code === 'project_binding_stale') {
    return t('agentResident.unavailable')
  }
  return t('agentResident.sendFailed')
}

function itemText(item: ProjectAgentItem, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (item.kind) {
    case 'user': return item.text
    case 'assistant': return item.text
    case 'tool': return item.text ?? t('agentResident.toolAction')
    case 'failure': return item.message
    case 'task': return item.task.kind === 'production-run' ? item.task.runId : item.task.jobId
    case 'artifact': return item.artifact.artifactId
    case 'proposal': return item.approval ? item.approval.approvalId : item.humanApproval.challengeId
  }
}

function itemTone(item: ProjectAgentItem): string {
  if (item.kind === 'user') return 'ml-auto bg-nomi-ink text-nomi-paper'
  if (item.kind === 'failure') return 'border-workbench-danger bg-workbench-danger-soft text-workbench-danger'
  if (item.kind === 'proposal') return 'border-nomi-accent bg-nomi-accent-soft text-nomi-ink'
  return 'bg-nomi-ink-05 text-nomi-ink'
}

function attachmentPayloads(attachments: readonly ComposerAttachment[]) {
  return attachments
    .filter((item) => item.status === 'ready' && item.url)
    .map((item) => ({
      url: item.url!,
      contentType: item.contentType,
      fileName: item.fileName,
      kind: item.kind,
    }))
}

function userItemForQueue(snapshot: NonNullable<ReturnType<typeof useProjectAgentSnapshot>>, queue: ProjectAgentQueueItem) {
  return snapshot.items.find((item) => item.kind === 'user' && item.turnId === queue.turnId)
}

export default function ProjectAgentResidentShell({ surface }: { surface: ResidentSurface }): JSX.Element {
  const { t } = useTranslation()
  const snapshot = useProjectAgentSnapshot()
  const collapsed = useWorkbenchStore((state) => state.projectAgentDockCollapsed)
  const setCollapsed = useWorkbenchStore((state) => state.setProjectAgentDockCollapsed)
  const draft = useWorkbenchStore((state) => state.projectAgentDraft)
  const setDraft = useWorkbenchStore((state) => state.setProjectAgentDraft)
  const attachments = useWorkbenchStore((state) => state.projectAgentAttachments)
  const setAttachments = useWorkbenchStore((state) => state.setProjectAgentAttachments)
  const activeDocumentId = useWorkbenchStore((state) => state.activeDocumentId)
  const creationDocumentTools = useWorkbenchStore((state) => state.creationDocumentTools)
  const promptModeId = useWorkbenchStore((state) => state.creationAiModeId)
  const activeSkill = useWorkbenchStore((state) => state.creationActiveSkill)
  const setPromptModeId = useWorkbenchStore((state) => state.setCreationAiModeId)
  const setActiveSkill = useWorkbenchStore((state) => state.setCreationActiveSkill)
  const selectedClipIds = useWorkbenchStore((state) => state.selectedTimelineClipIds)
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const [mode, setMode] = React.useState<Mode>('agent')
  const [threadsOpen, setThreadsOpen] = React.useState(false)
  const bindingKey = snapshot ? projectBindingKey(snapshot.binding) : null
  const pendingTools = useResidentPendingTools(bindingKey)
  const [editingQueue, setEditingQueue] = React.useState<{ queueItemId: string; userItemId: string } | null>(null)
  const [error, setError] = React.useState('')
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const runRef = React.useRef<string | null>(null)

  const activeThreadId = snapshot?.activeThreadId ?? null
  const activeThread = snapshot?.threads.find((thread) => thread.threadId === activeThreadId)
  const activeTurn = snapshot?.turns.find((turn) => turn.threadId === activeThreadId && isLive(turn.status))
  const runningTurn = snapshot?.turns.find((turn) => turn.threadId === activeThreadId && turn.status === 'running')
  const queue = React.useMemo(
    () => snapshot?.queue.filter((item) => item.threadId === activeThreadId) ?? [],
    [activeThreadId, snapshot],
  )
  const items = React.useMemo(
    () => snapshot?.items.filter((item) => item.threadId === activeThreadId) ?? [],
    [activeThreadId, snapshot],
  )
  const openTaskRef = React.useCallback((item: Extract<ProjectAgentItem, { kind: 'task' | 'artifact' }>) => {
    const projectId = snapshot?.binding.projectId
    if (!projectId) return
    window.dispatchEvent(new Event('nomi-open-task-center'))
    if (item.kind === 'task' && item.task.kind === 'production-run') {
      void useProductionRunStore.getState().navigateTo(projectId, item.task.runId).catch((caught) => setError(friendlyAgentError(caught, t)))
    }
    if (item.kind === 'artifact') {
      void useProductionRunStore.getState().navigateTo(projectId, item.artifact.runId, item.artifact.artifactId).catch((caught) => setError(friendlyAgentError(caught, t)))
    }
  }, [snapshot, t])
  const retryFailure = React.useCallback((item: Extract<ProjectAgentItem, { kind: 'failure' }>) => {
    const user = items.find((candidate) => candidate.kind === 'user' && candidate.turnId === item.turnId)
    if (user?.kind !== 'user') return
    setDraft(user.text)
    setError('')
  }, [items, setDraft])
  const stopTurn = React.useCallback(async (turnId: string) => {
    try {
      await stopProjectAgentTurn(turnId)
    } catch (caught) {
      setError(friendlyAgentError(caught, t))
    }
  }, [t])
  const setAttachmentState = React.useCallback((updater: (previous: ComposerAttachment[]) => ComposerAttachment[]) => {
    setAttachments(updater)
  }, [setAttachments])
  const attachmentApi = useComposerAttachments({
    attachments,
    setAttachments: setAttachmentState,
    onError: setError,
  })
  const { clearAttachments } = attachmentApi

  React.useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [items.length, activeTurn?.status, pendingTools.length])

  const resolveTool = React.useCallback(async (pending: PendingTool, ok: boolean) => {
    if (pending.state !== 'pending') return
    try {
      await pending.call.confirm({ ok, ...(ok ? {} : { message: t('agentResident.deny') }) })
      const key = pendingKey(pending.call)
      const current = residentPendingTools.get(key)
      if (current) {
        residentPendingTools.set(key, { ...current, state: ok ? 'approved' : 'denied' })
        notifyPendingTools()
      }
    } catch (caught) {
      setError(friendlyAgentError(caught, t))
    }
  }, [t])

  const submit = React.useCallback(async () => {
    const text = draft.trim()
    if (!text || !snapshot) return
    setError('')
    if (editingQueue) {
      try {
        await editProjectAgentQueueItem({ ...editingQueue, text })
        setEditingQueue(null)
        setDraft('')
      } catch (caught) {
        setError(friendlyAgentError(caught, t))
      }
      return
    }
    // Host owns the busy queue; a running turn does not block enqueueing the next
    // request. Only the currently executing turn is stopped with the header action.
    if (attachments.some((item) => item.status === 'uploading')) {
      setError(t('creationAi.attachmentsUploading'))
      return
    }
    const turnId = `turn-resident-${globalThis.crypto.randomUUID()}`
    runRef.current = turnId
    setDraft('')
    const surfaceContext = surfaceLabel(t, surface)
    const contextDetail = surface === 'generation'
      ? t('agentResident.contextNodes', { count: selectedNodeIds.length })
      : surface === 'preview'
        ? t('agentResident.contextClips', { count: selectedClipIds.length })
        : t('agentResident.currentDocument')
    const capability = surface === 'generation' ? 'canvas-agent' as const : surface === 'creation' ? 'creation-editor' as const : 'canvas-chat' as const
    const selectedPrompt = getCreationAiMode(promptModeId)
    const defaultSkillKey = surface === 'generation' ? 'workbench.generation.canvas-planner' : 'workbench.creation.general'
    const skillKey = activeSkill?.key ?? (selectedPrompt.id === 'general' ? defaultSkillKey : `workbench.creation.${selectedPrompt.id}`)
    const skillName = activeSkill?.name ?? selectedPrompt.title
    const readyClaims = projectAgentAttachmentClaims(attachments.filter((item) => item.status === 'ready'))
    const requestAttachments = attachmentPayloads(attachments)
    let target: TargetRef
    let preconditions: PreconditionSet | undefined
    try {
      if (surface === 'creation') {
        const state = creationDocumentTools?.readState()
        target = { kind: 'document', documentId: activeDocumentId, anchor: state?.anchor ?? { kind: 'whole-document' } }
        if (state) preconditions = { document: { revision: state.revision, contentHash: state.contentHash } }
      } else if (surface === 'preview') {
        target = { kind: 'timeline', clipIds: Object.freeze([...selectedClipIds]) }
      } else {
        target = { kind: 'canvas', nodeIds: Object.freeze([...selectedNodeIds]) }
      }
    } catch (caught) {
      setError(friendlyAgentError(caught, t))
      return
    }
    clearAttachments()
    try {
      await runWorkbenchAgent({
        turnId,
        prompt: `${surfaceContext}\n${contextDetail}\n\n${text}`,
        ...(surface === 'creation' && !activeSkill ? { systemPrompt: selectedPrompt.prompt } : {}),
        displayPrompt: text,
        capability,
        history: { kind: 'ephemeral' },
        projectId: snapshot.binding.projectId,
        selectedNodeIds: surface === 'generation' ? selectedNodeIds : undefined,
        target,
        ...(preconditions ? { preconditions } : {}),
        originSurface: { surfaceId: 'project-agent-resident', kind: surface === 'creation' ? 'document' : surface === 'generation' ? 'canvas' : 'preview' },
        mode: mode === 'chat' ? 'chat' : 'auto',
        skillKey,
        skillName,
        attachmentClaims: readyClaims.length ? readyClaims : undefined,
        attachments: requestAttachments,
        onToolCall: async (call) => {
          residentPendingTools.set(pendingKey(call), { call, bindingKey: projectBindingKey(snapshot.binding), state: 'pending' })
          notifyPendingTools()
        },
      })
    } catch (caught) {
      setError(friendlyAgentError(caught, t))
    } finally {
      clearResidentPendingTools(turnId)
      if (runRef.current === turnId) runRef.current = null
    }
  }, [activeDocumentId, activeSkill, attachments, clearAttachments, creationDocumentTools, draft, editingQueue, mode, promptModeId, selectedClipIds, selectedNodeIds, setDraft, snapshot, surface, t])

  const onComposerKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }, [submit])

  if (collapsed) {
    return (
      <button
        type="button"
        className={cn('grid h-full w-full place-items-center bg-nomi-paper text-nomi-ink', 'hover:bg-nomi-ink-05')}
        aria-label={t('agentResident.expand')}
        title={t('agentResident.expand')}
        onClick={() => setCollapsed(false)}
      >
        <NomiLogoMark size={20} />
      </button>
    )
  }

  return (
    <section
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--workbench-ai-panel-bg)] text-nomi-ink"
      aria-label={t('agentResident.aria')}
      data-agent-surface={surface}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-nomi-line-soft px-3 py-2">
        <button
          type="button"
          className="min-w-0 text-left"
          aria-expanded={threadsOpen}
          aria-label={t('agentResident.threads')}
          onClick={() => setThreadsOpen((open) => !open)}
        >
          <span className="flex items-center gap-1.5 text-body-sm font-semibold"><NomiAILabel markSize={18} wordSize={13} /> <IconChevronDown size={14} className={cn('transition-transform', threadsOpen && 'rotate-180')} /></span>
          <span className="block truncate text-micro text-nomi-ink-60">{activeThread?.title || t('agentResident.untitledThread')}</span>
        </button>
        <div className="flex items-center gap-1">
          <WorkbenchIconButton label={t('agentResident.newThread')} icon={<IconPlus size={15} />} onClick={() => { void createProjectAgentThread().catch((caught) => setError(friendlyAgentError(caught, t))); setThreadsOpen(false) }} />
          <WorkbenchIconButton label={t('agentResident.collapse')} icon={<IconX size={15} />} onClick={() => setCollapsed(true)} />
        </div>
        {threadsOpen ? (
          <div className="absolute z-30 mt-20 max-h-64 w-[300px] overflow-auto rounded-nomi border border-nomi-line bg-nomi-paper p-1 shadow-nomi-md">
            <div className="flex items-center justify-between px-2 py-1 text-micro text-nomi-ink-60"><span>{t('agentResident.threads')}</span><button type="button" className="text-nomi-accent" onClick={() => { void createProjectAgentThread().catch((caught) => setError(friendlyAgentError(caught, t))); setThreadsOpen(false) }}>{t('agentResident.newThread')}</button></div>
            {(snapshot?.threads ?? []).map((thread) => (
              <div key={thread.threadId} className={cn('flex items-center gap-1 rounded-nomi-sm px-2 py-1.5', thread.threadId === activeThreadId && 'bg-nomi-accent-soft')}>
                <button type="button" className="min-w-0 flex-1 truncate text-left text-body-sm" onClick={() => { void activateProjectAgentThread(thread.threadId).catch((caught) => setError(friendlyAgentError(caught, t))); setThreadsOpen(false) }}>{thread.title || t('agentResident.untitledThread')}</button>
                <button type="button" className="grid size-6 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-10" aria-label={t('agentResident.removeThread')} onClick={() => { void removeProjectAgentThread(thread.threadId).catch((caught) => setError(friendlyAgentError(caught, t))) }}><IconTrash size={13} /></button>
              </div>
            ))}
          </div>
        ) : null}
      </header>

      <div className="shrink-0 border-b border-nomi-line-soft px-3 py-2">
        <div className="mb-1 text-micro font-medium uppercase tracking-[0.08em] text-nomi-ink-50">{t('agentResident.context')}</div>
        <div className="flex items-center justify-between gap-2 text-body-sm">
          <span className="truncate">{surfaceLabel(t, surface)}</span>
          <span className="shrink-0 text-micro text-nomi-ink-60">{surface === 'generation' ? t('agentResident.contextNodes', { count: selectedNodeIds.length }) : surface === 'preview' ? t('agentResident.contextClips', { count: selectedClipIds.length }) : t('agentResident.currentDocument')}</span>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3" role="log" aria-live="polite">
        {!items.length && !queue.length ? <div className="grid min-h-40 place-items-center px-4 text-center"><div><div className="mb-1 text-body-sm font-medium">{t('agentResident.emptyTitle')}</div><p className="m-0 text-body-sm text-nomi-ink-60">{t('agentResident.emptyDescription')}</p></div></div> : null}
        {items.map((item) => (
          <div key={item.itemId} className={cn('max-w-[90%] rounded-nomi-sm border border-transparent px-2.5 py-2 text-body-sm', itemTone(item))} data-item-kind={item.kind}>
            {item.kind === 'assistant' && !item.text && isLive(item.status) ? <span className="text-nomi-ink-50">{t('creationAi.assistantMessage.processing')}…</span> : null}
            {item.kind !== 'task' && item.kind !== 'artifact' && (item.kind !== 'assistant' || item.text) ? <div className="whitespace-pre-wrap break-words">{itemText(item, t)}</div> : null}
            {item.kind === 'task' ? <div className="mt-1 flex items-center justify-between gap-2 text-micro"><span>{t('agentResident.task', { id: itemText(item, t) })}</span><button type="button" className="shrink-0 text-nomi-accent hover:underline" onClick={() => openTaskRef(item)}>{t('agentResident.openTask')}</button></div> : null}
            {item.kind === 'artifact' ? <div className="mt-1 flex items-center justify-between gap-2 text-micro"><span>{t('agentResident.artifact', { id: itemText(item, t) })}</span><button type="button" className="shrink-0 text-nomi-accent hover:underline" onClick={() => openTaskRef(item)}>{t('agentResident.openArtifact')}</button></div> : null}
            {item.kind === 'failure' && item.retryable ? <button type="button" className="mt-2 text-micro text-nomi-accent hover:underline" onClick={() => retryFailure(item)}>{t('agentResident.retry')}</button> : null}
            {item.kind === 'proposal' && item.approval ? <div className="mt-1 text-micro">{t('agentResident.approval')} · {statusLabel(t, item.status)}</div> : null}
          </div>
        ))}
        {pendingTools.map((pending) => (
          <div key={pending.call.toolCallId} className="rounded-nomi-sm border border-nomi-accent bg-nomi-accent-soft px-2.5 py-2 text-body-sm">
            <div className="font-medium">{t('agentResident.toolCall', { name: t('agentResident.toolAction') })}</div>
            <div className="mt-1 text-micro text-nomi-ink-60">{pending.state === 'pending' ? t('agentResident.waitingApproval') : pending.state === 'approved' ? t('agentResident.approve') : t('agentResident.deny')}</div>
            {pending.state === 'pending' ? <div className="mt-2 flex gap-1.5"><button type="button" className="inline-flex h-7 items-center gap-1 rounded-nomi-sm bg-nomi-ink px-2 text-micro text-nomi-paper" onClick={() => void resolveTool(pending, true)}><IconCheck size={13} />{t('agentResident.approve')}</button><button type="button" className="inline-flex h-7 items-center gap-1 rounded-nomi-sm border border-nomi-line px-2 text-micro" onClick={() => void resolveTool(pending, false)}><IconX size={13} />{t('agentResident.deny')}</button></div> : null}
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-nomi-line-soft bg-nomi-paper">
        <div className="flex items-center justify-between gap-2 px-3 pt-2 text-micro text-nomi-ink-60">
          <span>{t('agentResident.queue')} · {queue.length || t('agentResident.queueEmpty')}</span>
          {runningTurn ? <button type="button" className="inline-flex items-center gap-1 text-workbench-danger" aria-label={t('agentResident.stopAria')} onClick={() => void stopTurn(runningTurn.turnId)}><IconPlayerStopFilled size={12} />{t('agentResident.stop')}</button> : null}
        </div>
        {queue.length ? <div className="space-y-1 px-3 py-1.5">{queue.slice(-3).map((entry) => {
          const user = snapshot ? userItemForQueue(snapshot, entry) : undefined
          return <div key={entry.queueItemId} className="flex items-center gap-2 rounded-nomi-sm bg-nomi-ink-05 px-2 py-1.5 text-micro"><span className="size-1.5 shrink-0 rounded-pill bg-nomi-accent" /><span className="min-w-0 flex-1 truncate">{user?.kind === 'user' ? user.text : entry.turnId}</span><span className="shrink-0 text-nomi-ink-60">{statusLabel(t, entry.status)}</span>{entry.status === 'queued' && user?.kind === 'user' ? <button type="button" className="grid size-6 place-items-center rounded-nomi-sm hover:bg-nomi-ink-10" aria-label={t('agentResident.edit')} onClick={() => { setDraft(user.text); setEditingQueue({ queueItemId: entry.queueItemId, userItemId: user.itemId }) }}><IconPencil size={12} /></button> : null}{isLive(entry.status) ? <button type="button" className="grid size-6 place-items-center rounded-nomi-sm text-workbench-danger hover:bg-workbench-danger-soft" aria-label={t('agentResident.cancel')} onClick={() => void stopTurn(entry.turnId)}><IconX size={12} /></button> : null}</div>
        })}</div> : null}
        {error ? <div className="px-3 pb-1 text-micro text-workbench-danger">{error}</div> : null}
        <form className="grid gap-1.5 px-3 pb-3 pt-1.5" onSubmit={(event) => { event.preventDefault(); void submit() }} {...attachmentApi.dragHandlers}>
          <input ref={attachmentApi.inputRef} type="file" multiple accept={COMPOSER_ATTACHMENT_ACCEPT} className="hidden" tabIndex={-1} aria-hidden="true" onChange={attachmentApi.onInputChange} />
          <AttachmentRail attachments={attachments} onRemove={attachmentApi.removeAttachment} />
          <div className={cn('rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-1.5', attachmentApi.isDragging && 'border-nomi-accent bg-nomi-accent-soft')}>
            <AutoGrowTextarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKeyDown} onPaste={attachmentApi.handlePaste} placeholder={t('agentResident.placeholder')} aria-label={t('agentResident.sendAria')} maxHeight={120} className="min-h-10 text-body-sm" />
            <div className="flex items-center justify-between gap-1 border-t border-nomi-line-soft pt-1">
              <div className="flex min-w-0 items-center gap-1">
                <WorkbenchIconButton label={t('agentResident.attach')} icon={<IconPaperclip size={14} />} onClick={attachmentApi.openFilePicker} />
                <WorkbenchIconButton label={t('agentResident.mention')} icon={<IconCursorText size={14} />} onClick={() => setDraft(`${draft}${draft ? ' ' : ''}@${surface}`)} />
                <select aria-label={t('agentResident.mode')} value={mode} onChange={(event) => setMode(event.target.value as Mode)} className="h-7 max-w-20 rounded-nomi-sm border border-nomi-line bg-transparent px-1 text-micro"><option value="agent">{t('agentResident.modeAgent')}</option><option value="chat">{t('agentResident.modeChat')}</option><option value="refine">{t('agentResident.modeRefine')}</option></select>
                <CreationPromptPicker activeSkill={activeSkill} modeId={promptModeId} onModeChange={setPromptModeId} onSelect={setActiveSkill} />
                <AssistantModelPicker className="h-7 max-w-28" />
              </div>
              <button type="submit" disabled={!draft.trim()} className="grid size-7 shrink-0 place-items-center rounded-nomi-sm bg-nomi-ink text-nomi-paper disabled:opacity-30" aria-label={t('agentResident.sendAria')}><IconSend2 size={14} /></button>
            </div>
          </div>
        </form>
      </div>
    </section>
  )
}
