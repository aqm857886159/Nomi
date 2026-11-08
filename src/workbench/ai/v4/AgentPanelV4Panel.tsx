import { NomiBrand } from '../../../design/identity'
// Agent 面板 v4 · 整块面板的装配壳
//
// 定稿三张 Flow 板（创作 / 生成 / 预览）+ Rendering + Dark 板画的都是**同一个壳**装不同内容：
//   头部（N Nomi + Context 环 …… 历史 / 收起）→ 对话流 → 介入槽（永远在 composer 正上方）
//   → 队列（只在运行中还继续输入时）→ composer。
//
// 头部逐件照定稿 `.ph`：`<logo>N</logo>Nomi <ctx/> <sp/> <ic>hist side</ic>`——
// **Context 环紧跟品牌名**（不是甩到最右），右端是历史与收起两个图标。品牌名是「Nomi」不是「Nomi Agent」。
//
// 这个壳**不**按 view 枚举改形状：它只接一份对话流数据。早先那版把 44 个状态全渲成
// 「整块面板 + 几处 if」，结果接触表三列近乎一样，看不出任何一个积木的状态差别。
//
// 所有交互都从 `handlers` 一个口进来。分散成二十几个 `onXxx` prop 时，容器那边就得逐个
// 记住哪个还没接——而「没接」和「接了但没反应」在界面上长得一模一样。一个对象，
// 缺哪个键就是那件事这里做不了，TypeScript 看得见。
import React, { type JSX } from 'react'
import { useStickToBottom } from 'use-stick-to-bottom'
import { useWorkspacePanelFrame, workspacePanelFrame, workspacePanelHeader } from '../../WorkspacePanelFrame'
import type { LaneLegacyFacts } from '../../../../electron/shared/agentLane/laneLegacyNote'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { AgentPanelV4Composer, type AgentPanelV4ComposerProps } from './AgentPanelV4Composer'
import { V4ContextRing } from './AgentPanelV4Context'
import { V4Intervention, V4Queue, V4TaskCard } from './AgentPanelV4Cards'
import { V4AssistantMessage, V4Thinking, V4UserBubble } from './AgentPanelV4Message'
import { V4ErrorBar, V4Process, V4ReceiptNotice, V4ToolGroup, V4ToolReceipt } from './AgentPanelV4Receipt'
import { flowItemNotices } from './useDirectorPatchNotices'
import { GenerationReceiptPointers } from '../pointer/GenerationReceiptPointers'
import { flowItemGenerations } from '../pointer/generationReceiptFacts'
import { V4EmptyState } from './AgentPanelV4Empty'
import { IconHistory, IconLayoutSidebarRightCollapse } from './AgentPanelV4Icons'
import { AGENT_HEADER_COMPACT_WIDTH, AgentPanelHeaderSlotContext, type AgentPanelHeaderSlot } from '../../../ui/app-shell/shell/agentPanelHeaderSlot'
import { WorkbenchMenu, type WorkbenchMenuNode } from '../../../design'
import { IconDots } from '@tabler/icons-react'
import type { V4QuestionReply } from './agentPanelV4Question'
import { useV4Labels } from './agentPanelV4Labels'
import type { ResidentSurface } from '../resident/residentShellDisplay'
import type {
  ContextUsage,
  InterventionData,
  PermissionTier,
  QueueRowData,
  V4Chip,
  V4FlowItem,
} from './agentPanelV4Types'
import { DEFAULT_PERMISSION_TIER } from './agentPanelV4Types'

export type { V4FlowItem }

/** 对话流里某一条的动作。`index` 是流内序号——调用方用它换回宿主的 itemId。 */
export type V4FlowHandlers = Readonly<{
  onCopy?: (text: string) => void
  onRetry?: (index: number) => void
  onContinue?: (index: number) => void
  onUndoTool?: (toolCallId: string) => void
  onAdoptCandidate?: (index: number, tag: string, candidateIndex: number) => void
  onUndoTask?: (index: number) => void
  onErrorAction?: (index: number) => void
  /** 失败行上的「反馈」。宿主接了才画那颗钮（#789 的规矩：画出来的必须接得上）。 */
  onFeedback?: (index: number, reason: string) => void
}>

