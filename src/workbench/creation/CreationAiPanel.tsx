import React from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { IconCornerDownLeft, IconCursorText, IconFilePlus, IconMaximize, IconMinimize, IconPaperclip, IconPlayerStopFilled, IconReplace, IconSend2, IconX } from '@tabler/icons-react'
import { NomiLogoMark, WorkbenchButton, WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import type { AgentChatHistory } from '../../../electron/harness/agentChatContracts'
import { AssistantMessageView, UserMessageBubble } from '../ai/AssistantMessageView'
import { NoTextModelRecoveryCard } from '../ai/NoTextModelRecoveryCard'
import { AssistantErrorCard } from '../ai/AssistantErrorCard'
import { useHasTextModel } from '../library/useHasTextModel'
import AssistantModelPicker from '../ai/AssistantModelPicker'
import StoryboardPlanCard from './storyboard/StoryboardPlanCard'
import StoryboardActionCard from './storyboard/StoryboardActionCard'
import { handleAiComposerKeyDown } from '../ai/aiComposerKeyboard'
import { extractStoryFromRequest, routeCreationIntent } from './creationIntentRouting'
import { WorkbenchAiHeaderActions } from '../ai/WorkbenchAiHeaderActions'
import CreationPromptPicker from '../ai/CreationPromptPicker'
import { MemoryFold } from '../generationCanvas/components/MemoryFold'
import { useWorkbenchStore } from '../workbenchStore'
import { runStoryboardPlanner } from '../generationCanvas/agent/runStoryboardPlanner'
import { requestFixationPlanning } from '../generationCanvas/agent/fixationLauncher'
import {
  buildCreationAiPrompt,
  extractWorkbenchDocumentText,
  getCreationAiMode,
  modeAllowsIntentRouting,
  modeAllowsWriteTools,
  type CreationAiModeId,
} from './creationAiModes'
import { writeToolLabelKey } from './creationAiReplyText'
import { useSystemPromptOverrides } from './useSystemPromptOverrides'
import { useTransientScrollingClass } from './useTransientScrollingClass'
import type { PendingDocToolCall, WriteToolName } from './creationToolContracts'
import { createCreationToolHandler } from './creationToolCalls'
import { getActiveWorkbenchProjectId } from '../project/workbenchProjectSession'
import { AttachmentRail } from '../ai/composer/AttachmentRail'
import { AutoGrowTextarea } from '../ai/composer/AutoGrowTextarea'
import { COMPOSER_ATTACHMENT_ACCEPT, useComposerAttachments } from '../ai/composer/useComposerAttachments'
import StoryboardNudge from './storyboard/StoryboardNudge'
import type { ProjectAgentExecutionEvent } from '../../../electron/shared/projectAgentContracts'
import {
  createProjectAgentPendingToolRegistry,
  enqueueProjectAgentTurn,
  decideProjectAgentTool,
  stopProjectAgentTurn,
  subscribeProjectAgentEvents,
  createProjectAgentTurnHandle,
} from '../ai/projectAgentTurnCommands'
import { createProjectAgentThread } from '../ai/projectAgentUiCommands'
import type { AgentTurnHandle } from '../ai/agentTurnLifecycle'
import { useProjectAgentSnapshot, useProjectAgentThreadMessages } from '../ai/useProjectAgentThreadMessages'
import { projectAgentAttachmentClaims } from '../ai/projectAgentAttachments'
import { isProjectAgentLiveStatus } from '../../../electron/shared/projectAgentContracts'
import { projectAgentProjectionStore } from '../ai/projectAgentProjectionStore'
import type { WorkbenchAiMessage } from '../ai/workbenchAiTypes'

const CREATION_PROJECT_AGENT_TOOL_NAMES = new Set([
  'read_full_text',
  'read_selection',
  'author_skill',
  'insert_at_cursor',
  'replace_selection',
  'append_to_end',
])

const EPHEMERAL_AGENT_HISTORY: AgentChatHistory = Object.freeze({ kind: 'ephemeral' })

export default function CreationAiPanel({ onCollapse }: { onCollapse?: () => void } = {}): JSX.Element {
  const { t } = useTranslation()
  const [memoryRefreshKey, setMemoryRefreshKey] = React.useState(0)
  const [expanded, setExpanded] = React.useState(false)
  const messagesScrollRef = useTransientScrollingClass<HTMLDivElement>('workbench-scrollbar-visible')
  const workbenchDocuments = useWorkbenchStore((state) => state.workbenchDocuments)
  const activeDocumentId = useWorkbenchStore((state) => state.activeDocumentId)
  const workbenchDocument = React.useMemo(
    () => workbenchDocuments.find((d) => d.id === activeDocumentId) ?? workbenchDocuments[0],
    [workbenchDocuments, activeDocumentId],
  )
  const documentTools = useWorkbenchStore((state) => state.creationDocumentTools)
  const selectedText = useWorkbenchStore((state) => state.creationSelectionText)
  const modeId = useWorkbenchStore((state) => state.creationAiModeId)
  const activeSkill = useWorkbenchStore((state) => state.creationActiveSkill)
  const setActiveSkill = useWorkbenchStore((state) => state.setCreationActiveSkill)
  const draft = useWorkbenchStore((state) => state.creationAiDraft)
  const hostMessages = useProjectAgentThreadMessages()
  const hostSnapshot = useProjectAgentSnapshot()
  const pendingRegistryRef = React.useRef(createProjectAgentPendingToolRegistry<PendingDocToolCall>())
  const [pendingRegistryVersion, setPendingRegistryVersion] = React.useState(0)
  const [localPendingToolCalls, setLocalPendingToolCalls] = React.useState<PendingDocToolCall[]>([])
  const activeDocumentTurnId = React.useMemo(() => {
    const snapshot = hostSnapshot
    if (!snapshot) return null
    return snapshot.turns.find((candidate) => {
      if (!isProjectAgentLiveStatus(candidate.status)) return false
      const queue = snapshot.queue.find((item) => item.turnId === candidate.turnId)
      return queue?.originSurface.kind === 'document' && candidate.threadId === snapshot.activeThreadId
    })?.turnId ?? null
  }, [hostSnapshot])
  const sending = Boolean(activeDocumentTurnId)
  const prevSendingRef = React.useRef(sending)
  React.useEffect(() => {
    if (prevSendingRef.current && !sending) setMemoryRefreshKey((key) => key + 1)
    prevSendingRef.current = sending
  }, [sending])
  const hostPendingToolCalls = React.useMemo(
    () => pendingRegistryRef.current.select(projectAgentProjectionStore.getState(), 'document'),
    [hostSnapshot, pendingRegistryVersion],
  )
  const pendingToolCalls = React.useMemo(
    () => [...hostPendingToolCalls, ...localPendingToolCalls],
    [hostPendingToolCalls, localPendingToolCalls],
  )
  const [localActionMessages, setLocalActionMessages] = React.useState<WorkbenchAiMessage[]>([])
  const messages = React.useMemo(
    () => [...hostMessages, ...localActionMessages],
    [hostMessages, localActionMessages],
  )
  // 分镜方案卡挂在「产出它的那条消息」下面（治「卡片跟着对话跑」）。取**最后一条**带标消息：
  // 改方案会新产出一条带标的，卡片随之前移，永远只显示一张。
  // 两种没有锚的情形（都不是 fallback，是「方案在本线程里没有家」这个事实的诚实呈现）：
  //   ① 老项目：方案早于本次改动产生，消息上没有标；
  //   ② 用户点了「新对话」：消息清空但方案是项目级的，仍在。
  // 这时把卡片放在列表**顶部**当常驻产物，而不是放回尾部——放尾部就是把这个 bug 又请回来了。
  const storyboardPlans = useWorkbenchStore((state) => state.storyboardPlans)
  const storyboardDesigns = useWorkbenchStore((state) => state.storyboardDesignsByDocumentId)
  // 当前文档的分镜方案条目（P4：按 documentId 取，切文档切方案）。
  const storyboardEntry = activeDocumentId ? storyboardPlans[activeDocumentId] : undefined
  const storyboardPlan = storyboardEntry?.plan ?? null
  const storyboardAnchor = React.useMemo(() => {
    if (!storyboardPlan) return null
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (!message.storyboardPlan) continue
      if (message.storyboardDocumentId && message.storyboardDocumentId !== activeDocumentId) continue
      if (message.storyboardDesignId
        && !storyboardDesigns[activeDocumentId]?.some((design) => design.id === message.storyboardDesignId)) continue
      return message
    }
    return null
  }, [activeDocumentId, messages, storyboardDesigns, storyboardPlan])
  // Issue #9：agent 报错且目录里没有 enabled 文本模型 → 报错气泡换成「缺大脑」恢复卡（判真实状态非匹配串）。
  // recoveryShownIds：某条报错已进入恢复卡后「黏住」——一键启用使 hasTextModel 翻 true 也不卸载卡片，
  // 让它能展示自己的「大脑已就位」done 态，而不是露出旧报错文本。
  const { hasTextModel, refresh: refreshTextModel } = useHasTextModel()
  const [recoveryShownIds, setRecoveryShownIds] = React.useState<ReadonlySet<string>>(() => new Set())
  // resolvedActionIds：某张动作卡已被点过开跑 → 按钮置灰防重复触发（仿 recoveryShownIds 黏住态）。
  const [resolvedActionIds, setResolvedActionIds] = React.useState<ReadonlySet<string>>(() => new Set())
  const attachments = useWorkbenchStore((state) => state.creationAiAttachments)
  const error = useWorkbenchStore((state) => state.creationAiError)
  const setDraft = useWorkbenchStore((state) => state.setCreationAiDraft)
  const setAttachments = useWorkbenchStore((state) => state.setCreationAiAttachments)
  const setError = useWorkbenchStore((state) => state.setCreationAiError)
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)
  const setModeId = useWorkbenchStore((state) => state.setCreationAiModeId)
  const setStoryboardPlannerLauncher = useWorkbenchStore((state) => state.setStoryboardPlannerLauncher)
  React.useEffect(() => {
    setLocalActionMessages([])
    setResolvedActionIds(new Set())
  }, [hostSnapshot?.binding.immutableProjectUuid, hostSnapshot?.binding.projectGeneration, hostSnapshot?.activeThreadId])
  const {
    isDragging,
    openFilePicker,
    inputRef,
    onInputChange,
    removeAttachment,
    clearAttachments,
    handlePaste,
    dragHandlers,
  } = useComposerAttachments({ attachments, setAttachments, onError: setError })

  // Keep a live ref so the tool-call handler always sees the freshest editor
  // tools without re-creating `send` on every editor remount.
  const documentToolsRef = React.useRef(documentTools)
  documentToolsRef.current = documentTools
  const projectAgentTurnRef = React.useRef<string | null>(null)
  const projectAgentCancelRef = React.useRef<(() => void) | null>(null)
  const projectAgentInvalidateRef = React.useRef<(() => void) | null>(null)

  // 订阅设置里改过的系统提示词：覆盖到货/变更即重渲，activeMode 随之拿到最新有效提示词（发送路径同源）。
  useSystemPromptOverrides()
  const activeMode = getCreationAiMode(modeId as CreationAiModeId)
  // 同理:send 是空依赖 useCallback（稳定），不能直接闭包 activeSkill/activeMode（会捕获首渲染的旧值
  // → 点「AI 写技能」后 send 永远看不到）。用 live ref 让 send 取最新的技能选择。
  const skillSelRef = React.useRef({ activeSkill, activeMode })
  skillSelRef.current = { activeSkill, activeMode }
  const documentText = React.useMemo(() => extractWorkbenchDocumentText(workbenchDocument), [workbenchDocument])

  // ProjectAgentHost owns execution; this panel only adapts its live tool
  // notifications into the existing confirmation card view.
  React.useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = subscribeProjectAgentEvents((event: ProjectAgentExecutionEvent) => {
        if (disposed || event.type === 'patch') return
        if (event.type === 'tool-call' && !CREATION_PROJECT_AGENT_TOOL_NAMES.has(event.toolName)) return
        if (event.type === 'execution-error') return
        if (event.type !== 'tool-call') return
        const hostTurn = projectAgentProjectionStore.getState().snapshot?.turns.find((candidate) => candidate.turnId === event.turnId)
        if (!hostTurn || hostTurn.executionToken !== event.executionToken) return
        const hostTurnIsLive = () => {
          const current = projectAgentProjectionStore.getState().snapshot?.turns.find((candidate) => candidate.turnId === event.turnId)
          return Boolean(current && ['queued', 'drafting', 'proposed', 'running'].includes(current.status) && current.executionToken === event.executionToken)
        }
        const transportHandle: AgentTurnHandle = {
          id: 0,
          isCurrent: hostTurnIsLive,
          canWrite: hostTurnIsLive,
          isCancelled: () => !hostTurnIsLive(),
        }
        projectAgentTurnRef.current = event.turnId
        const confirm = (decision: Parameters<typeof decideProjectAgentTool>[0]['decision']) =>
          decideProjectAgentTool({ turnId: event.turnId, toolCallId: event.toolCallId, decision })
        const toolEvent = {
          turnId: event.turnId,
          subscriptionId: event.subscriptionId,
          subscriptionEpoch: event.subscriptionEpoch,
          executionToken: event.executionToken,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          isPending: hostTurnIsLive,
          confirm,
        }
        void createCreationToolHandler({
          turn: transportHandle,
          allowsWrite: modeAllowsWriteTools(skillSelRef.current.activeMode),
          enqueue: (call) => {
            pendingRegistryRef.current.install(event, call)
            setPendingRegistryVersion((version) => version + 1)
          },
          skillSaveFailed: () => t('creationAi.skillSaveFailed'),
        })(toolEvent).catch((error: unknown) => {
          void confirm({ ok: false, message: error instanceof Error ? error.message : String(error) }).catch(() => {})
        })
      })
    } catch {
      unsubscribe = undefined
    }
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [t])
  React.useEffect(() => {
    if (hostSnapshot !== null) return
    projectAgentInvalidateRef.current?.()
    projectAgentInvalidateRef.current = null
    projectAgentTurnRef.current = null
    projectAgentCancelRef.current = null
    pendingRegistryRef.current.clear()
    setPendingRegistryVersion((version) => version + 1)
  }, [hostSnapshot])

  const resolvePending = React.useCallback((
    toolCallId: string,
    decision: { ok: true; result?: unknown } | { ok: false; message?: string },
  ) => {
    const entry = pendingRegistryRef.current.find(toolCallId)
    if (entry) pendingRegistryRef.current.removeByToolCallId(toolCallId)
    else {
      const local = localPendingToolCalls.find((call) => call.toolCallId === toolCallId)
      if (local) void local.confirm(decision).catch(() => {})
      setLocalPendingToolCalls((current) => current.filter((call) => call.toolCallId !== toolCallId))
    }
    setPendingRegistryVersion((version) => version + 1)
    if (entry) void entry.value.confirm(decision).catch(() => {})
  }, [localPendingToolCalls])

  // The Host owns the actual editor mutation. This card only records the
  // user's approval; the bound Surface adapter executes the same decision in
  // main and returns a canonical write receipt.
  const applyWriteTool = React.useCallback((call: PendingDocToolCall) => {
    if (!pendingToolCalls.some((pending) => pending.toolCallId === call.toolCallId)) return
    resolvePending(call.toolCallId, { ok: true })
  }, [pendingToolCalls, resolvePending])
  const writeToolIcon = React.useCallback((name: WriteToolName) => {
    if (name === 'insert_at_cursor') return <IconCursorText size={13} />
    if (name === 'replace_selection') return <IconReplace size={13} />
    return <IconFilePlus size={13} />
  }, [])

  const launchStoryboardPlanning = React.useCallback((displayPrompt: string = t('creationAi.storyboardCommand'), revisionRequest?: string, shotMode: 'image' | 'video' | 'image-video' = 'image') => {
    if (activeDocumentTurnId) return
    const projectId = getActiveWorkbenchProjectId()
    const history = EPHEMERAL_AGENT_HISTORY
    // P0-9 Slice 3：已有未落画布的方案 + 用户给了修改要求 → 进「改方案」模式（基于现方案改，不从头拆）。
    const store = useWorkbenchStore.getState()
    // Capture both identities before the first await. Switching resources while
    // planning must never redirect the result into another draft or design.
    const documentId = store.activeDocumentId
    const storyboardId = store.activeStoryboardId ?? undefined
    const currentDesign = storyboardId
      ? store.storyboardDesignsByDocumentId[documentId]?.find((design) => design.id === storyboardId)
      : undefined
    const currentPlan = currentDesign?.plan ?? null
    const isRevision = Boolean(currentPlan && !currentDesign?.committed && revisionRequest?.trim())
    const revisionStoryboardId = isRevision ? storyboardId : undefined
    const liveDocumentText = documentToolsRef.current?.readFullText() || documentText
    const docStory = (selectedText || liveDocumentText).trim()
    // 编辑器为空但用户把故事打在了对话里 → 用对话正文，并补写进文稿（单一真相源），别让他把已经敲过的故事再搬一遍。
    const chatStory = docStory ? '' : extractStoryFromRequest(displayPrompt)
    if (chatStory) {
      const toolCallId = `local-script-draft-creation_ai_assistant_${globalThis.crypto.randomUUID()}`
      setLocalPendingToolCalls((current) => [...current, {
        toolCallId,
        toolName: 'append_to_end',
        content: chatStory,
        confirm: async (decision) => {
          if (!decision.ok) return
          launchStoryboardPlanning(displayPrompt, undefined, shotMode)
        },
      }])
      return
    }
    const storyText = docStory || chatStory
    if (!isRevision && !storyText) {
      setError(t('creationAi.writeStoryFirst'))
      return
    }
    setDraft('')
    setError('')
    // 流程 A：就地跑规划师（不切到生成区）。产出 propose_storyboard_plan 落创作 store →
    // 主列展开分镜方案编辑器；规划阶段全程免费、不碰画布（runStoryboardPlanner 的 onToolCall 守卫）。
    const hostTurnId = `turn-creation-${globalThis.crypto.randomUUID()}`
    const turnSession = createProjectAgentTurnHandle(hostTurnId)
    const handle = turnSession.handle
    projectAgentInvalidateRef.current = turnSession.invalidate
    projectAgentTurnRef.current = hostTurnId
    void (async () => {
      try {
        const { text, status, application } = await runStoryboardPlanner({
          target: 'creation', history, projectId: projectId ?? undefined, canWrite: handle.canWrite,
          turnId: hostTurnId,
          displayPrompt,
          documentId,
          ...(revisionStoryboardId ? { storyboardId: revisionStoryboardId } : {}),
          // 首拆带分镜模式（图片/视频，动作卡上选，默认图片）；改方案不带——保留现方案每镜已定的 shotKind。
          ...(isRevision ? { currentPlan, revisionRequest } : { storyText, shotMode }),
          onCancelReady: (cancel) => { projectAgentCancelRef.current = cancel },
        })
        if (!handle.isCurrent()) return // 轮次已被切项目/新对话作废:别把旧项目内容写进新项目
        // Planner output is projected by ProjectAgentHost; the storyboard store
        // remains the durable result surface for the editor card.
      } catch (error: unknown) {
        if (!handle.isCurrent()) return
        const canonicalFailure = projectAgentProjectionStore.getState().snapshot?.items.some(
          (item) => item.turnId === hostTurnId && item.kind === 'failure',
        )
        if (canonicalFailure) return
        // 存**原始**错误串（不再包一层中文前缀）——错误态统一由 AssistantErrorCard /
        // NoTextModelRecoveryCard 渲染，它们内部走 classifyGenerationError 分类成人话；提前包
        // 「拆镜头失败：<原串>」会污染 provider 原话抽取，且把英文散句直接怼到用户脸上（2026-08-25 走查）。
        const rawMessage = error instanceof Error && error.message ? error.message : t('creationAi.unknownError')
        setError(handle.isCancelled() ? '' : rawMessage)
      } finally {
        turnSession.invalidate()
        if (projectAgentTurnRef.current === hostTurnId) {
          projectAgentTurnRef.current = null
          projectAgentCancelRef.current = null
          projectAgentInvalidateRef.current = null
        }
      }
    })()
  }, [activeDocumentTurnId, documentText, selectedText, setDraft, setError, t])
  React.useEffect(() => {
    setStoryboardPlannerLauncher(launchStoryboardPlanning)
  }, [launchStoryboardPlanning, setStoryboardPlannerLauncher])
  // Tier2 定妆：把剧本交给 AI，按剧本为主要角色/场景建卡 + 注入身份板提示词（与拆镜头同构）。
  const launchFixationPlanning = React.useCallback((_displayPrompt: string = t('creationAi.fixationCommand')) => {
    const projectId = getActiveWorkbenchProjectId()
    const storyText = (selectedText || documentText).trim()
    if (!storyText) {
      setError(t('creationAi.writeScriptFirst'))
      return
    }
    setDraft('')
    setError('')
    setWorkspaceMode('generation')
    window.setTimeout(() => {
      if (getActiveWorkbenchProjectId() !== projectId) return
      requestFixationPlanning({ storyText, source: 'creation-ai-panel' })
    }, 60)
  }, [documentText, selectedText, setDraft, setError, setWorkspaceMode, t])

  const send = React.useCallback(async (textOverride?: string) => {
    if (activeDocumentTurnId) return
    const projectId = getActiveWorkbenchProjectId()
    const selection = skillSelRef.current
    const allowsWrite = modeAllowsWriteTools(selection.activeMode)
    const userRequest = (textOverride ?? draft).trim()
    // 附件还在上传就发送 = 静默丢弃在途附件（clearAttachments 会连 uploading 一起清）。
    // 拦下并提示用户稍候,等就绪再发,绝不悄悄把用户附的文件吞掉。
    if (attachments.some((item) => item.status === 'uploading')) {
      setError(t('creationAi.attachmentsUploading'))
      return
    }
    const readyAttachments = attachments.filter((item) => item.status === 'ready' && item.url)
    if (!userRequest && !selectedText && !documentText && !readyAttachments.length) return
    // P0-9 Slice 3：有未落画布的方案 + 用户给了自然语言要求 → 视为对现方案的修改要求
    // （「全部加负面词 / 统一冷调 / 第 3 镜改特写」等），交规划师基于现方案改、保留其余。
    // P4：按当前文档取方案，避免切文档后误改别篇的方案。send 内直读 store，保持依赖稳定。
    const liveStore = useWorkbenchStore.getState()
    const selectedDesign = liveStore.activeStoryboardId
      ? liveStore.storyboardDesignsByDocumentId[liveStore.activeDocumentId]?.find((design) => design.id === liveStore.activeStoryboardId)
      : undefined
    if (selectedDesign && !selectedDesign.committed && userRequest) {
      launchStoryboardPlanning(userRequest, userRequest)
      return
    }
    // 对话驱动（删固定 chip，用户拍板 2026-06-13）：自然语言意图 → 甩给画布 agent。
    // 跳过意图路由的两种「用户已明确选了路」的情形（B1 分工讲清，2026-06-22）：
    //  ① 锁定了 active skill（如「AI 写技能」）；
    //  ② 选了任何**专职模式**（素材规划/文字稿/提示词/审校）——他已经指了路，别再劫走。
    // 2026-08-17 根因修正：②原来硬编码成 `id === 'storyboard'`，于是「素材规划」漏在守卫外——
    // 用户选了素材规划、说一句带「画面/场景/镜头」的话就被劫持去拆分镜（用户实测反馈）。
    // 改读模式自己的能力声明 modeAllowsIntentRouting，新增专职模式自动受保护，不会再漏这一类。
    const skipIntentRouting = Boolean(skillSelRef.current.activeSkill) || !modeAllowsIntentRouting(skillSelRef.current.activeMode)
    const intent = skipIntentRouting ? null : routeCreationIntent(userRequest)
    if (intent) {
      // 识别到跨面板意图 → 不再静默直接开跑，推一张可见的动作卡（治隐形）：
      // 用户看见「看起来你想拆镜头 → [按钮]」，点按钮才真正落画布。口径放宽后这里召回更高，
      // 误判只是多一张可忽略的卡、不会误触动作（点了才跑），所以放心放宽（治脆）。
      const userId = `creation_ai_user_${globalThis.crypto.randomUUID()}`
      const actionId = `creation_ai_assistant_${globalThis.crypto.randomUUID()}`
      setLocalActionMessages((prev) => [
        ...prev,
        { id: userId, role: 'user', content: userRequest || (intent === 'storyboard' ? t('creationAi.storyboardCommand') : t('creationAi.fixationCommand')) },
        { id: actionId, role: 'assistant', content: '', status: 'done' as const, action: { kind: intent, prompt: userRequest } },
      ])
      setDraft('')
      setError('')
      return
    }
    const prompt = buildCreationAiPrompt({ mode: activeMode, userRequest })
    const displayPrompt = userRequest || (readyAttachments.length
      ? t('creationAi.attachmentPrompt')
      : t('creationAi.processDocument', { mode: t(`creationAi.mode.${activeMode.id}.label` as 'creationAi.mode.general.label') }))
    const attachmentClaims = projectAgentAttachmentClaims(readyAttachments)
    const documentState = liveStore.creationDocumentTools?.readState()
    const documentTarget = {
      kind: 'document' as const,
      documentId: activeDocumentId,
      anchor: documentState?.anchor ?? { kind: 'whole-document' as const },
    }
    setDraft('')
    clearAttachments()
    setError('')
    const hostTurnId = `turn-creation-${globalThis.crypto.randomUUID()}`
    const turnSession = createProjectAgentTurnHandle(hostTurnId)
    const handle = turnSession.handle
    projectAgentInvalidateRef.current = turnSession.invalidate
    const canonicalRequest = {
      prompt,
      displayPrompt,
      capability: allowsWrite ? 'creation-editor' as const : 'creation-chat' as const,
      history: { kind: 'ephemeral' as const },
      projectId: projectId ?? undefined,
      skillKey: selection.activeSkill ? selection.activeSkill.key : `workbench.creation.${selection.activeMode.id}`,
      skillName: selection.activeSkill
        ? selection.activeSkill.name
        : t(`creationAi.mode.${selection.activeMode.id}.title` as 'creationAi.mode.general.title'),
    }
    projectAgentTurnRef.current = hostTurnId
    try {
      const result = await enqueueProjectAgentTurn({
        turnId: hostTurnId,
        request: canonicalRequest,
        displayPrompt,
        ...(attachmentClaims.length ? { attachmentClaims } : {}),
        target: documentTarget,
        ...(documentState ? { preconditions: { document: { revision: documentState.revision, contentHash: documentState.contentHash } } } : {}),
        originSurface: { surfaceId: 'creation-ai-panel', kind: 'document' },
      })
      projectAgentTurnRef.current = result.turnId
      const status = result.state.turns.find((candidate) => candidate.turnId === result.turnId)?.status
      if (status && !['queued', 'drafting', 'proposed', 'running'].includes(status)) {
        projectAgentTurnRef.current = null
        turnSession.invalidate()
        projectAgentCancelRef.current = null
        projectAgentInvalidateRef.current = null
      }
    } catch (err) {
      if (!handle.isCurrent()) return // 轮次已被作废:错误属于旧项目,丢弃不写
      setError(err instanceof Error ? err.message : t('creationAi.callFailed'))
      turnSession.invalidate()
      projectAgentTurnRef.current = null
      projectAgentCancelRef.current = null
      projectAgentInvalidateRef.current = null
    } finally {
      turnSession.invalidate()
      if (projectAgentTurnRef.current === hostTurnId) {
        projectAgentTurnRef.current = null
        projectAgentCancelRef.current = null
        projectAgentInvalidateRef.current = null
      }
    }
  }, [activeDocumentTurnId, activeMode, attachments, clearAttachments, documentText, draft, launchStoryboardPlanning, setDraft, setError, selectedText, t])

  // 通用创作动作，贴 Nomi 视频创作调性、不绑小说题材（旧的「悬疑开场/童话语气」在产品/宣传项目里调性错配）。
  const suggestions = React.useMemo(() => [
    t('creationAi.suggestion.opening'),
    t('creationAi.suggestion.visual'),
    t('creationAi.suggestion.storyboard'),
  ], [t])

  const handleNewConversation = React.useCallback(() => {
    // 新对话 = 抛弃在途轮次:中止流 + 作废 token(迟到回调不再写) + 拒绝清空待批写卡。
    const activeTurnId = projectAgentTurnRef.current
    projectAgentCancelRef.current?.()
    if (!projectAgentCancelRef.current && activeTurnId) void stopProjectAgentTurn(activeTurnId).catch(() => undefined)
    projectAgentTurnRef.current = null
    projectAgentCancelRef.current = null
    projectAgentInvalidateRef.current?.()
    projectAgentInvalidateRef.current = null
    // Host-owned pending calls stay indexed across a thread switch. The
    // selector hides them while the new thread is active and restores them if
    // the user returns before the Host turn reaches a terminal state.
    setLocalPendingToolCalls([])
    setLocalActionMessages([])
    setResolvedActionIds(new Set())
    // 会话历史:归档当前线程(不销毁),建空活动线程,清面板消息投影。
    void createProjectAgentThread().catch(() => undefined)
    // 清 session 态(draft/附件/error 不落盘,不入线程)。
    setDraft('')
    clearAttachments()
    setError('')
  }, [clearAttachments, setDraft, setError])

  const panelBody = (
    <aside
      className={cn(
        'workbench-creation-ai',
        'relative grid grid-cols-[minmax(0,1fr)] grid-rows-[44px_auto_minmax(0,1fr)_auto_auto]',
        '[grid-template-areas:"header"_"tools"_"messages"_"error"_"composer"]',
        'min-w-0 min-h-0 overflow-hidden',
        expanded && 'h-[86vh] w-[min(760px,92vw)] rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-lg',
      )}
      aria-label={t('creationAi.panelAria')}
      {...dragHandlers}
    >
      {isDragging ? (
        <div
          className={cn(
            'absolute inset-1.5 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none',
            'rounded-nomi border-2 border-dashed border-nomi-accent bg-nomi-accent-soft',
            'text-body-sm font-semibold text-nomi-accent',
          )}
          aria-hidden="true"
        >
          <IconPaperclip size={26} stroke={1.5} />
          <div>{t('creationAi.dropAttachments')}</div>
          <div className={cn('text-micro font-normal text-nomi-ink-60')}>{t('creationAi.attachmentLimits')}</div>
        </div>
      ) : null}
      <header
        className={cn(
          'workbench-creation-ai__header',
          '[grid-area:header] flex items-center justify-between gap-[10px] min-w-0',
        )}
      >
        {/* 头部：Nomi 标 + 「助手」+ 动作（含 token 计数）。 */}
        <div className={cn('workbench-creation-ai__title', 'inline-flex items-center gap-2 min-w-0')}>
          <NomiLogoMark size={18} />
          {/* 审计 A14：与入口词「创作」一致，不再裸叫「助手」 */}
          <span className={cn('text-body-sm font-semibold text-nomi-ink')}>{t('creationAi.title')}</span>
        </div>
        {/* 提示词选择器已挪到 composer 发送键左边（用户 2026-08-18 拍板）——那里才是「马上要发这一句」
            的决策位，和模型选择器并排。头部这颗不再保留：同一功能两个家 = P1/§1.5 一功能一个家。 */}
        <div className={cn('inline-flex items-center gap-2 ml-auto min-w-0')}>
          <WorkbenchAiHeaderActions
            className={cn('inline-flex items-center flex-nowrap gap-1')}
            actionClassName={cn(
              'size-6 inline-grid place-items-center shrink-0',
              'p-0 border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            onNewConversation={handleNewConversation}
          />
          <WorkbenchIconButton
            className={cn(
              'size-6 inline-grid place-items-center shrink-0',
              'p-0 border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            label={expanded ? t('creationAi.shrink') : t('creationAi.expandConversation')}
            aria-label={expanded ? t('creationAi.shrinkAria') : t('creationAi.expandAria')}
            onClick={() => setExpanded((value) => !value)}
            icon={expanded ? <IconMinimize size={15} /> : <IconMaximize size={15} />}
          />
          {onCollapse ? (
            <WorkbenchIconButton
              className={cn(
                'size-6 inline-grid place-items-center shrink-0',
                'p-0 border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
                'hover:bg-nomi-ink-05 hover:text-nomi-ink',
              )}
              label={t('creationAi.collapse')}
              aria-label={t('creationAi.collapseAria')}
              onClick={onCollapse}
              icon={<IconX size={15} />}
            />
          ) : null}
        </div>
      </header>

      <div className={cn('[grid-area:tools] min-w-0')}>
        {/* 对齐画布助手:项目记忆「AI 记得 N 条」(N=0 不渲染);删工具条(与记忆条重复的灰杠)。 */}
        <MemoryFold refreshKey={memoryRefreshKey} />
        {/* 情景卡自动浮现：写好故事还没拆镜头时，把「拆成镜头」入口在对的时机端到眼前（治「没有可点入口」）。
            2026-08-17 补漏：专职模式（素材规划等）下不浮——它和上面的意图路由是同一件事的两个入口，
            只堵路由不堵这张卡，用户选了素材规划照样会看见「拆成镜头」被推到脸上（同一根因的第二个出口）。 */}
        <StoryboardNudge
          busy={sending}
          allowed={modeAllowsIntentRouting(activeMode) && !activeSkill}
          onRun={(shotMode) => launchStoryboardPlanning(t('creationAi.storyboardCommand'), undefined, shotMode)}
        />
      </div>

      <div
        ref={messagesScrollRef}
        className={cn(
          'workbench-creation-ai__messages',
          '[grid-area:messages] min-h-0 overflow-auto',
          'flex flex-col gap-3',
        )}
        aria-live="polite"
      >
        {/* 方案在本线程里没有锚（老项目 / 点过「新对话」）→ 当常驻产物钉在顶部，不放回尾部。 */}
        {storyboardPlan && !storyboardAnchor ? <StoryboardPlanCard documentId={activeDocumentId} /> : null}
        {messages.length === 0 && pendingToolCalls.length === 0 && !storyboardPlan ? (
          <div className={cn(
            'flex h-full flex-col items-center justify-center gap-2',
            'max-w-[240px] mx-auto py-6 px-3 text-center',
          )}>
            <div className={cn('text-nomi-ink font-nomi-display text-title font-medium')}>{t('creationAi.inspirationTitle')}</div>
            <div className={cn('text-nomi-ink-60 text-body-sm leading-relaxed')}>
              {t('creationAi.inspirationDescription')}
            </div>
            <div className={cn('flex flex-col gap-1.5 w-full mt-2')}>
              {suggestions.map((suggestion) => (
                <WorkbenchButton
                  key={suggestion}
                  className={cn(
                    'w-full min-h-9 py-2 px-3 border border-transparent rounded-nomi',
                    'flex items-center justify-between gap-2 text-left font-normal',
                    'bg-nomi-ink-05 text-nomi-ink-80 cursor-pointer',
                    'hover:border-nomi-line hover:bg-nomi-paper hover:text-nomi-ink',
                  )}
                  onClick={() => void send(suggestion)}
                >
                  <span className={cn('min-w-0')}>{suggestion}</span>
                  <IconCornerDownLeft size={13} className={cn('shrink-0 text-nomi-ink-40')} />
                </WorkbenchButton>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <React.Fragment key={message.id}>
              {message.role === 'user' ? (
                <UserMessageBubble content={message.content} attachments={message.attachments} />
              ) : message.action ? (
                <StoryboardActionCard
                  kind={message.action.kind}
                  resolved={resolvedActionIds.has(message.id)}
                  onRun={(shotMode) => {
                    if (resolvedActionIds.has(message.id)) return
                    setResolvedActionIds((prev) => new Set(prev).add(message.id))
                    const prompt = message.action!.prompt
                    setLocalActionMessages([])
                    if (message.action!.kind === 'storyboard') launchStoryboardPlanning(prompt || t('creationAi.storyboardCommand'), undefined, shotMode)
                    else launchFixationPlanning(prompt || t('creationAi.fixationCommand'))
                  }}
                />
              ) : message.status === 'error' && (hasTextModel === false || recoveryShownIds.has(message.id)) ? (
                <NoTextModelRecoveryCard
                  onResolved={() => {
                    setRecoveryShownIds((prev) => new Set(prev).add(message.id))
                    refreshTextModel()
                  }}
                />
              ) : message.status === 'error' || message.content.startsWith(t('creationAi.errorPrefix')) ? (
                // 缺大脑(上一分支)外的一般错误 → 红色错误卡(人话+重试/去模型接入),与生成侧同一张卡。
                <AssistantErrorCard
                  error={message.content}
                  onRetry={() => {
                    const lastUser = [...messages].reverse().find((item) => item.role === 'user')
                    if (lastUser) void send(lastUser.content)
                  }}
                />
              ) : (
                <AssistantMessageView
                  content={message.status === 'pending' ? '' : message.content}
                  attachments={message.attachments}
                  streaming={message.status === 'pending' || message.status === 'streaming'}
                  pendingLabel={message.status === 'pending' ? message.content : undefined}
                  cancelled={message.status === 'cancelled'}
                />
              )}
              {message.id === storyboardAnchor?.id ? <StoryboardPlanCard documentId={activeDocumentId} storyboardId={message.storyboardDesignId} /> : null}
            </React.Fragment>
          ))
        )}

        {pendingToolCalls.length > 0 ? (
          <div className={cn('workbench-creation-ai__tool-calls', 'flex flex-col gap-2 p-[10px_11px]')}>
            {pendingToolCalls.map((call) => (
              <div
                key={call.toolCallId}
                className={cn(
                  'workbench-creation-ai__tool-call',
                  'flex flex-col gap-2 p-3 rounded-nomi border border-nomi-accent-soft bg-nomi-accent-soft/40',
                )}
                data-tool-call-id={call.toolCallId}
              >
                <div className={cn('workbench-creation-ai__tool-call-head', 'inline-flex items-center gap-[6px] text-nomi-accent text-caption font-medium')}>
                  {writeToolIcon(call.toolName)}
                  {t(writeToolLabelKey(call.toolName))}
                </div>
                <div className={cn('workbench-creation-ai__tool-call-body', 'max-h-[160px] overflow-auto text-nomi-ink text-body-sm leading-[1.5] whitespace-pre-wrap')}>
                  {call.content || t('creationAi.emptyContent')}
                </div>
                <div className={cn('flex items-center justify-end gap-2 mt-1')}>
                  <WorkbenchButton
                    className={cn('h-7 px-3 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-80 text-caption cursor-pointer hover:bg-nomi-ink-05')}
                    onClick={() => resolvePending(call.toolCallId, { ok: false, message: 'rejected by user' })}
                  >
                    {t('creationAi.reject')}
                  </WorkbenchButton>
                  <WorkbenchButton
                    className={cn('h-7 px-3 rounded-nomi-sm border-0 bg-nomi-ink text-nomi-paper text-caption cursor-pointer hover:bg-nomi-accent disabled:cursor-not-allowed disabled:opacity-45')}
                    data-primary="true"
                    disabled={!documentTools}
                    onClick={() => applyWriteTool(call)}
                  >
                    {t('creationAi.apply')}
                  </WorkbenchButton>
                </div>
              </div>
            ))}
          </div>
        ) : null}

      </div>

      {error ? (
        <div
          className={cn(
            'workbench-creation-ai__error',
            '[grid-area:error] py-2 px-3 min-w-0',
            'border-t border-[color-mix(in_srgb,var(--workbench-danger)_16%,transparent)]',
            'bg-workbench-danger-soft text-workbench-danger',
            'text-caption leading-[1.45]',
          )}
        >
          {error}
        </div>
      ) : null}

      <footer className={cn('workbench-creation-ai__composer', '[grid-area:composer] min-w-0')}>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={COMPOSER_ATTACHMENT_ACCEPT}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={onInputChange}
        />
        <AttachmentRail attachments={attachments} onRemove={removeAttachment} className={cn('mb-2')} />
        <AutoGrowTextarea
          className={cn(
            // 与画布助手输入框同一套 Tailwind（不再走 workbench-ai.css 的 !important 覆写）。
            'min-h-14 px-2 py-2 rounded-nomi',
            'border border-nomi-line focus:border-nomi-accent',
            'bg-nomi-paper text-nomi-ink text-body-sm leading-[1.45]',
            'placeholder:text-nomi-ink-40',
          )}
          value={draft}
          placeholder={t('creationAi.placeholder')}
          aria-label={t('creationAi.inputAria')}
          // tour 锚点从已删的「拆镜头」chip 迁到输入框——引导改为「教用对话触发」。
          data-tour="storyboard-cta"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => handleAiComposerKeyDown(event, () => void send())}
          onPaste={handlePaste}
        />
        <div className={cn('workbench-creation-ai__actions', 'flex items-center justify-between')}>
          {/* 左侧：附件 + 工作方式 + 模型选择。内部模式不再占一个难懂的下拉。 */}
          <div className={cn('flex items-center gap-1.5 flex-1 min-w-0')}>
            <WorkbenchIconButton
              className={cn(
                'size-7 grid place-items-center shrink-0',
                'border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
                'hover:bg-nomi-ink-05 hover:text-nomi-ink',
              )}
              label={t('creationAi.addAttachment')}
              aria-label={t('creationAi.addAttachmentAria')}
              onClick={openFilePicker}
              icon={<IconPaperclip size={16} />}
            />
            {/* 「用哪段提示词」和「用哪个模型」是同一层决策（都作用于马上要发的这一句），并排放。 */}
            <CreationPromptPicker
              activeSkill={activeSkill}
              modeId={modeId}
              onModeChange={setModeId}
              onSelect={setActiveSkill}
            />
            <AssistantModelPicker />
          </div>
          {/* 拆镜头 / 立角色卡 不再做固定执行 chip（用户拍板：对话驱动）——
              用户在输入框直接说「拆成 6 个镜头」「把这个故事做成视频」「给主角立张定妆卡」即可，
              意图由 send() 的 pattern 路由给画布 agent（发现性靠 placeholder + tour 引导）。 */}
          {sending ? (
            <WorkbenchIconButton
              className={cn(
                'size-7 grid place-items-center shrink-0',
                'border-0 rounded-full bg-nomi-ink text-nomi-paper cursor-pointer',
                'hover:enabled:bg-nomi-accent',
              )}
              label={t('creationAi.stop')}
              aria-label={t('creationAi.stopAria')}
              onClick={() => {
                const turnId = activeDocumentTurnId ?? projectAgentTurnRef.current
                if (turnId) void stopProjectAgentTurn(turnId).catch(() => {})
                else projectAgentCancelRef.current?.()
              }}
              icon={<IconPlayerStopFilled size={13} />}
            />
          ) : (
            <WorkbenchIconButton
              className={cn(
                'size-7 grid place-items-center shrink-0',
                'border-0 rounded-full bg-nomi-ink text-nomi-paper cursor-pointer',
                'hover:enabled:bg-nomi-accent',
                'disabled:bg-nomi-ink-20 disabled:text-nomi-ink-40 disabled:cursor-not-allowed',
              )}
              label={t('creationAi.send')}
              aria-label={t('creationAi.sendAria')}
              disabled={!draft.trim()}
              onClick={() => void send()}
              icon={<IconSend2 size={15} />}
            />
          )}
        </div>
      </footer>
    </aside>
  )

  if (!expanded || typeof document === 'undefined') return panelBody
  return createPortal(
    <div
      className={cn('fixed inset-0 z-[200] grid place-items-center bg-[var(--workbench-backdrop)] p-4')}
      onClick={(event) => {
        if (event.target === event.currentTarget) setExpanded(false)
      }}
    >
      {panelBody}
    </div>,
    document.body,
  )
}
