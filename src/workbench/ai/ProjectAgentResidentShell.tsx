import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle, IconAperture, IconArrowUp, IconAt, IconBolt, IconCheck,
  IconAdjustmentsHorizontal, IconChevronLeft, IconChevronRight, IconCircleDashed, IconExternalLink, IconFileText, IconFilePencil,
  IconHistory, IconLayoutSidebarRightCollapse, IconListCheck, IconLoader2, IconLock, IconMicrophone, IconPaperclip, IconPencil, IconPhoto,
  IconMessageQuestion, IconRobot, IconRoute, IconSearch, IconSettings, IconTextSpellcheck, IconTimelineEvent, IconTool, IconWaveSine,
  IconPlayerStopFilled, IconPlus, IconTrash, IconVideo, IconWorld, IconWorldSearch, IconX,
} from '@tabler/icons-react'
import { NomiLogoMark, WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import { useWorkbenchStore, type ProjectAgentReference, type ProjectAgentRunMode, type WorkspaceMode } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { runWorkbenchAgent, type ToolCallEvent } from './workbenchAgentRunner'
import { stopProjectAgentTurn } from './projectAgentTurnCommands'
import { activateProjectAgentThread, createProjectAgentThread, editProjectAgentQueueItem, removeProjectAgentThread } from './projectAgentUiCommands'
import { useProjectAgentSnapshot } from './useProjectAgentThreadMessages'
import { projectAgentAttachmentClaims } from './projectAgentAttachments'
import { useComposerAttachments, COMPOSER_ATTACHMENT_ACCEPT } from './composer/useComposerAttachments'
import { AttachmentRail } from './composer/AttachmentRail'
import { AutoGrowTextarea } from './composer/AutoGrowTextarea'
import { getCreationAiMode } from '../creation/creationAiModes'
import { getAvailableSkillProviders, listWorkbenchSkills, providerLabel, skillCapabilityFor, type SkillListItemDto } from '../api/skillApi'
import { listWorkbenchModelCatalogModels, listWorkbenchModelCatalogVendors, type ModelCatalogModelDto } from '../api/modelCatalogApi'
import { decodeModelIdentity, encodeModelIdentity, filterUsableAssistantTextModels, labelForModel } from './assistantModelIdentity'
import { getAssistantModelPref, setAssistantModelPref } from './assistantModelPref'
import type { ComposerAttachment } from './composer/composerAttachmentTypes'
import type { ProjectAgentItem, ProjectAgentQueueItem, ProjectAgentStatus } from '../../../electron/shared/projectAgentContracts'
import type { PreconditionSet, TargetRef } from '../../../electron/shared/capabilityTargeting'
import { useProductionRunStore } from '../production/productionRunStore'

type ResidentSurface = Extract<WorkspaceMode, 'creation' | 'generation' | 'preview'>
type PendingTool = { call: ToolCallEvent; bindingKey: string; state: 'pending' | 'approved' | 'denied' }
type MenuId = 'attachments' | 'references' | 'skills' | 'prompts' | 'modes' | 'models' | null

const residentPendingTools = new Map<string, PendingTool>()
const residentPendingListeners = new Set<() => void>()
const residentResolvingTools = new Set<string>()
const pendingKey = (call: Pick<ToolCallEvent, 'turnId' | 'toolCallId'>): string => `${call.turnId}:${call.toolCallId}`
const bindingKey = (binding: { immutableProjectUuid: string; projectGeneration: number }): string => `${binding.immutableProjectUuid}:${binding.projectGeneration}`
const isLive = (status: ProjectAgentStatus): boolean => ['drafting', 'proposed', 'queued', 'running'].includes(status)
const emitPending = (): void => residentPendingListeners.forEach((listener) => listener())

function clearResidentPendingTools(turnId: string): void {
  let changed = false
  for (const key of residentPendingTools.keys()) {
    if (!key.startsWith(`${turnId}:`)) continue
    residentPendingTools.delete(key)
    residentResolvingTools.delete(key)
    changed = true
  }
  if (changed) emitPending()
}

function useResidentPendingTools(key: string | null): PendingTool[] {
  const [, redraw] = React.useState(0)
  React.useEffect(() => { const listener = () => redraw((value) => value + 1); residentPendingListeners.add(listener); return () => { residentPendingListeners.delete(listener) } }, [])
  return key ? Array.from(residentPendingTools.values()).filter((item) => item.bindingKey === key) : []
}

function Popover({ open, onClose, children, role = 'menu', label, className }: { open: boolean; onClose: () => void; children: React.ReactNode; role?: 'menu' | 'dialog'; label: string; className?: string }): JSX.Element | null {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onPointer); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [onClose, open])
  if (!open) return null
  return <div ref={ref} role={role} aria-label={label} data-agent-menu={label} className={cn('absolute bottom-full left-0 z-[60] mb-1 max-h-[min(420px,65vh)] w-[min(320px,calc(100vw-24px))] overflow-y-auto rounded-nomi border border-nomi-line bg-nomi-paper p-1.5 text-body-sm text-nomi-ink shadow-nomi-lg', className)}>{children}</div>
}

// Commit a primary-pointer action before the outside-click lifecycle can remount
// a hover-preview row; the ref suppresses the follow-up synthetic click while
// preserving keyboard activation through onClick.
function MenuRow({ children, onClick, onMouseEnter, onFocus, selected, disabled, testId, className }: { children: React.ReactNode; onClick?: () => void; onMouseEnter?: () => void; onFocus?: () => void; selected?: boolean; disabled?: boolean; testId?: string; className?: string }): JSX.Element {
  const pointerActivated = React.useRef(false)
  return <button type="button" disabled={disabled} data-agent-menu-item={testId} onClick={() => { if (pointerActivated.current) { pointerActivated.current = false; return }; onClick?.() }} onPointerDown={(event) => { event.stopPropagation(); if (event.button === 0 && !disabled) { pointerActivated.current = true; onClick?.() } }} onMouseEnter={onMouseEnter} onFocus={onFocus} className={cn('flex min-h-8 w-full items-center gap-2 rounded-nomi-sm px-2 py-1 text-left text-caption leading-tight transition-[background,color] duration-[var(--nomi-transition-fast)]', selected ? 'bg-nomi-accent-soft text-nomi-accent' : 'hover:bg-nomi-ink-05', disabled && 'cursor-not-allowed opacity-45', className)}>{children}</button>
}