export type V4InterventionHandlers = Readonly<{
  onConfirm?: () => void
  onReject?: (reason?: string) => void
  onEscalate?: () => void
  /** 次动作（「改一下」「换模型」「去配置」）。 */
  onAlternate?: () => void
  /** 用户答了反问（chip 或卡内那一行，同一个动作）。 */
  onAnswer?: (reply: V4QuestionReply, questions: readonly string[]) => void
  /** 计划行勾选 / 收起。**必填**——见 `V4Intervention` 里那段注释（R28）。 */
  onPlanToggle: (label: string, checked: boolean) => void
  onCollapsePlan: () => void
  planCollapsed?: boolean
}>

export type V4QueueHandlers = Readonly<{
  onAction?: (rowIndex: number, action: string) => void
  onDestructiveAction?: (rowIndex: number) => void
}>

export type AgentPanelV4PanelProps = {
  flow: readonly V4FlowItem[]
  legacy?: LaneLegacyFacts
  /** Live domain feedback remains outside the conversation transcript. */
  flowTail?: React.ReactNode
  /** 空态从这里派生它那三条起手（哪个面能做什么）。 */
  surface?: ResidentSurface
  /** 点空态起手 chip：把那句话填进 composer 并聚焦，**不发送**。 */
  onStarter?: (prompt: string) => void
  slot?: InterventionData
  /**
   * 介入槽的**卡体**。付费卡放指向元素 + 一行只读摘要 + 说明行（`AgentPanelV4SpendCardBody`，SpendCardQ1 板）。
   * 其余 kind 不传 = 槽照旧渲染它自己的摘要与参数 chip。
   */
  slotBody?: React.ReactNode
  /**
   * 槽里那张卡在不在等用户回答。**缺席 = 在等**，完整推导在 `V4SlotShell` 的 `waiting` 上。
   *
   * 生产侧永远缺席，而且**应该**缺席：这个面板只在 `slot` 在时才挂卡，而 `slot` 正是
   * `LaneProjection.pending` 的投影——「挂着」本身就是「在等」，再传一次等于把同一个事实
   * 说两遍，也就多了一处可以说错的地方。它存在只为让设计实验室画得出「已答 / 已确认」
   * 那一态（静态取景没有宿主投影可翻）。
   */
  slotWaiting?: boolean
  /**
   * 压在 composer 上沿那一条微字横条。今天只有「全自动」档的常驻提醒用它
   * （`V4AutoModeBanner`）——它在的地方就是用户打字的地方，所以不该住在面板头上。
   */
  composerBanner?: React.ReactNode
  queue?: readonly QueueRowData[]
  queueHint?: string
  context: ContextUsage
  composer?: Omit<AgentPanelV4ComposerProps, 'panelHeight'> & {
    permission?: PermissionTier
    chips?: readonly V4Chip[]
  }
  width?: number
  height?: number
  darkMode?: boolean
  flowHandlers?: V4FlowHandlers
  /** 介入槽的写口。**必填**：少接一根线，卡上那几颗按钮就是点不动的（R28）。 */
  slotHandlers: V4InterventionHandlers
  queueHandlers?: V4QueueHandlers
  onHistory?: () => void
  /** Workspace/lane/session identity, distinct from remembered reading position. */
  historyIdentity?: string
  historyCursor?: string
  /** Returns the authoritative cursor after loading, even before React commits its projection. */
  onLoadOlder?: () => Promise<string | undefined>
  onCollapse?: () => void
  /**
   * 现在显示的是哪一条对话（宿主给：项目 + 面 + 线程）。它一变就是「进了另一条对话」：落到那条的最新一条。
   * 不给（设计实验室、单测）= 只在挂载时落到底。
   */
  conversationKey?: string
}

