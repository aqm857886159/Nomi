import { IconPaperclip, IconPlayerStopFilled, IconSend2, IconX } from '@tabler/icons-react'
import { NomiAILabel, NomiLogoMark, NomiSelect, WorkbenchButton, WorkbenchIconButton } from '../../../design'
import React from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../../i18n'
import { cn } from '../../../utils/cn'
import { toast } from '../../../ui/toast'
import { sendGenerationCanvasAgentMessage, type ToolCallEvent } from '../agent/generationCanvasAgentClient'
import type { AgentChatHistory } from '../../../../electron/harness/agentChatContracts'
import { assertTurnCanWrite } from '../../ai/agentTurnLifecycle'
import { getActiveWorkbenchProjectId } from '../../project/workbenchProjectSession'
import { generationCanvasTools, readGenerationCanvasSnapshot } from '../agent/generationCanvasTools'
import { applyCanvasToolCall } from '../agent/applyCanvasToolCall'
import { applyProposalBatch } from '../agent/proposalTxn'
import {
  claimCanvasApprovalBatch,
  resolveCanvasApprovalSteps,
  type PendingCallStore,
  type CanvasApprovalRequest,
} from '../agent/canvasApprovalSteps'
import { evaluateGate } from '../agent/gate'
import { buildLockGateContext } from '../agent/lockGateContext'
import {
  buildFixationPlanningMessage,
  FIXATION_PLANNER_SKILL,
  FIXATION_PLANNING_EVENT,
  type FixationPlanningRequest,
} from '../agent/fixationLauncher'
import AssistantTimeline from './AssistantTimeline'
import { buildStepDetailLabels, countCreatedNodesByCategory, summarizeToolCall } from './toolCallSummary'
import { MemoryFold } from './MemoryFold'
import { createProposalReceiptCoordinator, runProposalUndo, useCommittedProposal } from '../agent/proposalUndo'
import type { ReconcileDeviation } from '../agent/reconcile'
import { useShotVerifyStore, buildContentFixMessage } from '../agent/shotVerifyStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { handleAiComposerKeyDown } from '../../ai/aiComposerKeyboard'
import { WorkbenchAiHeaderActions } from '../../ai/WorkbenchAiHeaderActions'
import AssistantModelPicker from '../../ai/AssistantModelPicker'
import { AttachmentRail } from '../../ai/composer/AttachmentRail'
import { AutoGrowTextarea } from '../../ai/composer/AutoGrowTextarea'
import { COMPOSER_ATTACHMENT_ACCEPT, useComposerAttachments } from '../../ai/composer/useComposerAttachments'
import type { ComposerAttachment } from '../../ai/composer/composerAttachmentTypes'
import { createProjectAgentThread } from '../../ai/projectAgentUiCommands'
import { useProjectAgentSnapshot, useProjectAgentThreadMessages } from '../../ai/useProjectAgentThreadMessages'
import { projectAgentAttachmentClaims } from '../../ai/projectAgentAttachments'
import { isProjectAgentLiveStatus } from '../../../../electron/shared/projectAgentContracts'
import {
  createProjectAgentPendingToolRegistry,
  createProjectAgentTurnHandle,
  stopProjectAgentTurn,
} from '../../ai/projectAgentTurnCommands'
import { projectAgentProjectionStore } from '../../ai/projectAgentProjectionStore'
import {
  canvasAssistantTimelineAnchor,
  type CanvasAssistantTimelineAnchor,
} from '../agent/canvasAssistantTimelineAnchor'

type PendingToolCall = Partial<CanvasAssistantTimelineAnchor> & {
  turnId: string
  subscriptionId?: string
  subscriptionEpoch?: number
  executionToken?: string
  toolCallId: string
  toolName: string
  args: unknown
  isPending: ToolCallEvent['isPending']
  /** 纯传输:把判决回给主进程(LLM 的 confirm 通道)。应用画布变更走 approveCalls 的事务批。 */
  confirm: ToolCallEvent['confirm']
}

/** 批准请求:plan card 把用户编辑过的字段作为 overrides 传回(S6-0 的 overridesDelta 来源)。 */
export type ApproveCallRequest = CanvasApprovalRequest

type CanvasAssistantPanelProps = {
  onCollapsedChange?: (collapsed: boolean) => void
}

// 文字里像「要动画布却没动」的意图特征——配合零工具发射判定「只说不做」，提示换模型。
const AGENT_ACTION_INTENT = /创建|生成|添加|新增|修改|删除|替换|连接|拆镜头|分镜|节点|我将|我会|我来|计划|操作/

