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
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { AgentPanelV4Composer, type AgentPanelV4ComposerProps } from './AgentPanelV4Composer'
import { V4ContextRing } from './AgentPanelV4Context'
import { V4Intervention, V4Queue, V4TaskCard } from './AgentPanelV4Cards'
import { V4AssistantMessage, V4Suggestion, V4Thinking, V4UserBubble } from './AgentPanelV4Message'
import { V4ErrorBar, V4ToolReceipt } from './AgentPanelV4Receipt'
import { V4EmptyState } from './AgentPanelV4Empty'
import { IconHistory, IconLayoutSidebarRightCollapse } from './AgentPanelV4Icons'
import { useV4Labels } from './agentPanelV4Labels'
import type { V4FlowScrollMemoryBox } from './agentPanelV4ScrollMemory'
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
  onUndoTool?: (index: number) => void
  onAdoptCandidate?: (index: number, tag: string, candidateIndex: number) => void
  onUndoTask?: (index: number) => void
  onErrorAction?: (index: number) => void
  onSuggestion?: (index: number, option: string) => void
}>

export type V4InterventionHandlers = Readonly<{
  onConfirm?: () => void
  onReject?: (reason?: string) => void
  onEscalate?: () => void
  onAlternate?: () => void
  onOption?: (option: string, index: number) => void
  onPlanToggle?: (label: string, checked: boolean) => void
  onCollapsePlan?: () => void
}>

export type V4QueueHandlers = Readonly<{
  onAction?: (rowIndex: number, action: string) => void
  onDestructiveAction?: (rowIndex: number) => void
}>

export type AgentPanelV4PanelProps = {
  flow: readonly V4FlowItem[]
  /** 空态从这里派生它那三条起手（哪个面能做什么）。 */
  surface?: ResidentSurface
  /** 点空态起手 chip：把那句话填进 composer 并聚焦，**不发送**。 */
  onStarter?: (prompt: string) => void
  slot?: InterventionData
  queue?: readonly QueueRowData[]
  context: ContextUsage
  composer?: Omit<AgentPanelV4ComposerProps, 'panelHeight'> & {
    permission?: PermissionTier
    chips?: readonly V4Chip[]
  }
  width?: number
  height?: number
  darkMode?: boolean
  flowHandlers?: V4FlowHandlers
  slotHandlers?: V4InterventionHandlers
  queueHandlers?: V4QueueHandlers
  onHistory?: () => void
  onCollapse?: () => void
  /**
   * 「用户读到哪儿了」的存放处（09-01 定稿 §11.2：点角标 = 原宽**原状态**还原）。
   * 收起会把对话流这棵子树整个摘掉，`scrollTop` 跟着 DOM 一起没了；本组件自己存不住，
   * 所以让宿主给一个活得比它久的盒子（`agentPanelV4ScrollMemory.ts`）。
   * 不给（设计实验室、单测）就是每次挂载都跟到底，与从前一样。
   */
  scrollMemory?: V4FlowScrollMemoryBox
}

/** 对话流里的一条 = 一个积木；哪个积木由 kind 决定，壳不认识内容。 */
export function V4FlowRow({
  item,
  index,
  darkMode,
  panelHeight,
  handlers,
}: {
  item: V4FlowItem
  index?: number
  darkMode: boolean
  panelHeight?: number
  handlers?: V4FlowHandlers
}): JSX.Element {
  const labels = useV4Labels()
  const at = index ?? 0
  if (item.kind === 'user') return <V4UserBubble text={item.text} chips={item.chips} darkMode={darkMode} />
  if (item.kind === 'assistant') {
    return (
      <V4AssistantMessage
        text={item.text}
        status={item.status}
        labels={labels.assistant}
        panelHeight={panelHeight}
        onCopy={handlers?.onCopy}
        {...(handlers?.onRetry ? { onRetry: () => handlers.onRetry?.(at) } : {})}
        {...(handlers?.onContinue ? { onContinue: () => handlers.onContinue?.(at) } : {})}
      />
    )
  }
  if (item.kind === 'thinking') return <V4Thinking label={item.label} meta={item.meta} />
  if (item.kind === 'suggestion') {
    return (
      <V4Suggestion
        text={item.text}
        options={item.options}
        panelHeight={panelHeight}
        onSelect={(option) => handlers?.onSuggestion?.(at, option)}
      />
    )
  }
  if (item.kind === 'tool') {
    return (
      <V4ToolReceipt
        receipt={item.receipt}
        statusLabel={labels.toolStatus[item.receipt.status]}
        undoLabel={labels.task.undo}
        onUndo={() => handlers?.onUndoTool?.(at)}
      />
    )
  }
  if (item.kind === 'task') {
    return (
      <V4TaskCard
        task={item.task}
        labels={labels.task}
        onAdopt={(tag, candidateIndex) => handlers?.onAdoptCandidate?.(at, tag, candidateIndex)}
        onUndo={() => handlers?.onUndoTask?.(at)}
        onErrorAction={() => handlers?.onErrorAction?.(at)}
      />
    )
  }
  return <V4ErrorBar reason={item.reason} action={item.action} onAction={() => handlers?.onErrorAction?.(at)} />
}