/** 对话流里的一条 = 一个积木；哪个积木由 kind 决定，壳不认识内容。 */
function V4FlowRowImpl({
  item,
  index,
  darkMode,
  handlers,
}: {
  item: V4FlowItem
  index?: number
  darkMode: boolean
  handlers?: V4FlowHandlers
}): JSX.Element {
  const labels = useV4Labels()
  const at = index ?? 0
  if (item.kind === 'user') return <V4UserBubble text={item.text} chips={item.chips} darkMode={darkMode} />
  if (item.kind === 'assistant') {
    // 每个动作**接了才画钮**：没有 handler 的钮和能用的钮长得一模一样，而按下去一个有事、
    // 一个没事（2026-09-14 用户报的「重试点了没反应」）。「继续」还要多一个条件——
    // 没有 `continuationEntryId` 就是没有半句话可接，宿主那边本来也会原地返回。
    return (
      <V4AssistantMessage
        text={item.text}
        status={item.status}
        {...(item.skill ? { skill: item.skill } : {})}
        labels={labels.assistant}
        {...(handlers?.onCopy ? { onCopy: handlers.onCopy } : {})}
        {...(handlers?.onRetry ? { onRetry: () => handlers.onRetry?.(at) } : {})}
        {...(handlers?.onContinue && item.continuationEntryId
          ? { onContinue: () => handlers.onContinue?.(at) } : {})}
      />
    )
  }
  if (item.kind === 'thinking') return <V4Thinking label={item.label} meta={item.meta} text={item.text} streaming={item.streaming} />
  if (item.kind === 'tool') {
    return (
      <V4ToolReceipt
        receipt={item.receipt}
        statusLabel={labels.toolStatus[item.receipt.status]}
        undoLabel={labels.task.undo}
        onUndo={() => { if (item.receipt.toolCallId) handlers?.onUndoTool?.(item.receipt.toolCallId) }}
      />
    )
  }
  if (item.kind === 'tool-group') {
    return <V4ToolGroup group={item} statusLabel={labels.toolStatus[item.status]} undoLabel={labels.task.undo} onUndo={handlers?.onUndoTool} />
  }
  if (item.kind === 'process') return <V4Process {...item}>{item.details?.map((detail, position) => (
    <V4FlowRow key={position} item={detail.item} index={detail.index} darkMode={darkMode} handlers={handlers} />
  ))}</V4Process>
  if (item.kind === 'task') {
    return (
      <V4TaskCard
        task={item.task}
        labels={labels.task}
        onAdopt={handlers?.onAdoptCandidate ? (tag, candidateIndex) => handlers.onAdoptCandidate?.(at, tag, candidateIndex) : undefined}
        onUndo={() => handlers?.onUndoTask?.(at)}
        onErrorAction={() => handlers?.onErrorAction?.(at)}
      />
    )
  }
  if (item.recovered) {
    return <div className="px-2.5 text-caption text-nomi-ink-40" data-v4-block="error-recovered">{item.reason}</div>
  }
  return (
    <V4ErrorBar
      reason={item.reason}
      action={item.action}
      onAction={() => handlers?.onErrorAction?.(at)}
      feedbackLabel={labels.assistant.feedback}
      onFeedback={handlers?.onFeedback ? () => handlers.onFeedback?.(at, item.reason) : undefined}
    />
  )
}

export const V4FlowRow = React.memo(V4FlowRowImpl)