// 「只说不做」提示:模型只回文字没发任何工具调用、但话里像要操作时追加(拼进消息正文=可见,走 i18n)。
const onlyTalkWarning = (): string => i18n.t('generationCommon.assistant.onlyTalkWarning')

// 截断提示:finishReason=length 且有正文 = 模型这条输出到达单次上限被切断(别把半截当完整)。
const truncatedWarning = (): string => i18n.t('generationCommon.assistant.truncatedWarning')
const EPHEMERAL_AGENT_HISTORY: AgentChatHistory = Object.freeze({ kind: 'ephemeral' })

function projectAgentTurnAnchor(turnId: string): CanvasAssistantTimelineAnchor | undefined {
  const items = projectAgentProjectionStore.getState().snapshot?.items ?? []
  const assistant = items.find((item) => item.turnId === turnId && item.kind === 'assistant')
  return assistant?.kind === 'assistant'
    ? Object.freeze({ anchorMessageId: assistant.itemId, anchorTextOffset: assistant.text.length })
    : undefined
}

export default function CanvasAssistantPanel({ onCollapsedChange }: CanvasAssistantPanelProps): JSX.Element {
  const { t } = useTranslation()
  const [mode, setMode] = React.useState<'agent' | 'chat' | 'refine'>('agent')
  // S6-3 对账偏差(N12):committed 但执行 ≠ 批准时弹卡;对账一致时恒 null(M1 零可见)。
  const [deviationReport, setDeviationReport] = React.useState<ReconcileDeviation[] | null>(null)
  // 时序内联:对账卡跟在本轮「卡前气泡」后(与 committed 同源,approveCalls 设)。
  const [deviationAnchor, setDeviationAnchor] = React.useState<CanvasAssistantTimelineAnchor | null>(null)
  // 镜级画面校验偏差(Stage 1,独立 store):生成完成后由 verifyShotsAndReport 写入,这里订阅显示。
  const contentDeviations = useShotVerifyStore((s) => s.deviations)
  const contentExhausted = useShotVerifyStore((s) => s.exhausted)
  const consumeVerifyRound = useShotVerifyStore((s) => s.consumeRound)
  const markVerifyFixing = useShotVerifyStore((s) => s.markFixing)
  const clearVerify = useShotVerifyStore((s) => s.clear)
  // S6-5:最近一笔已 commit 提议(整笔撤销/查看步骤入口;约束①存活到下一笔,③切项目清场)。
  const committedProposal = useCommittedProposal()
  // S9:每轮对话结束后递增,触发记忆卡重取(本轮新事件可能提炼出新事实)。
  const [memoryRefreshKey, setMemoryRefreshKey] = React.useState(0)
  const threadBottomRef = React.useRef<HTMLDivElement | null>(null)

  // Pending calls are indexed by Host subscription/epoch/execution identity;
  // this adapter exposes only the lookup/delete operations needed by the
  // approval transaction and does not create a second lifecycle owner.
  const pendingRegistryRef = React.useRef(createProjectAgentPendingToolRegistry<PendingToolCall>())
  const [pendingRegistryVersion, setPendingRegistryVersion] = React.useState(0)
  const projectAgentTurnRef = React.useRef<string | null>(null)
  const projectAgentCancelRef = React.useRef<(() => void) | null>(null)
  const projectAgentInvalidateRef = React.useRef<(() => void) | null>(null)

  /** 拒绝/传输专用:把判决直接回给 LLM 并移除卡片(批准走 approveCalls 的事务批)。 */
  const resolvePending = React.useCallback((toolCallId: string, decision: { ok: false; message?: string }) => {
    const target = pendingRegistryRef.current.find(toolCallId)?.value
    pendingRegistryRef.current.removeByToolCallId(toolCallId)
    setPendingRegistryVersion((version) => version + 1)
    if (target) void target.confirm(decision).catch(() => {})
  }, [])

  // S6-2 提议事务:批准 = 一笔原子批量(plan card 的 create+connect 共一个 proposalId)。
  // 实现挂在 turn 闭包里(要数 toolActionCount),组件层暴露稳定回调。
  const approveCallsRef = React.useRef<((requests: ApproveCallRequest[]) => Promise<void>) | null>(null)
  const approveCalls = React.useCallback((requests: ApproveCallRequest[]) => {
    void approveCallsRef.current?.(requests).catch(() => {})
  }, [])

  // 稳定引用:传给 AssistantTimeline→AgentPlanCard,使 React.memo(AgentPlanCard) 在流式吐字
  // 每帧重渲染时不被新函数引用打穿(原内联箭头每帧新建会让 memo 失效)。
  const rejectPending = React.useCallback(
    (toolCallId: string) => resolvePending(toolCallId, { ok: false, message: 'rejected by user' }),
    [resolvePending],
  )

  const pendingCallStore = React.useMemo<PendingCallStore<PendingToolCall>>(() => ({
    get: (toolCallId) => pendingRegistryRef.current.find(toolCallId)?.value,
    delete: (toolCallId) => {
      const exists = pendingRegistryRef.current.find(toolCallId) !== null
      pendingRegistryRef.current.removeByToolCallId(toolCallId)
      return exists
    },
  }), [])
  const draft = useGenerationCanvasStore((state) => state.generationAiDraft)
  const hostMessages = useProjectAgentThreadMessages()
  const hostSnapshot = useProjectAgentSnapshot()
  const activeCanvasTurnId = React.useMemo(() => {
    if (!hostSnapshot) return null
    return hostSnapshot.turns.find((turn) => {
      if (!isProjectAgentLiveStatus(turn.status) || turn.threadId !== hostSnapshot.activeThreadId) return false
      return hostSnapshot.queue.find((item) => item.turnId === turn.turnId)?.originSurface.kind === 'canvas'
    })?.turnId ?? null
  }, [hostSnapshot])
  const busy = Boolean(activeCanvasTurnId)
  const pendingToolCalls = React.useMemo(
    () => pendingRegistryRef.current.select(projectAgentProjectionStore.getState(), 'canvas'),
    [hostSnapshot, pendingRegistryVersion],
  )
  const [turnNotes, setTurnNotes] = React.useState<Readonly<Record<string, string>>>({})
  const messages = React.useMemo(
    () => hostMessages.map((message) => {
      const note = message.turnId ? turnNotes[message.turnId] : undefined
      return note && message.role === 'assistant' ? { ...message, content: `${message.content}${note}` } : message
    }),
    [hostMessages, turnNotes],
  )
  const activeThreadId = hostSnapshot?.activeThreadId ?? null
  const collapsed = useGenerationCanvasStore((state) => state.generationAiCollapsed)
  const setDraft = useGenerationCanvasStore((state) => state.setGenerationAiDraft)
  // 附件用组件本地态（不进 generationCanvasStore——它已是白名单巨壳，不再喂；附件本就 ephemeral，
  // 面板折叠时组件仍挂载，本地态不丢）。
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>([])
  const setCollapsed = useGenerationCanvasStore((state) => state.setGenerationAiCollapsed)
  React.useEffect(() => {
    if (hostSnapshot !== null) return
    projectAgentInvalidateRef.current?.()
    projectAgentInvalidateRef.current = null
    projectAgentTurnRef.current = null
    projectAgentCancelRef.current = null
    pendingRegistryRef.current.clear()
    setPendingRegistryVersion((version) => version + 1)
  }, [hostSnapshot])
  React.useEffect(() => {
    // Selecting against the current Host snapshot prunes terminal, stale,
    // cross-project, and old-thread entries. Hidden live entries stay indexed
    // so switching back to that thread restores the decision card.
    pendingRegistryRef.current.select(projectAgentProjectionStore.getState(), 'canvas')
  }, [hostSnapshot])
  React.useEffect(() => {
    setDeviationReport(null)
    setDeviationAnchor(null)
    setTurnNotes({})
  }, [activeThreadId])

  const {
    isDragging,
    openFilePicker,
    inputRef,
    onInputChange,
    removeAttachment,
    clearAttachments,
    handlePaste,
    dragHandlers,
  } = useComposerAttachments({ attachments, setAttachments })

  React.useEffect(() => {
    onCollapsedChange?.(collapsed)
  }, [collapsed, onCollapsedChange])

  // 贴底跟随（P1 流式 layout thrash + 抢滚动）：旧实现每次 messages 变(流式每帧)都强制
  // scrollIntoView → ① 每帧同步 layout；② 用户上翻读历史时被一把拽回底部。改成 IntersectionObserver
  // 观察底部哨兵：在底部(哨兵可见)才自动滚跟随，上翻(哨兵被滚出裁剪)即停。滚动容器裁剪 overflow，
  // 故 viewport-root IO 即能判「是否滚到底」，无需额外容器 ref。
  const [stickToBottom, setStickToBottom] = React.useState(true)
  React.useEffect(() => {
    const sentinel = threadBottomRef.current
    if (collapsed || !sentinel || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setStickToBottom(entry.isIntersecting), {
      rootMargin: '0px 0px 80px 0px', // 距底 80px 内都算「在底部」
    })
    io.observe(sentinel)
    return () => io.disconnect()
  }, [collapsed])
  React.useEffect(() => {
    if (collapsed || !stickToBottom) return
    threadBottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, pendingToolCalls, deviationReport, contentDeviations, collapsed, stickToBottom])

  type SubmitMessageOptions = {
    skill?: { key: string; name: string }
    displayMessage?: string
  }

  const submitAgentMessage = React.useCallback(
    (text: string, options: SubmitMessageOptions = {}) => {
      const readyAttachments = attachments.filter((item) => item.status === 'ready' && item.url)
      if ((!text && !readyAttachments.length) || busy) return
      const projectId = getActiveWorkbenchProjectId()
      const snapshot = readGenerationCanvasSnapshot()
      const selectedNodes = generationCanvasTools.read_selected_nodes()
      const launchHistory = EPHEMERAL_AGENT_HISTORY
      const launchMode = mode
      const hostTurnId = `turn-canvas-${globalThis.crypto.randomUUID()}`
      const turnSession = createProjectAgentTurnHandle(hostTurnId)
      const handle = turnSession.handle
      projectAgentTurnRef.current = hostTurnId
      projectAgentInvalidateRef.current = turnSession.invalidate
      setDraft('')
      clearAttachments()
      const attachmentClaims = projectAgentAttachmentClaims(readyAttachments)
      void (async () => {
        // S6-2 提议事务批:用户点「确认」后整批原子应用——全成 committed,中途失败补偿回滚
        // (零半截)。先落地后回话:LLM 收到的每步成败与画布事实一致。
        approveCallsRef.current = async (requests: ApproveCallRequest[]) => {
          const approval = claimCanvasApprovalBatch(requests, pendingCallStore, handle, hostTurnId)
          if (!approval) return
          const { items, rawSteps, owner, timelineAnchor } = approval
          // 立即摘卡防双击;事务结果经 transport 回 LLM,卡不复原(与既有 resolve 即摘一致)。
          setPendingRegistryVersion((version) => version + 1)
          try {
            const steps = await resolveCanvasApprovalSteps(rawSteps, owner.canWrite)
            assertTurnCanWrite(owner.canWrite)
            const categoryCounts = countCreatedNodesByCategory(steps)
            const receiptCoordinator = createProposalReceiptCoordinator({
              summary: steps.map((step) => summarizeToolCall(step.toolName, step.effectiveArgs)).join(' · '),
              stepLabels: steps.flatMap((step) => buildStepDetailLabels(step.toolName, step.effectiveArgs)),
              ...(categoryCounts.length ? { categoryCounts } : {}),
              ...timelineAnchor,
            })
            const outcome = await applyProposalBatch(
              steps.map(({ toolCallId, toolName, effectiveArgs }) => ({ toolCallId, toolName, effectiveArgs })),
              owner,
              receiptCoordinator,
            )
            if (!handle.canWrite()) return
            if (outcome.status === 'committed') {
              // 回执和对账卡复用审批 batch 捕获的同一个 canonical Host item+offset 锚点。
              // S6-3 对账(N12):执行 ≠ 批准 → 弹偏差卡(per-field diff+一键整笔撤销);一致则零可见。
              if (!outcome.reconciliation.ok) {
                setDeviationReport(outcome.reconciliation.deviations)
                setDeviationAnchor(timelineAnchor ?? null)
              }
              // S6-5 整笔撤销唯一入口 = committed 卡(约束①,存活到下一笔)。落点回报靠卡内分类 chip。
              // 旧实现额外弹一个「整笔撤销」toast 当第二入口——每次 commit 都弹、和卡内入口重复,
              // 即用户反馈的「多余弹窗」,已删(单一入口,不再两套风格/两处冒泡)。
              // 无可补偿的提议(如 run_generation_batch 受理——网络调用收不回)不出撤销入口,不误导。
              // 回执已经在 applyProposalBatch 内完成 prepare→Canvas apply→commit；只有 durable commit
              // 得到确认后才会走到这里并向 LLM 回 success，避免画布已落地但 Undo 证据尚未落盘。
              for (let index = 0; index < steps.length; index += 1) {
                if (!handle.canWrite()) return
                const step = steps[index]
                await step.transport({
                  ok: true,
                  result: outcome.results[index],
                  effectiveArgs: step.effectiveArgs,
                  ...(step.overridesDelta ? { overridesDelta: step.overridesDelta } : {}),
                  proposalId: outcome.proposalId,
                })
              }
            } else {
              // 整笔失败:每步如实回话(LLM 可重新规划),画布已由补偿回滚到提议前(I3)。
              for (let index = 0; index < steps.length; index += 1) {
                if (!handle.canWrite()) return
                const message =
                  index === outcome.failedIndex
                    ? outcome.reason
                    : index < outcome.failedIndex
                      ? `已回滚:第 ${outcome.failedIndex + 1} 步(${steps[outcome.failedIndex].toolName})失败——${outcome.reason}`
                      : `未执行:第 ${outcome.failedIndex + 1} 步失败,整批已回滚`
                await steps[index].transport({ ok: false, message })
              }
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            toast(message, 'error')
            for (const { call } of items)
              await call
                .confirm({ ok: false, message, ...(!handle.canWrite() ? { denied: true } : {}) })
                .catch(() => {})
          }
        }
        try {
          const result = await sendGenerationCanvasAgentMessage({
            turnId: hostTurnId,
            projectId: projectId ?? undefined,
            history: launchHistory,
            capability:
              launchMode === 'chat' ? 'canvas-chat' : launchMode === 'refine' ? 'canvas-refine' : 'canvas-agent',
            canWrite: handle.canWrite,
            message: text || '请看这些附件',
            ...(options.displayMessage ? { displayMessage: options.displayMessage } : {}),
            ...(attachmentClaims.length ? { attachmentClaims } : {}),
            snapshot,
            selectedNodes,
            mode: launchMode,
            skill: options.skill,
            onCancelReady: (cancel) => {
              projectAgentCancelRef.current = cancel
            },
            onToolError: ({ toolCallId }) => {
              const call = pendingRegistryRef.current.find(toolCallId)?.value
              if (call?.turnId !== hostTurnId) return
              pendingRegistryRef.current.removeByToolCallId(toolCallId)
              setPendingRegistryVersion((version) => version + 1)
            },
            onToolCall: async (event: ToolCallEvent) => {
              const canWrite = () => handle.canWrite() && event.isPending()
              if (!canWrite()) {
                await event.confirm({ ok: false, denied: true, message: 'canvas turn ended' })
                return
              }
              const gate = evaluateGate(
                { kind: 'tool-call', toolName: event.toolName, args: event.args },
                buildLockGateContext(),
              )
              if (gate.outcome === 'deny') {
                await event.confirm({ ok: false, message: gate.reason, denied: true })
                return
              }
              if (gate.outcome === 'allow') {
                try {
                  const result = await applyCanvasToolCall(event.toolName, event.args, undefined, canWrite)
                  assertTurnCanWrite(canWrite)
                  if (event.toolName === 'propose_edit_plan' && result && typeof result === 'object') {
                    captureTimelinePreview({ toolCallId: event.toolCallId, toolName: event.toolName, args: event.args, anchorMessageId: anchorId }, result)
                  }
                  await event.confirm({ ok: true, result, silent: true })
                } catch (error: unknown) {
                  const code = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined
                  await event.confirm({
                    ok: false,
                    message: error instanceof Error ? error.message : String(error),
                    ...(typeof code === 'string' ? { code } : {}),
                  })
                }
                return
              }
              // ask:写/破坏性操作排队。卡片只保存 canonical Host item 锚点，
              // confirm 纯传输，批准仍走 approveCalls 的事务批。
              const timelineAnchor = canvasAssistantTimelineAnchor(event.assistantTextAnchor)
                ?? projectAgentTurnAnchor(event.turnId)
              const pendingCall: PendingToolCall = {
                turnId: event.turnId,
                subscriptionId: event.subscriptionId,
                subscriptionEpoch: event.subscriptionEpoch,
                executionToken: event.executionToken,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args,
                isPending: event.isPending,
                confirm: event.confirm,
                ...timelineAnchor,
              }
              const projection = projectAgentProjectionStore.getState()
              const currentSnapshot = projection.snapshot
              const currentTurn = currentSnapshot?.turns.find((candidate) => candidate.turnId === event.turnId)
              if (!currentSnapshot || !currentTurn || projection.subscriptionId === null || projection.subscriptionEpoch === null) return
              pendingRegistryRef.current.install({
                type: 'tool-call',
                subscriptionId: event.subscriptionId ?? projection.subscriptionId,
                subscriptionEpoch: event.subscriptionEpoch ?? projection.subscriptionEpoch,
                binding: currentSnapshot.binding,
                turnId: event.turnId,
                executionToken: event.executionToken ?? currentTurn.executionToken,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args,
              }, pendingCall)
              setPendingRegistryVersion((version) => version + 1)
            },
          })
          if (!handle.isCurrent()) return
          const finalText = result.response.text?.trim() || ''
          // Main-owned canvas.read never emits a renderer pending event, but it
          // is still present in the canonical final response tool-call list.
          const warn =
            result.response.toolCalls.length === 0 && launchMode === 'agent' && AGENT_ACTION_INTENT.test(finalText)
          // 截断只在「模型真出了正文又被切断」时提示(空文本+length 是弱模型空响应,backend 已另说人话)。
          const truncated = result.response.finishReason === 'length' && finalText !== ''
          const note = finalText
            ? `${warn ? onlyTalkWarning() : ''}${truncated ? truncatedWarning() : ''}`
            : result.response.toolCalls.length === 0 && result.response.status !== 'cancelled'
              ? i18n.t('generationCommon.assistant.completed')
              : ''
          if (note) {
            setTurnNotes((current) => ({ ...current, [hostTurnId]: note }))
          }
        } catch {
          // Runtime failures are committed as canonical Host failure items.
        } finally {
          turnSession.invalidate()
          approveCallsRef.current = null
          setMemoryRefreshKey((key) => key + 1)
          if (projectAgentTurnRef.current === hostTurnId) {
            projectAgentTurnRef.current = null
            projectAgentCancelRef.current = null
            projectAgentInvalidateRef.current = null
          }
        }
      })()
    },
    [attachments, busy, clearAttachments, mode, pendingCallStore, setDraft],
  )

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitAgentMessage(draft.trim())
  }

  // 注：分镜规划的触发已收口到创作区 runStoryboardPlanner（流程 A：就地跑、不弹来生成区）。
  // 原 STORYBOARD_PLANNING_EVENT 事件桥已随之删除（P1 不留死路径）。定妆仍走事件桥（见下）。

  // Tier2 定妆/定景：创作区「💄 定妆」触发 → 跑 fixation planner skill，按剧本建角色/场景卡 +
  // 注入身份板提示词（与 storyboard 同构）。
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<FixationPlanningRequest>).detail
      const storyText = detail?.storyText?.trim() || ''
      if (!storyText) return
      setCollapsed(false)
      const message = buildFixationPlanningMessage(storyText)
      submitAgentMessage(message, {
        skill: FIXATION_PLANNER_SKILL,
        displayMessage: `💄 定妆\n\n${storyText}`,
      })
    }
    window.addEventListener(FIXATION_PLANNING_EVENT, handler as EventListener)
    return () => window.removeEventListener(FIXATION_PLANNING_EVENT, handler as EventListener)
  }, [setCollapsed, submitAgentMessage])

  const handleNewConversation = React.useCallback(() => {
    const activeTurnId = projectAgentTurnRef.current
    const cancel = projectAgentCancelRef.current
    cancel?.()
    if (!cancel && activeTurnId) void stopProjectAgentTurn(activeTurnId).catch(() => undefined)
    projectAgentInvalidateRef.current?.()
    projectAgentInvalidateRef.current = null
    projectAgentTurnRef.current = null
    projectAgentCancelRef.current = null
    setDeviationReport(null)
    setDeviationAnchor(null)
    // 会话历史:归档当前线程(不销毁),建空活动线程,清消息投影;startNewConversation 内部清整笔撤销入口。
    void createProjectAgentThread().catch(() => undefined)
    setDraft('')
    clearAttachments()
  }, [clearAttachments, setDraft])

  if (collapsed) {
    return (
      <aside
        className={cn('generation-canvas-v2-assistant', 'block w-auto h-auto rounded-full')}
        data-collapsed="true"
        aria-label={t('generationCommon.assistant.launcherAria')}
      >
        <WorkbenchButton
          className={cn(
            'generation-canvas-v2-assistant__launcher',
            'inline-flex items-center gap-2 h-9 pl-[10px] pr-[14px]',
            'border border-nomi-line rounded-full',
            'bg-nomi-paper text-nomi-ink font-[inherit] text-body-sm font-medium',
            'shadow-nomi-sm cursor-pointer',
            'hover:shadow-nomi-md hover:-translate-y-px',
          )}
          onClick={() => setCollapsed(false)}
        >
          <NomiAILabel markSize={18} wordSize={13} suffix="生成" />
        </WorkbenchButton>
      </aside>
    )
  }

  return (
    <aside
      className={cn(
        'generation-canvas-v2-assistant',
        // flexbox 而非 grid-rows-[…minmax(0,1fr)…] 任意值——后者在本环境解析异常，
        // 把工具条行撑成 145px 留出 ~120px 空白（用户反馈"上面空这么大"的真凶）。
        // 停靠展开时外层 grid 列宽从 0 动到目标宽；面板本体固定按目标宽排版并贴右侧，
        // 只让外层裁切露出，避免文字在 20px→340px 的中间宽度里反复换行。
        'relative flex flex-col w-[var(--generation-assistant-target-width,340px)] h-full justify-self-end',
        'max-h-none min-w-[var(--generation-assistant-target-width,340px)] min-h-0 overflow-hidden',
        'border-0 rounded-none bg-nomi-paper shadow-none',
        'max-[900px]:w-[min(340px,calc(100vw-28px))]',
        'max-[900px]:min-w-0',
        'max-[900px]:max-h-[calc(100vh-var(--workbench-topbar-height)-var(--workbench-timeline-height)-32px)]',
        'max-[900px]:border max-[900px]:border-nomi-line max-[900px]:rounded-nomi max-[900px]:shadow-nomi-lg',
      )}
      data-collapsed="false"
      aria-label={t('generationCommon.assistant.panelAria')}
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
          <div>{t('generationCommon.assistant.dropAttachments')}</div>
          <div className={cn('text-micro font-normal text-nomi-ink-60')}>
            {t('generationCommon.assistant.attachmentLimits')}
          </div>
        </div>
      ) : null}
      {/* 头部：Nomi 标 + 「助手」+ 动作（含 token 计数）+ 收起。 */}
      <header
        className={cn(
          'flex items-center justify-between gap-2 px-3 py-2',
          'border-b border-nomi-line-soft bg-nomi-paper',
        )}
      >
        <div className={cn('flex items-center gap-2 min-w-0')}>
          <NomiLogoMark size={18} />
          {/* 审计 A14：与入口词「生成」一致，不再裸叫「助手」 */}
          <span className={cn('text-body-sm font-semibold text-nomi-ink')}>
            {t('generationCommon.assistant.title')}
          </span>
        </div>
        <div className={cn('inline-flex items-center gap-2 ml-auto min-w-0')}>
          <WorkbenchAiHeaderActions
            className={cn(
              'generation-canvas-v2-assistant__shared-actions',
              'inline-flex items-center flex-nowrap gap-1',
            )}
            actionClassName={cn(
              'size-6 inline-grid place-items-center',
              'p-0 border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            onNewConversation={handleNewConversation}
          />
          <WorkbenchIconButton
            className={cn(
              'size-6 inline-grid place-items-center',
              'p-0 border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            label={t('generationCommon.assistant.collapse')}
            onClick={() => setCollapsed(true)}
            icon={<IconX size={14} />}
          />
        </div>
      </header>
      <MemoryFold refreshKey={memoryRefreshKey} />
      {/* 制作任务不再挂这里：它的家是任务中心（顶栏常驻、任何视图可开）。助手面板只和 Nomi 聊画布，
          不再让两套操作相邻（plan 2026-08-11-nomi-side-viewer-and-fallback N2）。 */}
      <AssistantTimeline
        messages={messages}
        staleBoundaryId={null}
        onSuggestion={submitAgentMessage}
        pendingToolCalls={pendingToolCalls}
        approveCalls={approveCalls}
        rejectPending={rejectPending}
        committedProposal={committedProposal}
        deviationReport={deviationReport}
        deviationAnchor={deviationAnchor}
        onDeviationUndo={() => {
          // 整笔撤销单机制(S6-5):补偿事务回退本笔,期间用户工作保留。
          if (committedProposal) {
            void runProposalUndo(committedProposal)
              .then(() => {
                setDeviationReport(null)
                setDeviationAnchor(null)
              })
              .catch((error: unknown) => toast(error instanceof Error ? error.message : String(error), 'error'))
          } else {
            useGenerationCanvasStore.getState().undo()
            setDeviationReport(null)
            setDeviationAnchor(null)
          }
        }}
        onRetry={() => {
          // 错误卡「重试」= 重发上一条用户消息(网络/服务商抖动等瞬时错误的直接出路)。
          const lastUser = [...messages].reverse().find((message) => message.role === 'user')
          if (lastUser) submitAgentMessage(lastUser.content)
        }}
        onDeviationDismiss={() => {
          setDeviationReport(null)
          setDeviationAnchor(null)
        }}
        onDeviationAiFix={() => {
          // 让 AI 读画布、用所选模型支持的方式把没接上的参考连接重连(或换支持的模型)。
          submitAgentMessage(
            '刚才有几条参考连接没接上（所选模型不支持那种连接方式）。请先读画布，把这些没连上的参考连接，用所选模型支持的连接方式重连；如果模型确实不支持，就换成支持的模型再连。',
          )
          setDeviationReport(null)
          setDeviationAnchor(null)
        }}
        contentDeviations={contentDeviations}
        contentExhausted={contentExhausted}
        onContentAiFix={() => {
          // 半自动·每轮确认(Stage 2):消耗一轮预算;到顶则不发(卡片已落「已尽力」)。
          if (!consumeVerifyRound()) return
          // 发修复消息走 agent 现成「确认才生成」路径(改 prompt/重生坏镜),不另建付费 loop。
          submitAgentMessage(buildContentFixMessage(contentDeviations))
          // 暂藏卡(AI 干活中);重生完成后再跑一轮 verify 重新填充。markFixing 不动预算(区别于收敛重置)。
          markVerifyFixing()
        }}
        onContentDismiss={() => clearVerify()}
        timelinePlanPreviews={timelinePlanPreviews}
        timelineApplied={timelineApplied}
        onTimelineUndo={() => { void undoTimelinePlan() }}
        threadBottomRef={threadBottomRef}
      />
      <form className={cn('grid gap-1 p-3 border-t border-nomi-line-soft bg-nomi-paper')} onSubmit={handleSubmit}>
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
        <AttachmentRail attachments={attachments} onRemove={removeAttachment} className={cn('mb-1')} />
        <AutoGrowTextarea
          className={cn(
            // 对齐样张 .input：带边框圆角输入盒。
            'min-h-14 px-2 py-2 rounded-nomi',
            'border border-nomi-line focus:border-nomi-accent',
            'bg-nomi-paper text-nomi-ink text-body-sm leading-[1.45]',
            'placeholder:text-nomi-ink-40',
          )}
          aria-label={t('generationCommon.assistant.inputAria')}
          placeholder={t('generationCommon.assistant.placeholder')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) =>
            handleAiComposerKeyDown(event, () => {
              event.currentTarget.form?.requestSubmit()
            })
          }
          onPaste={handlePaste}
        />
        <div className={cn('flex items-center justify-between gap-2')}>
          <div className={cn('flex items-center gap-2 flex-1 min-w-0')}>
            <WorkbenchIconButton
              type="button"
              className={cn(
                'size-7 grid place-items-center shrink-0',
                'border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
                'hover:bg-nomi-ink-05 hover:text-nomi-ink',
              )}
              label={t('generationCommon.assistant.addAttachment')}
              aria-label={t('generationCommon.assistant.addAttachmentAria')}
              onClick={openFilePicker}
              icon={<IconPaperclip size={16} />}
            />
            <NomiSelect
              ariaLabel={t('generationCommon.assistant.modeAria')}
              leadingLabel={t('generationCommon.assistant.modeLeading')}
              size="sm"
              value={mode}
              options={[
                { value: 'agent', label: 'Agent' },
                { value: 'chat', label: t('generationCommon.assistant.chat') },
                { value: 'refine', label: t('generationCommon.assistant.refine') },
              ]}
              onChange={(value) => setMode(value as 'agent' | 'chat' | 'refine')}
            />
            <AssistantModelPicker className="h-7" />
          </div>
          {busy ? (
            <WorkbenchIconButton
              type="button"
              onClick={() => {
                const turnId = activeCanvasTurnId ?? projectAgentTurnRef.current
                if (turnId) void stopProjectAgentTurn(turnId).catch(() => {})
                else projectAgentCancelRef.current?.()
              }}
              className={cn(
                'size-7 grid place-items-center shrink-0',
                'border-0 rounded-full bg-nomi-ink text-nomi-paper cursor-pointer',
                'hover:enabled:bg-nomi-accent',
              )}
              label={t('generationCommon.assistant.stop')}
              aria-label={t('generationCommon.assistant.stopAria')}
              icon={<IconPlayerStopFilled size={13} />}
            />
          ) : (
            <WorkbenchIconButton
              type="submit"
              className={cn(
                'size-7 grid place-items-center shrink-0',
                'border-0 rounded-full bg-nomi-ink text-nomi-paper cursor-pointer',
                'hover:enabled:bg-nomi-accent',
                'disabled:bg-nomi-ink-20 disabled:text-nomi-ink-40 disabled:cursor-not-allowed',
              )}
              disabled={!draft.trim() && !attachments.some((item) => item.status === 'ready')}
              label={t('generationCommon.assistant.send')}
              aria-label={t('generationCommon.assistant.sendAria')}
              icon={<IconSend2 size={15} />}
            />
          )}
        </div>
      </form>
    </aside>
  )
}
