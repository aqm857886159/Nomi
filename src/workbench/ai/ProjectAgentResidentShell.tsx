import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle, IconAperture, IconArrowUp, IconAt, IconCheck,
  IconAdjustmentsHorizontal, IconChevronLeft, IconChevronRight, IconCircleDashed, IconCoin, IconExternalLink, IconFileText, IconFilePencil,
  IconHistory, IconLayoutSidebarRightCollapse, IconListCheck, IconLock, IconMicrophone, IconPaperclip, IconPencil, IconPhoto,
  IconMessageQuestion, IconRobot, IconSearch, IconSettings, IconTextSpellcheck, IconTimelineEvent, IconTool, IconWaveSine,
  IconPlus, IconRefresh, IconTrash, IconVideo, IconWorld, IconWorldSearch, IconX, IconFocusCentered, IconPlayerStopFilled, IconChevronDown,
} from '@tabler/icons-react'
import { BodyPortal, NomiLogoMark, WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import { useWorkbenchStore, type ProjectAgentReference, type ProjectAgentRunMode, type WorkspaceMode } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { runWorkbenchAgent, type ToolCallEvent } from './workbenchAgentRunner'
import { stopProjectAgentTurn } from './projectAgentTurnCommands'
import { activateProjectAgentThread, createProjectAgentThread, deleteProjectAgentQueueItem, editProjectAgentQueueItem, moveProjectAgentQueueItem, pauseProjectAgentQueueItem, removeProjectAgentThread, resumeProjectAgentQueueItem } from './projectAgentUiCommands'
import { useProjectAgentSnapshot } from './useProjectAgentThreadMessages'
import { projectAgentAttachmentClaims } from './projectAgentAttachments'
import { useComposerAttachments, COMPOSER_ATTACHMENT_ACCEPT } from './composer/useComposerAttachments'
import { AttachmentRail } from './composer/AttachmentRail'
import { AutoGrowTextarea } from './composer/AutoGrowTextarea'
import { getCreationAiMode } from '../creation/creationAiModes'
import { getAvailableSkillProviders, listWorkbenchSkills, providerLabel, skillCapabilityFor, type SkillListItemDto } from '../api/skillApi'
import { filterPrompts, type LibraryPrompt } from '../api/promptLibraryApi'
import { listWorkbenchModelCatalogModels, listWorkbenchModelCatalogVendors, type ModelCatalogModelDto } from '../api/modelCatalogApi'
import { usePromptLibrary } from '../promptLibrary/usePromptLibrary'
import { useUserPrompts } from '../promptLibrary/useUserPrompts'
import { promptDisplayTitle, promptSourceLabel } from '../promptLibrary/promptDisplay'
import { decodeModelIdentity, encodeModelIdentity, filterUsableAssistantTextModels, labelForModel } from './assistantModelIdentity'
import { getAssistantModelPref, setAssistantModelPref } from './assistantModelPref'
import { useAgentUsageStore } from './agentUsageStore'
import type { ComposerAttachment } from './composer/composerAttachmentTypes'
import type { CreationDocumentTools } from '../workbenchTypes'
import type { ProjectAgentApprovalMode, ProjectAgentItem, ProjectAgentSpendPolicy, ProjectAgentStatus } from '../../../electron/shared/projectAgentContracts'
import type { DocumentAnchorRef, PreconditionSet, TargetRef } from '../../../electron/shared/capabilityTargeting'
import { timelineRevision } from '../timeline/kernel/timelineKernel'
import { useProductionRunStore } from '../production/productionRunStore'
import { ResidentApprovalCard, ResidentStreamingText, ResidentTaskRows, ResidentThinkingState, ResidentToolChips, type ResidentApprovalState, type ResidentToolChipData } from './resident/ResidentUiPrimitives'
import { ResidentReferenceChip } from './resident/ResidentReferenceChip'
import { normalizeResidentToolProjection, readResidentToolProjections, residentToolProjectionKey, residentToolProjectionScope, writeResidentToolProjections, type ResidentToolProjection } from './resident/residentToolProjection'
import { proposalForTool, readableToolDetailRows, readableToolName, readableToolPreview, readableToolResult, readableToolSummary, readableToolTarget, residentToolProjectionForCall } from './resident/residentToolDisplay'
import { GenerationProposalEditor } from './resident/GenerationProposalEditor'
import { isGenerationProposalTool, proposalDecisionPayload } from './resident/generationProposalEditing'
import { buildResidentReference, contextHandleForResidentReference, residentReferencePromptValue } from './resident/residentReferences'
import { composeResidentSystemPrompt, libraryPromptMenuId, libraryPromptReferenceId } from './resident/residentPromptSelection'
import { buildResidentContextSnapshot, mergeResidentContextHandles, type AgentContextSnapshot } from './resident/residentContextSnapshot'
import { isTranscriptAtBottom, shouldFollowTranscript, transcriptScrollBehavior } from './resident/residentTranscriptScroll'
import { isAgentActionIntent } from './agentIntent'
import { buildStaticAgentSystemPrompt } from '../generationCanvas/agent/generationCanvasAgentClient'
import { projectAgentSkillEvents } from './skillEventProjection'

type ResidentSurface = Extract<WorkspaceMode, 'creation' | 'generation' | 'preview'>
type PendingTool = { call: ToolCallEvent; bindingKey: string; state: ResidentApprovalState }
type MenuId = 'attachments' | 'references' | 'skills' | 'prompts' | 'modes' | 'policy' | 'models' | null

const residentPendingTools = new Map<string, PendingTool>()
const residentToolArgs = new Map<string, unknown>()
/** Derived, redacted display data; never a second source of Host task truth. */
const residentToolProjections = new Map<string, ResidentToolProjection>()
const residentPendingListeners = new Set<() => void>()
const residentResolvingTools = new Set<string>()
const pendingKey = (call: Pick<ToolCallEvent, 'turnId' | 'toolCallId'>): string => `${call.turnId}:${call.toolCallId}`
const bindingKey = (binding: { immutableProjectUuid: string; projectGeneration: number }): string => `${binding.immutableProjectUuid}:${binding.projectGeneration}`
const isLive = (status: ProjectAgentStatus): boolean => ['drafting', 'proposed', 'queued', 'running'].includes(status)
const emitPending = (): void => residentPendingListeners.forEach((listener) => listener())

function cacheResidentToolProjection(scope: string, turnId: string, toolCallId: string, projection: ResidentToolProjection): void {
  if (!scope) return
  residentToolProjections.set(residentToolProjectionKey(scope, turnId, toolCallId), normalizeResidentToolProjection(projection))
  emitPending()
}

function clearResidentPendingTools(turnId: string): void {
  let changed = false
  for (const key of residentPendingTools.keys()) {
    if (!key.startsWith(`${turnId}:`)) continue
    residentPendingTools.delete(key)
    residentToolArgs.delete(key)
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
  const anchorRef = React.useRef<HTMLSpanElement>(null)
  const [position, setPosition] = React.useState<{ left: number; bottom: number } | null>(null)
  React.useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onPointer); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [onClose, open])
  // Menus attached to the right-side composer controls open toward the dock,
  // preserving the transcript edge in narrow windows. Attachment/reference
  // menus intentionally keep the left anchor because they originate at the
  // composer start. `role=dialog` is reserved for the split Skill preview.
  const alignEnd = role === 'dialog' || ['技能', 'Skill', '提示词', 'Prompt', '模式', 'Mode', '模型', 'Model'].some((token) => label.startsWith(token))
  React.useLayoutEffect(() => {
    if (!open) { setPosition(null); return }
    const updatePosition = () => {
      const anchor = anchorRef.current?.parentElement?.getBoundingClientRect()
      const menu = ref.current?.getBoundingClientRect()
      if (!anchor) return
      const width = menu?.width || 320
      const padding = 12
      const desiredLeft = alignEnd ? anchor.right - width : anchor.left
      const left = Math.min(Math.max(desiredLeft, padding), Math.max(padding, window.innerWidth - width - padding))
      const bottom = Math.max(padding, window.innerHeight - anchor.top + 4)
      setPosition({ left, bottom })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => { window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', updatePosition, true) }
  }, [alignEnd, className, open])
  if (!open) return null
  const menu = <div ref={ref} role={role} aria-label={label} data-agent-menu={label} style={position ? { left: position.left, bottom: position.bottom } : { left: -10000, bottom: -10000 }} className={cn('fixed z-[60] mb-1 max-h-[min(420px,65vh)] w-[min(320px,calc(100vw-24px))] overflow-y-auto rounded-nomi border border-nomi-line bg-nomi-paper p-1.5 text-body-sm text-nomi-ink shadow-nomi-lg', !position && 'pointer-events-none opacity-0', className)}>{children}</div>
  return <><span ref={anchorRef} className="pointer-events-none absolute inset-0" aria-hidden="true" />{typeof document === 'undefined' ? menu : <BodyPortal>{menu}</BodyPortal>}</>
}

// Commit a primary-pointer action before the outside-click lifecycle can remount
// a hover-preview row; the ref suppresses the follow-up synthetic click while
// preserving keyboard activation through onClick.
function MenuRow({ children, onClick, onMouseEnter, onFocus, selected, disabled, testId, promptLibraryId, className }: { children: React.ReactNode; onClick?: () => void; onMouseEnter?: () => void; onFocus?: () => void; selected?: boolean; disabled?: boolean; testId?: string; promptLibraryId?: string; className?: string }): JSX.Element {
  const pointerActivated = React.useRef(false)
  return <button type="button" disabled={disabled} data-agent-menu-item={testId} data-agent-prompt-library-item={promptLibraryId} onClick={() => { if (pointerActivated.current) { pointerActivated.current = false; return }; onClick?.() }} onPointerDown={(event) => { event.stopPropagation(); if (event.button === 0 && !disabled) { pointerActivated.current = true; onClick?.() } }} onMouseEnter={onMouseEnter} onFocus={onFocus} className={cn('flex min-h-7 w-full items-center gap-2 rounded-nomi-sm px-2 py-1 text-left text-caption leading-tight transition-[background,color] duration-[var(--nomi-transition-fast)]', selected ? 'bg-nomi-accent-soft text-nomi-accent' : 'hover:bg-nomi-ink-05', disabled && 'cursor-not-allowed opacity-45', className)}>{children}</button>
}

function iconControlClass(active = false): string {
  return cn('inline-grid size-7 shrink-0 place-items-center rounded-nomi-sm border p-0 transition-[background,border-color,color,transform] duration-[var(--nomi-transition-fast)] motion-reduce:transition-none motion-safe:hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40', active ? 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent' : 'border-nomi-line bg-transparent text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink')
}

function MenuCopy({ label, hint }: { label: React.ReactNode; hint?: React.ReactNode }): JSX.Element {
  return <span className="min-w-0 flex-1"><span className="block truncate">{label}</span>{hint ? <span className="mt-0.5 block truncate text-micro leading-tight text-nomi-ink-40">{hint}</span> : null}</span>
}

type ResidentPromptMenuProps = {
  t: (key: string, options?: Record<string, unknown>) => string
  promptLibraryItems: readonly LibraryPrompt[]
  userPromptItems: readonly LibraryPrompt[]
  loading: boolean
  error: string | null
  query: string
  selectedLibraryPrompt: LibraryPrompt | null
  activeSkill: { key: string; name: string } | null
  promptModeId: string
  onQueryChange: (query: string) => void
  onSelectPreset: (id: string) => void
  onSelectLibraryPrompt: (prompt: LibraryPrompt) => void
  onReload: () => void
  onClose: () => void
}

/** Compact prompt chooser: built-in round presets plus the canonical library. */
function ResidentPromptMenu({
  t,
  promptLibraryItems,
  userPromptItems,
  loading,
  error,
  query,
  selectedLibraryPrompt,
  activeSkill,
  promptModeId,
  onQueryChange,
  onSelectPreset,
  onSelectLibraryPrompt,
  onReload,
  onClose,
}: ResidentPromptMenuProps): JSX.Element {
  const rowClass = 'flex min-h-7 w-full items-center gap-2 rounded-nomi-sm px-2 py-1 text-left text-caption leading-tight transition-[background,color] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05'
  const typeLabel = (prompt: LibraryPrompt): string => prompt.promptType === 'video' ? t('agentResident.video') : t('agentResident.image')
  const normalizedQuery = query.trim().toLowerCase()
  const visiblePresets = PROMPT_PRESETS.filter((preset) => {
    if (!normalizedQuery) return true
    return `${t(`agentResident.${preset.labelKey}`)} ${t(`agentResident.${preset.hintKey}`)} ${preset.prompt}`.toLowerCase().includes(normalizedQuery)
  })
  const renderLibraryRow = (prompt: LibraryPrompt): JSX.Element => {
    const selected = selectedLibraryPrompt?.id === prompt.id && selectedLibraryPrompt.origin === prompt.origin
    const menuId = libraryPromptMenuId(prompt)
    return <MenuRow key={`${prompt.origin}:${prompt.id}`} testId={menuId} promptLibraryId={prompt.id} selected={selected} onClick={() => onSelectLibraryPrompt(prompt)} className={rowClass}>
      {prompt.promptType === 'video' ? <IconVideo size={16} className="shrink-0 text-nomi-ink-60" /> : <IconPhoto size={16} className="shrink-0 text-nomi-ink-60" />}
      <MenuCopy label={promptDisplayTitle(prompt)} hint={`${promptSourceLabel(prompt)} · ${typeLabel(prompt)}`} />
      {selected ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}
    </MenuRow>
  }
  return <Popover open onClose={onClose} label={t('agentResident.prompt')} className="w-[360px] max-w-[calc(100vw-24px)]">
    <label className="mx-1 mb-1 flex h-7 items-center gap-1.5 rounded-nomi-sm border border-nomi-line px-2 text-micro text-nomi-ink-40 focus-within:border-nomi-accent">
      <IconSearch size={14} aria-hidden="true" />
      <input value={query} onChange={(event) => onQueryChange(event.currentTarget.value)} placeholder={t('libraries.prompt.searchPlaceholder')} aria-label={t('libraries.prompt.searchAria')} data-agent-prompt-search="true" className="min-w-0 flex-1 bg-transparent outline-none" />
    </label>
    {visiblePresets.map((preset) => {
      const PresetIcon = preset.icon
      const selected = !activeSkill && !selectedLibraryPrompt && promptModeId === preset.id
      return <MenuRow key={preset.id} selected={selected} testId={preset.id} onClick={() => onSelectPreset(preset.id)} className={rowClass}>
        <PresetIcon size={16} className="shrink-0 text-nomi-ink-60" />
        <MenuCopy label={<>{t(`agentResident.${preset.labelKey}`)}{preset.id !== 'general' ? <span className="ml-1 rounded-pill bg-nomi-ink-05 px-1 text-micro text-nomi-ink-40">{t('agentResident.builtIn')}</span> : null}</>} hint={t(`agentResident.${preset.hintKey}`)} />
        {selected ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}
      </MenuRow>
    })}
    <div className="my-1 border-t border-nomi-line-soft" />
    <div className="px-2 py-1 text-micro text-nomi-ink-40">{t('libraries.prompt.title')}</div>
    {loading ? <div className="px-2 py-1 text-micro text-nomi-ink-40" role="status">{t('libraries.prompt.fetching')}</div> : null}
    {!loading && promptLibraryItems.length ? promptLibraryItems.map(renderLibraryRow) : null}
    {userPromptItems.length ? <><div className="my-1 border-t border-nomi-line-soft" /><div className="px-2 py-1 text-micro text-nomi-ink-40">{t('libraries.prompt.source.mine')}</div>{userPromptItems.map(renderLibraryRow)}</> : null}
    {!loading && !promptLibraryItems.length && !userPromptItems.length ? <MenuRow disabled testId="library-empty" className={rowClass}><IconPencil size={16} className="shrink-0 text-nomi-ink-40" /><MenuCopy label={error ? t('runtime.promptLibrary.loadFailed') : t('runtime.promptLibrary.empty')} /></MenuRow> : null}
    {error ? <MenuRow testId="library-retry" onClick={onReload} className={rowClass}><IconRefresh size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('runtime.promptLibrary.loadFailed')} hint={t('agentResident.retry')} /></MenuRow> : null}
  </Popover>
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
  const key = status === 'drafting' ? 'planning' : status === 'proposed' ? 'waitingApprovalShort' : status === 'declined' ? 'declined' : status
  return t(`agentResident.${key}`)
}

function isActiveQueueStatus(status: ProjectAgentStatus): boolean {
  return status === 'queued' || status === 'proposed' || status === 'running'
}

function readableFailure(t: (key: string, options?: Record<string, unknown>) => string, code: string, message: string): string {
  const text = `${code} ${message}`.toLowerCase()
  if (text.includes('model') && (text.includes('config') || text.includes('credential') || text.includes('key'))) return t('agentResident.modelUnavailable')
  if (text.includes('stale') || text.includes('precondition')) return t('agentResident.contextChanged')
  if (text.includes('denied') || text.includes('approval')) return t('agentResident.operationDenied')
  if (text.includes('cancel')) return t('agentResident.operationStopped')
  return t('agentResident.operationFailed')
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

type ResidentSendContext = Readonly<{
  snapshot: AgentContextSnapshot
  activeDocumentId: string
  selectedNodeIds: readonly string[]
  selectedClipIds: readonly string[]
  documentState?: Readonly<{ revision: number; contentHash: string; anchor: DocumentAnchorRef }>
}>

/**
 * Read all domain selections in one synchronous turn immediately before
 * enqueue.  The composer must never send a render-time selection that changed
 * while the user was typing; the resulting snapshot is detached/frozen by the
 * pure builder and travels with the Host request.
 */
function captureResidentSendContext(surface: ResidentSurface, creationDocumentTools: CreationDocumentTools | null): ResidentSendContext {
  const workbench = useWorkbenchStore.getState()
  const canvas = useGenerationCanvasStore.getState()
  const activeDocumentId = workbench.activeDocumentId
  const document = workbench.workbenchDocuments.find((item) => item.id === activeDocumentId)
  // The editor bridge is authoritative only while the creation surface is
  // active. Generation/preview may keep the resident shell mounted after the
  // editor has been torn down; probing that bridge there would make an
  // otherwise valid send fail or capture a stale anchor.
  const documentState = surface === 'creation' ? creationDocumentTools?.readState() : undefined
  const selectedNodeIds = surface === 'generation' ? Object.freeze([...canvas.selectedNodeIds]) : Object.freeze([])
  const selectedClipIds = surface === 'preview' ? Object.freeze([...workbench.selectedTimelineClipIds]) : Object.freeze([])
  const snapshot = buildResidentContextSnapshot({
    document: document
      ? {
          id: document.id,
          // The editor supplies a content revision when mounted.  Other
          // surfaces use the workbench persistence revision as a conservative
          // fallback rather than claiming a made-up document revision.
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
  const approvalPolicy = useWorkbenchStore((state) => state.projectAgentApprovalPolicy)
  const setApprovalPolicy = useWorkbenchStore((state) => state.setProjectAgentApprovalPolicy)
  const activeDocumentId = useWorkbenchStore((state) => state.activeDocumentId)
  const creationDocumentTools = useWorkbenchStore((state) => state.creationDocumentTools)
  const promptModeId = useWorkbenchStore((state) => state.creationAiModeId)
  const activeSkill = useWorkbenchStore((state) => state.creationActiveSkill)
  const setPromptModeId = useWorkbenchStore((state) => state.setCreationAiModeId)
  const setActiveSkill = useWorkbenchStore((state) => state.setCreationActiveSkill)
  const selectedClipIds = useWorkbenchStore((state) => state.selectedTimelineClipIds)
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const [menu, setMenu] = React.useState<MenuId>(null)
  // Prompt bodies stay in the canonical prompt-library API/cache. The
  // resident stores only the ephemeral selected projection for this composer.
  const [selectedLibraryPrompt, setSelectedLibraryPrompt] = React.useState<LibraryPrompt | null>(null)
  const [promptSearch, setPromptSearch] = React.useState('')
  const [threadsOpen, setThreadsOpen] = React.useState(false)
  const [error, setError] = React.useState('')
  const [editingQueue, setEditingQueue] = React.useState<{ queueItemId: string; userItemId: string } | null>(null)
  const [skills, setSkills] = React.useState<SkillListItemDto[]>([])
  const [availableSkillProviders, setAvailableSkillProviders] = React.useState<ReadonlySet<'text' | 'image' | 'video'>>(new Set())
  const [skillSearch, setSkillSearch] = React.useState('')
  const [skillPreview, setRawSkillPreview] = React.useState<SkillListItemDto | null>(null)
  // Keep the preview one compact line richer than the list: provenance is
  // useful when two similarly named Skills are present, while the full hash
  // remains available through the native title tooltip for progressive
  // disclosure. The catalog remains the sole source of this identity.
  const setSkillPreview = React.useCallback((skill: SkillListItemDto | null) => {
    if (!skill) {
      setRawSkillPreview(null)
      return
    }
    const source = skill.origin === 'user' ? t('agentResident.skillUser') : t('agentResident.skillBuiltin')
    const identity = `${source} · ${skill.packageVersion} · #${skill.contentHash.slice(0, 8)}`
    setRawSkillPreview({ ...skill, description: [skill.description, identity].filter(Boolean).join(' · ') })
  }, [t])
  const [models, setModels] = React.useState<ModelCatalogModelDto[]>([])
  const [vendors, setVendors] = React.useState<Record<string, string>>({})
  const [selectedModel, setSelectedModel] = React.useState(() => { const pref = getAssistantModelPref(); return pref ? `${pref.vendorKey}:${pref.modelKey}` : '' })
  const [lastTurnTokens, setLastTurnTokens] = React.useState(0)
  const [contextPulse, setContextPulse] = React.useState(false)
  const [thinkingOpen, setThinkingOpen] = React.useState(false)
  const [proposalDrafts, setProposalDrafts] = React.useState<Record<string, Record<string, unknown>>>({})
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const transcriptAtBottomRef = React.useRef(true)
  const [showLatest, setShowLatest] = React.useState(false)
  const threadMenuRef = React.useRef<HTMLDivElement>(null)
  const promptLibrary = usePromptLibrary(menu === 'prompts')
  const userPromptLibrary = useUserPrompts(menu === 'prompts')
  const binding = snapshot?.binding ?? null
  const pendingTools = useResidentPendingTools(binding ? bindingKey(binding) : null)
  const activeThreadId = snapshot?.activeThreadId ?? null
  const activeThread = snapshot?.threads.find((thread) => thread.threadId === activeThreadId)
  const items = React.useMemo(() => snapshot?.items.filter((item) => item.threadId === activeThreadId) ?? [], [activeThreadId, snapshot])
  const skillEvents = React.useMemo(() => projectAgentSkillEvents(items), [items])
  const queue = React.useMemo(() => snapshot?.queue.filter((item) => item.threadId === activeThreadId) ?? [], [activeThreadId, snapshot])
  const activeQueue = React.useMemo(() => queue.filter((item) => isActiveQueueStatus(item.status)), [queue])
  const activeTurn = snapshot?.turns.find((turn) => turn.threadId === activeThreadId && isLive(turn.status))
  const runningTurn = snapshot?.turns.find((turn) => turn.threadId === activeThreadId && turn.status === 'running')
  const planningTurn = snapshot?.turns.find((turn) => turn.threadId === activeThreadId && turn.status === 'drafting')
  const sessionTotalTokens = useAgentUsageStore((state) => state.totalTokens)
  const toolProjectionScope = binding && activeThreadId ? residentToolProjectionScope(bindingKey(binding), activeThreadId) : ''
  const selectedModelRow = models.find((model) => encodeModelIdentity(model) === selectedModel)
  const costLabel = selectedModelRow?.pricing?.enabled && Number.isFinite(selectedModelRow.pricing.cost)
    ? t('agentResident.costCataloguedAmount', { amount: selectedModelRow.pricing.cost.toFixed(2) })
    : t('agentResident.costUnknown')
  React.useEffect(() => {
    if (!toolProjectionScope) return
    const prefix = `${toolProjectionScope}:`
    for (const key of residentToolProjections.keys()) if (!key.startsWith(prefix)) residentToolProjections.delete(key)
    const persisted = readResidentToolProjections(toolProjectionScope)
    for (const [callKey, projection] of Object.entries(persisted)) {
      const key = `${toolProjectionScope}:${callKey}`
      if (!residentToolProjections.has(key)) residentToolProjections.set(key, projection)
    }
    emitPending()
  }, [toolProjectionScope])
  const toolChipItems = React.useMemo<ResidentToolChipData[]>(() => items.filter((item): item is Extract<ProjectAgentItem, { kind: 'tool' }> => item.kind === 'tool' && item.capability.id !== 'skill.read').map((item) => {
    const projection = toolProjectionScope ? residentToolProjections.get(residentToolProjectionKey(toolProjectionScope, item.turnId, item.toolCallId)) : undefined
    const args = residentToolArgs.get(pendingKey({ turnId: item.turnId, toolCallId: item.toolCallId }))
    const effect = projection?.effect || readableToolPreview(t, item.capability.id, args) || item.text || ''
    const result = item.resultRef ? t('agentResident.toolReferenceResult') : readableToolResult(t, item.status)
    const target = projection?.target || readableToolTarget(t, item.capability.id, args)
    const technicalDetails = projection?.technicalDetails || [readableToolSummary(t, item.capability.id, args) || item.text || '', item.resultRef ? `${t('agentResident.toolReferenceResult')} · ${item.resultRef}` : ''].filter(Boolean).join(' · ')
    return { id: item.itemId, label: readableToolName(t, item.capability.id), name: item.capability.id, effect, target, summary: effect, detail: technicalDetails, technicalDetails, result, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt }
  }), [items, t, toolProjectionScope])
  const selectedPromptPreset = PROMPT_PRESETS.find((preset) => preset.id === promptModeId) ?? PROMPT_PRESETS[0]
  const visibleLibraryPrompts = React.useMemo(() => {
    const query = promptSearch.trim()
    return {
      nomi: filterPrompts(promptLibrary.items, 'all', query),
      mine: filterPrompts(userPromptLibrary.items, 'all', query),
    }
  }, [promptLibrary.items, promptSearch, userPromptLibrary.items])
  const contextCount = surface === 'generation' ? t('agentResident.contextNodes', { count: selectedNodeIds.length }) : surface === 'preview' ? t('agentResident.contextClips', { count: selectedClipIds.length }) : t('agentResident.currentDocument')
  const hasContextLocator = surface === 'creation'
    ? Boolean(activeDocumentId)
    : surface === 'generation'
      ? selectedNodeIds.length > 0
      : selectedClipIds.length > 0

  // The picker is the user's capability index: expose every selectable
  // repository/user Skill. Electron filters implementation-only resources
  // before they cross the bridge.
  React.useEffect(() => { try { setSkills(listWorkbenchSkills()) } catch { setSkills([]) }; void getAvailableSkillProviders().then(setAvailableSkillProviders).catch(() => setAvailableSkillProviders(new Set())) }, [])
  React.useEffect(() => { let alive = true; void Promise.all([listWorkbenchModelCatalogVendors(), listWorkbenchModelCatalogModels({ kind: 'text', enabled: true })]).then(([vendorRows, modelRows]) => { if (!alive) return; const usable = filterUsableAssistantTextModels(modelRows, vendorRows); setModels(usable); setVendors(Object.fromEntries(vendorRows.map((row) => [row.key, row.name]))); const pref = getAssistantModelPref(); const found = pref && usable.find((row) => row.vendorKey === pref.vendorKey && row.modelKey === pref.modelKey); if (!found && usable[0]) { setAssistantModelPref({ vendorKey: usable[0].vendorKey, modelKey: usable[0].modelKey }); setSelectedModel(encodeModelIdentity(usable[0])) } else if (found) setSelectedModel(encodeModelIdentity(found)) }).catch(() => { if (alive) setModels([]) }); return () => { alive = false } }, [])
  // Skill, built-in mode, and library prompt are mutually exclusive round
  // context choices. Keep the canonical store fields in sync even when a
  // selection comes from a different menu row.
  React.useEffect(() => {
    if (activeSkill && (selectedLibraryPrompt || promptModeId !== 'general')) {
      if (selectedLibraryPrompt) setSelectedLibraryPrompt(null)
      if (promptModeId !== 'general') setPromptModeId('general')
      return
    }
    if (selectedLibraryPrompt && promptModeId !== 'general') setSelectedLibraryPrompt(null)
  }, [activeSkill, promptModeId, selectedLibraryPrompt, setPromptModeId])
  React.useEffect(() => {
    const activeKeys = new Set(pendingTools.map((pending) => pendingKey(pending.call)))
    setProposalDrafts((previous) => {
      const next = Object.fromEntries(Object.entries(previous).filter(([key]) => activeKeys.has(key)))
      return Object.keys(next).length === Object.keys(previous).length ? previous : next
    })
  }, [pendingTools])
  React.useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const updatePosition = () => {
      const atBottom = isTranscriptAtBottom(node)
      transcriptAtBottomRef.current = atBottom
      setShowLatest(!atBottom)
    }
    updatePosition()
    node.addEventListener('scroll', updatePosition, { passive: true })
    return () => node.removeEventListener('scroll', updatePosition)
  }, [])
  React.useEffect(() => {
    const node = scrollRef.current
    if (!node || !shouldFollowTranscript(transcriptAtBottomRef.current)) return
    node.scrollTop = node.scrollHeight
    transcriptAtBottomRef.current = true
    setShowLatest(false)
  }, [items.length, pendingTools.length, activeTurn?.status])
  const scrollToLatest = React.useCallback(() => {
    const node = scrollRef.current
    if (!node) return
    const prefersReducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    node.scrollTo({ top: node.scrollHeight, behavior: transcriptScrollBehavior(prefersReducedMotion) })
    transcriptAtBottomRef.current = true
    setShowLatest(false)
  }, [])
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
  const selectLibraryPrompt = React.useCallback((prompt: LibraryPrompt) => {
    setActiveSkill(null)
    setPromptModeId('general')
    setSelectedLibraryPrompt(prompt)
    closeMenu()
  }, [closeMenu, setActiveSkill, setPromptModeId])
  const selectPromptPreset = React.useCallback((id: string) => {
    setSelectedLibraryPrompt(null)
    setActiveSkill(null)
    setPromptModeId(id)
    closeMenu()
  }, [closeMenu, setActiveSkill, setPromptModeId])
  const addReference = React.useCallback((reference: ProjectAgentReference) => {
    // Bind a manual @ reference to the current immutable domain handle at the
    // moment the user chooses it. Labels alone are never promoted into a
    // target; unmatched browser/empty-selection references remain legacy
    // projections and are resolved only by their explicit value.
    let enriched = reference
    try {
      const current = captureResidentSendContext(surface, creationDocumentTools).snapshot
      const handle = contextHandleForResidentReference(reference, current.handles)
      if (handle) enriched = Object.freeze({ ...reference, contextHandle: handle })
    } catch {
      // A reference menu must remain usable if a surface bridge is between
      // mounts. The send path still captures a fresh snapshot and validates
      // the explicit target before enqueue.
    }
    setReferences((previous) => previous.some((item) => item.id === enriched.id) ? previous : [...previous, enriched])
    closeMenu()
  }, [closeMenu, creationDocumentTools, setReferences, surface])
  const removeReference = React.useCallback((id: string) => setReferences((previous) => previous.filter((item) => item.id !== id)), [setReferences])
  const focusContext = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('nomi-agent-context-focus', {
      detail: {
        surface,
        nodeIds: surface === 'generation' ? [...selectedNodeIds] : undefined,
        clipIds: surface === 'preview' ? [...selectedClipIds] : undefined,
      },
    }))
    setContextPulse(true)
    window.setTimeout(() => setContextPulse(false), 1400)
  }, [selectedClipIds, selectedNodeIds, surface])
  const focusReceipt = React.useCallback(() => {
    focusContext()
  }, [focusContext])
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
  const runQueueMutation = React.useCallback(async (mutation: () => Promise<unknown>) => {
    try {
      await mutation()
    } catch (caught) {
      setError(friendlyError(caught, t))
    }
  }, [t])
  const resolveTool = React.useCallback(async (pending: PendingTool, ok: boolean, editedArgs?: Record<string, unknown>) => {
    const key = pendingKey(pending.call)
    if (pending.state !== 'pending' || residentResolvingTools.has(key)) return
    residentResolvingTools.add(key)
    try {
      const editedPayload = ok ? proposalDecisionPayload(pending.call.args, editedArgs ?? proposalDrafts[key]) : {}
      await pending.call.confirm({ ok, ...(ok ? editedPayload : { message: t('agentResident.deny') }) })
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
  }, [proposalDrafts, t])

  const submit = React.useCallback(async () => {
    const text = draft.trim(); if (!text || !snapshot) return; setError('')
    if (editingQueue) { try { await editProjectAgentQueueItem({ ...editingQueue, text }); setEditingQueue(null); setDraft('') } catch (caught) { setError(friendlyError(caught, t)) }; return }
    if (attachments.some((item) => item.status === 'uploading')) { setError(t('creationAi.attachmentsUploading')); return }
    const turnId = `turn-resident-${globalThis.crypto.randomUUID()}`
    let sendContext: ResidentSendContext
    try { sendContext = captureResidentSendContext(surface, creationDocumentTools) } catch (caught) { setError(friendlyError(caught, t)); return }
    const selectedNodeIdsAtSend = sendContext.selectedNodeIds
    const selectedClipIdsAtSend = sendContext.selectedClipIds
    const surfaceContext = surfaceLabel(t, surface)
    const contextDetail = surface === 'generation' ? t('agentResident.contextNodes', { count: selectedNodeIdsAtSend.length }) : surface === 'preview' ? t('agentResident.contextClips', { count: selectedClipIdsAtSend.length }) : t('agentResident.currentDocument')
    // Preview is a real timeline task surface, not tool-free chat. Keep the
    // legacy canvas-chat capability for callers that explicitly need prose,
    // while the resident routes timeline work through the Host's timeline
    // profile so read/plan/apply/export can use the existing owner.
    const capability = surface === 'creation' ? 'creation-editor' as const : 'canvas-agent' as const
    const selectedPrompt = getCreationAiMode(promptModeId)
    const skillKey = activeSkill?.key ?? (surface === 'creation' ? `workbench.creation.${selectedPrompt.id}` : surface === 'preview' ? 'workbench.timeline.editor' : 'workbench.generation.canvas-planner')
    let target: TargetRef; let preconditions: PreconditionSet | undefined
    try {
      if (surface === 'creation') {
        const state = sendContext.documentState
        target = { kind: 'document', documentId: sendContext.activeDocumentId, anchor: state?.anchor ?? { kind: 'whole-document' } }
        if (state) preconditions = { document: { revision: state.revision, contentHash: state.contentHash } }
      } else if (surface === 'preview') {
        target = { kind: 'timeline', clipIds: Object.freeze([...selectedClipIdsAtSend]) }
      } else {
        target = { kind: 'canvas', nodeIds: Object.freeze([...selectedNodeIdsAtSend]) }
      }
    } catch (caught) { setError(friendlyError(caught, t)); return }
    const contextSnapshot = mergeResidentContextHandles(
      sendContext.snapshot,
      references.flatMap((reference) => reference.contextHandle ? [reference.contextHandle] : []),
    )
    const referencesText = references.length ? `\n\n${t('agentResident.referencesLabel')}: ${references.map(residentReferencePromptValue).join(', ')}` : ''
    setDraft(''); attachmentApi.clearAttachments(); closeMenu()
    try {
      const actionIntent = isAgentActionIntent(text)
      const requestMode = runMode === 'ask' && !actionIntent ? 'chat' : 'auto'
      const surfaceSystemPrompt = surface === 'generation'
        ? buildStaticAgentSystemPrompt(requestMode === 'chat' ? 'chat' : 'agent')
        : surface === 'preview'
          ? buildStaticAgentSystemPrompt(requestMode === 'chat' ? 'chat' : 'agent', 'timeline')
        : surface === 'creation' && !activeSkill
          ? selectedPromptPreset.prompt || selectedPrompt.prompt
          : undefined
      const systemPrompt = composeResidentSystemPrompt(surfaceSystemPrompt, activeSkill ? null : selectedLibraryPrompt)
      const response = await runWorkbenchAgent({ turnId, prompt: `${surfaceContext}\n${contextDetail}${referencesText}\n\n${text}`, ...(systemPrompt ? { systemPrompt } : {}), displayPrompt: text, capability, ...(surface === 'preview' ? { toolProfile: 'timeline' as const } : {}), history: { kind: 'ephemeral' }, projectId: snapshot.binding.projectId, selectedNodeIds: surface === 'generation' ? selectedNodeIdsAtSend : undefined, target, ...(preconditions ? { preconditions } : {}), originSurface: { surfaceId: 'project-agent-resident', kind: surface === 'creation' ? 'document' : surface === 'generation' ? 'canvas' : 'preview' }, mode: requestMode, workMode: runMode, approvalPolicy, skillKey, skillName: activeSkill?.name ?? (selectedLibraryPrompt ? promptDisplayTitle(selectedLibraryPrompt) : surface === 'preview' ? t('agentResident.skillTimeline') : selectedPrompt.title), contextSnapshot, attachmentClaims: projectAgentAttachmentClaims(attachments.filter((item) => item.status === 'ready')), attachments: attachmentPayloads(attachments), onToolCall: async (call) => { residentToolArgs.set(pendingKey(call), call.args); residentPendingTools.set(pendingKey(call), { call, bindingKey: bindingKey(snapshot.binding), state: 'pending' }); const projectionScope = residentToolProjectionScope(bindingKey(snapshot.binding), snapshot.activeThreadId ?? ''); if (projectionScope) { const projection = residentToolProjectionForCall(t, call.toolName, call.args, 'proposed'); cacheResidentToolProjection(projectionScope, call.turnId, call.toolCallId, projection); const persisted = new Map(Object.entries(readResidentToolProjections(projectionScope))); persisted.set(`${call.turnId}:${call.toolCallId}`, projection); writeResidentToolProjections(projectionScope, persisted) }; emitPending() } })
      const projectionScope = residentToolProjectionScope(bindingKey(snapshot.binding), snapshot.activeThreadId ?? '')
      if (projectionScope && response.toolCalls.length) {
        const persisted = new Map(Object.entries(readResidentToolProjections(projectionScope)))
        for (const record of response.toolCalls) {
          const status: ProjectAgentStatus = record.status === 'ok' ? 'done' : record.status === 'cancelled' ? 'stopped' : record.status === 'denied' ? 'declined' : 'failed'
          const projection = residentToolProjectionForCall(t, record.toolName, record.args, status)
          const callKey = `${turnId}:${record.toolCallId}`
          persisted.set(callKey, projection)
          cacheResidentToolProjection(projectionScope, turnId, record.toolCallId, projection)
        }
        writeResidentToolProjections(projectionScope, persisted)
      }
      setLastTurnTokens(response.usage.totalTokens)
    } catch (caught) { setError(friendlyError(caught, t)) } finally { clearResidentPendingTools(turnId) }
  }, [activeSkill, attachmentApi, attachments, closeMenu, creationDocumentTools, draft, editingQueue, promptModeId, references, runMode, selectedLibraryPrompt, selectedPromptPreset, setDraft, snapshot, surface, t])
  const onKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }, [submit])

  // Search by the stable Skill key and directory as well as the localized
  // label. Users (and walk-throughs) commonly paste `brand.promo` from a
  // manifest or MCP request; filtering only the translated label made a
  // perfectly loaded repository Skill appear to be missing.
  const filteredSkills = skills.filter((item) => `${item.name} ${item.directoryName} ${item.label} ${item.description ?? ''}`.toLowerCase().includes(skillSearch.toLowerCase()))
  const promptPreset = PROMPT_PRESETS.find((preset) => preset.id === promptModeId) ?? PROMPT_PRESETS[0]
  const PromptIcon = promptPreset.icon
  const modeKey = (value: ProjectAgentRunMode): string => `agentResident.mode${value[0].toUpperCase()}${value.slice(1)}`
  const modeTitle = `${t('agentResident.modeTitle')} · ${t(modeKey(runMode))}`
  const approvalModeLabel = (value: ProjectAgentApprovalMode): string => t(`agentResident.approvalMode${value === 'safe-auto' ? 'SafeAuto' : value === 'project' ? 'Project' : 'Step'}`)
  const spendPolicyLabel = (value: ProjectAgentSpendPolicy): string => t(`agentResident.spendPolicy${value === 'within-budget' ? 'WithinBudget' : 'Confirm'}`)
  const approvalTitle = `${t('agentResident.approvalTitle')} · ${approvalModeLabel(approvalPolicy.mode)} · ${spendPolicyLabel(approvalPolicy.spend)}`
  const promptTitle = selectedLibraryPrompt
    ? `${t('agentResident.prompt')} · ${promptDisplayTitle(selectedLibraryPrompt)}`
    : promptModeId === 'general'
      ? t('agentResident.promptTitle')
      : `${t('agentResident.prompt')} · ${t(`agentResident.${promptPreset.labelKey}`)}`
  const compactStatus = runningTurn
    ? t('agentResident.running')
    : pendingTools.some((pending) => pending.state === 'pending')
      // The collapsed affordance is a status chip, not an explanation. Keep
      // its label short in both locales; the expanded card carries the full
      // approval copy and the button title remains the accessible detail.
      ? t('agentResident.waitingApprovalShort')
      : planningTurn
        ? t('agentResident.planning')
        : activeQueue.length
          ? t('agentResident.queueCount', { count: activeQueue.length })
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

  return <section id="project-agent-resident" onKeyDownCapture={(event) => { if (event.key === 'Escape') { setThreadsOpen(false); setMenu(null) } }} className="relative isolate flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--workbench-ai-panel-bg)] text-nomi-ink" aria-label={t('agentResident.aria')} data-agent-resident="true" data-agent-panel="true" data-agent-surface={surface} data-agent-run-mode={runMode} data-agent-approval-mode={approvalPolicy.mode} data-agent-spend-policy={approvalPolicy.spend}>
    <header className="relative flex shrink-0 items-center gap-2 border-b border-nomi-line-soft px-3 py-1.5" data-agent-header="true">
      {/* 单行 logo+品牌：规格 A-01 要求整个 header ≤44px（单行证明），合并两行文本为一行 */}
      <div className="flex min-w-0 flex-1 items-center gap-2 text-left"><NomiLogoMark size={19} /><span className="min-w-0 truncate text-body-sm font-semibold leading-tight">{t('agentResident.brand')} · <span className="font-normal text-nomi-ink-60">{activeThread?.title || t('agentResident.untitledThread')}</span></span></div>
      {/* data-agent-usage-pill: spec §0 挂点（别名 data-agent-usage 沿用现有属性保持向后兼容） */}
      <span className="max-w-[12rem] shrink-0 truncate text-micro text-nomi-ink-60" data-agent-usage="true" data-agent-usage-pill="true" title={t('agentResident.usageTitle', { last: lastTurnTokens, total: sessionTotalTokens })} aria-label={t('agentResident.usageTitle', { last: lastTurnTokens, total: sessionTotalTokens })}>{t('agentResident.usageCompact', { last: lastTurnTokens, total: sessionTotalTokens })}</span><span className="max-w-[4.5rem] shrink-0 truncate text-micro text-nomi-ink-40" data-agent-cost="true" title={costLabel}>{costLabel}</span>
      {/* data-agent-history: spec §0 挂点（保留 data-agent-thread-trigger 兼容外部引用） */}
      <WorkbenchIconButton size="sm" label={t('agentResident.threadList')} icon={<IconHistory size={15} />} onClick={() => setThreadsOpen((value) => !value)} data-agent-thread-trigger="true" data-agent-history="true" />
      {/* data-agent-collapse: spec §0 挂点 */}
      <WorkbenchIconButton size="sm" label={t('agentResident.collapse')} icon={<IconLayoutSidebarRightCollapse size={15} />} onClick={() => setCollapsed(true)} data-agent-collapse="true" />
      {threadsOpen ? <div ref={threadMenuRef} tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') setThreadsOpen(false) }} className="absolute right-2 top-full z-50 mt-1 w-[280px] rounded-nomi border border-nomi-line bg-nomi-paper p-1 shadow-nomi-lg" data-agent-thread-menu="true" role="menu"><div className="flex items-center justify-between px-2 py-1 text-micro text-nomi-ink-60"><span>{t('agentResident.threads')}</span><button type="button" className="text-nomi-accent" onClick={() => { void createProjectAgentThread(); setThreadsOpen(false) }}>{t('agentResident.newThread')}</button></div>{(snapshot?.threads ?? []).map((thread) => <div key={thread.threadId} className={cn('flex items-center gap-1 rounded-nomi-sm px-2 py-1', thread.threadId === activeThreadId && 'bg-nomi-accent-soft')}><button type="button" className="min-w-0 flex-1 truncate text-left text-caption" onClick={() => { void activateProjectAgentThread(thread.threadId); setThreadsOpen(false) }}>{thread.title || t('agentResident.untitledThread')}</button><button type="button" className="grid size-7 place-items-center rounded-nomi-sm hover:bg-nomi-ink-10" aria-label={t('agentResident.removeThread')} onClick={() => void removeProjectAgentThread(thread.threadId)}><IconTrash size={13} /></button></div>)}</div> : null}
    </header>
    <div className={cn('flex shrink-0 items-center gap-2 border-b border-nomi-line-soft px-3 py-1.5 transition-[background,box-shadow] duration-[var(--nomi-transition-fast)]', contextPulse && 'bg-nomi-accent-soft shadow-[inset_0_-2px_0_var(--nomi-accent)]')} data-agent-context="true" data-agent-context-focused={contextPulse ? 'true' : 'false'}><div className="min-w-0 flex-1 truncate text-caption"><span className="text-nomi-ink-60">{t('agentResident.currentScene')} · </span><span className="font-medium">{surfaceShortLabel(t, surface)}</span><span className="text-nomi-ink-60"> · {contextCount}</span></div>{contextPulse ? <span className="shrink-0 text-micro text-nomi-accent">{t('agentResident.sceneFocused')}</span> : null}{hasContextLocator ? <button type="button" className={iconControlClass(contextPulse)} aria-label={t('agentResident.focusContext')} title={t('agentResident.focusContext')} data-agent-context-focus="true" onClick={focusContext}><IconFocusCentered size={14} aria-hidden="true" /></button> : null}</div>
    <div className="relative min-h-0 flex-1">
    <div ref={scrollRef} className={cn('h-full min-h-0 space-y-1.5 overflow-y-auto px-3 py-2', menu && 'pointer-events-none')} role="log" aria-live="polite" data-agent-transcript="true" data-agent-flow="true">
      {!items.length && !activeQueue.length ? <div className="grid min-h-28 place-items-center px-3 text-center"><div><div className="mb-1 text-body-sm font-semibold">{t('agentResident.emptyTitle')}</div><p className="m-0 text-caption text-nomi-ink-60">{t('agentResident.emptyDescription')}</p></div></div> : null}
      {planningTurn ? <ResidentThinkingState label={t('agentResident.planning')} detail={t('agentResident.planningDetail')} open={thinkingOpen} onToggle={() => setThinkingOpen((value) => !value)} /> : null}
      {skillEvents.map((item) => <div key={item.itemId} className="flex min-h-7 items-center gap-1.5 px-1 text-micro text-nomi-ink-40" data-agent-skill-event="true" data-state={item.loaded ? 'settled' : 'failed'}><IconTool size={13} className="shrink-0" aria-hidden="true" /><span>{item.loaded ? t('agentResident.skillLoaded', { name: item.name }) : t('agentResident.skillLoadFailed')}</span></div>)}
      <ResidentToolChips items={toolChipItems} emptyLabel={t('agentResident.toolDetailEmpty')} sectionLabel={t('agentResident.toolCalls')} headerLabel={t('agentResident.toolCallsCount', { count: toolChipItems.length })} explanationLabel={t('agentResident.toolExplanation')} targetLabel={t('agentResident.toolTargetLabel')} resultLabel={t('agentResident.toolResult')} technicalLabel={t('agentResident.toolTechnicalDetails')} statusLabel={(status) => statusLabel(t, status)} />
      {items.map((item) => { const proposal = item.kind === 'proposal' && item.approval; const proposalActive = item.kind === 'proposal' && item.status === 'proposed' && Boolean(proposal); const declined = item.kind === 'failure' && item.status === 'declined'; if (item.kind === 'tool' || proposalActive) return null; return <article key={item.itemId} data-agent-item-kind={item.kind} data-agent-turn-id={item.turnId} data-agent-status={item.status}
        data-agent-user-bubble={item.kind === 'user' ? 'true' : undefined}
        data-agent-reply={item.kind === 'assistant' ? 'true' : undefined}
        className={cn(item.kind === 'user' ? 'ml-6 rounded-nomi-sm border border-nomi-ink bg-nomi-ink px-2.5 py-1.5 text-caption text-nomi-paper' : item.kind === 'assistant' ? 'px-1 py-0.5 text-caption' : cn('rounded-nomi-sm border px-2.5 py-1.5 text-caption', item.kind === 'failure' && !declined ? 'border-workbench-danger bg-workbench-danger-soft' : declined ? 'border-nomi-line-soft bg-nomi-ink-05' : 'border-nomi-line-soft bg-nomi-paper'))}>
        {item.kind === 'user' ? <div data-user-content="true" className="whitespace-pre-wrap break-words">{item.text}</div> : null}
        {item.kind === 'assistant' ? <ResidentStreamingText text={item.text || (isLive(item.status) ? `${t('creationAi.assistantMessage.processing')}…` : '')} streaming={isLive(item.status)} streamingLabel={t('agentResident.streaming')} /> : null}
        {item.kind === 'proposal' ? <div data-agent-proposal="true" data-agent-proposal-receipt={item.status === 'done' ? 'true' : undefined} title={item.status === 'done' ? t('agentResident.approvedReceiptHint') : undefined}><div className="flex min-h-7 items-center gap-1.5 text-micro font-medium text-nomi-ink-60"><IconListCheck size={15} className="shrink-0 text-nomi-accent" />{item.status === 'done' ? t('agentResident.approved') : t('agentResident.plan')}<span className="ml-auto text-micro text-nomi-accent">{statusLabel(t, item.status)}</span>{item.status === 'done' && hasContextLocator ? <button type="button" className="grid size-7 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink" aria-label={t('agentResident.viewChange')} title={t('agentResident.viewChange')} data-agent-action="focus-receipt" onClick={focusReceipt}><IconFocusCentered size={13} aria-hidden="true" /></button> : null}</div></div> : null}
        {item.kind === 'failure' ? declined ? <div className="flex items-center gap-1.5 font-medium text-nomi-ink-60"><IconCircleDashed size={18} />{t('agentResident.operationDeniedReceipt')}</div> : <><div className="flex items-center gap-1.5 font-medium text-workbench-danger"><IconAlertTriangle size={18} />{readableFailure(t, item.code, item.message)}</div><div className="mt-1 text-micro text-nomi-ink-60">{t('agentResident.failureNextAction')}</div><div className="mt-2 grid grid-cols-3 gap-1.5"><button type="button" className="h-7 min-w-0 rounded-nomi-sm bg-nomi-ink px-1 text-micro text-nomi-paper" data-agent-action="retry" onClick={() => { const user = items.find((candidate) => candidate.kind === 'user' && candidate.turnId === item.turnId); if (user?.kind === 'user') setDraft(user.text) }}>{t('agentResident.changeModelRetry')}</button><button type="button" className="h-7 min-w-0 rounded-nomi-sm border border-nomi-line px-1 text-micro" data-agent-action="edit-prompt" onClick={() => setDraft(t('agentResident.editPlanPrompt'))}>{t('agentResident.editPrompt')}</button><button type="button" className="h-7 min-w-0 rounded-nomi-sm border border-nomi-line px-1 text-micro" data-agent-action="view-log" onClick={() => window.dispatchEvent(new Event('nomi-open-task-center'))}>{t('agentResident.viewLog')}</button></div></> : null}
        {item.kind === 'task' || item.kind === 'artifact' ? <div className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1.5 truncate"><IconExternalLink size={14} />{item.kind === 'task' ? t('agentResident.task', { id: itemRef(item) }) : t('agentResident.artifact', { id: itemRef(item) })}</span><button type="button" className="h-7 rounded-nomi-sm border border-nomi-line px-2 text-micro" onClick={() => openTask(item)}>{item.kind === 'task' ? t('agentResident.openTask') : t('agentResident.openArtifact')}</button></div> : null}
      </article> })}
      {pendingTools.map((pending) => {
        const key = pendingKey(pending.call)
        const editableArgs = proposalDrafts[key] ?? (pending.call.args && typeof pending.call.args === 'object' && !Array.isArray(pending.call.args) ? pending.call.args as Record<string, unknown> : undefined)
        const proposal = proposalForTool(t, pending.call.toolName, editableArgs)
        const compactGeneration = Boolean(editableArgs && isGenerationProposalTool(pending.call.toolName, editableArgs))
        return <div key={pending.call.toolCallId} data-agent-item-kind="approval"><ResidentApprovalCard title={readableToolName(t, pending.call.toolName)} iconName={pending.call.toolName} summary={readableToolPreview(t, pending.call.toolName, editableArgs)} details={compactGeneration ? undefined : readableToolDetailRows(t, pending.call.toolName, editableArgs)} detailsLabel={t('agentResident.toolInspectDetails')} proposal={proposal} compactGeneration={compactGeneration} state={pending.state === 'approved' ? 'approved' : pending.state === 'denied' ? 'denied' : 'pending'} approveLabel={t('agentResident.approve')} denyLabel={t('agentResident.deny')} pendingLabel={t('agentResident.waitingApproval')} approvedLabel={t('agentResident.approved')} deniedLabel={t('agentResident.denied')} resolvedApprovedHint={t('agentResident.approvedReceiptHint')} resolvedDeniedHint={t('agentResident.deniedReceiptHint')} notWrittenLabel={t('agentResident.notWritten')} onApprove={() => void resolveTool(pending, true, editableArgs)} onDeny={() => void resolveTool(pending, false)}>{pending.state === 'pending' && compactGeneration ? <GenerationProposalEditor args={editableArgs} t={t} onChange={(next) => setProposalDrafts((previous) => ({ ...previous, [key]: next }))} /> : null}</ResidentApprovalCard></div>
      })}
    </div>
    {showLatest ? <button type="button" className="absolute bottom-2 right-3 z-10 grid size-7 place-items-center rounded-pill border border-nomi-line bg-nomi-paper text-nomi-ink-60 shadow-nomi-md transition-[background,box-shadow,transform] duration-[var(--nomi-transition-fast)] hover:-translate-y-px hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40 motion-reduce:transition-none" data-agent-action="scroll-latest" aria-label={t('agentResident.scrollLatest')} title={t('agentResident.scrollLatest')} onClick={scrollToLatest}><IconChevronDown size={15} aria-hidden="true" /></button> : null}
    </div>
    <div className="relative z-20 shrink-0 border-t border-nomi-line-soft bg-nomi-paper" data-agent-composer="true"><ResidentTaskRows entries={activeQueue} getLabel={(entry) => { const user = snapshot?.items.find((candidate) => candidate.kind === 'user' && candidate.turnId === entry.turnId); return user?.kind === 'user' ? user.text : t('agentResident.taskFallback') }} getStatusLabel={(status) => statusLabel(t, status)} editLabel={t('agentResident.edit')} cancelLabel={t('agentResident.cancel')} stopLabel={t('agentResident.stop')} deleteLabel={t('agentResident.delete')} moveUpLabel={t('agentResident.moveUp')} moveDownLabel={t('agentResident.moveDown')} pauseLabel={t('agentResident.pause')} resumeLabel={t('agentResident.resume')} queueLabel={t('agentResident.queue')} queueCountLabel={t('agentResident.queueCount', { count: activeQueue.length })} queueSummaryLabel={t('agentResident.queueSummary', { running: activeQueue.filter((entry) => entry.status === 'running').length, proposed: activeQueue.filter((entry) => entry.status === 'proposed').length, queued: activeQueue.filter((entry) => entry.status === 'queued').length })} queueHiddenLabel={t('agentResident.queueHidden', { count: Math.max(0, activeQueue.length - 3) })} onEdit={(entry) => { const user = snapshot?.items.find((candidate) => candidate.kind === 'user' && candidate.turnId === entry.turnId); if (user?.kind === 'user') { setDraft(user.text); setEditingQueue({ queueItemId: entry.queueItemId, userItemId: user.itemId }) } }} onCancel={(entry) => entry.status === 'queued' ? void runQueueMutation(() => deleteProjectAgentQueueItem(entry.queueItemId)) : void stopTurn(entry.turnId)} onDelete={(entry) => void runQueueMutation(() => deleteProjectAgentQueueItem(entry.queueItemId))} onMove={(entry, direction) => void runQueueMutation(() => moveProjectAgentQueueItem(entry.queueItemId, direction))} onPause={(entry) => void runQueueMutation(() => pauseProjectAgentQueueItem(entry.queueItemId))} onResume={(entry) => void runQueueMutation(() => resumeProjectAgentQueueItem(entry.queueItemId))} onStop={runningTurn ? () => void stopTurn(runningTurn.turnId) : undefined} />{error ? <div className="px-3 pb-1 text-micro text-workbench-danger" role="alert">{error}</div> : null}
      <form className="relative grid gap-1 px-3 pb-1.5 pt-1" onSubmit={(event) => { event.preventDefault(); void submit() }} {...attachmentApi.dragHandlers}><input ref={attachmentApi.inputRef} type="file" multiple accept={COMPOSER_ATTACHMENT_ACCEPT} className="hidden" tabIndex={-1} aria-hidden="true" onChange={attachmentApi.onInputChange} /><AttachmentRail attachments={attachments} onRemove={attachmentApi.removeAttachment} />{references.length || activeSkill || selectedLibraryPrompt || (promptModeId !== 'general' && !activeSkill) ? <div className="flex max-h-14 flex-wrap gap-1 overflow-y-auto" data-agent-references="true">{references.map((reference) => <ResidentReferenceChip key={reference.id} reference={reference} t={t} onRemove={() => removeReference(reference.id)} />)}{activeSkill ? <span data-agent-reference={`skill:${activeSkill.key}`} className="inline-flex h-6 max-w-full items-center gap-1 rounded-pill bg-nomi-accent-soft px-2 text-micro text-nomi-accent"><IconTool size={12} /><span className="truncate">{activeSkill.name}</span><button type="button" aria-label={t('agentResident.removeReference')} onClick={() => setActiveSkill(null)}><IconX size={11} /></button></span> : null}{selectedLibraryPrompt && !activeSkill ? <span data-agent-reference={libraryPromptReferenceId(selectedLibraryPrompt)} className="inline-flex h-6 max-w-full items-center gap-1 rounded-pill bg-nomi-accent-soft px-2 text-micro text-nomi-accent" title={selectedLibraryPrompt.prompt}><IconPencil size={12} /><span className="truncate">{promptDisplayTitle(selectedLibraryPrompt)}</span><button type="button" aria-label={t('agentResident.removeReference')} title={t('agentResident.removeReference')} onClick={() => setSelectedLibraryPrompt(null)}><IconX size={11} /></button></span> : null}{promptModeId !== 'general' && !activeSkill && !selectedLibraryPrompt ? <span data-agent-reference={`prompt:${promptModeId}`} className="inline-flex h-6 max-w-full items-center gap-1 rounded-pill bg-nomi-ink-05 px-2 text-micro text-nomi-ink-80"><PromptIcon size={12} /><span className="truncate">{t(`agentResident.${promptPreset.labelKey}`)}</span><button type="button" aria-label={t('agentResident.removeReference')} onClick={() => setPromptModeId('general')}><IconX size={11} /></button></span> : null}</div> : null}
        {/* data-agent-input: spec §0 挂点 */}
        <div className={cn('rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-1', attachmentApi.isDragging && 'border-nomi-accent bg-nomi-accent-soft')}><AutoGrowTextarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onPaste={attachmentApi.handlePaste} placeholder={t('agentResident.placeholder')} aria-label={t('agentResident.messageAria')} maxHeight={120} className="min-h-10 text-body-sm" data-agent-input="true" /><div className="flex flex-wrap items-center gap-1 border-t border-nomi-line-soft pt-1">
          {/* data-agent-composer-attach: spec §0 挂点（保留 data-agent-attachment-trigger 兼容外部引用） */}
          <div className="relative shrink-0"><button type="button" className={iconControlClass(menu === 'attachments')} aria-expanded={menu === 'attachments'} aria-haspopup="menu" data-agent-attachment-trigger="true" data-agent-composer-attach="true" aria-label={t('agentResident.attach')} title={t('agentResident.attachTitle')} onClick={() => setMenu(menu === 'attachments' ? null : 'attachments')}><IconPaperclip size={16} /></button><Popover open={menu === 'attachments'} onClose={closeMenu} label={t('agentResident.attach')}><MenuRow testId="image" onClick={() => { attachmentApi.openFilePicker(); closeMenu() }}><IconPhoto size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.attachImage')} hint={t('agentResident.attachImageHint')} /></MenuRow><MenuRow testId="video" onClick={() => { attachmentApi.openFilePicker(); closeMenu() }}><IconVideo size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.attachVideo')} hint={t('agentResident.attachVideoHint')} /></MenuRow><MenuRow testId="audio" onClick={() => { attachmentApi.openFilePicker(); closeMenu() }}><IconWaveSine size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.attachAudio')} hint={t('agentResident.attachAudioHint')} /></MenuRow><MenuRow testId="document" onClick={() => { attachmentApi.openFilePicker(); closeMenu() }}><IconFileText size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.attachDocument')} hint={t('agentResident.attachDocumentHint')} /></MenuRow><div className="my-1 border-t border-nomi-line-soft" /><MenuRow testId="voice" onClick={() => { startVoiceInput() }}><IconMicrophone size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.voiceInput')} hint={t('agentResident.voiceInputHint')} /></MenuRow></Popover></div>
          <div className="relative shrink-0"><button type="button" className={iconControlClass(menu === 'references')} aria-expanded={menu === 'references'} aria-haspopup="menu" data-agent-mention-trigger="true" aria-label={t('agentResident.mention')} title={t('agentResident.mentionTitle')} onClick={() => setMenu(menu === 'references' ? null : 'references')}><IconAt size={16} /></button><Popover open={menu === 'references'} onClose={closeMenu} label={t('agentResident.mention')}><MenuRow testId="canvas" onClick={() => addReference(buildResidentReference('canvas', t('agentResident.referenceCanvas'), { documentId: activeDocumentId, nodeIds: surface === 'generation' ? selectedNodeIds : [], clipIds: [] }))}><IconPhoto size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.referenceCanvas')} hint={t('agentResident.referenceCanvasHint')} /></MenuRow><MenuRow testId="document" onClick={() => addReference(buildResidentReference('document', t('agentResident.referenceDocument'), { documentId: activeDocumentId, nodeIds: [], clipIds: [] }))}><IconFileText size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.referenceDocument')} hint={t('agentResident.referenceDocumentHint')} /></MenuRow><MenuRow testId="preview" onClick={() => addReference(buildResidentReference('preview', t('agentResident.referencePreview'), { documentId: activeDocumentId, nodeIds: [], clipIds: surface === 'preview' ? selectedClipIds : [] }))}><IconVideo size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.referencePreview')} hint={t('agentResident.referencePreviewHint')} /></MenuRow><MenuRow testId="timeline" onClick={() => addReference(buildResidentReference('timeline', t('agentResident.referenceTimeline'), { documentId: activeDocumentId, nodeIds: [], clipIds: surface === 'preview' ? selectedClipIds : [] }))}><IconTimelineEvent size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.referenceTimeline')} hint={t('agentResident.referenceTimelineHint')} /></MenuRow><MenuRow testId="browser" onClick={() => addReference(buildResidentReference('browser', t('agentResident.referenceBrowser'), { documentId: activeDocumentId, nodeIds: [], clipIds: [] }))}><IconWorld size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.referenceBrowser')} hint={t('agentResident.referenceBrowserHint')} /></MenuRow></Popover></div>
          <span className="min-w-0 flex-1 basis-0" aria-hidden="true" />
          <div className="relative"><button type="button" className={iconControlClass(Boolean(activeSkill))} aria-expanded={menu === 'skills'} aria-haspopup="dialog" data-agent-skill-trigger="true" aria-label={t('agentResident.skillSelect')} title={activeSkill?.name ?? t('agentResident.skillTitle')} onClick={() => setMenu(menu === 'skills' ? null : 'skills')}><IconTool size={16} /></button><Popover open={menu === 'skills'} onClose={closeMenu} role="dialog" label={t('agentResident.skill')} className={cn(skillPreview ? "w-[548px]" : "w-[320px]", "max-w-[calc(100vw-24px)]")}><div className={cn("grid min-w-0 gap-1", skillPreview ? "grid-cols-[minmax(0,1fr)_minmax(150px,.72fr)]" : "grid-cols-1")}><div className="min-w-0"><label className="mx-1 mb-1 flex h-7 items-center gap-1.5 rounded-nomi-sm border border-nomi-line px-2 text-micro text-nomi-ink-40 focus-within:border-nomi-accent"><IconSearch size={14} /><input autoFocus value={skillSearch} onChange={(event) => setSkillSearch(event.target.value)} placeholder={t('agentResident.skillSearch')} className="min-w-0 flex-1 bg-transparent outline-none" /></label><MenuRow selected={!activeSkill} testId="auto" onMouseEnter={() => setSkillPreview(null)} onFocus={() => setSkillPreview(null)} onClick={() => { setActiveSkill(null); closeMenu() }}><IconTool size={16} className="shrink-0" /><MenuCopy label={t('agentResident.skillAuto')} />{!activeSkill ? <IconCheck size={14} /> : null}</MenuRow>{filteredSkills.map((skill) => <MenuRow key={skill.directoryName} selected={activeSkill?.key === skill.name} testId={skill.name} onMouseEnter={() => setSkillPreview(skill)} onFocus={() => setSkillPreview(skill)} onClick={() => { setActiveSkill({ key: skill.name, name: skill.label }); closeMenu() }}><IconListCheck size={16} className="shrink-0" /><MenuCopy label={skill.label} hint={skill.description ?? skill.stageLabels.join(' · ')} />{skillCapabilityFor(skill, availableSkillProviders).missing.length ? <IconAlertTriangle size={14} className="shrink-0 text-workbench-danger" /> : null}{activeSkill?.key === skill.name ? <IconCheck size={14} /> : null}</MenuRow>)}<div className="my-1 border-t border-nomi-line-soft" /><MenuRow className="min-h-7" onClick={() => window.dispatchEvent(new Event('nomi-focus-skill-library'))}><IconSettings size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.skillManage')} /><IconChevronRight size={13} /></MenuRow></div><aside className={cn("min-w-0 rounded-nomi-sm bg-nomi-ink-05 p-2", !skillPreview && "hidden")} aria-live="polite">{skillPreview ? <><div className="mb-1 text-caption font-medium">{skillPreview.label}</div><p className="m-0 text-micro leading-relaxed text-nomi-ink-60">{skillPreview.description ?? t('agentResident.skillDialogHint')}</p><div className="mt-2 border-t border-nomi-line-soft pt-2 text-micro"><div className="text-nomi-ink-40">{t('agentResident.skillStages')}</div><div className="mt-1 text-nomi-ink-80">{skillPreview.stageLabels.join(' · ') || '—'}</div><div className="mt-2 text-nomi-ink-40">{t('agentResident.skillNeeds')}</div><div className="mt-1 text-nomi-ink-80">{skillPreview.neededProviders.map(providerLabel).join(' · ') || '—'}</div></div></> : <><div className="mb-1 text-caption font-medium">{t('agentResident.skill')}</div><p className="m-0 text-micro leading-relaxed text-nomi-ink-60">{t('agentResident.skillDialogHint')}</p></>}</aside></div></Popover></div>
          {/* data-agent-composer-prompt: spec §0 挂点（保留 data-agent-prompt-trigger 兼容外部引用） */}
          <div className="relative"><button type="button" className={iconControlClass((promptModeId !== 'general' && !activeSkill) || Boolean(selectedLibraryPrompt))} aria-expanded={menu === 'prompts'} aria-haspopup="menu" data-agent-prompt-trigger="true" data-agent-composer-prompt="true" aria-label={t('agentResident.promptSelect')} title={promptTitle} onClick={() => { setPromptSearch(''); setMenu(menu === 'prompts' ? null : 'prompts') }}><IconPencil size={16} /></button>{menu === 'prompts' ? <ResidentPromptMenu t={t} promptLibraryItems={visibleLibraryPrompts.nomi} userPromptItems={visibleLibraryPrompts.mine} loading={promptLibrary.loading || userPromptLibrary.loading} error={promptLibrary.error || userPromptLibrary.error} query={promptSearch} selectedLibraryPrompt={selectedLibraryPrompt} activeSkill={activeSkill} promptModeId={promptModeId} onQueryChange={setPromptSearch} onSelectPreset={selectPromptPreset} onSelectLibraryPrompt={selectLibraryPrompt} onReload={() => { promptLibrary.reload(); userPromptLibrary.reload() }} onClose={closeMenu} /> : null}</div>
          {/* data-agent-composer-mode: spec §0 挂点（保留 data-agent-mode-trigger 兼容外部引用） */}
          <div className="relative"><button type="button" className={iconControlClass(runMode !== 'agent')} aria-expanded={menu === 'modes'} aria-haspopup="menu" data-agent-mode-trigger="true" data-agent-composer-mode="true" aria-label={t('agentResident.modeSelect')} title={modeTitle} onClick={() => setMenu(menu === 'modes' ? null : 'modes')}><IconAdjustmentsHorizontal size={16} /></button><Popover open={menu === 'modes'} onClose={closeMenu} label={t('agentResident.modeMenuTitle')} className="w-[320px] max-w-[calc(100vw-24px)]">{(['ask', 'editSelection', 'agent'] as ProjectAgentRunMode[]).map((value) => { const ModeIcon = value === 'ask' ? IconMessageQuestion : value === 'editSelection' ? IconFilePencil : IconRobot; return <MenuRow key={value} selected={runMode === value} testId={value} onClick={() => { setRunMode(value); closeMenu() }}><ModeIcon size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t(modeKey(value))} hint={t(`agentResident.mode${value === 'ask' ? 'Ask' : value === 'editSelection' ? 'EditSelection' : 'Agent'}Hint`)} />{runMode === value ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}</MenuRow> })}</Popover></div>
          <div className="relative"><button type="button" className={iconControlClass(approvalPolicy.mode !== 'step' || approvalPolicy.spend !== 'confirm')} aria-expanded={menu === 'policy'} aria-haspopup="menu" data-agent-approval-trigger="true" aria-label={t('agentResident.approvalTitle')} title={approvalTitle} onClick={() => setMenu(menu === 'policy' ? null : 'policy')}><IconLock size={16} /></button><Popover open={menu === 'policy'} onClose={closeMenu} label={t('agentResident.approvalTitle')} className="w-[340px] max-w-[calc(100vw-24px)]"><div className="px-2 py-1 text-micro font-medium text-nomi-ink-40">{t('agentResident.approvalMode')}</div>{(['step', 'safe-auto', 'project'] as ProjectAgentApprovalMode[]).map((value) => { const label = approvalModeLabel(value); const hintKey = value === 'step' ? 'approvalModeStepHint' : value === 'safe-auto' ? 'approvalModeSafeAutoHint' : 'approvalModeProjectHint'; return <MenuRow key={value} selected={approvalPolicy.mode === value} testId={`approval-mode-${value}`} onClick={() => { setApprovalPolicy({ ...approvalPolicy, mode: value }); closeMenu() }}><IconLock size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={label} hint={t(`agentResident.${hintKey}`)} />{approvalPolicy.mode === value ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}</MenuRow> })}<div className="my-1 border-t border-nomi-line-soft" /><div className="px-2 py-1 text-micro font-medium text-nomi-ink-40">{t('agentResident.spendPolicy')}</div>{(['confirm', 'within-budget'] as ProjectAgentSpendPolicy[]).map((value) => { const label = spendPolicyLabel(value); const hintKey = value === 'confirm' ? 'spendPolicyConfirmHint' : 'spendPolicyWithinBudgetHint'; return <MenuRow key={value} selected={approvalPolicy.spend === value} testId={`spend-policy-${value}`} onClick={() => { setApprovalPolicy({ ...approvalPolicy, spend: value }); closeMenu() }}><IconCoin size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={label} hint={t(`agentResident.${hintKey}`)} />{approvalPolicy.spend === value ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}</MenuRow> })}</Popover></div>
          {/* data-agent-composer-model: spec §0 挂点（保留 data-agent-model-trigger 兼容外部引用） */}
          <div className="relative"><button type="button" className={iconControlClass(menu === 'models')} aria-expanded={menu === 'models'} aria-haspopup="menu" data-agent-model-trigger="true" data-agent-composer-model="true" aria-label={t('agentResident.modelSelect')} title={t('agentResident.modelTitle')} onClick={() => setMenu(menu === 'models' ? null : 'models')}><IconRobot size={16} /></button><Popover open={menu === 'models'} onClose={closeMenu} label={t('agentResident.modelMenuTitle')} className="w-[280px] max-w-[calc(100vw-24px)]">{models.length ? models.map((model) => { const value = encodeModelIdentity(model); return <MenuRow key={value} selected={selectedModel === value} testId={value} onClick={() => { setSelectedModel(value); const identity = decodeModelIdentity(value); if (identity) setAssistantModelPref(identity); closeMenu() }}><IconRobot size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={labelForModel(model, models, vendors)} />{selectedModel === value ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}</MenuRow> }) : <MenuRow testId="catalog" onClick={() => window.dispatchEvent(new Event('nomi-open-model-catalog'))}><IconPlus size={16} className="shrink-0" /><MenuCopy label={t('generationCommon.parameters.selectTextModel')} hint={t('agentResident.modelMenuHint')} /></MenuRow>}</Popover></div>
          {/* data-agent-composer-send: spec §0 挂点（保留 data-agent-send 兼容外部引用） */}
          <button type={runningTurn ? 'button' : 'submit'} disabled={!runningTurn && !draft.trim()} className={cn('grid size-7 shrink-0 place-items-center rounded-pill text-nomi-paper disabled:opacity-30', runningTurn ? 'bg-workbench-danger-soft text-workbench-danger' : 'bg-nomi-ink')} data-agent-send="true" data-agent-composer-send="true" data-agent-stop={runningTurn ? 'true' : undefined} aria-label={runningTurn ? t('agentResident.stopAria') : t('agentResident.send')} title={runningTurn ? t('agentResident.stopAria') : t('agentResident.send')} onClick={runningTurn ? () => void stopTurn(runningTurn.turnId) : undefined}>{runningTurn ? <IconPlayerStopFilled size={15} aria-hidden="true" /> : <IconArrowUp size={16} />}</button>
        </div></div>
      </form>
    </div>
  </section>
}
