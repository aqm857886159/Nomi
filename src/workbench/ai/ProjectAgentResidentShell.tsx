import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle, IconArrowUp, IconBolt, IconCheck, IconCircleDashed,
  IconAdjustmentsHorizontal, IconChevronLeft, IconChevronRight, IconCoin, IconExternalLink, IconFileText, IconFilePencil,
  IconDotsVertical, IconHistory, IconLayoutSidebarRightCollapse, IconListCheck, IconLock, IconMicrophone, IconPaperclip, IconPhoto,
  IconMessageQuestion, IconPencil, IconRobot, IconSettings, IconTimelineEvent, IconTool, IconVideo, IconWaveSine,
  IconPlus, IconTrash, IconWorld, IconX, IconFocusCentered, IconArrowBackUp, IconPlayerStopFilled, IconChevronDown,
} from '@tabler/icons-react'
import { NomiLogoMark, WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import type { AgentToolProfile } from '../../../electron/shared/projectAgentContracts'
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
import { getAvailableSkillProviders, listWorkbenchSkills, skillCapabilityFor, type SkillListItemDto } from '../api/skillApi'
import { filterPrompts, type LibraryPrompt } from '../api/promptLibraryApi'
import { listWorkbenchModelCatalogModels, listWorkbenchModelCatalogVendors, type ModelCatalogModelDto } from '../api/modelCatalogApi'
import { usePromptLibrary } from '../promptLibrary/usePromptLibrary'
import { useUserPrompts } from '../promptLibrary/useUserPrompts'
import { promptDisplayTitle, promptSourceLabel } from '../promptLibrary/promptDisplay'
import { decodeModelIdentity, encodeModelIdentity, filterUsableAssistantTextModels, labelForModel } from './assistantModelIdentity'
import { getAssistantModelPref, setAssistantModelPref } from './assistantModelPref'
import { useAgentUsageStore } from './agentUsageStore'
import type { CreationDocumentTools } from '../workbenchTypes'
import type { ProjectAgentApprovalMode, ProjectAgentItem, ProjectAgentSpendPolicy, ProjectAgentStatus } from '../../../electron/shared/projectAgentContracts'
import type { DocumentAnchorRef, PreconditionSet, TargetRef } from '../../../electron/shared/capabilityTargeting'
import { timelineRevision } from '../timeline/kernel/timelineKernel'
import { useProductionRunStore } from '../production/productionRunStore'
import { ResidentApprovalCard, ResidentThinkingState, ResidentToolChips, type ResidentApprovalState, type ResidentToolChipData } from './resident/ResidentUiPrimitives'
import { ResidentArtifactCard, ResidentAtPicker, ResidentCandidatesCard, ResidentDeviationCard, ResidentFailureCard, ResidentFoldableText, ResidentPinnedResultCard, ResidentPlanCard, ResidentSpendCard, ResidentQuestionCard, ResidentWriteFailureRow } from './resident/ResidentExceptionStates'
import { ResidentReferenceChip } from './resident/ResidentReferenceChip'
import { MenuCopy, MenuRow, Popover, PROMPT_PRESETS, ResidentPromptMenu, iconControlClass } from './resident/ResidentMenus'
import { attachmentPayloads, itemRef } from './resident/agentItemHelpers'
import { normalizeResidentToolProjection, readResidentToolProjections, residentToolProjectionKey, residentToolProjectionScope, writeResidentToolProjections, type ResidentToolProjection } from './resident/residentToolProjection'
import { proposalForTool, readableToolDetailRows, readableToolName, readableToolPreview, readableToolResult, readableToolSummary, readableToolTarget, residentToolProjectionForCall } from './resident/residentToolDisplay'
import { GenerationProposalEditor } from './resident/GenerationProposalEditor'
import { isGenerationProposalTool, proposalDecisionPayload } from './resident/generationProposalEditing'
import { residentArgsForSelection, residentCandidates, residentPlanShots, residentProposalParameters, residentQuestionOptions } from './resident/residentExceptionProjections'
import { useAssetPool } from '../assets/useAssetPool'
import { buildResidentAssetReference, buildResidentReference, contextHandleForResidentReference, residentReferencePromptValue } from './resident/residentReferences'
import { composeResidentSystemPrompt, libraryPromptReferenceId } from './resident/residentPromptSelection'
import { buildResidentContextSnapshot, mergeResidentContextHandles, type AgentContextSnapshot } from './resident/residentContextSnapshot'
import { isTranscriptAtBottom, shouldFollowTranscript, transcriptScrollBehavior } from './resident/residentTranscriptScroll'
import { isAgentActionIntent } from './agentIntent'
import { agentFailureCategory, isWriteFailure, readableFailure, safeAgentFailureCode } from './agentFailureDiagnostics'
import { buildStaticAgentSystemPrompt } from '../generationCanvas/agent/generationCanvasAgentClient'
import { projectAgentSkillEvents } from './skillEventProjection'
import { runProposalUndo, useCommittedProposal } from '../generationCanvas/agent/proposalUndo'

type ResidentSurface = Extract<WorkspaceMode, 'creation' | 'storyboard' | 'generation' | 'preview'>
const isDocumentSurface = (surface: ResidentSurface): boolean => surface === 'creation' || surface === 'storyboard'
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

function surfaceLabel(t: (key: string, options?: Record<string, unknown>) => string, surface: ResidentSurface): string {
  return surface === 'generation'
    ? t('agentResident.contextGeneration')
    : surface === 'preview'
      ? t('agentResident.contextPreview')
      : surface === 'storyboard'
        ? t('agentResident.contextStoryboard')
        : t('agentResident.contextCreation')
}

function statusLabel(t: (key: string, options?: Record<string, unknown>) => string, status: ProjectAgentStatus): string {
  const key = status === 'drafting' ? 'planning' : status === 'proposed' ? 'waitingApprovalShort' : status === 'declined' ? 'declined' : status
  return t(`agentResident.${key}`)
}

function isActiveQueueStatus(status: ProjectAgentStatus): boolean {
  return status === 'queued' || status === 'proposed' || status === 'running'
}

function friendlyError(error: unknown, t: (key: string, options?: Record<string, unknown>) => string): string {
  const code = error instanceof Error ? error.message : ''
  return code === 'project_agent_unavailable' || code === 'project_binding_stale' ? t('agentResident.unavailable') : t('agentResident.sendFailed')
}

function residentItemClassName(item: ProjectAgentItem, declined: boolean): string {
  if (item.kind === 'user') return 'ml-auto min-h-[52px] max-w-[86%] text-caption text-nomi-paper'
  if (item.kind === 'assistant') return 'max-w-full px-1 text-caption leading-5'
  const ownsCard = (item.kind === 'failure' && !declined) || (item.kind === 'artifact' && (item.status === 'running' || item.status === 'failed'))
  if (ownsCard) return 'max-w-full'
  return cn('rounded-nomi-sm border px-2.5 py-1.5 text-caption', declined ? 'border-nomi-line-soft bg-nomi-ink-05' : 'border-nomi-line-soft bg-nomi-paper')
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
  const documentState = isDocumentSurface(surface) ? creationDocumentTools?.readState() : undefined
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
  const setStoryboardPlannerLauncher = useWorkbenchStore((state) => state.setStoryboardPlannerLauncher)
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
  const [queueMenuOpen, setQueueMenuOpen] = React.useState<string | null>(null)
  const [queueExpanded, setQueueExpanded] = React.useState(false)
  const [error, setError] = React.useState('')
  const [editingQueue, setEditingQueue] = React.useState<{ queueItemId: string; userItemId: string } | null>(null)
  const [skills, setSkills] = React.useState<SkillListItemDto[]>([])
  const [availableSkillProviders, setAvailableSkillProviders] = React.useState<ReadonlySet<'text' | 'image' | 'video'>>(new Set())
  const [models, setModels] = React.useState<ModelCatalogModelDto[]>([])
  const [vendors, setVendors] = React.useState<Record<string, string>>({})
  const [selectedModel, setSelectedModel] = React.useState(() => { const pref = getAssistantModelPref(); return pref ? `${pref.vendorKey}:${pref.modelKey}` : '' })
  const [lastTurnTokens, setLastTurnTokens] = React.useState(0)
  const [thinkingOpen, setThinkingOpen] = React.useState(false)
  const [usageOpen, setUsageOpen] = React.useState(false)
  const [proposalDrafts, setProposalDrafts] = React.useState<Record<string, Record<string, unknown>>>({})
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const transcriptAtBottomRef = React.useRef(true)
  const [showLatest, setShowLatest] = React.useState(false)
  const threadMenuRef = React.useRef<HTMLDivElement>(null)
  const promptLibrary = usePromptLibrary(menu === 'prompts')
  const userPromptLibrary = useUserPrompts(menu === 'prompts')
  const binding = snapshot?.binding ?? null
  const pendingTools = useResidentPendingTools(binding ? bindingKey(binding) : null)
  const assetPool = useAssetPool(snapshot?.binding.projectId ?? null)
  const activeThreadId = snapshot?.activeThreadId ?? null
  const committedProposal = useCommittedProposal()
  const items = React.useMemo(() => snapshot?.items.filter((item) => item.threadId === activeThreadId) ?? [], [activeThreadId, snapshot])
  const skillEvents = React.useMemo(() => projectAgentSkillEvents(items), [items])
  const queue = React.useMemo(() => snapshot?.queue.filter((item) => item.threadId === activeThreadId) ?? [], [activeThreadId, snapshot])
  const activeQueue = React.useMemo(() => queue.filter((item) => isActiveQueueStatus(item.status)), [queue])
  const activeTurn = snapshot?.turns.find((turn) => turn.threadId === activeThreadId && isLive(turn.status))
  const runningTurn = snapshot?.turns.find((turn) => turn.threadId === activeThreadId && turn.status === 'running')
  const latestCompactionTurn = snapshot?.turns.find((turn) => turn.threadId === activeThreadId && (turn.runtimeContext?.compactions ?? 0) > 0)
  const planningTurn = snapshot?.turns.find((turn) => turn.threadId === activeThreadId && turn.status === 'drafting')
  const sessionTotalTokens = useAgentUsageStore((state) => state.totalTokens)
  const sessionTurns = useAgentUsageStore((state) => state.turns)
  const toolProjectionScope = binding && activeThreadId ? residentToolProjectionScope(bindingKey(binding), activeThreadId) : ''
  const selectedModelRow = models.find((model) => encodeModelIdentity(model) === selectedModel)
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
  const hasContextLocator = isDocumentSurface(surface)
    ? Boolean(activeDocumentId)
    : surface === 'generation'
      ? selectedNodeIds.length > 0
      : selectedClipIds.length > 0

  // Exception-card actions stay on the resident surface. These listeners
  // make the two explicit recovery events actionable instead of leaving a
  // button that only emits an unhandled browser event.
  React.useEffect(() => {
    const onPriceRefresh = (): void => setError(t('agentResident.priceUnavailable'))
    const onWriteRetry = (): void => {
      setError('')
      setDraft(t('agentResident.editPlanPrompt'))
    }
    window.addEventListener('nomi-agent-price-refresh', onPriceRefresh)
    window.addEventListener('nomi-agent-write-retry', onWriteRetry)
    return () => {
      window.removeEventListener('nomi-agent-price-refresh', onPriceRefresh)
      window.removeEventListener('nomi-agent-write-retry', onWriteRetry)
    }
  }, [setDraft, t])

  // The picker is the user's capability index: expose every selectable
  // repository/user Skill. Electron filters implementation-only resources
  // before they cross the bridge.
  React.useEffect(() => { try { setSkills(listWorkbenchSkills()) } catch { setSkills([]) }; void getAvailableSkillProviders().then(setAvailableSkillProviders).catch(() => setAvailableSkillProviders(new Set())) }, [])
  React.useEffect(() => {
    let alive = true
    let requestVersion = 0
    const loadModels = (): void => {
      const version = ++requestVersion
      void Promise.all([listWorkbenchModelCatalogVendors(), listWorkbenchModelCatalogModels({ kind: 'text', enabled: true })]).then(([vendorRows, modelRows]) => {
        if (!alive || version !== requestVersion) return
        const usable = filterUsableAssistantTextModels(modelRows, vendorRows)
        setModels(usable)
        setVendors(Object.fromEntries(vendorRows.map((row) => [row.key, row.name])))
        const pref = getAssistantModelPref()
        const found = pref && usable.find((row) => row.vendorKey === pref.vendorKey && row.modelKey === pref.modelKey)
        if (found) setSelectedModel(encodeModelIdentity(found))
        else { setAssistantModelPref(null); setSelectedModel('') }
      }).catch(() => {
        if (alive && version === requestVersion) setModels([])
      })
    }
    loadModels()
    window.addEventListener('nomi-model-catalog-changed', loadModels)
    return () => {
      alive = false
      requestVersion += 1
      window.removeEventListener('nomi-model-catalog-changed', loadModels)
    }
  }, [])
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
      if (document.querySelector('[data-agent-history]')?.contains(target)) return
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
  }, [selectedClipIds, selectedNodeIds, surface])
  const focusReceipt = React.useCallback(() => {
    focusContext()
  }, [focusContext])
  const undoReceipt = React.useCallback(async (record: NonNullable<typeof committedProposal>) => {
    try { await runProposalUndo(record) } catch (caught) { setError(friendlyError(caught, t)) }
  }, [t])
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

  // Every explicit action entry (including the selection popover and resource
  // sidebar) must converge on this same Host turn path. The tool profile is
  // captured at the caller boundary, so storyboard capability does not depend
  // on a keyword classifier or a second planner implementation.
  const sendTurn = React.useCallback(async (rawText: string, options?: { toolProfile?: AgentToolProfile; displayText?: string }) => {
    const text = rawText.trim(); if (!text || !snapshot) return; setError('')
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
    const capability = isDocumentSurface(surface) ? 'creation-editor' as const : 'canvas-agent' as const
    const selectedPrompt = getCreationAiMode(promptModeId)
    const skillKey = activeSkill?.key ?? (surface === 'storyboard' ? 'workbench.storyboard.planner' : surface === 'creation' ? `workbench.creation.${selectedPrompt.id}` : surface === 'preview' ? 'workbench.timeline.editor' : 'workbench.generation.canvas-planner')
    let target: TargetRef; let preconditions: PreconditionSet | undefined
    try {
      if (isDocumentSurface(surface)) {
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
    attachmentApi.clearAttachments(); closeMenu()
    try {
      const actionIntent = isAgentActionIntent(text)
      const requestMode = runMode === 'ask' && !actionIntent ? 'chat' : 'auto'
      const surfaceSystemPrompt = surface === 'generation'
        ? buildStaticAgentSystemPrompt(requestMode === 'chat' ? 'chat' : 'agent')
        : surface === 'preview'
          ? buildStaticAgentSystemPrompt(requestMode === 'chat' ? 'chat' : 'agent', 'timeline')
        : isDocumentSurface(surface) && !activeSkill
          ? selectedPromptPreset.prompt || selectedPrompt.prompt
          : undefined
      const systemPrompt = composeResidentSystemPrompt(surfaceSystemPrompt, activeSkill ? null : selectedLibraryPrompt)
      const response = await runWorkbenchAgent({ turnId, prompt: `${surfaceContext}\n${contextDetail}${referencesText}\n\n${text}`, ...(systemPrompt ? { systemPrompt } : {}), displayPrompt: options?.displayText ?? text, capability, ...(options?.toolProfile ? { toolProfile: options.toolProfile } : surface === 'preview' ? { toolProfile: 'timeline' as const } : {}), history: { kind: 'ephemeral' }, projectId: snapshot.binding.projectId, selectedNodeIds: surface === 'generation' ? selectedNodeIdsAtSend : undefined, target, ...(preconditions ? { preconditions } : {}), originSurface: { surfaceId: 'project-agent-resident', kind: isDocumentSurface(surface) ? 'document' : surface === 'generation' ? 'canvas' : 'preview' }, mode: requestMode, workMode: runMode, approvalPolicy, skillKey, skillName: activeSkill?.name ?? (selectedLibraryPrompt ? promptDisplayTitle(selectedLibraryPrompt) : surface === 'preview' ? t('agentResident.skillTimeline') : selectedPrompt.title), contextSnapshot, attachmentClaims: projectAgentAttachmentClaims(attachments.filter((item) => item.status === 'ready')), attachments: attachmentPayloads(attachments), onToolCall: async (call) => { residentToolArgs.set(pendingKey(call), call.args); residentPendingTools.set(pendingKey(call), { call, bindingKey: bindingKey(snapshot.binding), state: 'pending' }); const projectionScope = residentToolProjectionScope(bindingKey(snapshot.binding), snapshot.activeThreadId ?? ''); if (projectionScope) { const projection = residentToolProjectionForCall(t, call.toolName, call.args, 'proposed'); cacheResidentToolProjection(projectionScope, call.turnId, call.toolCallId, projection); const persisted = new Map(Object.entries(readResidentToolProjections(projectionScope))); persisted.set(`${call.turnId}:${call.toolCallId}`, projection); writeResidentToolProjections(projectionScope, persisted) }; emitPending() } })
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
  }, [activeSkill, approvalPolicy, attachmentApi, attachments, closeMenu, creationDocumentTools, promptModeId, references, runMode, selectedLibraryPrompt, selectedPromptPreset, snapshot, surface, t])

  const submit = React.useCallback(async () => {
    const text = draft.trim(); if (!text || !snapshot) return
    if (editingQueue) { try { await editProjectAgentQueueItem({ ...editingQueue, text }); setEditingQueue(null); setDraft('') } catch (caught) { setError(friendlyError(caught, t)) }; return }
    setDraft('')
    await sendTurn(text)
  }, [draft, editingQueue, sendTurn, setDraft, snapshot, t])

  // The resident Agent is the sole owner of the storyboard launcher. Keep the
  // bridge alive for the creation surface and clear it on unmount/surface
  // changes so a hidden creation dock cannot receive a later click.
  React.useEffect(() => {
    if (surface !== 'creation') return
    const launch = (displayPrompt?: string) => {
      void sendTurn(t('agentResident.storyboardRequest'), {
        toolProfile: 'storyboard',
        ...(displayPrompt ? { displayText: displayPrompt } : {}),
      })
    }
    setStoryboardPlannerLauncher(launch)
    return () => setStoryboardPlannerLauncher(null)
  }, [sendTurn, setStoryboardPlannerLauncher, surface, t])
  const onKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === '@') window.setTimeout(() => setMenu('references'), 0)
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() }
  }, [submit])

  // Search by the stable Skill key and directory as well as the localized
  // label. Users (and walk-throughs) commonly paste `brand.promo` from a
  // manifest or MCP request; filtering only the translated label made a
  // perfectly loaded repository Skill appear to be missing.
  const filteredSkills = skills
  const promptPreset = PROMPT_PRESETS.find((preset) => preset.id === promptModeId) ?? PROMPT_PRESETS[0]
  const PromptIcon = promptPreset.icon
  const modeKey = (value: ProjectAgentRunMode): string => `agentResident.mode${value[0].toUpperCase()}${value.slice(1)}`
  const modeTitle = `${t('agentResident.modeTitle')} · ${t(modeKey(runMode))}`
  const approvalModeLabel = (value: ProjectAgentApprovalMode): string => t(`agentResident.approvalMode${value === 'safe-auto' ? 'SafeAuto' : value === 'project' ? 'Project' : 'Step'}`)
  const spendPolicyLabel = (value: ProjectAgentSpendPolicy): string => t(`agentResident.spendPolicy${value === 'within-budget' ? 'WithinBudget' : 'Confirm'}`)
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
  const remainingRounds = Math.max(1, 40 - sessionTurns)
  const modelNeedsSelection = models.length === 0 || !selectedModelRow
  const renderPendingTool = (pending: PendingTool): JSX.Element => {
    const key = pendingKey(pending.call)
    const editableArgs = proposalDrafts[key] ?? (pending.call.args && typeof pending.call.args === 'object' && !Array.isArray(pending.call.args) ? pending.call.args as Record<string, unknown> : undefined)
    const proposal = proposalForTool(t, pending.call.toolName, editableArgs)
    const compactGeneration = Boolean(editableArgs && isGenerationProposalTool(pending.call.toolName, editableArgs))
    const approvalState = pending.state === 'approved' ? 'approved' : pending.state === 'denied' ? 'denied' : 'pending'
    const rawRecord = editableArgs ?? {}
    const candidates = residentCandidates(rawRecord)
    const question = typeof rawRecord.question === 'string' ? rawRecord.question : ''
    const questionOptions = residentQuestionOptions(rawRecord)
    if (question && questionOptions.length) {
      return <div key={pending.call.toolCallId} data-agent-item-kind="approval"><ResidentQuestionCard question={question} options={questionOptions} pageLabel={t('agentResident.questionPage')} moreLabel={t('agentResident.questionMore', { count: Math.max(0, questionOptions.length - 4) })} collapseLabel={t('agentResident.questionCollapse')} skipLabel={t('agentResident.questionSkip')} nextLabel={t('agentResident.questionNext')} onAnswer={(option) => setDraft(option.label)} onSkip={() => setDraft('')} onNext={() => { if (draft.trim()) void submit() }} /></div>
    }
    if (rawRecord.planStatus === 'failed' && proposal) {
      return <div key={pending.call.toolCallId} data-agent-item-kind="approval"><ResidentPlanCard state="failed" shots={[]} parameters={[]} failureReason={t('agentResident.planFailed')} billing={t('agentResident.notCharged')} editLabel={t('agentResident.editPrompt')} retryLabel={t('agentResident.retry')} loadingLabel={t('agentResident.planLoading')} summaryLabel={(total, selected) => t('agentResident.planSummary', { total, selected })} generateLabel={(selected) => t('agentResident.planGenerate', { count: selected })} editedLabel={t('agentResident.planEdited')} selectAllLabel={t('agentResident.planSelectAll')} onEdit={() => setDraft(t('agentResident.editPlanPrompt'))} onRetry={() => void resolveTool(pending, true, editableArgs)} onGenerate={() => undefined} /></div>
    }
    if (rawRecord.priceStatus === 'failed' && proposal) {
      const knownRows = proposal.fields.filter((field) => field.kind !== 'estimate').slice(0, 3)
      const amount = typeof rawRecord.amount === 'number' && Number.isFinite(rawRecord.amount) ? rawRecord.amount : null
      return <div key={pending.call.toolCallId} data-agent-item-kind="approval"><ResidentSpendCard knownRows={knownRows} amount={amount} failureReason={t('agentResident.priceUnavailable')} refreshLabel={t('agentResident.spendRefresh')} continueLabel={t('agentResident.spendContinue')} amountLabel={(value) => t('agentResident.proposalEstimateAmount', { amount: value.toFixed(2) })} unknownAmountLabel={t('agentResident.priceUnavailable')} onRefresh={() => window.dispatchEvent(new Event('nomi-agent-price-refresh'))} onContinue={() => void resolveTool(pending, true, editableArgs)} /></div>
    }
    if (candidates.length > 0) {
      return <div key={pending.call.toolCallId} data-agent-item-kind="approval"><ResidentCandidatesCard candidates={candidates} versionCountLabel={(count) => t('agentResident.candidateVersions', { count })} adoptLabel={(label) => t('agentResident.candidateAdopt', { label })} moreLabel={t('agentResident.candidateMore', { count: Math.max(0, candidates.length - 3) })} collapseLabel={t('agentResident.candidateCollapse')} onSelect={(candidate) => setProposalDrafts((previous) => ({ ...previous, [key]: { ...rawRecord, candidate } }))} /></div>
    }
    if (compactGeneration) {
      const shots = residentPlanShots(editableArgs)
      return <div key={pending.call.toolCallId} data-agent-item-kind="approval"><ResidentPlanCard state="ready" shots={shots} parameters={residentProposalParameters(editableArgs)} failureReason={t('agentResident.planFailed')} billing={t('agentResident.notCharged')} editLabel={t('agentResident.editPrompt')} retryLabel={t('agentResident.retry')} loadingLabel={t('agentResident.planLoading')} summaryLabel={(total, selected) => t('agentResident.planSummary', { total, selected })} generateLabel={(selected) => t('agentResident.planGenerate', { count: selected })} editedLabel={t('agentResident.planEdited')} selectAllLabel={t('agentResident.planSelectAll')} onEdit={() => setDraft(t('agentResident.editPlanPrompt'))} onRetry={() => void resolveTool(pending, true, editableArgs)} onGenerate={(selected) => void resolveTool(pending, true, residentArgsForSelection(editableArgs, selected))}><GenerationProposalEditor args={editableArgs} t={t} onChange={(next) => setProposalDrafts((previous) => ({ ...previous, [key]: next }))} /></ResidentPlanCard></div>
    }
    return <div key={pending.call.toolCallId} data-agent-item-kind="approval"><ResidentApprovalCard title={readableToolName(t, pending.call.toolName)} iconName={pending.call.toolName} summary={readableToolPreview(t, pending.call.toolName, editableArgs)} details={readableToolDetailRows(t, pending.call.toolName, editableArgs)} detailsLabel={t('agentResident.toolInspectDetails')} proposal={proposal} state={approvalState} approveLabel={t('agentResident.approve')} denyLabel={t('agentResident.deny')} pendingLabel={t('agentResident.waitingApproval')} approvedLabel={t('agentResident.approved')} deniedLabel={t('agentResident.denied')} resolvedApprovedHint={t('agentResident.approvedReceiptHint')} resolvedDeniedHint={t('agentResident.deniedReceiptHint')} notWrittenLabel={t('agentResident.notWritten')} compactGeneration={compactGeneration} onApprove={() => void resolveTool(pending, true, editableArgs)} onDeny={() => void resolveTool(pending, false)} /></div>
  }

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

  return <section id="project-agent-resident" onKeyDownCapture={(event) => { if (event.key === 'Escape') { setThreadsOpen(false); setMenu(null); setQueueMenuOpen(null) } }} className="relative isolate flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--workbench-ai-panel-bg)] text-nomi-ink" aria-label={t('agentResident.aria')} data-agent-resident="true" data-agent-panel="true" data-agent-surface={surface} data-agent-run-mode={runMode} data-agent-approval-mode={approvalPolicy.mode} data-agent-spend-policy={approvalPolicy.spend}>
    <header className="relative flex min-h-11 shrink-0 items-center gap-2 border-b border-nomi-line-soft px-3 py-1.5" data-agent-header="true">
      <div className="flex min-w-0 items-center gap-2"><NomiLogoMark size={19} /><span className="text-body-sm font-semibold">{t('agentResident.brand')}</span></div>
      <div className="relative shrink-0" onMouseEnter={() => setUsageOpen(true)}>
        <button type="button" className="inline-flex h-6 items-center gap-1.5 rounded-pill border border-nomi-line bg-nomi-paper px-2 text-micro tabular-nums text-nomi-ink-60" data-agent-usage-pill="true" title={t('agentResident.usageTitle', { last: lastTurnTokens, total: sessionTotalTokens })} aria-label={t('agentResident.usageRoundsTitle', { count: remainingRounds })} onFocus={() => setUsageOpen(true)} onClick={() => setUsageOpen(true)}><IconCircleDashed size={13} className="text-nomi-accent" aria-hidden="true" />{t('agentResident.usageRounds', { count: remainingRounds })}</button>
        <Popover open={usageOpen} onClose={() => setUsageOpen(false)} label={t('agentResident.usageTitle', { last: lastTurnTokens, total: sessionTotalTokens })} className="w-[220px]" testId="usage-popover">
          <div className="grid gap-1 px-2 py-1.5 text-micro tabular-nums text-nomi-ink-60">
            <div>{t('agentResident.usagePopoverRound', { value: lastTurnTokens })}</div>
            <div>{t('agentResident.usagePopoverTotal', { value: sessionTotalTokens })}</div>
            <div>{t('agentResident.usagePopoverCost', { value: t('agentResident.costUnknown') })}</div>
          </div>
        </Popover>
      </div>
      <span className="min-w-0 flex-1" aria-hidden="true" />
      <WorkbenchIconButton size="sm" label={t('agentResident.threadList')} icon={<IconHistory size={15} />} onClick={() => setThreadsOpen((value) => !value)} data-agent-history="true" />
      <WorkbenchIconButton size="sm" label={t('agentResident.collapse')} icon={<IconLayoutSidebarRightCollapse size={15} />} onClick={() => setCollapsed(true)} data-agent-collapse="true" />
      {threadsOpen ? <div ref={threadMenuRef} tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') setThreadsOpen(false) }} className="absolute right-2 top-full z-50 mt-1 w-[280px] rounded-nomi border border-nomi-line bg-nomi-paper p-1 shadow-nomi-lg" data-agent-thread-menu="true" role="menu"><div className="flex items-center justify-between px-2 py-1 text-micro text-nomi-ink-60"><span>{t('agentResident.threads')}</span><button type="button" className="text-nomi-accent" onClick={() => { void createProjectAgentThread(); setThreadsOpen(false) }}>{t('agentResident.newThread')}</button></div>{(snapshot?.threads ?? []).map((thread) => <div key={thread.threadId} className={cn('flex items-center gap-1 rounded-nomi-sm px-2 py-1', thread.threadId === activeThreadId && 'bg-nomi-accent-soft')}><button type="button" className="min-w-0 flex-1 truncate text-left text-caption" onClick={() => { void activateProjectAgentThread(thread.threadId); setThreadsOpen(false) }}>{thread.title || t('agentResident.untitledThread')}</button><button type="button" className="grid size-7 place-items-center rounded-nomi-sm hover:bg-nomi-ink-10" aria-label={t('agentResident.removeThread')} onClick={() => void removeProjectAgentThread(thread.threadId)}><IconTrash size={13} /></button></div>)}</div> : null}
    </header>
    {committedProposal ? <div className="shrink-0 px-3 pt-1.5" data-agent-result-card-area="true">
      <ResidentPinnedResultCard
        record={committedProposal}
        undoLabel={t('generationCommon.committedProposal.undo')}
        onUndo={() => void undoReceipt(committedProposal)}
        summaryLabel={(total, selected) => t('agentResident.planSummary', { total, selected })}
        openLabel={t('agentResident.pinnedOpen')}
        collapseLabel={t('agentResident.pinnedCollapse')}
      />
    </div> : null}
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className={cn('h-full min-h-0 space-y-1 overflow-y-auto px-3 py-2', menu && 'pointer-events-none')} role="log" aria-live="polite" data-agent-transcript="true" data-agent-flow="true">
        {latestCompactionTurn?.runtimeContext && latestCompactionTurn.runtimeContext.compactions > 0 ? <div className="mb-2 flex min-h-7 items-center gap-1.5 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 px-2.5 py-1.5 text-micro text-nomi-ink-60" data-agent-compaction-line="true"><IconCircleDashed size={12} className="shrink-0 text-nomi-accent" aria-hidden="true" /><span>{t('agentResident.compactionLine', { count: latestCompactionTurn.runtimeContext.compactions })}</span></div> : null}
        {!items.length && !activeQueue.length ? <div className="grid min-h-40 place-items-center px-5 py-8 text-center" data-agent-empty-state="true"><div className="grid justify-items-center gap-2"><span className="grid size-10 place-items-center rounded-pill bg-nomi-accent-soft text-nomi-accent"><IconMessageQuestion size={22} aria-hidden="true" /></span><div className="text-body-sm font-semibold">{t('agentResident.emptyTitle')}</div><p className="m-0 max-w-[18rem] text-caption leading-5 text-nomi-ink-60">{t('agentResident.emptyDescription')}</p><button type="button" className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-nomi-sm border border-nomi-accent bg-nomi-accent-soft px-3 text-caption font-medium text-nomi-accent transition-colors hover:bg-nomi-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40" data-agent-empty-cta="true" onClick={() => { document.querySelector<HTMLTextAreaElement>('[data-agent-input="true"]')?.focus() }}><IconArrowUp size={14} aria-hidden="true" />{t('agentResident.emptyCta')}</button></div></div> : null}
        {planningTurn ? <ResidentThinkingState label={t('agentResident.planning')} detail={t('agentResident.planningDetail')} open={thinkingOpen} onToggle={() => setThinkingOpen((value) => !value)} /> : null}
        {planningTurn ? <ResidentPlanCard state="loading" shots={[]} parameters={[]} failureReason={t('agentResident.planFailed')} billing={t('agentResident.notCharged')} editLabel={t('agentResident.editPrompt')} retryLabel={t('agentResident.retry')} loadingLabel={t('agentResident.planLoading')} summaryLabel={(total, selected) => t('agentResident.planSummary', { total, selected })} generateLabel={(selected) => t('agentResident.planGenerate', { count: selected })} editedLabel={t('agentResident.planEdited')} selectAllLabel={t('agentResident.planSelectAll')} onEdit={() => undefined} onRetry={() => undefined} onGenerate={() => undefined} /> : null}
        {skillEvents.map((item) => <div key={item.itemId} className="flex min-h-6 items-center gap-1.5 px-1 text-micro text-nomi-ink-40" data-agent-skill-event="true" data-state={item.loaded ? 'settled' : 'failed'}><IconTool size={13} className="shrink-0" aria-hidden="true" /><span>{item.loaded ? t('agentResident.skillLoaded', { name: item.name }) : t('agentResident.skillLoadFailed')}</span></div>)}
        <ResidentToolChips items={toolChipItems} emptyLabel={t('agentResident.toolDetailEmpty')} sectionLabel={t('agentResident.toolCalls')} headerLabel={toolChipItems.length > 20 ? t('agentResident.toolCallsLong', { count: toolChipItems.length, actions: toolChipItems.slice(0, 3).map((item) => item.label).join(' · ') }) : t('agentResident.toolCallsCount', { count: toolChipItems.length })} explanationLabel={t('agentResident.toolExplanation')} targetLabel={t('agentResident.toolTargetLabel')} resultLabel={t('agentResident.toolResult')} technicalLabel={t('agentResident.toolTechnicalDetails')} statusLabel={(status) => statusLabel(t, status)} />
        {items.map((item) => { const proposal = item.kind === 'proposal' && item.approval; const proposalActive = item.kind === 'proposal' && item.status === 'proposed' && Boolean(proposal); const receipt = item.kind === 'proposal' && item.status === 'done' && item.approval?.receiptProposalId === committedProposal?.proposalId ? committedProposal : null; const declined = item.kind === 'failure' && item.status === 'declined'; const streaming = item.kind === 'assistant' && (isLive(item.status) || runningTurn?.turnId === item.turnId); const failureCode = item.kind === 'failure' ? safeAgentFailureCode(item.code) : undefined; const failureCategory = item.kind === 'failure' ? agentFailureCategory(item.code, item.message) : undefined; if (item.kind === 'tool' || proposalActive) return null; return <article key={item.itemId} data-agent-item-kind={item.kind} data-agent-turn-id={item.turnId} data-agent-status={item.status} data-agent-user-bubble={item.kind === 'user' ? 'true' : undefined} data-agent-error-code={failureCode} data-agent-error-message-category={failureCategory} className={residentItemClassName(item, declined)}>
          {item.kind === 'user' ? <ResidentFoldableText text={item.text} expandLabel={t('agentResident.foldMore')} collapseLabel={t('agentResident.foldCollapse')} estimatedExtra={t('agentResident.foldCharacters', { count: Math.max(1, item.text.length - 360) })} dataUserContent foldLinkOutside className="text-caption" contentWrapClassName="rounded-nomi-sm border border-nomi-ink bg-nomi-ink px-3 py-2" contentClassName="text-nomi-paper" /> : null}
          {item.kind === 'assistant' ? <><div data-agent-reply="true" className={cn('block max-w-full', item.text.length <= 360 && 'h-5 overflow-hidden')} title={item.text}><ResidentFoldableText text={item.text || (streaming ? `${t('creationAi.assistantMessage.processing')}…` : '')} expandLabel={t('agentResident.foldMore')} collapseLabel={t('agentResident.foldCollapse')} estimatedExtra={t('agentResident.foldCharacters', { count: Math.max(1, item.text.length - 360) })} singleLine contentClassName="text-caption leading-5" />{streaming ? <span data-agent-stream-cursor="true" className="ml-0.5 inline-block h-[1em] w-px translate-y-[0.1em] rounded-pill bg-nomi-accent align-baseline motion-safe:animate-pulse motion-reduce:animate-none" aria-hidden="true" /> : null}</div>{item.status === 'stopped' ? <span data-agent-status-label="stopped" className="text-micro text-nomi-ink-40">{statusLabel(t, item.status)}</span> : null}</> : null}
          {item.kind === 'proposal' ? <div data-agent-proposal="true" data-agent-proposal-receipt={item.status === 'done' ? 'true' : undefined} title={item.status === 'done' ? t('agentResident.approvedReceiptHint') : undefined}><div className="flex min-h-7 items-center gap-1.5 text-micro font-medium text-nomi-ink-60"><IconListCheck size={15} className="shrink-0 text-nomi-accent" />{item.status === 'done' ? t('agentResident.approved') : t('agentResident.plan')}<span className="ml-auto text-micro text-nomi-accent">{statusLabel(t, item.status)}</span>{receipt ? <button type="button" className="grid size-5 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink" aria-label={t('generationCommon.committedProposal.undo')} title={t('generationCommon.committedProposal.undo')} data-agent-receipt-undo="true" onClick={() => void undoReceipt(receipt)}><IconArrowBackUp size={13} aria-hidden="true" /></button> : null}{item.status === 'done' && hasContextLocator ? <button type="button" className="grid size-7 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink" aria-label={t('agentResident.viewChange')} title={t('agentResident.viewChange')} data-agent-action="focus-receipt" onClick={focusReceipt}><IconFocusCentered size={13} aria-hidden="true" /></button> : null}</div></div> : null}
          {item.kind === 'failure' ? declined ? <div className="flex items-center gap-1.5 font-medium text-nomi-ink-60"><IconCircleDashed size={18} />{t('agentResident.operationDeniedReceipt')}</div> : isWriteFailure(item.code, item.message) ? <ResidentWriteFailureRow reason={t('agentResident.writeFailed')} billing={t('agentResident.notCharged')} retryLabel={t('agentResident.retry')} onRetry={() => window.dispatchEvent(new Event('nomi-agent-write-retry'))} /> : <ResidentFailureCard reason={readableFailure(t, item.code, item.message)} billing={t('agentResident.notCharged')} actions={[t('agentResident.changeModelRetry'), t('agentResident.editPrompt'), t('agentResident.viewLog')]} onAction={(action) => { if (action === t('agentResident.changeModelRetry')) { const user = items.find((candidate) => candidate.kind === 'user' && candidate.turnId === item.turnId); if (user?.kind === 'user') setDraft(user.text) } else if (action === t('agentResident.editPrompt')) setDraft(t('agentResident.editPlanPrompt')); else window.dispatchEvent(new Event('nomi-open-task-center')) }} /> : null}
          {item.kind === 'artifact' && item.status === 'running' ? <ResidentArtifactCard state="loading" title={t('agentResident.artifact', { id: itemRef(item) })} sizeLabel={t('agentResident.artifactSizeUnknown')} versionLabel={t('agentResident.artifactVersion', { version: 1 })} waitLabel={t('agentResident.artifactWaiting', { elapsed: '30s' })} failureReason={t('agentResident.artifactFailed')} billing={t('agentResident.notCharged')} retryLabel={t('agentResident.changeModelRetry')} editLabel={t('agentResident.editPrompt')} openLabel={t('agentResident.openArtifact')} onRetry={() => { const user = items.find((candidate) => candidate.kind === 'user' && candidate.turnId === item.turnId); if (user?.kind === 'user') setDraft(user.text) }} onEdit={() => setDraft(t('agentResident.editPlanPrompt'))} onOpen={() => openTask(item)} /> : null}
          {item.kind === 'artifact' && item.status === 'failed' ? <ResidentArtifactCard state="failed" title={t('agentResident.artifact', { id: itemRef(item) })} sizeLabel={t('agentResident.artifactSizeUnknown')} versionLabel={t('agentResident.artifactVersion', { version: item.artifact.version })} waitLabel={t('agentResident.artifactWaiting', { elapsed: '30s' })} failureReason={t('agentResident.artifactFailed')} billing={t('agentResident.notCharged')} retryLabel={t('agentResident.changeModelRetry')} editLabel={t('agentResident.editPrompt')} openLabel={t('agentResident.openArtifact')} onRetry={() => { const user = items.find((candidate) => candidate.kind === 'user' && candidate.turnId === item.turnId); if (user?.kind === 'user') setDraft(user.text) }} onEdit={() => setDraft(t('agentResident.editPlanPrompt'))} onOpen={() => openTask(item)} /> : null}
          {item.deviated ? <ResidentDeviationCard deviations={[{ where: t('agentResident.deviationWhere'), field: t('agentResident.deviationField'), detail: t('agentResident.deviationDetail') }]} moreLabel={t('agentResident.deviationMore', { count: 1 })} collapseLabel={t('agentResident.deviationCollapse')} actions={[t('agentResident.viewLog')]} onAction={() => window.dispatchEvent(new Event('nomi-open-task-center'))} /> : null}
          {item.kind === 'task' || (item.kind === 'artifact' && item.status !== 'running' && item.status !== 'failed') ? <div className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1.5 truncate"><IconExternalLink size={14} />{item.kind === 'task' ? t('agentResident.task', { id: itemRef(item) }) : t('agentResident.artifact', { id: itemRef(item) })}</span><button type="button" className="h-7 rounded-nomi-sm border border-nomi-line px-2 text-micro" onClick={() => openTask(item)}>{item.kind === 'task' ? t('agentResident.openTask') : t('agentResident.openArtifact')}</button></div> : null}
        </article> })}
        {pendingTools.map(renderPendingTool)}
      </div>
      {showLatest ? <button type="button" className="absolute bottom-2 right-3 z-10 grid size-7 place-items-center rounded-pill border border-nomi-line bg-nomi-paper text-nomi-ink-60 shadow-nomi-md transition-[background,box-shadow,transform] duration-[var(--nomi-transition-fast)] hover:-translate-y-px hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40 motion-reduce:transition-none" data-agent-action="scroll-latest" aria-label={t('agentResident.scrollLatest')} title={t('agentResident.scrollLatest')} onClick={scrollToLatest}><IconChevronDown size={15} aria-hidden="true" /></button> : null}
    </div>
    <div className="relative z-20 shrink-0 border-t border-nomi-line-soft bg-nomi-paper" data-agent-composer="true">
      {activeQueue.length ? <div className="grid gap-0.5 px-3 pt-1" data-agent-queue="true">{activeQueue.slice(0, queueExpanded ? activeQueue.length : 3).map((entry) => { const user = snapshot?.items.find((candidate) => candidate.kind === 'user' && candidate.turnId === entry.turnId); const label = user?.kind === 'user' ? user.text : t('agentResident.taskFallback'); const queued = entry.status === 'queued'; const open = queueMenuOpen === entry.queueItemId; return <div key={entry.queueItemId} className="relative" data-agent-queue-row="true"><div className="flex min-h-7 items-center gap-1.5 px-1 text-micro text-nomi-ink-40"><span className="size-1.5 shrink-0 rounded-pill border border-nomi-ink-30" aria-hidden="true" /><span className="min-w-0 flex-1 truncate" title={label}>{label}</span><span className="shrink-0">{statusLabel(t, entry.status)}</span><button type="button" className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink" aria-label={t('agentResident.more')} title={t('agentResident.more')} onClick={() => setQueueMenuOpen(open ? null : entry.queueItemId)}><IconDotsVertical size={14} /></button>{queued ? <button type="button" data-agent-queue-remove="true" className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-workbench-danger-soft hover:text-workbench-danger" aria-label={t('agentResident.cancel')} title={t('agentResident.cancel')} onClick={() => void runQueueMutation(() => deleteProjectAgentQueueItem(entry.queueItemId))}><IconX size={13} /></button> : <button type="button" className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-workbench-danger hover:bg-workbench-danger-soft" aria-label={t('agentResident.stop')} title={t('agentResident.stop')} onClick={() => void stopTurn(entry.turnId)}><IconPlayerStopFilled size={12} /></button>}</div>{open ? <div className="ml-4 flex gap-1 border-l border-nomi-line-soft pl-2 pb-1" data-agent-queue-actions="true"><button type="button" className={iconControlClass()} aria-label={t('agentResident.edit')} title={t('agentResident.edit')} onClick={() => { if (user?.kind === 'user') { setDraft(user.text); setEditingQueue({ queueItemId: entry.queueItemId, userItemId: user.itemId }) }; setQueueMenuOpen(null) }}><IconPencil size={13} /></button>{queued ? <><button type="button" className={iconControlClass()} aria-label={t('agentResident.moveUp')} title={t('agentResident.moveUp')} onClick={() => void runQueueMutation(() => moveProjectAgentQueueItem(entry.queueItemId, 'up'))}><IconChevronLeft size={13} /></button><button type="button" className={iconControlClass()} aria-label={t('agentResident.moveDown')} title={t('agentResident.moveDown')} onClick={() => void runQueueMutation(() => moveProjectAgentQueueItem(entry.queueItemId, 'down'))}><IconChevronRight size={13} /></button><button type="button" className={iconControlClass()} aria-label={entry.paused ? t('agentResident.resume') : t('agentResident.pause')} title={entry.paused ? t('agentResident.resume') : t('agentResident.pause')} onClick={() => void runQueueMutation(() => entry.paused ? resumeProjectAgentQueueItem(entry.queueItemId) : pauseProjectAgentQueueItem(entry.queueItemId))}><IconAdjustmentsHorizontal size={13} /></button><button type="button" className={iconControlClass()} aria-label={t('agentResident.delete')} title={t('agentResident.delete')} onClick={() => void runQueueMutation(() => deleteProjectAgentQueueItem(entry.queueItemId))}><IconTrash size={13} /></button></> : null}</div> : null}</div> })}{activeQueue.length > 3 ? <button type="button" className="flex min-h-7 items-center gap-1 px-1 text-left text-micro text-nomi-accent" data-queue-more-row="true" data-queue-more-count={String(activeQueue.length - 3)} onClick={() => setQueueExpanded((value) => !value)}><IconChevronDown size={12} className={cn(queueExpanded && 'rotate-180')} aria-hidden="true" />{queueExpanded ? t('agentResident.queueCollapse') : t('agentResident.queueMore', { count: activeQueue.length - 3 })}</button> : null}</div> : null}
      {error ? <div className="px-3 pb-1 text-micro text-workbench-danger" role="alert">{error}</div> : null}
      <form className="relative grid gap-1 px-3 pb-1.5 pt-1" onSubmit={(event) => { event.preventDefault(); void submit() }} {...attachmentApi.dragHandlers}>
        <input ref={attachmentApi.inputRef} type="file" multiple accept={COMPOSER_ATTACHMENT_ACCEPT} className="hidden" tabIndex={-1} aria-hidden="true" onChange={attachmentApi.onInputChange} />
        <AttachmentRail attachments={attachments} onRemove={attachmentApi.removeAttachment} />
        {references.length || activeSkill || selectedLibraryPrompt || (promptModeId !== 'general' && !activeSkill) ? <div className="flex max-h-14 flex-wrap gap-1 overflow-y-auto" data-agent-references="true">{references.map((reference) => <ResidentReferenceChip key={reference.id} reference={reference} t={t} onRemove={() => removeReference(reference.id)} />)}{activeSkill ? <span data-agent-reference={`skill:${activeSkill.key}`} className="inline-flex h-6 max-w-full items-center gap-1 rounded-pill bg-nomi-accent-soft px-2 text-micro text-nomi-accent"><IconTool size={12} /><span className="truncate">{activeSkill.name}</span><button type="button" aria-label={t('agentResident.removeReference')} onClick={() => setActiveSkill(null)}><IconX size={11} /></button></span> : null}{selectedLibraryPrompt && !activeSkill ? <span data-agent-reference={libraryPromptReferenceId(selectedLibraryPrompt)} className="inline-flex h-6 max-w-full items-center gap-1 rounded-pill bg-nomi-accent-soft px-2 text-micro text-nomi-accent" title={selectedLibraryPrompt.prompt}><IconPencil size={12} /><span className="truncate">{promptDisplayTitle(selectedLibraryPrompt)}</span><button type="button" aria-label={t('agentResident.removeReference')} title={t('agentResident.removeReference')} onClick={() => setSelectedLibraryPrompt(null)}><IconX size={11} /></button></span> : null}{promptModeId !== 'general' && !activeSkill && !selectedLibraryPrompt ? <span data-agent-reference={`prompt:${promptModeId}`} className="inline-flex h-6 max-w-full items-center gap-1 rounded-pill bg-nomi-ink-05 px-2 text-micro text-nomi-ink-80"><PromptIcon size={12} /><span className="truncate">{t(`agentResident.${promptPreset.labelKey}`)}</span><button type="button" aria-label={t('agentResident.removeReference')} onClick={() => setPromptModeId('general')}><IconX size={11} /></button></span> : null}</div> : null}
        <div className={cn('rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-1', attachmentApi.isDragging && 'border-nomi-accent bg-nomi-accent-soft')}>
          <AutoGrowTextarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onPaste={attachmentApi.handlePaste} placeholder={t('agentResident.placeholder')} aria-label={t('agentResident.messageAria')} maxHeight={120} className="min-h-10 text-body-sm" data-agent-input="true" />
          <div className="flex items-center gap-1 border-t border-nomi-line-soft pt-1">
            <div className="relative shrink-0"><button type="button" className={iconControlClass(menu === 'attachments')} aria-expanded={menu === 'attachments'} aria-haspopup="menu" data-agent-composer-attach="true" aria-label={t('agentResident.attach')} title={t('agentResident.attachTitle')} onClick={() => setMenu(menu === 'attachments' ? null : 'attachments')}><IconPaperclip size={16} /></button><Popover open={menu === 'attachments'} onClose={closeMenu} label={t('agentResident.attach')}><MenuRow testId="image" onClick={() => { attachmentApi.openFilePicker(); closeMenu() }}><IconPhoto size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.attachImage')} hint={t('agentResident.attachImageHint')} /></MenuRow><MenuRow testId="video" onClick={() => { attachmentApi.openFilePicker(); closeMenu() }}><IconVideo size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.attachVideo')} hint={t('agentResident.attachVideoHint')} /></MenuRow><MenuRow testId="audio" onClick={() => { attachmentApi.openFilePicker(); closeMenu() }}><IconWaveSine size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.attachAudio')} hint={t('agentResident.attachAudioHint')} /></MenuRow><MenuRow testId="document" onClick={() => { attachmentApi.openFilePicker(); closeMenu() }}><IconFileText size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.attachDocument')} hint={t('agentResident.attachDocumentHint')} /></MenuRow><div className="my-1 border-t border-nomi-line-soft" /><MenuRow testId="voice" onClick={startVoiceInput}><IconMicrophone size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.voiceInput')} hint={t('agentResident.voiceInputHint')} /></MenuRow></Popover></div>
            <div className="relative shrink-0"><button type="button" className={iconControlClass(runMode !== 'agent' || approvalPolicy.mode !== 'step' || approvalPolicy.spend !== 'confirm')} aria-expanded={menu === 'modes'} aria-haspopup="menu" data-agent-composer-mode="true" aria-label={t('agentResident.modeSelect')} title={modeTitle} onClick={() => setMenu(menu === 'modes' ? null : 'modes')}><IconBolt size={16} /></button><Popover open={menu === 'modes'} onClose={closeMenu} label={t('agentResident.modeMenuTitle')} className="w-[360px] max-w-[calc(100vw-24px)]"><div className="px-2 py-1 text-micro font-medium text-nomi-ink-40">{t('agentResident.mode')}</div>{(['ask', 'editSelection', 'agent'] as ProjectAgentRunMode[]).map((value) => { const ModeIcon = value === 'ask' ? IconMessageQuestion : value === 'editSelection' ? IconFilePencil : IconRobot; return <MenuRow key={value} selected={runMode === value} testId={value} onClick={() => { setRunMode(value); closeMenu() }}><ModeIcon size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t(modeKey(value))} hint={t(`agentResident.mode${value === 'ask' ? 'Ask' : value === 'editSelection' ? 'EditSelection' : 'Agent'}Hint`)} />{runMode === value ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}</MenuRow> })}<div className="my-1 border-t border-nomi-line-soft" /><div className="px-2 py-1 text-micro font-medium text-nomi-ink-40">{t('agentResident.approvalMode')}</div>{(['step', 'safe-auto', 'project'] as ProjectAgentApprovalMode[]).map((value) => <MenuRow key={value} selected={approvalPolicy.mode === value} testId={`approval-mode-${value}`} onClick={() => { setApprovalPolicy({ ...approvalPolicy, mode: value }); closeMenu() }}><IconLock size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={approvalModeLabel(value)} hint={t(`agentResident.${value === 'step' ? 'approvalModeStepHint' : value === 'safe-auto' ? 'approvalModeSafeAutoHint' : 'approvalModeProjectHint'}`)} />{approvalPolicy.mode === value ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}</MenuRow>)}<div className="my-1 border-t border-nomi-line-soft" /><div className="px-2 py-1 text-micro font-medium text-nomi-ink-40">{t('agentResident.spendPolicy')}</div>{(['confirm', 'within-budget'] as ProjectAgentSpendPolicy[]).map((value) => <MenuRow key={value} selected={approvalPolicy.spend === value} testId={`spend-policy-${value}`} onClick={() => { setApprovalPolicy({ ...approvalPolicy, spend: value }); closeMenu() }}><IconCoin size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={spendPolicyLabel(value)} hint={t(`agentResident.${value === 'confirm' ? 'spendPolicyConfirmHint' : 'spendPolicyWithinBudgetHint'}`)} />{approvalPolicy.spend === value ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}</MenuRow>)}<div className="my-1 border-t border-nomi-line-soft" /><div className="px-2 py-1 text-micro font-medium text-nomi-ink-40">{t('agentResident.skill')}</div><MenuRow selected={!activeSkill} testId="auto" onClick={() => { setActiveSkill(null); closeMenu() }}><IconTool size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.skillAuto')} />{!activeSkill ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}</MenuRow>{filteredSkills.map((skill) => <MenuRow key={skill.directoryName} selected={activeSkill?.key === skill.name} testId={skill.name} onClick={() => { setActiveSkill({ key: skill.name, name: skill.label }); closeMenu() }}><IconListCheck size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={skill.label} hint={skill.description ?? skill.stageLabels.join(' · ')} />{skillCapabilityFor(skill, availableSkillProviders).missing.length ? <IconAlertTriangle size={14} className="shrink-0 text-workbench-danger" /> : null}{activeSkill?.key === skill.name ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}</MenuRow>)}<MenuRow onClick={() => window.dispatchEvent(new Event('nomi-focus-skill-library'))}><IconSettings size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.skillManage')} /><IconChevronRight size={13} /></MenuRow></Popover></div>
            <div className="relative shrink-0"><button type="button" className={iconControlClass(menu === 'models')} aria-expanded={menu === 'models'} aria-haspopup="menu" data-agent-composer-model="true" aria-label={t('agentResident.modelSelect')} title={modelNeedsSelection ? t('agentResident.modelTitle') : selectedModelRow ? labelForModel(selectedModelRow, models, vendors) : t('agentResident.modelTitle')} onClick={() => setMenu(menu === 'models' ? null : 'models')}><IconRobot size={16} />{modelNeedsSelection ? <span className="absolute right-0 top-0 size-1.5 rounded-pill bg-workbench-danger" data-agent-model-alert="true" aria-hidden="true" /> : null}</button><Popover open={menu === 'models'} onClose={closeMenu} label={t('agentResident.modelMenuTitle')} className="w-[280px] max-w-[calc(100vw-24px)]">{models.length ? models.map((model) => { const value = encodeModelIdentity(model); return <MenuRow key={value} selected={selectedModel === value} testId={value} onClick={() => { setSelectedModel(value); const identity = decodeModelIdentity(value); if (identity) setAssistantModelPref(identity); closeMenu() }}><IconRobot size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={labelForModel(model, models, vendors)} />{selectedModel === value ? <IconCheck size={14} className="shrink-0 text-nomi-accent" /> : null}</MenuRow> }) : <MenuRow testId="catalog" onClick={() => window.dispatchEvent(new Event('nomi-open-model-catalog'))}><IconPlus size={16} className="shrink-0" /><MenuCopy label={t('generationCommon.parameters.selectTextModel')} hint={t('agentResident.modelMenuHint')} /></MenuRow>}</Popover></div>
            <div className="relative shrink-0"><button type="button" className={iconControlClass((promptModeId !== 'general' && !activeSkill) || Boolean(selectedLibraryPrompt))} aria-expanded={menu === 'prompts'} aria-haspopup="menu" data-agent-composer-prompt="true" aria-label={t('agentResident.promptSelect')} title={promptTitle} onClick={() => { setPromptSearch(''); setMenu(menu === 'prompts' ? null : 'prompts') }}><IconPencil size={16} /></button>{menu === 'prompts' ? <ResidentPromptMenu t={t} promptLibraryItems={visibleLibraryPrompts.nomi} userPromptItems={visibleLibraryPrompts.mine} loading={promptLibrary.loading || userPromptLibrary.loading} error={promptLibrary.error || userPromptLibrary.error} query={promptSearch} selectedLibraryPrompt={selectedLibraryPrompt} activeSkill={activeSkill} promptModeId={promptModeId} onQueryChange={setPromptSearch} onSelectPreset={selectPromptPreset} onSelectLibraryPrompt={selectLibraryPrompt} onReload={() => { promptLibrary.reload(); userPromptLibrary.reload() }} onClose={closeMenu} /> : null}</div>
            <span className="min-w-0 flex-1" aria-hidden="true" />
            <button type={runningTurn ? 'button' : 'submit'} disabled={!runningTurn && !draft.trim()} className={cn('grid size-8 shrink-0 place-items-center rounded-pill text-nomi-paper disabled:opacity-30', runningTurn ? 'bg-workbench-danger-soft text-workbench-danger' : 'bg-nomi-ink')} data-agent-composer-send="true" data-agent-stop={runningTurn ? 'true' : undefined} aria-label={runningTurn ? t('agentResident.stopAria') : t('agentResident.send')} title={runningTurn ? t('agentResident.stopAria') : t('agentResident.send')} onClick={runningTurn ? () => void stopTurn(runningTurn.turnId) : undefined}>{runningTurn ? <IconPlayerStopFilled size={15} aria-hidden="true" /> : <IconArrowUp size={16} />}</button>
          </div>
        </div>
        <Popover open={menu === 'references'} onClose={closeMenu} label={t('agentResident.mention')} className="w-[360px] max-w-[calc(100vw-24px)]">{assetPool.assets.length || !assetPool.loading ? <ResidentAtPicker assets={assetPool.assets} groups={[]} emptyTitle={t('agentResident.atEmptyTitle')} emptyDescription={t('agentResident.atEmptyDescription')} uploadLabel={t('agentResident.atUpload')} searchLabel={t('agentResident.atSearch')} onPickAsset={(asset) => addReference(buildResidentAssetReference(asset.id, asset.name))} onUpload={() => { window.dispatchEvent(new Event('nomi-open-files-panel')); closeMenu() }} /> : null}<div className="border-t border-nomi-line-soft pt-1">{!assetPool.assets.length && assetPool.loading ? <div className="px-2 py-2 text-micro text-nomi-ink-40">{t('agentResident.planLoading')}</div> : null}<MenuRow testId="canvas" onClick={() => addReference(buildResidentReference('canvas', t('agentResident.referenceCanvas'), { documentId: activeDocumentId, nodeIds: surface === 'generation' ? selectedNodeIds : [], clipIds: [] }))}><IconPhoto size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.referenceCanvas')} hint={t('agentResident.referenceCanvasHint')} /></MenuRow><MenuRow testId="document" onClick={() => addReference(buildResidentReference('document', t('agentResident.referenceDocument'), { documentId: activeDocumentId, nodeIds: [], clipIds: [] }))}><IconFileText size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.referenceDocument')} hint={t('agentResident.referenceDocumentHint')} /></MenuRow><MenuRow testId="preview" onClick={() => addReference(buildResidentReference('preview', t('agentResident.referencePreview'), { documentId: activeDocumentId, nodeIds: [], clipIds: surface === 'preview' ? selectedClipIds : [] }))}><IconVideo size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.referencePreview')} hint={t('agentResident.referencePreviewHint')} /></MenuRow><MenuRow testId="timeline" onClick={() => addReference(buildResidentReference('timeline', t('agentResident.referenceTimeline'), { documentId: activeDocumentId, nodeIds: [], clipIds: surface === 'preview' ? selectedClipIds : [] }))}><IconTimelineEvent size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.referenceTimeline')} hint={t('agentResident.referenceTimelineHint')} /></MenuRow><MenuRow testId="browser" onClick={() => addReference(buildResidentReference('browser', t('agentResident.referenceBrowser'), { documentId: activeDocumentId, nodeIds: [], clipIds: [] }))}><IconWorld size={16} className="shrink-0 text-nomi-ink-60" /><MenuCopy label={t('agentResident.referenceBrowser')} hint={t('agentResident.referenceBrowserHint')} /></MenuRow></div></Popover>
      </form>
    </div>
  </section>
}