export function AgentPanelV4Panel({
  flow,
  legacy,
  flowTail,
  surface = 'creation',
  onStarter,
  slot,
  slotBody,
  slotWaiting,
  composerBanner,
  queue,
  queueHint,
  context,
  composer,
  width = 390,
  height = 620,
  darkMode = false,
  flowHandlers,
  slotHandlers,
  queueHandlers,
  onHistory,
  onLoadOlder,
  historyIdentity,
  historyCursor,
  onCollapse,
  conversationKey,
}: AgentPanelV4PanelProps): JSX.Element {
  const { t } = useTranslation()
  const workspaceFrame = useWorkspacePanelFrame()
  const headerSlot = React.useContext(AgentPanelHeaderSlotContext)
  const labels = useV4Labels()
  const flowHandlersRef = React.useRef(flowHandlers)
  flowHandlersRef.current = flowHandlers
  const flowHandlerKeys = flowHandlers
    ? Object.keys(flowHandlers).filter((key) => typeof flowHandlers[key as keyof V4FlowHandlers] === 'function').sort().join('\u0000')
    : ''
  const stableFlowHandlers = React.useMemo(() => {
    if (!flowHandlerKeys) return undefined
    const stable: { -readonly [K in keyof V4FlowHandlers]?: V4FlowHandlers[K] } = {}
    const stableByKey = stable as unknown as Record<string, ((...args: never[]) => void) | undefined>
    for (const keyText of flowHandlerKeys.split('\u0000')) {
      const key = keyText as keyof V4FlowHandlers
      stableByKey[keyText] = (...args: never[]) => {
        const latest = flowHandlersRef.current?.[key] as ((...values: never[]) => void) | undefined
        latest?.(...args)
      }
    }
    return stable
  }, [flowHandlerKeys])
  const legacyNotice = legacy ? [t('agentPanelV4.legacyNotice'),
    ...(legacy.arrayOrder ? [t('agentPanelV4.legacyArrayOrder')] : []),
    ...(legacy.summaries ? [t('agentPanelV4.legacySummaries')] : []),
    ...(legacy.archivedItems ? [t('agentPanelV4.legacyArchived')] : []),
    ...(legacy.missingToolArguments ? [t('agentPanelV4.legacyMissingArguments')] : []),
  ].join(t('agentPanelV4.legacySeparator')) : undefined
  // 跟到底交给现成库 use-stick-to-bottom（StackBlitz，MIT）：它看的是**内容高度**——流式长字、卡片展开、
  // 图片撑高都算，不看条目数；人往上翻（滚轮 / 拖滚动条 / 拖选文字）就松开不拽他，滚回离底 70px 以内自己重新跟上。
  // 这里只留两件本来就属于我们的事：「加载更早」时钉住他读到的那一行；收起 / 换形态回来时回到原处（定稿 §11.2）。
  const stick = useStickToBottom({ initial: 'instant', resize: 'instant' })
  const { scrollRef, contentRef, scrollToBottom, stopScroll, state: stuck } = stick
  // 上一次渲染时「在不在跟着底」。收起那一刻库自己会因为高度归零重新挂上跟随，所以记的是这里，不是那一刻的库状态。
  const followingRef = React.useRef(true)
  followingRef.current = stuck.isAtBottom
  const paging = React.useRef<{ settled: boolean } | null>(null)
  const pageOwner = React.useRef<object>({})
  const pageAnchor = React.useRef<{ owner: object; request: object; height: number; top: number; first?: string; cursor?: string } | null>(null)
  const [pageCompletion, setPageCompletion] = React.useState(0)
  const [historyError, setHistoryError] = React.useState(false)
  React.useLayoutEffect(() => {
    const owner = {}
    pageOwner.current = owner
    paging.current = null
    pageAnchor.current = null
    setHistoryError(false)
    return () => {
      if (pageOwner.current === owner) {
        pageOwner.current = {}
        paging.current = null
        pageAnchor.current = null
      }
    }
  }, [historyIdentity])
  React.useLayoutEffect(() => {
    const node = scrollRef.current
    if (node && pageAnchor.current && (flow[0]?.identity !== pageAnchor.current.first || historyCursor !== pageAnchor.current.cursor)) {
      // A reset/compaction is not a prepend. Only preserve an existing row's position.
      // 跟着底的时候不钉：底由跟到底那一路管（一页旧消息插在上面，他看的还是最新一条），这里只钉往上翻着读的人。
      if (!stuck.isAtBottom && flow[0]?.identity !== pageAnchor.current.first && pageAnchor.current.owner === pageOwner.current && flow.some(item => item.identity === pageAnchor.current?.first)) {
        node.scrollTop = pageAnchor.current.top + node.scrollHeight - pageAnchor.current.height
      }
      pageAnchor.current = null
      if (paging.current?.settled) paging.current = null
    }
  }, [flow, historyCursor, scrollRef, stuck])
  // 进了另一条对话（切线程 / 换面 / 换项目）：落到它的最新一条。这是一个明确的动作，不靠记忆、不看条目数。
  React.useLayoutEffect(() => {
    void scrollToBottom('instant')
  }, [conversationKey, scrollToBottom])
  /**
   * 收起成小球、换停靠 / 浮窗：同一棵面板的 DOM 被挪进隐藏容器或别的挂点（`ShellAgentHost` 的 reverse portal，
   * 不卸载），浏览器把滚动位置清零、库也因为高度归零重新挂上跟随。回来时照收起前那一刻还原：
   * 在跟着底就到**当下**的底（收起期间来的也看得见）；翻在半路就回那个像素，并且不跟（他在读）。
   * 对话流这块地方变矮（输入框长高、介入槽冒出来）也走这里：跟着底的人照样看得见最后一行。
   */
  React.useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return undefined
    let lastTop = node.scrollTop
    let frozen: { top: number; following: boolean } | null = null
    const remember = (): void => {
      if (!frozen && node.clientHeight > 0) lastTop = node.scrollTop
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      if (entry.contentRect.height === 0) {
        frozen ??= { top: lastTop, following: followingRef.current }
        return
      }
      const back = frozen
      frozen = null
      const following = back ? back.following : followingRef.current
      const top = back ? back.top : lastTop
      if (following) {
        void scrollToBottom('instant')
      } else if (back || Math.abs(node.scrollTop - top) > 1) {
        stopScroll()
        node.scrollTop = top
      }
    })
    node.addEventListener('scroll', remember, { passive: true })
    observer.observe(node)
    return () => {
      observer.disconnect()
      node.removeEventListener('scroll', remember)
    }
  }, [scrollRef, scrollToBottom, stopScroll])
  React.useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const onScroll = (): void => {
      if (node.scrollTop <= 24 && historyIdentity && onLoadOlder && !paging.current) {
        const owner = pageOwner.current
        const request = { settled: false }
        paging.current = request
        pageAnchor.current = { owner, request, height: node.scrollHeight, top: node.scrollTop, first: flow[0]?.identity, cursor: historyCursor }
        const current = () => pageOwner.current === owner && paging.current === request
        setHistoryError(false)
        let advanced = false
        void onLoadOlder().then(cursor => {
          advanced = cursor !== undefined && cursor !== historyCursor
          // The host has completed its read. An unchanged cursor proves no prepend;
          // a changed cursor retains the anchor until React commits that projection.
          if (current() && cursor === historyCursor && pageAnchor.current?.request === request) pageAnchor.current = null
        }).catch(() => {
          if (!current()) return
          pageAnchor.current = null
          setHistoryError(true)
        }).finally(() => {
          if (!current()) return
          request.settled = true
          // ACK is not a React commit. Keep the lock while this page still owns
          // an anchor, so another scroll cannot overwrite its pending geometry.
          if (pageAnchor.current?.request !== request) {
            paging.current = null
            // Commit may precede ACK; let a short filtered page continue only
            // after actual cursor progress, never retry an empty page in a loop.
            if (advanced) setPageCompletion(value => value + 1)
          }
        })
      }
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    if (node.scrollHeight <= node.clientHeight) onScroll()
    return () => node.removeEventListener('scroll', onScroll)
  }, [onLoadOlder, flow, historyIdentity, historyCursor, pageCompletion, scrollRef])
  const onComposerSubmit = composer?.onSubmit
  const submitAndFollow = React.useCallback((choice?: 'primary' | 'secondary') => {
    // 发出去的那句永远要看得见：他刚才翻在半路也拉回最新一条，接着跟（拍板 2）。
    void scrollToBottom('instant')
    onComposerSubmit?.(choice)
  }, [onComposerSubmit, scrollToBottom])
  return (
    <section
      // `overflow-clip` 而不是 `overflow-hidden`：hidden 仍然是一个**可以被程序滚动**的
      // 滚动容器，浏览器把新内容 scrollIntoView 时会把 scrollLeft 推走，而用户没有任何手段
      // 拖回来——一次溢出就变成永久裁切。面板自身在两个方向上都不该滚（对话流有自己的
      // `overflow-y-auto`），所以直接 clip：把「溢出」留在能看见的地方，不留一个静默的坏状态。
      className={cn('flex flex-col', workspacePanelFrame)}
      style={{ width, height }}
      data-v4-panel="true"
    >
      <header className={cn('flex shrink-0 items-center gap-2 text-body-sm font-semibold', workspaceFrame ? workspacePanelHeader : 'h-10 border-b border-nomi-line-soft px-3', headerSlot?.dragHandleClassName)}>
        <NomiBrand markSize={18} wordSize={14} />
        <V4ContextRing usage={context} labels={labels.context} />
        <span className="flex-1" />
        {headerSlot ? (
          <V4HeaderShellActions slot={headerSlot} compact={width < AGENT_HEADER_COMPACT_WIDTH} onHistory={onHistory} historyLabel={t('agentPanelV4.history')} moreLabel={t('agentPanelV4.headerMore')} />
        ) : (
        <span className="flex shrink-0 gap-2 text-nomi-ink-40">
          <button type="button" aria-label={t('agentPanelV4.history')} onClick={onHistory} data-v4-control="history">
            <IconHistory size={15} />
          </button>
          <button type="button" aria-label={t('agentPanelV4.collapsePanel')} onClick={onCollapse} data-v4-control="collapse">
            <IconLayoutSidebarRightCollapse size={15} />
          </button>
        </span>
        )}
      </header>
      {legacyNotice ? <p className="shrink-0 truncate px-3 pt-2 text-micro text-nomi-ink-60" title={legacyNotice} data-v4-legacy="true">{legacyNotice}</p> : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2.5" data-v4-flow="true">
          {/* 跟到底量的是这一层的高度；`grow` 让空态在内容不满时照样垂直居中。 */}
          <div ref={contentRef} className="flex shrink-0 grow flex-col gap-2.5 [&>*]:shrink-0" data-v4-flow-rows="true">
            {/* 空态只在**流为空**时占这块地方：来了第一条消息它就永远不再出现，
                所以它不是常驻件、不参与控件预算（设计系统 §1.5）。 */}
            {historyError ? <div role="alert">{t('agentPanelV4.historyLoadFailed')}</div> : null}
            {flow.length === 0 ? <V4EmptyState surface={surface} onStarter={onStarter} /> : null}
            {flow.map((item, index) => (
              <React.Fragment key={item.identity ?? `${item.kind}-${index}`}>
                <V4FlowRow
                  item={item}
                  index={index}
                  darkMode={darkMode}
                  handlers={stableFlowHandlers}
                />
                {/* 宿主确定性的提示（例如 3D-BOX 补丁覆盖了手调）画在这一行外面：收起的过程行也照样看得见 */}
                {flowItemNotices(item).map((notice, position) => <V4ReceiptNotice key={position} text={notice} />)}
                {/* `generate` 那一行：卡关掉以后挂那几镜的组指向（实时读节点，点了照样定位），同样画在行外面 */}
                {flowItemGenerations(item).map((operationId) => <GenerationReceiptPointers key={operationId} operationId={operationId} />)}
              </React.Fragment>
            ))}
            {flowTail}
          </div>
        </div>
      </div>
      {slot ? (
        <div className="shrink-0 px-2.5 pb-2">
          <V4Intervention data={slot} labels={labels.intervention} {...(slotBody ? { body: slotBody } : {})} {...(slotWaiting === undefined ? {} : { waiting: slotWaiting })} {...slotHandlers} />
        </div>
      ) : null}
      {queue?.length ? (
        <div className="shrink-0 px-2.5 pb-2">
          <V4Queue rows={queue} labels={labels.queue} {...queueHandlers} />
          {queueHint ? <p className="px-1 pt-1 text-micro text-nomi-ink-60">{queueHint}</p> : null}
        </div>
      ) : null}
      <div className={cn('flex shrink-0 flex-col gap-1.5 px-2.5 pb-2.5', !slot && !queue?.length && 'pt-2')}>
        {composerBanner}
        <AgentPanelV4Composer
          panelHeight={height}
          {...composer}
          onSubmit={onComposerSubmit ? submitAndFollow : undefined}
          mode={composer?.mode ?? 'idle'}
          permission={composer?.permission ?? DEFAULT_PERMISSION_TIER}
        />
      </div>
    </section>
  )
}