export function AgentPanelV4Panel({
  flow,
  surface = 'creation',
  onStarter,
  slot,
  queue,
  context,
  composer,
  width = 390,
  height = 620,
  darkMode = false,
  flowHandlers,
  slotHandlers,
  queueHandlers,
  onHistory,
  onCollapse,
  scrollMemory,
}: AgentPanelV4PanelProps): JSX.Element {
  const { t } = useTranslation()
  const labels = useV4Labels()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  // 跟到底：只有用户本来就在底部时才跟。他往上翻着看历史的时候把他拽回来，
  // 比不跟更糟——那是把「我在读」当成「我想看新的」。
  // 初值取自宿主记下的那次：展开回来时先恢复「他当时在不在底」，再决定跟不跟。
  const atBottomRef = React.useRef(scrollMemory?.current.atBottom ?? true)
  /**
   * 展开那一刻把位置还回去，用 layout effect（跟到底那条是普通 effect，跑在它之后，
   * 而 `atBottomRef` 已经是收起前的值——他当时翻在半路，就不会被新一轮「跟到底」拽走）。
   * 在 paint 之前还原：放进普通 effect 会先画一帧在顶部，看起来像内容闪了一下。
   */
  React.useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return undefined
    const remembered = scrollMemory?.current
    // 记的是底就跟到**当下**这个底：收起期间来的那几条也要看得见，回到旧的那个像素反而是错的。
    if (remembered) node.scrollTop = remembered.atBottom ? node.scrollHeight : remembered.top
    return () => {
      // 位置在**这里**记：布局 effect 的清理跑在节点还挂在文档里的那一刻（提交的 mutation 阶段）。
      //
      // 另外两种写法都记到假话，而且长得跟真的一样：① 靠 scroll 事件记——一个从没被滚过的位置
      // （内容长出来把人留在顶上）压根不发事件，记下的是上一次滚到的地方；② 放普通 effect 的清理——
      // 那时节点已经被摘掉，`scrollTop`/`scrollHeight` 全读成 0，于是「他在顶上」被记成「他在底部」。
      // 2026-09-06 真机走查两次都是同一个现象：收起前明明停在 0，展开弹回 259.5 的底。
      if (scrollMemory) {
        scrollMemory.current = {
          top: node.scrollTop,
          atBottom: node.scrollHeight - node.scrollTop - node.clientHeight < 24,
        }
      }
    }
  }, [scrollMemory])
  React.useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const onScroll = (): void => {
      atBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [])
  React.useEffect(() => {
    const node = scrollRef.current
    if (node && atBottomRef.current) node.scrollTop = node.scrollHeight
  }, [flow.length, slot?.title, queue?.length])
  return (
    <section
      // `overflow-clip` 而不是 `overflow-hidden`：hidden 仍然是一个**可以被程序滚动**的
      // 滚动容器，浏览器把新内容 scrollIntoView 时会把 scrollLeft 推走，而用户没有任何手段
      // 拖回来——一次溢出就变成永久裁切。面板自身在两个方向上都不该滚（对话流有自己的
      // `overflow-y-auto`），所以直接 clip：把「溢出」留在能看见的地方，不留一个静默的坏状态。
      className="flex flex-col overflow-clip rounded-nomi border border-nomi-line bg-nomi-paper"
      style={{ width, height }}
      data-v4-panel="true"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-nomi-line-soft px-3 text-body-sm font-semibold">
        <span
          className="grid size-[18px] shrink-0 place-items-center rounded-nomi-sm bg-nomi-ink text-micro not-italic text-nomi-paper"
          aria-hidden="true"
        >
          {t('agentPanelV4.logo')}
        </span>
        {t('agentPanelV4.brand')}
        <V4ContextRing usage={context} labels={labels.context} />
        <span className="flex-1" />
        <span className="flex shrink-0 gap-2 text-nomi-ink-40">
          <button type="button" aria-label={t('agentPanelV4.history')} onClick={onHistory} data-v4-control="history">
            <IconHistory size={15} />
          </button>
          <button type="button" aria-label={t('agentPanelV4.collapsePanel')} onClick={onCollapse} data-v4-control="collapse">
            <IconLayoutSidebarRightCollapse size={15} />
          </button>
        </span>
      </header>
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-2.5" data-v4-flow="true">
        {/* 空态只在**流为空**时占这块地方：来了第一条消息它就永远不再出现，
            所以它不是常驻件、不参与控件预算（设计系统 §1.5）。 */}
        {flow.length === 0 ? <V4EmptyState surface={surface} onStarter={onStarter} /> : null}
        {flow.map((item, index) => (
          <V4FlowRow
            key={`${item.kind}-${index}`}
            item={item}
            index={index}
            darkMode={darkMode}
            panelHeight={height}
            handlers={flowHandlers}
          />
        ))}
      </div>
      {slot ? (
        <div className="shrink-0 px-2.5 pb-2">
          <V4Intervention data={slot} labels={labels.intervention} {...slotHandlers} />
        </div>
      ) : null}
      {queue?.length ? (
        <div className="shrink-0 px-2.5 pb-2">
          <V4Queue rows={queue} labels={labels.queue} {...queueHandlers} />
        </div>
      ) : null}
      <div className={cn('shrink-0 px-2.5 pb-2.5', !slot && !queue?.length && 'pt-2')}>
        <AgentPanelV4Composer
          panelHeight={height}
          {...composer}
          mode={composer?.mode ?? 'idle'}
          permission={composer?.permission ?? DEFAULT_PERMISSION_TIER}
        />
      </div>
    </section>
  )
}
