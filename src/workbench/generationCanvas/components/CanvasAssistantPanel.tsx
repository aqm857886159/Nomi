import { IconPaperclip, IconPlayerStopFilled, IconSend2, IconX } from '@tabler/icons-react'
import { NomiAILabel, NomiLogoMark, NomiSelect, WorkbenchButton, WorkbenchIconButton } from '../../../design'
import React from 'react'
import { cn } from '../../../utils/cn'
import {
  sendGenerationCanvasAgentMessage,
  type ToolCallEvent,
} from '../agent/generationCanvasAgentClient'
import { workbenchSessionKey } from '../../ai/workbenchAgentRunner'
import { startNewConversation } from '../../ai/conversationPersistence'
import { clearWorkbenchAgentSession } from '../../../api/desktopClient'
import { generationCanvasTools } from '../agent/generationCanvasTools'
import { applyCanvasToolCall } from '../agent/applyCanvasToolCall'
import { applyProposalBatch } from '../agent/proposalTxn'
import { listAvailableModelsForAgent } from '../agent/availableModels'
import { resolvePlannedNodeArgs } from '../agent/plannedNodeMeta'
import { partitionConnectableEdges, type PlannedEdgeLike } from '../agent/referenceEdgeCapability'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
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
import { runProposalUndo, setCommittedProposal, useCommittedProposal } from '../agent/proposalUndo'
import type { ReconcileDeviation } from '../agent/reconcile'
import { useShotVerifyStore, buildContentFixMessage } from '../agent/shotVerifyStore'
import type { WorkbenchAiMessage } from '../../ai/workbenchAiTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { handleAiComposerKeyDown } from '../../ai/aiComposerKeyboard'
import { WorkbenchAiHeaderActions } from '../../ai/WorkbenchAiHeaderActions'
import AssistantModelPicker from '../../ai/AssistantModelPicker'
import { useStaleConversationBoundary } from '../../ai/staleConversationDivider'
import { AttachmentRail } from '../../ai/composer/AttachmentRail'
import { AutoGrowTextarea } from '../../ai/composer/AutoGrowTextarea'
import { COMPOSER_ATTACHMENT_ACCEPT, useComposerAttachments } from '../../ai/composer/useComposerAttachments'
import type { ComposerAttachment } from '../../ai/composer/composerAttachmentTypes'

type PendingToolCall = {
  toolCallId: string
  toolName: string
  args: unknown
  /** 纯传输:把判决回给主进程(LLM 的 confirm 通道)。应用画布变更走 approveCalls 的事务批。 */
  confirm: ToolCallEvent['confirm']
  /** 时序内联:本卡跟在哪条消息后(入队时的「卡前气泡」或用户消息 id)。 */
  anchorMessageId?: string
}

/** 批准请求:plan card 把用户编辑过的字段作为 overrides 传回(S6-0 的 overridesDelta 来源)。 */
export type ApproveCallRequest = {
  toolCallId: string
  overrides?: Record<string, unknown>
}