function iconControlClass(active = false): string {
  return cn('inline-grid size-7 shrink-0 place-items-center rounded-nomi-sm border p-0 transition-[background,border-color,color,transform] duration-[var(--nomi-transition-fast)] motion-reduce:transition-none motion-safe:hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40', active ? 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent' : 'border-nomi-line bg-transparent text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink')
}

function MenuCopy({ label, hint }: { label: React.ReactNode; hint?: React.ReactNode }): JSX.Element {
  return <span className="min-w-0 flex-1"><span className="block truncate">{label}</span>{hint ? <span className="mt-0.5 block truncate text-micro leading-tight text-nomi-ink-40">{hint}</span> : null}</span>
}

const PROMPT_PRESETS = [
  { id: 'general', labelKey: 'promptDefault', hintKey: 'promptDefaultHint', icon: IconCircleDashed, prompt: '' },
  { id: 'story', labelKey: 'promptCamera', hintKey: 'promptCameraHint', icon: IconAperture, prompt: '保留人物、机位和动作，只调整光线、景深与前景层次。' },
  { id: 'script', labelKey: 'promptScript', hintKey: 'promptScriptHint', icon: IconFilePencil, prompt: '先指出冲突与节奏问题，再给出尽量保留原意的改写。' },
  { id: 'review', labelKey: 'promptReview', hintKey: 'promptReviewHint', icon: IconTextSpellcheck, prompt: '检查结构、逻辑和表达，逐条说明原因后再修订。' },
  { id: 'assets', labelKey: 'promptAssets', hintKey: 'promptAssetsHint', icon: IconWorldSearch, prompt: '只返回可追溯来源与明确授权状态的候选素材。' },
] as const

function surfaceLabel(t: (key: string, options?: Record<string, unknown>) => string, surface: ResidentSurface): string {
  return surface === 'generation' ? t('agentResident.contextGeneration') : surface === 'preview' ? t('agentResident.contextPreview') : t('agentResident.contextCreation')
}

function surfaceShortLabel(t: (key: string, options?: Record<string, unknown>) => string, surface: ResidentSurface): string {
  return surface === 'generation' ? t('agentResident.surfaceCanvas') : surface === 'preview' ? t('agentResident.surfaceTimeline') : t('agentResident.surfaceDraft')
}

function statusLabel(t: (key: string, options?: Record<string, unknown>) => string, status: ProjectAgentStatus): string {
  const key = status === 'drafting' || status === 'proposed' ? 'queued' : status === 'declined' ? 'stopped' : status
  return t(`agentResident.${key}`)
}

function friendlyError(error: unknown, t: (key: string, options?: Record<string, unknown>) => string): string {
  const code = error instanceof Error ? error.message : ''
  return code === 'project_agent_unavailable' || code === 'project_binding_stale' ? t('agentResident.unavailable') : t('agentResident.sendFailed')
}

function itemRef(item: ProjectAgentItem): string {
  if (item.kind === 'task') return item.task.kind === 'production-run' ? item.task.runId : item.task.jobId
  if (item.kind === 'artifact') return item.artifact.artifactId
  if (item.kind === 'proposal') return item.approval?.approvalId ?? item.humanApproval?.challengeId ?? ''
  return ''
}

function attachmentPayloads(attachments: readonly ComposerAttachment[]) {
  return attachments.filter((item) => item.status === 'ready' && item.url).map((item) => ({ url: item.url!, contentType: item.contentType, fileName: item.fileName, kind: item.kind }))
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
  const references = useWorkbenchStore((state) => state.projectAgentReferences)
  const setReferences = useWorkbenchStore((state) => state.setProjectAgentReferences)
  const runMode = useWorkbenchStore((state) => state.projectAgentRunMode)
  const setRunMode = useWorkbenchStore((state) => state.setProjectAgentRunMode)
  const activeDocumentId = useWorkbenchStore((state) => state.activeDocumentId)
  const creationDocumentTools = useWorkbenchStore((state) => state.creationDocumentTools)
  const promptModeId = useWorkbenchStore((state) => state.creationAiModeId)
  const activeSkill = useWorkbenchStore((state) => state.creationActiveSkill)
  const setPromptModeId = useWorkbenchStore((state) => state.setCreationAiModeId)
  const setActiveSkill = useWorkbenchStore((state) => state.setCreationActiveSkill)
  const selectedClipIds = useWorkbenchStore((state) => state.selectedTimelineClipIds)
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const [menu, setMenu] = React.useState<MenuId>(null)
  const [threadsOpen, setThreadsOpen] = React.useState(false)
  const [error, setError] = React.useState('')
  const [editingQueue, setEditingQueue] = React.useState<{ queueItemId: string; userItemId: string } | null>(null)
  const [skills, setSkills] = React.useState<SkillListItemDto[]>([])
  const [availableSkillProviders, setAvailableSkillProviders] = React.useState<ReadonlySet<'text' | 'image' | 'video'>>(new Set())
  const [skillSearch, setSkillSearch] = React.useState('')
  const [skillPreview, setSkillPreview] = React.useState<SkillListItemDto | null>(null)
  const [models, setModels] = React.useState<ModelCatalogModelDto[]>([])
  const [vendors, setVendors] = React.useState<Record<string, string>>({})
  const [selectedModel, setSelectedModel] = React.useState(() => { const pref = getAssistantModelPref(); return pref ? `${pref.vendorKey}:${pref.modelKey}` : '' })
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const threadMenuRef = React.useRef<HTMLDivElement>(null)
  const binding = snapshot?.binding ?? null
  const pendingTools = useResidentPendingTools(binding ? bindingKey(binding) : null)
  const activeThreadId = snapshot?.activeThreadId ?? null
  const activeThread = snapshot?.threads.find((thread) => thread.threadId === activeThreadId)
  const items = React.useMemo(() => snapshot?.items.filter((item) => item.threadId === activeThreadId) ?? [], [activeThreadId, snapshot])
  const queue = React.useMemo(() => snapshot?.queue.filter((item) => item.threadId === activeThreadId) ?? [], [activeThreadId, snapshot])
  const activeTurn = snapshot?.turns.find((turn) => turn.threadId === activeThreadId && isLive(turn.status))
  const runningTurn = snapshot?.turns.find((turn) => turn.threadId === activeThreadId && turn.status === 'running')
  const selectedPromptPreset = PROMPT_PRESETS.find((preset) => preset.id === promptModeId) ?? PROMPT_PRESETS[0]
  const contextCount = surface === 'generation' ? t('agentResident.contextNodes', { count: selectedNodeIds.length }) : surface === 'preview' ? t('agentResident.contextClips', { count: selectedClipIds.length }) : t('agentResident.currentDocument')

  React.useEffect(() => { try { setSkills(listWorkbenchSkills().filter((item) => item.isPlaybook)) } catch { setSkills([]) }; void getAvailableSkillProviders().then(setAvailableSkillProviders).catch(() => setAvailableSkillProviders(new Set())) }, [])
  React.useEffect(() => { let alive = true; void Promise.all([listWorkbenchModelCatalogVendors(), listWorkbenchModelCatalogModels({ kind: 'text', enabled: true })]).then(([vendorRows, modelRows]) => { if (!alive) return; const usable = filterUsableAssistantTextModels(modelRows, vendorRows); setModels(usable); setVendors(Object.fromEntries(vendorRows.map((row) => [row.key, row.name]))); const pref = getAssistantModelPref(); const found = pref && usable.find((row) => row.vendorKey === pref.vendorKey && row.modelKey === pref.modelKey); if (!found && usable[0]) { setAssistantModelPref({ vendorKey: usable[0].vendorKey, modelKey: usable[0].modelKey }); setSelectedModel(encodeModelIdentity(usable[0])) } else if (found) setSelectedModel(encodeModelIdentity(found)) }).catch(() => { if (alive) setModels([]) }); return () => { alive = false } }, [])
  React.useEffect(() => { const node = scrollRef.current; if (node) node.scrollTop = node.scrollHeight }, [items.length, pendingTools.length, activeTurn?.status])
  React.useEffect(() => {
    if (!threadsOpen) return
    requestAnimationFrame(() => threadMenuRef.current?.focus())
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setThreadsOpen(false) }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (document.querySelector('[data-agent-thread-menu]')?.contains(target)) return
      if (document.querySelector('[data-agent-thread-trigger]')?.contains(target)) return
      setThreadsOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer) }
  }, [threadsOpen])

  const attachmentApi = useComposerAttachments({ attachments, setAttachments, onError: setError })
  const closeMenu = React.useCallback(() => setMenu(null), [])
  const addReference = React.useCallback((reference: ProjectAgentReference) => { setReferences((previous) => previous.some((item) => item.id === reference.id) ? previous : [...previous, reference]); closeMenu() }, [closeMenu, setReferences])
  const removeReference = React.useCallback((id: string) => setReferences((previous) => previous.filter((item) => item.id !== id)), [setReferences])
  const focusContext = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('nomi-agent-context-focus', { detail: { surface } }))
  }, [surface])
  const startVoiceInput = React.useCallback(() => {
    type VoiceRecognition = { lang: string; interimResults: boolean; maxAlternatives: number; onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onerror: () => void; start: () => void }
    const speechWindow = window as unknown as { SpeechRecognition?: new () => VoiceRecognition; webkitSpeechRecognition?: new () => VoiceRecognition }
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
    if (!Recognition) { setError(t('agentResident.voiceUnavailable')); closeMenu(); return }
    const recognition = new Recognition()
    recognition.lang = document.documentElement.lang || 'zh-CN'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => { const transcript = event.results[0]?.[0]?.transcript?.trim(); if (transcript) { const previous = useWorkbenchStore.getState().projectAgentDraft; setDraft(`${previous}${previous ? ' ' : ''}${transcript}`) }; closeMenu() }
    recognition.onerror = () => setError(t('agentResident.voiceUnavailable'))
    closeMenu()
    try { recognition.start() } catch { setError(t('agentResident.voiceUnavailable')) }
  }, [closeMenu, setDraft, t])
  const openTask = React.useCallback((item: Extract<ProjectAgentItem, { kind: 'task' | 'artifact' }>) => { const projectId = snapshot?.binding.projectId; if (!projectId) return; window.dispatchEvent(new Event('nomi-open-task-center')); const runId = item.kind === 'task' ? (item.task.kind === 'production-run' ? item.task.runId : undefined) : item.artifact.runId; if (runId) void useProductionRunStore.getState().navigateTo(projectId, runId, item.kind === 'artifact' ? item.artifact.artifactId : undefined).catch((caught) => setError(friendlyError(caught, t))) }, [snapshot, t])
  const stopTurn = React.useCallback(async (turnId: string) => { try { await stopProjectAgentTurn(turnId) } catch (caught) { setError(friendlyError(caught, t)) } }, [t])
  const resolveTool = React.useCallback(async (pending: PendingTool, ok: boolean) => {
    const key = pendingKey(pending.call)
    if (pending.state !== 'pending' || residentResolvingTools.has(key)) return
    residentResolvingTools.add(key)
    try {
      await pending.call.confirm({ ok, ...(ok ? {} : { message: t('agentResident.deny') }) })
      const current = residentPendingTools.get(key)
      if (current?.state === 'pending') {
        residentPendingTools.set(key, { ...current, state: ok ? 'approved' : 'denied' })
        emitPending()
      }
    } catch (caught) {
      setError(friendlyError(caught, t))
    } finally {
      residentResolvingTools.delete(key)
    }
  }, [t])

  const submit = React.useCallback(async () => {
    const text = draft.trim(); if (!text || !snapshot) return; setError('')
    if (editingQueue) { try { await editProjectAgentQueueItem({ ...editingQueue, text }); setEditingQueue(null); setDraft('') } catch (caught) { setError(friendlyError(caught, t)) }; return }
    if (attachments.some((item) => item.status === 'uploading')) { setError(t('creationAi.attachmentsUploading')); return }
    const turnId = `turn-resident-${globalThis.crypto.randomUUID()}`
    const surfaceContext = surfaceLabel(t, surface)
    const contextDetail = surface === 'generation' ? t('agentResident.contextNodes', { count: selectedNodeIds.length }) : surface === 'preview' ? t('agentResident.contextClips', { count: selectedClipIds.length }) : t('agentResident.currentDocument')
    const capability = surface === 'generation' ? 'canvas-agent' as const : surface === 'creation' ? 'creation-editor' as const : 'canvas-chat' as const
    const selectedPrompt = getCreationAiMode(promptModeId)
    const skillKey = activeSkill?.key ?? (surface === 'generation' ? 'workbench.generation.canvas-planner' : `workbench.creation.${selectedPrompt.id}`)
    let target: TargetRef; let preconditions: PreconditionSet | undefined
    try { if (surface === 'creation') { const state = creationDocumentTools?.readState(); target = { kind: 'document', documentId: activeDocumentId, anchor: state?.anchor ?? { kind: 'whole-document' } }; if (state) preconditions = { document: { revision: state.revision, contentHash: state.contentHash } } } else if (surface === 'preview') target = { kind: 'timeline', clipIds: Object.freeze([...selectedClipIds]) }; else target = { kind: 'canvas', nodeIds: Object.freeze([...selectedNodeIds]) } } catch (caught) { setError(friendlyError(caught, t)); return }
    const referencesText = references.length ? `\n\n${t('agentResident.referencesLabel')}: ${references.map((reference) => reference.label).join(', ')}` : ''
    setDraft(''); attachmentApi.clearAttachments(); closeMenu()
    try { await runWorkbenchAgent({ turnId, prompt: `${surfaceContext}\n${contextDetail}${referencesText}\n\n${text}`, ...(surface === 'creation' && !activeSkill ? { systemPrompt: selectedPromptPreset.prompt || selectedPrompt.prompt } : {}), displayPrompt: text, capability, history: { kind: 'ephemeral' }, projectId: snapshot.binding.projectId, selectedNodeIds: surface === 'generation' ? selectedNodeIds : undefined, target, ...(preconditions ? { preconditions } : {}), originSurface: { surfaceId: 'project-agent-resident', kind: surface === 'creation' ? 'document' : surface === 'generation' ? 'canvas' : 'preview' }, mode: runMode === 'ask' ? 'chat' : 'auto', skillKey, skillName: activeSkill?.name ?? selectedPrompt.title, attachmentClaims: projectAgentAttachmentClaims(attachments.filter((item) => item.status === 'ready')), attachments: attachmentPayloads(attachments), onToolCall: async (call) => { residentPendingTools.set(pendingKey(call), { call, bindingKey: bindingKey(snapshot.binding), state: 'pending' }); emitPending() } }) } catch (caught) { setError(friendlyError(caught, t)) } finally { clearResidentPendingTools(turnId) }
  }, [activeDocumentId, activeSkill, attachmentApi, attachments, closeMenu, creationDocumentTools, draft, editingQueue, promptModeId, references, runMode, selectedClipIds, selectedNodeIds, selectedPromptPreset, setDraft, snapshot, surface, t])
  const onKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }, [submit])

  const filteredSkills = skills.filter((item) => `${item.label} ${item.description ?? ''}`.toLowerCase().includes(skillSearch.toLowerCase()))
  const promptPreset = PROMPT_PRESETS.find((preset) => preset.id === promptModeId) ?? PROMPT_PRESETS[0]
  const PromptIcon = promptPreset.icon
  const modeKey = (value: ProjectAgentRunMode): string => `agentResident.mode${value[0].toUpperCase()}${value.slice(1)}`
  const modeTitle = `${t('agentResident.modeTitle')} · ${t(modeKey(runMode))}`
  const promptTitle = promptModeId === 'general' ? t('agentResident.promptTitle') : `${t('agentResident.prompt')} · ${t(`agentResident.${promptPreset.labelKey}`)}`
  const compactStatus = runningTurn
    ? t('agentResident.running')
    : pendingTools.some((pending) => pending.state === 'pending')
      ? t('agentResident.waitingApproval')
      : queue.length
        ? t('agentResident.queueCount', { count: queue.length })
        : t('agentResident.ready')

  if (collapsed) {
    return <section id="project-agent-resident" className="pointer-events-none relative h-full w-full overflow-visible" aria-label={t('agentResident.aria')} data-agent-resident="true" data-agent-surface={surface}>
      <button type="button" className="pointer-events-auto absolute right-0 top-0 z-40 flex h-9 w-fit max-w-[calc(100vw-24px)] items-center gap-1.5 rounded-pill border border-nomi-line bg-nomi-paper px-2 text-left text-caption text-nomi-ink shadow-nomi-md transition-[box-shadow,transform] duration-[var(--nomi-transition-fast)] motion-reduce:transition-none hover:-translate-y-px hover:shadow-nomi-lg" aria-label={t('agentResident.expand')} title={t('agentResident.expand')} aria-controls="project-agent-resident" aria-expanded="false" data-agent-resident-collapsed="true" onClick={() => setCollapsed(false)}>
        <NomiLogoMark size={17} />
        <span className={cn('size-1.5 shrink-0 rounded-pill', runningTurn ? 'bg-nomi-accent' : pendingTools.some((pending) => pending.state === 'pending') ? 'bg-nomi-warning' : 'bg-nomi-ink-30')} aria-hidden="true" />
        <span className="max-w-[8rem] shrink truncate">{compactStatus}</span>
        <IconChevronLeft size={14} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />
      </button>
    </section>
  }

  return <section id="project-agent-resident" onKeyDownCapture={(event) => { if (event.key === 'Escape') { setThreadsOpen(false); setMenu(null) } }} className="relative isolate flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--workbench-ai-panel-bg)] text-nomi-ink" aria-label={t('agentResident.aria')} data-agent-resident="true" data-agent-surface={surface}>
    <header className="relative flex shrink-0 items-center gap-2 border-b border-nomi-line-soft px-3 py-2" data-agent-header="true">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-left"><NomiLogoMark size={19} /><span className="min-w-0"><span className="block text-body-sm font-semibold leading-tight">{t('agentResident.brand')}</span><span className="block truncate text-micro text-nomi-ink-60">{activeThread?.title || t('agentResident.untitledThread')}</span></span></div>
      <span className="flex shrink-0 items-center gap-1 text-micro text-nomi-ink-60" aria-label={t('agentResident.usage', { value: 0 })}><span className="h-1 w-6 overflow-hidden rounded-pill bg-nomi-ink-10"><span className="block h-full w-0 rounded-pill bg-nomi-ink-40" /></span><span>0%</span></span>
      <WorkbenchIconButton size="sm" label={t('agentResident.threadList')} icon={<IconHistory size={15} />} onClick={() => setThreadsOpen((value) => !value)} data-agent-thread-trigger="true" />
      <WorkbenchIconButton size="sm" label={t('agentResident.collapse')} icon={<IconLayoutSidebarRightCollapse size={15} />} onClick={() => setCollapsed(true)} />
      {threadsOpen ? <div ref={threadMenuRef} tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') setThreadsOpen(false) }} className="absolute right-2 top-full z-50 mt-1 w-[280px] rounded-nomi border border-nomi-line bg-nomi-paper p-1 shadow-nomi-lg" data-agent-thread-menu="true" role="menu"><div className="flex items-center justify-between px-2 py-1 text-micro text-nomi-ink-60"><span>{t('agentResident.threads')}</span><button type="button" className="text-nomi-accent" onClick={() => { void createProjectAgentThread(); setThreadsOpen(false) }}>{t('agentResident.newThread')}</button></div>{(snapshot?.threads ?? []).map((thread) => <div key={thread.threadId} className={cn('flex items-center gap-1 rounded-nomi-sm px-2 py-1', thread.threadId === activeThreadId && 'bg-nomi-accent-soft')}><button type="button" className="min-w-0 flex-1 truncate text-left text-caption" onClick={() => { void activateProjectAgentThread(thread.threadId); setThreadsOpen(false) }}>{thread.title || t('agentResident.untitledThread')}</button><button type="button" className="grid size-6 place-items-center rounded-nomi-sm hover:bg-nomi-ink-10" aria-label={t('agentResident.removeThread')} onClick={() => void removeProjectAgentThread(thread.threadId)}><IconTrash size={13} /></button></div>)}</div> : null}
    </header>
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-nomi-line-soft px-3 py-2" data-agent-context="true"><div className="min-w-0 truncate text-caption"><span className="text-nomi-ink-60">{t('agentResident.currentScene')} · </span><span className="font-medium">{surfaceShortLabel(t, surface)}</span><span className="text-nomi-ink-60"> · {contextCount}</span></div><button type="button" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-nomi-sm px-1.5 text-micro font-medium text-nomi-ink-60 transition-[background,color] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05 hover:text-nomi-ink" onClick={focusContext}>{t('agentResident.backToScene')}<IconChevronRight size={12} /></button></div>
    <div ref={scrollRef} className={cn('min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3', menu && 'pointer-events-none')} role="log" aria-live="polite" data-agent-transcript="true">
      {!items.length && !queue.length ? <div className="grid min-h-28 place-items-center px-3 text-center"><div><div className="mb-1 text-body-sm font-semibold">{t('agentResident.emptyTitle')}</div><p className="m-0 text-caption text-nomi-ink-60">{t('agentResident.emptyDescription')}</p></div></div> : null}
      {items.map((item) => { const proposal = item.kind === 'proposal' && item.approval; return <article key={item.itemId} data-agent-item-kind={item.kind} className={cn('rounded-nomi-sm border px-2.5 py-2 text-caption', item.kind === 'user' ? 'ml-6 border-nomi-ink bg-nomi-ink text-nomi-paper' : item.kind === 'failure' ? 'border-workbench-danger bg-workbench-danger-soft' : proposal ? 'border-nomi-accent bg-nomi-accent-soft' : 'border-nomi-line-soft bg-nomi-paper')}>
        {item.kind === 'user' ? <div className="whitespace-pre-wrap break-words">{item.text}</div> : null}
        {item.kind === 'assistant' ? <div className="whitespace-pre-wrap break-words">{item.text || (isLive(item.status) ? `${t('creationAi.assistantMessage.processing')}…` : '')}</div> : null}
        {item.kind === 'tool' ? <><div className="flex items-center gap-1.5 font-medium"><IconFileText size={13} />{t('agentResident.toolCall', { name: item.capability.id })}{item.status === 'running' ? <IconLoader2 size={13} className="animate-spin" /> : <IconCheck size={13} className="text-workbench-success-ink" />}</div><div className="mt-1 text-micro text-nomi-ink-60">{item.resultRef ?? t('agentResident.waitingApproval')}</div></> : null}
        {item.kind === 'proposal' ? <><div className="flex items-center gap-1.5 font-medium"><IconListCheck size={18} className="text-nomi-accent" />{t('agentResident.plan')}<span className="ml-auto text-micro text-nomi-accent">{statusLabel(t, item.status)}</span></div><div className="mt-1 text-micro text-nomi-ink-60">{t('agentResident.approval')}</div>{proposal ? <div className="mt-2 grid grid-cols-2 gap-1.5"><button type="button" className="h-7 rounded-nomi-sm border border-nomi-line text-micro" data-agent-action="edit-plan" onClick={() => setDraft(t('agentResident.editPlanPrompt'))}>{t('agentResident.editPlan')}</button><button type="button" className="h-7 rounded-nomi-sm bg-nomi-ink text-micro text-nomi-paper" data-agent-action="approve-plan" disabled>{t('agentResident.approve')}</button></div> : null}</> : null}
        {item.kind === 'failure' ? <><div className="flex items-center gap-1.5 font-medium text-workbench-danger"><IconAlertTriangle size={18} />{item.message}</div><div className="mt-1 text-micro text-nomi-ink-60">{item.nextAction ?? t('agentResident.sendFailed')}</div><div className="mt-2 grid grid-cols-3 gap-1.5"><button type="button" className="h-7 min-w-0 rounded-nomi-sm bg-nomi-ink px-1 text-micro text-nomi-paper" data-agent-action="retry" onClick={() => { const user = items.find((candidate) => candidate.kind === 'user' && candidate.turnId === item.turnId); if (user?.kind === 'user') setDraft(user.text) }}>{t('agentResident.changeModelRetry')}</button><button type="button" className="h-7 min-w-0 rounded-nomi-sm border border-nomi-line px-1 text-micro" data-agent-action="edit-prompt" onClick={() => setDraft(t('agentResident.editPlanPrompt'))}>{t('agentResident.editPrompt')}</button><button type="button" className="h-7 min-w-0 rounded-nomi-sm border border-nomi-line px-1 text-micro" data-agent-action="view-log" onClick={() => window.dispatchEvent(new Event('nomi-open-task-center'))}>{t('agentResident.viewLog')}</button></div></> : null}
        {item.kind === 'task' || item.kind === 'artifact' ? <div className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1.5 truncate"><IconExternalLink size={14} />{item.kind === 'task' ? t('agentResident.task', { id: itemRef(item) }) : t('agentResident.artifact', { id: itemRef(item) })}</span><button type="button" className="h-7 rounded-nomi-sm border border-nomi-line px-2 text-micro" onClick={() => openTask(item)}>{item.kind === 'task' ? t('agentResident.openTask') : t('agentResident.openArtifact')}</button></div> : null}
      </article> })}
      {pendingTools.map((pending) => <article key={pending.call.toolCallId} className="rounded-nomi-sm border border-nomi-accent bg-nomi-accent-soft px-2.5 py-2 text-caption" data-agent-item-kind="approval"><div className="flex items-center gap-1.5 font-medium"><IconLock size={14} />{t('agentResident.toolCall', { name: pending.call.toolName })}</div><div className="mt-1 text-micro text-nomi-ink-60">{pending.state === 'pending' ? t('agentResident.waitingApproval') : pending.state === 'approved' ? t('agentResident.approved') : t('agentResident.denied')}</div>{pending.state === 'pending' ? <div className="mt-2 grid grid-cols-2 gap-1.5"><button type="button" className="h-7 rounded-nomi-sm border border-nomi-line text-micro" data-agent-action="deny" onClick={() => void resolveTool(pending, false)}>{t('agentResident.deny')}</button><button type="button" className="h-7 rounded-nomi-sm bg-nomi-ink text-micro text-nomi-paper" data-agent-action="approve" onClick={() => void resolveTool(pending, true)}>{t('agentResident.approve')}</button></div> : null}</article>)}
    </div>
    <div className="relative z-20 shrink-0 border-t border-nomi-line-soft bg-nomi-paper" data-agent-composer="true">{queue.length || runningTurn ? <div className="flex items-center justify-between gap-2 px-3 pt-2 text-micro text-nomi-ink-60"><span>{t('agentResident.queue')}{queue.length ? ` · ${t('agentResident.queueCount', { count: queue.length })}` : ''}</span>{runningTurn ? <button type="button" className="inline-flex h-7 items-center gap-1 rounded-nomi-sm px-2 text-workbench-danger transition-[background,color] duration-[var(--nomi-transition-fast)] hover:bg-workbench-danger-soft" data-agent-action="stop" onClick={() => void stopTurn(runningTurn.turnId)}><IconPlayerStopFilled size={12} />{t('agentResident.stop')}</button> : null}</div> : null}{queue.length ? <div className="space-y-1 px-3 py-1.5">{queue.slice(-3).map((entry: ProjectAgentQueueItem) => { const user = snapshot?.items.find((candidate) => candidate.kind === 'user' && candidate.turnId === entry.turnId); return <div key={entry.queueItemId} className="flex items-center gap-2 rounded-nomi-sm bg-nomi-ink-05 px-2 py-1.5 text-micro" data-agent-queue-item="true"><span className="size-1.5 rounded-pill bg-nomi-accent" /><span className="min-w-0 flex-1 truncate">{user?.kind === 'user' ? user.text : entry.turnId}</span><span>{statusLabel(t, entry.status)}</span>{entry.status === 'queued' && user?.kind === 'user' ? <button type="button" className="grid size-6 place-items-center rounded-nomi-sm hover:bg-nomi-ink-10" aria-label={t('agentResident.edit')} onClick={() => { setDraft(user.text); setEditingQueue({ queueItemId: entry.queueItemId, userItemId: user.itemId }) }}><IconPencil size={12} /></button> : null}<button type="button" className="grid size-6 place-items-center rounded-nomi-sm text-workbench-danger hover:bg-workbench-danger-soft" aria-label={t('agentResident.cancel')} onClick={() => void stopTurn(entry.turnId)}><IconX size={12} /></button></div> })}</div> : null}{error ? <div className="px-3 pb-1 text-micro text-workbench-danger" role="alert">{error}</div> : null}
      <form className="relative grid gap-1.5 px-3 pb-2 pt-1" onSubmit={(event) => { event.preventDefault(); void submit() }} {...attachmentApi.dragHandlers}><input ref={attachmentApi.inputRef} type="file" multiple accept={COMPOSER_ATTACHMENT_ACCEPT} className="hidden" tabIndex={-1} aria-hidden="true" onChange={attachmentApi.onInputChange} /><AttachmentRail attachments={attachments} onRemove={attachmentApi.removeAttachment} />{references.length || activeSkill || (promptModeId !== 'general' && !activeSkill) ? <div className="flex max-h-14 flex-wrap gap-1 overflow-y-auto" data-agent-references="true">{references.map((reference) => <span key={reference.id} data-agent-reference={reference.id} className="inline-flex h-6 max-w-full items-center gap-1 rounded-pill bg-nomi-ink-05 px-2 text-micro text-nomi-ink-80"><IconAt size={12} /><span className="truncate">{reference.label}</span><button type="button" aria-label={t('agentResident.removeReference')} onClick={() => removeReference(reference.id)}><IconX size={11} /></button></span>)}{activeSkill ? <span data-agent-reference={`skill:${activeSkill.key}`} className="inline-flex h-6 max-w-full items-center gap-1 rounded-pill bg-nomi-accent-soft px-2 text-micro text-nomi-accent"><IconTool size={12} /><span className="truncate">{activeSkill.name}</span><button type="button" aria-label={t('agentResident.removeReference')} onClick={() => setActiveSkill(null)}><IconX size={11} /></button></span> : null}{promptModeId !== 'general' && !activeSkill ? <span data-agent-reference={`prompt:${promptModeId}`} className="inline-flex h-6 max-w-full items-center gap-1 rounded-pill bg-nomi-ink-05 px-2 text-micro text-nomi-ink-80"><PromptIcon size={12} /><span className="truncate">{t(`agentResident.${promptPreset.labelKey}`)}</span><button type="button" aria-label={t('agentResident.removeReference')} onClick={() => setPromptModeId('general')}><IconX size={11} /></button></span> : null}</div> : null}
        <div className={cn('rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-1', attachmentApi.isDragging && 'border-nomi-accent bg-nomi-accent-soft')}><AutoGrowTextarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onPaste={attachmentApi.handlePaste} placeholder={t('agentResident.placeholder')} aria-label={t('agentResident.messageAria')} maxHeight={120} className="min-h-10 text-body-sm" /><div className="flex flex-wrap items-center gap-1 border-t border-nomi-line-soft pt-1">
          <div className="relative shrink-0"><button type="button" className={iconControlClass(menu === 'attachments')} aria-expanded={menu === 'attachments'} aria-haspopup="menu" data-agent-attachment-trigger="true" aria-label={t('agentResident.attach')} title={t('agentResident.attachTitle')} onClick={() => setMenu(menu === 'attachments' ? null : 'attachments')}><IconPaperclip size={16} /></button><Popover open={menu === 'attachments'} onClose={closeMenu} label={t('agentResident.attach')}><MenuRow testId="image" onClick={() => { attachmentApi.openFilePicker(); closeMenu() }}><IconPhoto size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.attachImage')} hint={t('agentResident.attachImageHint')} /></MenuRow><MenuRow testId="video" onClick={() => { attachmentApi.openFilePicker(); closeMenu() }}><IconVideo size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.attachVideo')} hint={t('agentResident.attachVideoHint')} /></MenuRow><MenuRow testId="audio" onClick={() => { attachmentApi.openFilePicker(); closeMenu() }}><IconWaveSine size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.attachAudio')} hint={t('agentResident.attachAudioHint')} /></MenuRow><MenuRow testId="document" onClick={() => { attachmentApi.openFilePicker(); closeMenu() }}><IconFileText size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.attachDocument')} hint={t('agentResident.attachDocumentHint')} /></MenuRow><div className="my-1 border-t border-nomi-line-soft" /><MenuRow testId="voice" onClick={() => { startVoiceInput() }}><IconMicrophone size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.voiceInput')} hint={t('agentResident.voiceInputHint')} /></MenuRow></Popover></div>
          <div className="relative shrink-0"><button type="button" className={iconControlClass(menu === 'references')} aria-expanded={menu === 'references'} aria-haspopup="menu" data-agent-mention-trigger="true" aria-label={t('agentResident.mention')} title={t('agentResident.mentionTitle')} onClick={() => setMenu(menu === 'references' ? null : 'references')}><IconAt size={16} /></button><Popover open={menu === 'references'} onClose={closeMenu} label={t('agentResident.mention')}><MenuRow testId="canvas" onClick={() => addReference({ id: 'canvas:selection', label: t('agentResident.referenceCanvas'), kind: 'canvas' })}><IconPhoto size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.referenceCanvas')} hint={t('agentResident.referenceCanvasHint')} /></MenuRow><MenuRow testId="document" onClick={() => addReference({ id: `document:${activeDocumentId || 'current'}`, label: t('agentResident.referenceDocument'), kind: 'document' })}><IconFileText size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.referenceDocument')} hint={t('agentResident.referenceDocumentHint')} /></MenuRow><MenuRow testId="preview" onClick={() => addReference({ id: 'preview:frame', label: t('agentResident.referencePreview'), kind: 'preview' })}><IconVideo size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.referencePreview')} hint={t('agentResident.referencePreviewHint')} /></MenuRow><MenuRow testId="timeline" onClick={() => addReference({ id: 'timeline:range', label: t('agentResident.referenceTimeline'), kind: 'timeline' })}><IconTimelineEvent size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.referenceTimeline')} hint={t('agentResident.referenceTimelineHint')} /></MenuRow><MenuRow testId="browser" onClick={() => addReference({ id: 'browser:selection', label: t('agentResident.referenceBrowser'), kind: 'browser' })}><IconWorld size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.referenceBrowser')} hint={t('agentResident.referenceBrowserHint')} /></MenuRow></Popover></div>
          <span className="min-w-0 flex-1 basis-0" aria-hidden="true" />
          <div className="relative"><button type="button" className={iconControlClass(Boolean(activeSkill))} aria-expanded={menu === 'skills'} aria-haspopup="dialog" data-agent-skill-trigger="true" aria-label={t('agentResident.skillSelect')} title={activeSkill?.name ?? t('agentResident.skillTitle')} onClick={() => setMenu(menu === 'skills' ? null : 'skills')}><IconTool size={16} /></button><Popover open={menu === 'skills'} onClose={closeMenu} role="dialog" label={t('agentResident.skill')} className={cn(skillPreview ? "w-[548px]" : "w-[320px]", "max-w-[calc(100vw-24px)]")}><div className={cn("grid min-w-0 gap-1", skillPreview ? "grid-cols-[minmax(0,1fr)_minmax(150px,.72fr)]" : "grid-cols-1")}><div className="min-w-0"><label className="mx-1 mb-1 flex h-7 items-center gap-1.5 rounded-nomi-sm border border-nomi-line px-2 text-micro text-nomi-ink-40 focus-within:border-nomi-accent"><IconSearch size={14} /><input autoFocus value={skillSearch} onChange={(event) => setSkillSearch(event.target.value)} placeholder={t('agentResident.skillSearch')} className="min-w-0 flex-1 bg-transparent outline-none" /></label><MenuRow selected={!activeSkill} testId="auto" onMouseEnter={() => setSkillPreview(null)} onFocus={() => setSkillPreview(null)} onClick={() => { setActiveSkill(null); closeMenu() }}><IconTool size={16} className="shrink-0" /><MenuCopy label={t('agentResident.skillAuto')} />{!activeSkill ? <IconCheck size={14} /> : null}</MenuRow>{filteredSkills.map((skill) => <MenuRow key={skill.directoryName} selected={activeSkill?.key === skill.name} testId={skill.name} onMouseEnter={() => setSkillPreview(skill)} onFocus={() => setSkillPreview(skill)} onClick={() => { setActiveSkill({ key: skill.name, name: skill.label }); closeMenu() }}><IconListCheck size={16} className="shrink-0" /><MenuCopy label={skill.label} hint={skill.description ?? skill.stageLabels.join(' · ')} />{skillCapabilityFor(skill, availableSkillProviders).missing.length ? <IconAlertTriangle size={14} className="shrink-0 text-workbench-danger" /> : null}{activeSkill?.key === skill.name ? <IconCheck size={14} /> : null}</MenuRow>)}<div className="my-1 border-t border-nomi-line-soft" /><MenuRow className="min-h-8" onClick={() => window.dispatchEvent(new Event('nomi-focus-skill-library'))}><IconSettings size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.skillManage')} /><IconChevronRight size={13} /></MenuRow></div><aside className={cn("min-w-0 rounded-nomi-sm bg-nomi-ink-05 p-2", !skillPreview && "hidden")} aria-live="polite">{skillPreview ? <><div className="mb-1 text-caption font-medium">{skillPreview.label}</div><p className="m-0 text-micro leading-relaxed text-nomi-ink-60">{skillPreview.description ?? t('agentResident.skillDialogHint')}</p><div className="mt-2 border-t border-nomi-line-soft pt-2 text-micro"><div className="text-nomi-ink-40">{t('agentResident.skillStages')}</div><div className="mt-1 text-nomi-ink-80">{skillPreview.stageLabels.join(' · ') || '—'}</div><div className="mt-2 text-nomi-ink-40">{t('agentResident.skillNeeds')}</div><div className="mt-1 text-nomi-ink-80">{skillPreview.neededProviders.map(providerLabel).join(' · ') || '—'}</div></div></> : <><div className="mb-1 text-caption font-medium">{t('agentResident.skill')}</div><p className="m-0 text-micro leading-relaxed text-nomi-ink-60">{t('agentResident.skillDialogHint')}</p></>}</aside></div></Popover></div>
          <div className="relative"><button type="button" className={iconControlClass(promptModeId !== 'general' && !activeSkill)} aria-expanded={menu === 'prompts'} aria-haspopup="menu" data-agent-prompt-trigger="true" aria-label={t('agentResident.promptSelect')} title={promptTitle} onClick={() => setMenu(menu === 'prompts' ? null : 'prompts')}><IconPencil size={16} /></button><Popover open={menu === 'prompts'} onClose={closeMenu} label={t('agentResident.prompt')} className="w-[330px] max-w-[calc(100vw-24px)]">{PROMPT_PRESETS.map((preset) => { const PresetIcon = preset.icon; return <MenuRow key={preset.id} selected={!activeSkill && promptModeId === preset.id} testId={preset.id} onClick={() => { setActiveSkill(null); setPromptModeId(preset.id); closeMenu() }}><PresetIcon size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={<>{t(`agentResident.${preset.labelKey}`)}{preset.id !== 'general' ? <span className="ml-1 rounded-pill bg-nomi-ink-05 px-1 text-micro text-nomi-ink-40">{t('agentResident.builtIn')}</span> : null}</>} hint={t(`agentResident.${preset.hintKey}`)} />{!activeSkill && promptModeId === preset.id ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}</MenuRow> })}</Popover></div>
          <div className="relative"><button type="button" className={iconControlClass(runMode !== 'balanced')} aria-expanded={menu === 'modes'} aria-haspopup="menu" data-agent-mode-trigger="true" aria-label={t('agentResident.modeSelect')} title={modeTitle} onClick={() => setMenu(menu === 'modes' ? null : 'modes')}><IconAdjustmentsHorizontal size={16} /></button><Popover open={menu === 'modes'} onClose={closeMenu} label={t('agentResident.modeMenuTitle')} className="w-[320px] max-w-[calc(100vw-24px)]">{(['ask', 'guided', 'balanced', 'auto'] as ProjectAgentRunMode[]).map((value) => { const ModeIcon = value === 'ask' ? IconMessageQuestion : value === 'guided' ? IconRoute : value === 'balanced' ? IconAdjustmentsHorizontal : IconBolt; return <MenuRow key={value} selected={runMode === value} testId={value} onClick={() => { setRunMode(value); closeMenu() }}><ModeIcon size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t(modeKey(value))} hint={t(`${modeKey(value)}Hint`)} />{runMode === value ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}</MenuRow> })}</Popover></div>
          <div className="relative"><button type="button" className={iconControlClass(menu === 'models')} aria-expanded={menu === 'models'} aria-haspopup="menu" data-agent-model-trigger="true" aria-label={t('agentResident.modelSelect')} title={t('agentResident.modelTitle')} onClick={() => setMenu(menu === 'models' ? null : 'models')}><IconRobot size={16} /></button><Popover open={menu === 'models'} onClose={closeMenu} label={t('agentResident.modelMenuTitle')} className="w-[280px] max-w-[calc(100vw-24px)]">{models.length ? models.map((model) => { const value = encodeModelIdentity(model); return <MenuRow key={value} selected={selectedModel === value} testId={value} onClick={() => { setSelectedModel(value); const identity = decodeModelIdentity(value); if (identity) setAssistantModelPref(identity); closeMenu() }}><IconRobot size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={labelForModel(model, models, vendors)} />{selectedModel === value ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}</MenuRow> }) : <MenuRow testId="catalog" onClick={() => window.dispatchEvent(new Event('nomi-open-model-catalog'))}><IconPlus size={16} className="shrink-0" /><MenuCopy label={t('generationCommon.parameters.selectTextModel')} hint={t('agentResident.modelMenuHint')} /></MenuRow>}</Popover></div>
          <button type="submit" disabled={!draft.trim()} className="grid size-7 shrink-0 place-items-center rounded-pill bg-nomi-ink text-nomi-paper disabled:opacity-30" data-agent-send="true" aria-label={t('agentResident.send')}><IconArrowUp size={16} /></button>
        </div></div>
      </form>
    </div>
  </section>
}