/**
 * 外壳插口给了形态切换时的头部右端（10-08 外壳拍板稿 CanvasAgent / CreationDoc）：历史 · 小球 / 浮窗 / 停靠。
 * 浮窗被拖窄（< AGENT_HEADER_COMPACT_WIDTH）时两样一起收进一颗「⋯」，菜单里是同几件事（协调裁决第 57 项）。
 */
function V4HeaderShellActions({ slot, compact, onHistory, historyLabel, moreLabel }: {
  slot: AgentPanelHeaderSlot
  compact: boolean
  onHistory?: () => void
  historyLabel: string
  moreLabel: string
}): JSX.Element {
  const [menu, setMenu] = React.useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const iconButton = 'grid size-7 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink'
  if (compact) {
    const items: WorkbenchMenuNode[] = [
      { id: 'history', label: historyLabel, icon: IconHistory, onSelect: () => onHistory?.() },
      { kind: 'separator', id: 'sep' },
      ...(slot.menuItems ?? []).map((item) => ({ id: item.id, label: item.label, onSelect: item.onSelect })),
    ]
    return (
      <>
        <button
          type="button"
          className={iconButton}
          aria-label={moreLabel}
          title={moreLabel}
          aria-haspopup="menu"
          data-v4-control="more"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            setMenu(menu ? null : { left: box.left, top: box.top, width: box.width, height: box.height })
          }}
        >
          <IconDots size={16} stroke={1.5} />
        </button>
        <WorkbenchMenu open={menu !== null} onOpenChange={(next) => { if (!next) setMenu(null) }} anchorRect={menu ?? { left: 0, top: 0, width: 0, height: 0 }} items={items} ariaLabel={moreLabel} />
      </>
    )
  }
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <button type="button" className={iconButton} aria-label={historyLabel} title={historyLabel} onClick={onHistory} data-v4-control="history">
        <IconHistory size={16} stroke={1.5} />
      </button>
      {slot.actions}
    </span>
  )
}