type CanvasAssistantPanelProps = {
  defaultCollapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

function createMessageId(): string {
  return `assistant-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// 文字里像「要动画布却没动」的意图特征——配合零工具发射判定「只说不做」，提示换模型。
const AGENT_ACTION_INTENT = /创建|生成|添加|新增|修改|删除|替换|连接|拆镜头|分镜|节点|我将|我会|我来|计划|操作/

// 「只说不做」提示:模型只回文字没发任何工具调用、但话里像要操作时追加。
const ONLY_TALK_WARNING = '\n\n⚠️ 这一轮 AI 只回复了文字、没有真正动画布。如果你是想生成或修改节点，多半是当前模型不擅长工具调用——点上方「模型」换一个（推荐 GPT / Claude / DeepSeek 系）再试一次。'

// 截断提示:finishReason=length 且有正文 = 模型这条输出到达单次上限被切断(别把半截当完整)。
const TRUNCATED_WARNING = '\n\n⚠️ 这条回复可能没说完（达到模型单次输出上限被截断）。需要的话直接说「继续」。'

export default function CanvasAssistantPanel({
  defaultCollapsed = false,
  onCollapsedChange,
}: CanvasAssistantPanelProps): JSX.Element {
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const snapshot = React.useMemo(() => generationCanvasTools.read_canvas(), [nodes, edges, selectedNodeIds])
  const selectedNodes = React.useMemo(() => generationCanvasTools.read_selected_nodes(), [nodes, selectedNodeIds])
  const [busy, setBusy] = React.useState(false)
  // Cancel handle for the in-flight agent turn (user "Stop"); set once the
  // backend session exists, cleared when the turn ends.
  const cancelRef = React.useRef<(() => void) | null>(null)
  const [mode, setMode] = React.useState<'agent' | 'chat' | 'refine'>('agent')
  const [pendingToolCalls, setPendingToolCalls] = React.useState<PendingToolCall[]>([])
  // S6-3 对账偏差(N12):committed 但执行 ≠ 批准时弹卡;对账一致时恒 null(M1 零可见)。
  const [deviationReport, setDeviationReport] = React.useState<ReconcileDeviation[] | null>(null)
  // 时序内联:对账卡跟在本轮「卡前气泡」后(与 committed 同源,approveCalls 设)。
  const [deviationAnchorId, setDeviationAnchorId] = React.useState<string | null>(null)
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

  // toolCallId → pending call 查找表(approveCalls 事务批要按序取多个 call,函数式 setState 取不到)。
  const pendingByIdRef = React.useRef(new Map<string, PendingToolCall>())

  /** 拒绝/传输专用:把判决直接回给 LLM 并移除卡片(批准走 approveCalls 的事务批)。 */
  const resolvePending = React.useCallback((
    toolCallId: string,
    decision: { ok: false; message?: string },
  ) => {
    const target = pendingByIdRef.current.get(toolCallId)
    pendingByIdRef.current.delete(toolCallId)
    if (target) void target.confirm(decision)
    setPendingToolCalls((current) => current.filter((item) => item.toolCallId !== toolCallId))
  }, [])

  // S6-2 提议事务:批准 = 一笔原子批量(plan card 的 create+connect 共一个 proposalId)。
  // 实现挂在 turn 闭包里(要数 toolActionCount),组件层暴露稳定回调。
  const approveCallsRef = React.useRef<((requests: ApproveCallRequest[]) => Promise<void>) | null>(null)
  const approveCalls = React.useCallback((requests: ApproveCallRequest[]) => {
    void approveCallsRef.current?.(requests)
  }, [])

  // 稳定引用:传给 AssistantTimeline→AgentPlanCard,使 React.memo(AgentPlanCard) 在流式吐字
  // 每帧重渲染时不被新函数引用打穿(原内联箭头每帧新建会让 memo 失效)。
  const rejectPending = React.useCallback(
    (toolCallId: string) => resolvePending(toolCallId, { ok: false, message: 'rejected by user' }),
    [resolvePending],
  )

  // Exposed for the V2 agent client (wired in B6) so the panel can render
  // pending tool calls and forward the user's confirmation back to the IPC
  // session. We surface it via a ref so the call site doesn't have to
  // re-render on every state change.
  const pendingToolCallsRef = React.useRef({
    enqueue: (call: PendingToolCall) => {
      pendingByIdRef.current.set(call.toolCallId, call)
      setPendingToolCalls((current) => [...current, call])
    },
    clear: () => {
      pendingByIdRef.current.clear()
      setPendingToolCalls([])
    },
  })
  const draft = useGenerationCanvasStore((state) => state.generationAiDraft)
  const messages = useGenerationCanvasStore((state) => state.generationAiMessages)
  // S1b 诚实分隔线:气泡有历史而 LLM 记忆为空 → 在历史末尾画「以上对话 AI 已不再记得」。
  const staleBoundaryId = useStaleConversationBoundary(messages.map((message) => message.id), 'generation')
  const collapsed = useGenerationCanvasStore((state) => state.generationAiCollapsed)
  const setDraft = useGenerationCanvasStore((state) => state.setGenerationAiDraft)
  const setMessages = useGenerationCanvasStore((state) => state.setGenerationAiMessages)
  // 附件用组件本地态（不进 generationCanvasStore——它已是白名单巨壳，不再喂；附件本就 ephemeral，
  // 面板折叠时组件仍挂载，本地态不丢）。
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>([])
  const setCollapsed = useGenerationCanvasStore((state) => state.setGenerationAiCollapsed)

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
    if (messages.length === 0 && !draft.trim()) setCollapsed(defaultCollapsed)
  }, [defaultCollapsed, draft, messages.length, setCollapsed])

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
  }, [messages, pendingToolCalls, deviationReport, collapsed, stickToBottom])

  const updateMessage = React.useCallback((id: string, content: string) => {
    setMessages((current) => current.map((message) => (
      message.id === id ? { ...message, content } : message
    )))
  }, [setMessages])

  const setMessageStatus = React.useCallback((id: string, status: WorkbenchAiMessage['status']) => {
    setMessages((current) => current.map((message) => (
      message.id === id ? { ...message, status } : message
    )))
  }, [setMessages])

  const removeMessage = React.useCallback((id: string) => {
    setMessages((current) => current.filter((message) => message.id !== id))
  }, [setMessages])

  type SubmitMessageOptions = {
    skill?: { key: string; name: string }
    displayMessage?: string
  }

  const submitAgentMessage = React.useCallback((text: string, options: SubmitMessageOptions = {}) => {
    const readyAttachments = attachments.filter((item) => item.status === 'ready' && item.url)
    if ((!text && !readyAttachments.length) || busy) return
    setDraft('')
    clearAttachments()
    const attachmentPayload = readyAttachments.map((item) => ({
      url: item.url as string,
      contentType: item.contentType,
      fileName: item.fileName,
      kind: item.kind,
    }))
    // 时序内联:捕获用户消息 id(无前言时第一张卡锚定到它)+ 开一个占位「卡前气泡」。
    const userMessageId = createMessageId()
    const firstBubbleId = createMessageId()
    setMessages((current) => [
      ...current,
      {
        id: userMessageId,
        role: 'user',
        content: options.displayMessage || text || '请看这些附件',
        ...(readyAttachments.length ? { attachments: readyAttachments } : {}),
      },
      { id: firstBubbleId, role: 'assistant', content: '处理中...', status: 'pending' },
    ])
    setBusy(true)
    void (async () => {
      let toolActionCount = 0
      // 本轮模型是否发出过任何 tool 调用（含只读）。0 = 模型只回文字、没触发任何操作——
      // 自动选模型撞到不会工具调用的模型时的典型「只说不做」（2026-06-07 走查 P0）。
      let toolEmittedCount = 0
      // S6-2 提议事务批:用户点「确认」后整批原子应用——全成 committed,中途失败补偿回滚
      // (零半截)。先落地后回话:LLM 收到的每步成败与画布事实一致。
      approveCallsRef.current = async (requests: ApproveCallRequest[]) => {
        const items = requests
          .map((request) => ({ request, call: pendingByIdRef.current.get(request.toolCallId) }))
          .filter((item): item is { request: ApproveCallRequest; call: PendingToolCall } => Boolean(item.call))
        if (items.length === 0) return
        // 立即摘卡防双击;事务结果经 transport 回 LLM,卡不复原(与既有 resolve 即摘一致)。
        const ids = new Set(items.map((item) => item.request.toolCallId))
        items.forEach((item) => pendingByIdRef.current.delete(item.request.toolCallId))
        setPendingToolCalls((current) => current.filter((item) => !ids.has(item.toolCallId)))
        const rawSteps = items.map(({ request, call }) => {
          const baseArgs = (call.args && typeof call.args === 'object') ? call.args as Record<string, unknown> : {}
          return {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            effectiveArgs: request.overrides ? { ...baseArgs, ...request.overrides } : baseArgs,
            overridesDelta: request.overrides,
            transport: call.confirm,
          }
        })
        // 「批准 ≡ 执行」根治:批准前就把模型/参数按档案解析成执行后会真正写入的值(与执行端
        // buildPlannedNodeMeta 同源),折进 effectiveArgs。否则 agent 写的非法参数(如给 Hailuo 配
        // duration:5,档案只允许 6-10)执行时被静默回退 → 对账每次换个字段报「执行与批准有出入」。
        const needsModels = rawSteps.some(
          (step) =>
            step.toolName === 'create_canvas_nodes' &&
            Array.isArray((step.effectiveArgs as Record<string, unknown>).nodes) &&
            ((step.effectiveArgs as { nodes: unknown[] }).nodes).some(
              (node) => node && typeof node === 'object' && typeof (node as Record<string, unknown>).modelKey === 'string',
            ),
        )
        const entryByKey = needsModels
          ? new Map((await listAvailableModelsForAgent()).map((entry) => [entry.modelKey, entry]))
          : new Map()
        const nodeResolvedSteps = rawSteps.map((step) => {
          const args = step.effectiveArgs as Record<string, unknown>
          if (step.toolName !== 'create_canvas_nodes' || !Array.isArray(args.nodes)) return step
          const nodes = (args.nodes as Record<string, unknown>[]).map((node) =>
            node && typeof node === 'object' ? resolvePlannedNodeArgs(node, entryByKey) : node,
          )
          return { ...step, effectiveArgs: { ...args, nodes } }
        })
        // 同理把边按目标模型能力解析:连不上的(目标模型不吃这类参考,如 image_ref 槽吃不了视频
        // 接力源)在批准时就剔除,执行端不再丢、对账不再报「执行与批准有出入」。节点查找=本批解析后的
        // 计划节点(clientId)+ 画布已有节点(真实 id);查不到的边保守保留交执行端兜。
        const plannedById = new Map<string, GenerationCanvasNode>()
        for (const step of nodeResolvedSteps) {
          const args = step.effectiveArgs as Record<string, unknown>
          if (step.toolName !== 'create_canvas_nodes' || !Array.isArray(args.nodes)) continue
          for (const node of args.nodes as Record<string, unknown>[]) {
            if (node && typeof node === 'object' && typeof node.clientId === 'string') {
              plannedById.set(node.clientId, {
                id: node.clientId,
                kind: node.kind,
                meta: typeof node.modelKey === 'string' ? { modelKey: node.modelKey } : {},
              } as GenerationCanvasNode)
            }
          }
        }
        const existingById = new Map(generationCanvasTools.read_canvas().nodes.map((node) => [node.id, node]))
        const resolveNodeForEdge = (id: string): GenerationCanvasNode | null =>
          plannedById.get(id) ?? existingById.get(id) ?? null
        const steps = nodeResolvedSteps.map((step) => {
          const args = step.effectiveArgs as Record<string, unknown>
          if (!Array.isArray(args.edges)) return step
          const { connectable } = partitionConnectableEdges(args.edges as PlannedEdgeLike[], resolveNodeForEdge)
          return { ...step, effectiveArgs: { ...args, edges: connectable } }
        })
        const outcome = await applyProposalBatch(
          steps.map(({ toolCallId, toolName, effectiveArgs }) => ({ toolCallId, toolName, effectiveArgs })),
        )
        if (outcome.status === 'committed') {
          toolActionCount += steps.length
          // 时序内联:卡片锚定到本轮「卡前气泡」(入队时记在 pending call 上),committed/对账卡同源。
          const cardAnchorId = items.map((item) => item.call.anchorMessageId).find(Boolean) ?? null
          // S6-3 对账(N12):执行 ≠ 批准 → 弹偏差卡(per-field diff+一键整笔撤销);一致则零可见。
          if (!outcome.reconciliation.ok) {
            setDeviationReport(outcome.reconciliation.deviations)
            setDeviationAnchorId(cardAnchorId)
          }
          // S6-5 整笔撤销唯一入口 = committed 卡(约束①,存活到下一笔)。落点回报靠卡内分类 chip。
          // 旧实现额外弹一个「整笔撤销」toast 当第二入口——每次 commit 都弹、和卡内入口重复,
          // 即用户反馈的「多余弹窗」,已删(单一入口,不再两套风格/两处冒泡)。
          // 无可补偿的提议(如 run_generation_batch 受理——网络调用收不回)不出撤销入口,不误导。
          if (outcome.compensation.length > 0) {
            // 落点回报(审计 A1):跨分类创建的节点会落进默认折叠的分类面板,卡片
            // 必须报「落在哪」并给跳转入口,否则用户视角=确认过的节点凭空消失。
            const categoryCounts = countCreatedNodesByCategory(steps)
            const record = {
              proposalId: outcome.proposalId,
              summary: steps.map((step) => summarizeToolCall(step.toolName, step.effectiveArgs)).join(' · '),
              // A16:逐节点「标题 → 落点分类」明细,不再与 summary 同句重复。
              stepLabels: steps.flatMap((step) => buildStepDetailLabels(step.toolName, step.effectiveArgs)),
              ...(categoryCounts.length ? { categoryCounts } : {}),
              compensation: outcome.compensation,
              watchNodes: outcome.watchNodes,
              reconciliationOk: outcome.reconciliation.ok,
              ...(cardAnchorId ? { anchorMessageId: cardAnchorId } : {}),
            }
            setCommittedProposal(record)
          }
          for (let index = 0; index < steps.length; index += 1) {
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
            const message = index === outcome.failedIndex
              ? outcome.reason
              : index < outcome.failedIndex
                ? `已回滚:第 ${outcome.failedIndex + 1} 步(${steps[outcome.failedIndex].toolName})失败——${outcome.reason}`
                : `未执行:第 ${outcome.failedIndex + 1} 步失败,整批已回滚`
            await steps[index].transport({ ok: false, message })
          }
        }
      }
      // 时序内联(根治「吐字顺序倒挂/确认卡在上面」):文字按工具调用边界分段——
      // 卡前文字进「卡前气泡」,卡后总结进「卡后新气泡」,卡片锚定到它跟随的消息;渲染层据此把卡
      // 排到卡前文字之下、卡后文字之上。token 高频到达合帧(每帧最多一次 updateMessage),避免每字重渲。
      let activeId: string | null = firstBubbleId  // 当前打开的文字气泡(null=未开)
      let activeText = ''                           // 本段累积(按 delta,非 cumulative)
      let anchorId = userMessageId                  // 下一张卡锚定到的消息(气泡收首字后升级为气泡 id)
      let streamRaf: number | null = null
      const flush = () => {
        streamRaf = null
        if (activeId !== null) updateMessage(activeId, activeText || '处理中...')
      }
      const openBubble = () => {
        const id = createMessageId()
        activeId = id
        activeText = ''
        setMessages((current) => [...current, { id, role: 'assistant', content: '处理中...', status: 'streaming' }])
      }
      // 收口当前气泡:有正文→标 done(后续卡锚到它);空壳→删除(不留占位)。
      const sealBubble = () => {
        if (activeId === null) return
        if (streamRaf !== null) { cancelAnimationFrame(streamRaf); streamRaf = null }
        if (activeText.trim() === '') {
          removeMessage(activeId)
        } else {
          updateMessage(activeId, activeText)
          setMessageStatus(activeId, 'done')
        }
        activeId = null
        activeText = ''
      }
      try {
        const result = await sendGenerationCanvasAgentMessage({
          message: text || '请看这些附件',
          ...(attachmentPayload.length ? { attachments: attachmentPayload } : {}),
          snapshot,
          selectedNodes,
          mode,
          skill: options.skill,
          onContent: (delta) => {
            if (activeId === null) openBubble()
            if (activeText === '') anchorId = activeId as string // 首字:后续卡锚到本气泡
            activeText += delta
            if (streamRaf === null) streamRaf = requestAnimationFrame(flush)
          },
          onCancelReady: (cancel) => {
            cancelRef.current = cancel
          },
          onToolCall: (event: ToolCallEvent) => {
            toolEmittedCount += 1
            // 统一求值流(§6.1):一道门替代散落 if。allow=只读直通 / deny=校验/锁拒绝 / ask=等点头。
            const decision = evaluateGate({ kind: 'tool-call', toolName: event.toolName, args: event.args }, buildLockGateContext())
            if (decision.outcome === 'deny') {
              // gate 拒绝(非用户拒):带 denied 标记 → 主进程记 gate.denied,人话回喂 LLM。
              void event.confirm({ ok: false, message: decision.reason, denied: true })
              return
            }
            if (decision.outcome === 'allow') {
              // 只读直通:经单一真相源 applyCanvasToolCall 执行(它已处理 read_canvas_state);
              // silent=不记 proposal.approved(纯噪声);try/catch 防读失败把 loop 卡在永不到来的确认。
              void (async () => {
                try {
                  const result = await applyCanvasToolCall(event.toolName, event.args)
                  await event.confirm({ ok: true, result, silent: true })
                } catch (error: unknown) {
                  await event.confirm({ ok: false, message: error instanceof Error ? error.message : String(error) })
                }
              })()
              return
            }
            // ask:写/破坏性操作排队,等用户经 pending 卡显式点头。卡锚定到当前「卡前气泡」,
            // 收口本段→卡后文字另起新气泡。confirm 纯传输,批准走 approveCalls 事务批(S6-2)。
            pendingToolCallsRef.current.enqueue({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
              confirm: event.confirm,
              anchorMessageId: anchorId,
            })
            sealBubble()
          },
        })

        // 流结束:收口尾段气泡 + 特例定稿(只说不做⚠️ / 空回复)。
        if (streamRaf !== null) cancelAnimationFrame(streamRaf)
        const finalText = result.response.text?.trim() || ''
        const warn = toolEmittedCount === 0 && mode === 'agent' && AGENT_ACTION_INTENT.test(finalText)
        // 截断只在「模型真出了正文又被切断」时提示(空文本+length 是弱模型空响应,backend 已另说人话)。
        const truncated = result.response.finishReason === 'length' && finalText !== ''
        const withNotes = (text: string): string =>
          `${text}${warn ? ONLY_TALK_WARNING : ''}${truncated ? TRUNCATED_WARNING : ''}`
        if (activeId !== null && activeText.trim() !== '') {
          // 尾段有正文(纯聊天整段 / 卡后总结)。
          updateMessage(activeId, withNotes(activeText))
          setMessageStatus(activeId, 'done')
        } else if (activeId !== null) {
          // 尾段是空占位气泡。有动作但无收尾文字 → 已应用卡已叙述结果,删空壳;否则补「已完成。」。
          if (toolActionCount > 0) {
            removeMessage(activeId)
          } else {
            updateMessage(activeId, withNotes(finalText || '已完成。'))
            setMessageStatus(activeId, 'done')
          }
        } else if (toolActionCount === 0) {
          // 无打开气泡且整轮零动作零文字 → 补一条「已完成。」(末尾是卡时不补,卡已叙述)。
          const id = createMessageId()
          setMessages((current) => [...current, { id, role: 'assistant', content: withNotes(finalText || '已完成。'), status: 'done' }])
        }
      } catch (error: unknown) {
        if (streamRaf !== null) cancelAnimationFrame(streamRaf)
        const message = `生成区 Agent 执行失败：${error instanceof Error && error.message ? error.message : '未知错误'}`
        if (activeId !== null) {
          updateMessage(activeId, activeText ? `${activeText}\n\n${message}` : message)
          setMessageStatus(activeId, 'error')
        } else {
          const id = createMessageId()
          setMessages((current) => [...current, { id, role: 'assistant', content: message, status: 'error' }])
        }
      } finally {
        setBusy(false)
        cancelRef.current = null
        approveCallsRef.current = null
        setMemoryRefreshKey((key) => key + 1) // S9:本轮事件可能提炼出新记忆
      }
    })()
  }, [attachments, busy, clearAttachments, mode, removeMessage, selectedNodes, setDraft, setMessages, setMessageStatus, snapshot, updateMessage])

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
    pendingByIdRef.current.clear()
    setPendingToolCalls([])
    setDeviationReport(null)
    setDeviationAnchorId(null)
    // 会话历史:归档当前线程(不销毁),建空活动线程,清消息投影;startNewConversation 内部清整笔撤销入口。
    startNewConversation('generation')
    setDraft('')
    clearAttachments()
    // 新对话 = 该 area 模型上下文归零(创作/画布各一份键,互不影响)。
    void clearWorkbenchAgentSession(workbenchSessionKey('generation'))
  }, [clearAttachments, setDraft])

  if (collapsed) {
    return (
      <aside
        className={cn(
          'generation-canvas-v2-assistant',
          'block w-auto h-auto rounded-full',
        )}
        data-collapsed="true"
        aria-label="生成区 AI 启动器"
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
        // 宽度撑满外层可拖拽的 grid 列（GenerationWorkspace 把列宽推到 assistantWidth），
        // 之前写死 w-[340px] → 拖宽后右侧一大片空白、header 右簇被 overflow-hidden 裁断 token。
        'relative flex flex-col w-full h-full',
        'max-h-none min-w-0 min-h-0 overflow-hidden',
        'border-0 rounded-none bg-nomi-paper shadow-none',
        'max-[900px]:w-[min(340px,calc(100vw-28px))]',
        'max-[900px]:max-h-[calc(100vh-var(--workbench-topbar-height)-var(--workbench-timeline-height)-32px)]',
        'max-[900px]:border max-[900px]:border-nomi-line max-[900px]:rounded-nomi max-[900px]:shadow-nomi-lg',
      )}
      data-collapsed="false"
      aria-label="生成区 AI 助手"
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
          <div>拖到这里添加附件</div>
          <div className={cn('text-micro font-normal text-nomi-ink-60')}>图片 / PDF / Word / Excel / txt · 单个上限 30MB</div>
        </div>
      ) : null}
      {/* 头部：Nomi 标 + 「助手」+ 动作（含 token 计数）+ 收起。 */}
      <header className={cn(
        'flex items-center justify-between gap-2 px-3 py-2',
        'border-b border-nomi-line-soft bg-nomi-paper',
      )}>
        <div className={cn('flex items-center gap-2 min-w-0')}>
          <NomiLogoMark size={18} />
          {/* 审计 A14：与入口词「生成」一致，不再裸叫「助手」 */}
          <span className={cn('text-body-sm font-semibold text-nomi-ink')}>生成助手</span>
        </div>
        <div className={cn('inline-flex items-center gap-2 ml-auto min-w-0')}>
          <WorkbenchAiHeaderActions
            area="generation"
            className={cn('generation-canvas-v2-assistant__shared-actions', 'inline-flex items-center flex-nowrap gap-1')}
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
            label="收起 AI"
            onClick={() => setCollapsed(true)}
            icon={<IconX size={14} />}
          />
        </div>
      </header>
      <MemoryFold refreshKey={memoryRefreshKey} />
      <AssistantTimeline
        messages={messages}
        staleBoundaryId={staleBoundaryId}
        onSuggestion={submitAgentMessage}
        pendingToolCalls={pendingToolCalls}
        approveCalls={approveCalls}
        rejectPending={rejectPending}
        committedProposal={committedProposal}
        deviationReport={deviationReport}
        deviationAnchorId={deviationAnchorId}
        onDeviationUndo={() => {
          // 整笔撤销单机制(S6-5):补偿事务回退本笔,期间用户工作保留。
          if (committedProposal) runProposalUndo(committedProposal)
          else useGenerationCanvasStore.getState().undo()
          setDeviationReport(null)
          setDeviationAnchorId(null)
        }}
        onRetry={() => {
          // 错误卡「重试」= 重发上一条用户消息(网络/服务商抖动等瞬时错误的直接出路)。
          const lastUser = [...messages].reverse().find((message) => message.role === 'user')
          if (lastUser) submitAgentMessage(lastUser.content)
        }}
        onDeviationDismiss={() => { setDeviationReport(null); setDeviationAnchorId(null) }}
        onDeviationAiFix={() => {
          // 让 AI 读画布、用所选模型支持的方式把没接上的参考连接重连(或换支持的模型)。
          submitAgentMessage(
            '刚才有几条参考连接没接上（所选模型不支持那种连接方式）。请先读画布，把这些没连上的参考连接，用所选模型支持的连接方式重连；如果模型确实不支持，就换成支持的模型再连。',
          )
          setDeviationReport(null)
          setDeviationAnchorId(null)
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
        threadBottomRef={threadBottomRef}
      />
      <form
        className={cn('grid gap-1 p-3 border-t border-nomi-line-soft bg-nomi-paper')}
        onSubmit={handleSubmit}
      >
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
          aria-label="给生成助手发送消息"
          placeholder="告诉我画布上想怎么搭..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => handleAiComposerKeyDown(event, () => {
            event.currentTarget.form?.requestSubmit()
          })}
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
              label="添加附件"
              aria-label="添加附件（也可拖拽 / 粘贴）"
              onClick={openFilePicker}
              icon={<IconPaperclip size={16} />}
            />
            <NomiSelect
              ariaLabel="AI 模式"
              leadingLabel="模式"
              size="sm"
              value={mode}
              options={[
                { value: 'agent', label: 'Agent' },
                { value: 'chat', label: '问答' },
                { value: 'refine', label: '润色' },
              ]}
              onChange={(value) => setMode(value as 'agent' | 'chat' | 'refine')}
            />
            <AssistantModelPicker className="h-7" />
          </div>
          {busy ? (
            <WorkbenchIconButton
              type="button"
              onClick={() => cancelRef.current?.()}
              className={cn(
                'size-7 grid place-items-center shrink-0',
                'border-0 rounded-full bg-nomi-ink text-nomi-paper cursor-pointer',
                'hover:enabled:bg-nomi-accent',
              )}
              label="停止"
              aria-label="停止生成"
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
              label="发送"
              aria-label="生成 AI 发送"
              icon={<IconSend2 size={15} />}
            />
          )}
        </div>
      </form>
    </aside>
  )
}
