// Agent 三种形态的宿主（10-08 外壳拍板稿 Main / CanvasAgent / CreationDoc / Chrome）：小球 / 浮窗 / 停靠右侧。
// 设计卡 docs/plan/2026-10-08-shell-redesign.md「Agent 三形态状态表」。
//
// 形态归 agentFormStore（唯一 owner，每页一份）。这里只做四件事：
//   1. 把同一个常驻面板（ProjectAgentResidentShell）摆到对的地方：停靠 → 工作区给的右栏；浮窗 → react-rnd 窗；
//      小球 → 面板收起（回执效果、计划预览、角标投影照跑），只留小球；
//   2. 面板头部右端换成「小球 · 浮窗 · 停靠」三选一（AgentPanelHeaderSlotContext），浮窗窄时收进「⋯」；
//   3. 快捷键：Mod+J 打开并聚焦输入框；Mod+\ 当前页在「停靠 ↔ 小球」之间切（浮窗时收成小球）；
//   4. 小球 / 浮窗的坐标系：工作区给的「浮层位」（生成页 = 画布那一格，让开底边时间轴），没给就是整块内容区。
// 窄窗档（窗口宽 < NARROW_TIER_WIDTH，WindowNarrow 板）：这里挂唯一的 matchMedia，写 agentFormStore.windowNarrow；
// 停靠的页此刻显示成小球、点开是浮窗，形态切换里「停靠」变灰；所有「人要某个形态」都走 requestForm，存档只在人亲手点时写。
// 拖动、改大小、出界约束全交给 react-rnd；窗口缩小后的「夹回可见区」在渲染时算（不回写），见 agentFormStore.clampRect。
import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Rnd } from 'react-rnd'
import { createHtmlPortalNode, InPortal, OutPortal, type HtmlPortalNode } from 'react-reverse-portal'
import { IconLayoutSidebarRight, IconPictureInPicture } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, WorkbenchMenu, type WorkbenchMenuNode } from '../../../design'
import { modalInputLayerCovers } from '../../../design/modalInputLayer'
import { cn } from '../../../utils/cn'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { useResidentActivityStore } from '../../../workbench/ai/residentActivity'
import { AgentPanelHeaderSlotContext, type AgentPanelHeaderSlot } from './agentPanelHeaderSlot'
import { dockStatusLabel } from '../../../workbench/ai/v4/agentPanelV4DockStatus'
import { useV4Labels } from '../../../workbench/ai/v4/agentPanelV4Labels'
import { AgentBallFace } from './AgentBallFace'
import {
  BALL_SIZE,
  FLOAT_MIN,
  NARROW_MOTION_CLEAR_MS,
  NARROW_TIER_QUERY,
  NARROW_TIER_WIDTH,
  agentBallIsPill,
  effectiveAgentForm,
  useEffectiveAgentForm,
  clampBall,
  clampRect,
  defaultBallPoint,
  defaultFloatRect,
  useAgentFormStore,
  type AgentForm,
  type AgentFormSurface,
} from './agentFormStore'

const DRAG_HANDLE = 'shell-agent-drag-handle'
const PILL_WIDTH = 132
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl+'

/** 从小球「打开」去哪：生成页（画布 / 列表）是浮窗，其余三页是停靠（拍板稿各页默认）。 */
function openFormFor(surface: AgentFormSurface): AgentForm {
  return surface === 'generation' ? 'float' : 'dock'
}

/**
 * 「点开」该不该把面板摆出来：看此刻显示的是不是小球。dockSuppressed（生成页大详情占着右边）不算——
 * 那时停靠的页本来就显示小球、按快捷键也不弹（沿用改前的行为）；窄窗档的小球算。
 */
function shownIgnoringSuppression(surface: AgentFormSurface): AgentForm {
  const state = useAgentFormStore.getState()
  return effectiveAgentForm(state.bySurface[surface].form, { windowNarrow: state.windowNarrow, narrowOpen: state.narrowOpen, dockSuppressed: false })
}

function useAreaSize(node: HTMLElement | null): { width: number; height: number } {
  const [size, setSize] = React.useState({ width: 0, height: 0 })
  React.useLayoutEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const update = () => setSize({ width: node.clientWidth, height: node.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return size
}

function focusComposerSoon(): void {
  let frames = 0
  const tick = () => {
    const input = document.querySelector<HTMLTextAreaElement>('#project-agent-resident textarea')
    // 小球形态时面板整棵挪在看不见的容器里，输入框一直「找得到」：要等它真的摆进浮窗 / 停靠栏（有盒子）再聚焦，
    // 否则第一帧 focus() 落空、焦点留在原处（窄窗小球按 ⌘J 就是这样）。
    if (input && input.getClientRects().length > 0) {
      input.focus()
      return
    }
    if (frames++ < 20) window.requestAnimationFrame(tick)
  }
  window.requestAnimationFrame(tick)
}

function BallIcon(): JSX.Element {
  return <span className="block size-2 rounded-full bg-current" aria-hidden="true" />
}

/** 面板头部右端：小球 · 浮窗 · 停靠 三选一，当前形态高亮（CanvasAgent 板 .form）。 */
function FormSwitch({ surface, form }: { surface: AgentFormSurface; form: AgentForm }): JSX.Element {
  const { t } = useTranslation()
  const requestForm = useAgentFormStore((state) => state.requestForm)
  const narrow = useAgentFormStore((state) => state.windowNarrow)
  const options: { id: AgentForm; label: string; icon: JSX.Element }[] = [
    { id: 'ball', label: t('appShell.agent.toBall'), icon: <BallIcon /> },
    { id: 'float', label: t('appShell.agent.toFloat'), icon: <IconPictureInPicture size={15} stroke={1.5} aria-hidden="true" /> },
    { id: 'dock', label: t('appShell.agent.toDock'), icon: <IconLayoutSidebarRight size={15} stroke={1.5} aria-hidden="true" /> },
  ]
  const narrowHint = t('appShell.agent.dockNarrow', { width: NARROW_TIER_WIDTH })
  return (
    <TooltipProvider delayDuration={250} disableHoverableContent>
      <span className="ml-0.5 inline-flex h-7 shrink-0 items-center gap-0.5 rounded-pill bg-nomi-ink-05 p-0.5" role="radiogroup" aria-label={t('appShell.agent.formMenu')} data-agent-form-switch>
        {options.map((option) => {
          const on = option.id === form
          // 窄窗档里「停靠」放不下：变灰、点了不动，悬停说为什么、什么时候自己回来（WindowNarrow 板 agent.form-switch-dock-disabled）。
          const blocked = narrow && option.id === 'dock'
          const button = (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={blocked || undefined}
              aria-label={blocked ? `${option.label} · ${narrowHint}` : option.label}
              title={blocked ? undefined : option.label}
              data-agent-form-to={option.id}
              data-agent-form-blocked={blocked ? 'narrow' : undefined}
              onClick={() => {
                if (blocked) return
                requestForm(surface, option.id)
                if (option.id !== 'ball') focusComposerSoon()
              }}
              className={cn(
                'grid h-6 w-7 place-items-center rounded-pill border-0 p-0 transition-[background,color,box-shadow] duration-nomi-fast',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink',
                blocked
                  ? 'cursor-not-allowed bg-transparent text-nomi-ink-30'
                  : on ? 'bg-nomi-paper text-nomi-ink shadow-nomi-sm' : 'bg-transparent text-nomi-ink-60 hover:text-nomi-ink',
              )}
            >
              {option.icon}
            </button>
          )
          if (!blocked) return button
          return (
            <Tooltip key={option.id}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="top" className="z-popover" data-agent-form-blocked-hint>{narrowHint}</TooltipContent>
            </Tooltip>
          )
        })}
      </span>
    </TooltipProvider>
  )
}

function AgentBall({ surface, area }: { surface: AgentFormSurface; area: { width: number; height: number } }): JSX.Element | null {
  const { t } = useTranslation()
  const labels = useV4Labels()
  const status = useResidentActivityStore((state) => state.dockStatus)
  const pending = useResidentActivityStore((state) => state.dockPendingCount)
  const unread = useResidentActivityStore((state) => state.dockUnreadCount)
  const stored = useAgentFormStore((state) => state.bySurface[surface].ball)
  const setBallPoint = useAgentFormStore((state) => state.setBallPoint)
  const requestForm = useAgentFormStore((state) => state.requestForm)
  const narrow = useAgentFormStore((state) => state.windowNarrow)
  // 这颗小球是不是「窄窗把停靠临时收起来」的那颗：是就换悬停提示，并在跨阈值那一下播收拢。
  const narrowHeld = useAgentFormStore((state) => state.windowNarrow && state.bySurface[surface].form === 'dock')
  const gathering = useAgentFormStore((state) => state.narrowMotion === 'collapse' && state.bySurface[surface].form === 'dock')
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null)
  const dragStart = React.useRef<{ x: number; y: number } | null>(null)
  const pill = agentBallIsPill(status, pending)
  const width = pill ? PILL_WIDTH : BALL_SIZE
  if (!area.width || !area.height) return null
  const base = stored ?? defaultBallPoint(area)
  // 胶囊比球宽：以右缘为准往左长，「同一位置」= 右下角不动。
  const point = clampBall({ x: base.x + BALL_SIZE - width, y: base.y }, area, { width, height: BALL_SIZE })
  const open = () => {
    requestForm(surface, openFormFor(surface))
    focusComposerSoon()
  }
  const statusText = status ? dockStatusLabel(status, pending, labels.dock) : labels.dock.idle
  const label = pill
    ? t('appShell.agent.ballPending', { count: pending })
    : t(narrowHeld ? 'appShell.agent.ballNarrow' : 'appShell.agent.ballOpen', { shortcut: `${MOD}J` })
  // 未读（不含等你确认那几条——那几条已经在胶囊里点名）：悬停 / 读屏说「N 条新消息」。
  const unreadOnly = pill ? 0 : Math.max(0, unread - pending)
  const title = [label, statusText, unreadOnly > 0 ? t('appShell.agent.ballUnread', { count: unreadOnly }) : null].filter(Boolean).join(' · ')
  const items: WorkbenchMenuNode[] = [
    { id: 'float', label: t('appShell.agent.toFloat'), icon: IconPictureInPicture, onSelect: () => { requestForm(surface, 'float'); focusComposerSoon() } },
    narrow
      ? { id: 'dock', label: t('appShell.agent.toDock'), icon: IconLayoutSidebarRight, disabled: true, disabledReason: t('appShell.agent.dockNarrow', { width: NARROW_TIER_WIDTH }), onSelect: () => undefined }
      : { id: 'dock', label: t('appShell.agent.toDock'), icon: IconLayoutSidebarRight, onSelect: () => { requestForm(surface, 'dock'); focusComposerSoon() } },
  ]
  return (
    <>
      <Rnd
        className="pointer-events-auto"
        bounds="parent"
        size={{ width, height: BALL_SIZE }}
        position={point}
        enableResizing={false}
        onDragStart={(_event, data) => { dragStart.current = { x: data.x, y: data.y } }}
        onDragStop={(_event, data) => {
          const start = dragStart.current
          dragStart.current = null
          // 几乎没动 = 这是一次点击，交给按钮自己的 onClick。
          if (start && Math.abs(start.x - data.x) + Math.abs(start.y - data.y) < 4) return
          setBallPoint(surface, { x: data.x - BALL_SIZE + width, y: data.y })
        }}
      >
        <AgentBallFace
          status={status}
          pendingCount={pending}
          unreadCount={unreadOnly}
          label={label}
          title={title}
          className={cn(pill && 'w-full', gathering && 'origin-bottom-right motion-safe:animate-nomi-agent-gather')}
          data-agent-ball-narrow={narrowHeld ? 'true' : undefined}
          onClick={open}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenu({ x: event.clientX, y: event.clientY })
          }}
        />
      </Rnd>
      <WorkbenchMenu open={menu !== null} onOpenChange={(next) => { if (!next) setMenu(null) }} point={menu ?? { x: 0, y: 0 }} items={items} side="top" ariaLabel={t('appShell.agent.formMenu')} />
    </>
  )
}

function AgentFloat({ surface, area, children }: { surface: AgentFormSurface; area: { width: number; height: number }; children: React.ReactNode }): JSX.Element | null {
  const { t } = useTranslation()
  const stored = useAgentFormStore((state) => state.bySurface[surface].float)
  const setFloatRect = useAgentFormStore((state) => state.setFloatRect)
  if (!area.width || !area.height) return null
  const rect = clampRect(stored ?? defaultFloatRect(area), area)
  return (
    <Rnd
      className="pointer-events-auto"
      bounds="parent"
      size={{ width: rect.width, height: rect.height }}
      position={{ x: rect.x, y: rect.y }}
      minWidth={Math.min(FLOAT_MIN.width, area.width)}
      minHeight={Math.min(FLOAT_MIN.height, area.height)}
      dragHandleClassName={DRAG_HANDLE}
      cancel="button, input, textarea, [contenteditable='true'], [role='menu'], [role='radiogroup']"
      onDragStop={(_event, data) => setFloatRect(surface, { ...rect, x: data.x, y: data.y })}
      onResizeStop={(_event, _direction, element, _delta, position) => setFloatRect(surface, {
        x: position.x, y: position.y, width: element.offsetWidth, height: element.offsetHeight,
      })}
    >
      <section
        className="relative size-full overflow-hidden rounded-nomi-lg bg-nomi-paper shadow-nomi-lg ring-1 ring-nomi-line-soft [&_[data-v4-panel]]:rounded-none [&_[data-v4-panel]]:ring-0"
        aria-label={t('appShell.agent.floatAria')}
        data-agent-float={surface}
      >
        {/* 顶部中间六个点 = 拖动手柄的样子（真正的手柄是整条头部）；左上角折线 = 改大小的角。 */}
        <svg className={cn(DRAG_HANDLE, 'absolute left-1/2 top-0.5 z-[2] h-2.5 w-5 -translate-x-1/2 cursor-move text-nomi-ink-30')} viewBox="0 0 20 10" aria-hidden="true">
          {[4, 10, 16].flatMap((cx) => [3, 7].map((cy) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.2" fill="currentColor" />))}
        </svg>
        <svg className="pointer-events-none absolute left-[3px] top-[3px] z-[2] size-2.5 text-nomi-ink-30" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 9V1h8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {children}
      </section>
    </Rnd>
  )
}

/**
 * 摆面板。`dockTarget` 是工作区给的右栏（只有停靠形态用它）；`layerTarget` 是工作区给的浮层位
 * （小球 / 浮窗的坐标系，生成页 = 画布那一格）；没给就用整块内容区（本组件自己那一层）。
 */
export function ShellAgentHost({
  surface,
  dockTarget,
  layerTarget,
  agent,
}: {
  surface: AgentFormSurface
  dockTarget: HTMLDivElement | null
  layerTarget?: HTMLDivElement | null
  agent: React.ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  const form = useEffectiveAgentForm(surface)
  const requestForm = useAgentFormStore((state) => state.requestForm)
  const narrow = useAgentFormStore((state) => state.windowNarrow)
  const narrowMotion = useAgentFormStore((state) => state.narrowMotion)
  const restoring = narrowMotion === 'restore'
  const [ownLayer, setOwnLayer] = React.useState<HTMLDivElement | null>(null)
  const [hidden, setHidden] = React.useState<HTMLDivElement | null>(null)
  const layer = layerTarget ?? ownLayer
  const area = useAreaSize(layer)

  // 「面板占不占位」在 Agent 的 layout.read/write 契约里叫 visibility.assistant（projectAgentDockCollapsed）。
  // 形态是它唯一的写入者：小球 ⇔ 收起。单向驱动，不让两份「占不占位」各说各的。
  React.useEffect(() => {
    const store = useWorkbenchStore.getState()
    const collapsed = form === 'ball'
    if (store.projectAgentDockCollapsed !== collapsed) store.setProjectAgentDockCollapsed(collapsed)
  }, [form])
  // 别处叫回面板（任务中心「定位到制作」、Agent 自己的 layout.write）：小球 → 这一页的默认展开形态。
  // 看的是「叫回」计数（agentRecallNonce），不是 projectAgentDockCollapsed 的翻转：重开项目时那个投影会被还原 / 重置翻一下，
  // 按翻转去猜，小球就会在用户什么也没点时自己弹成浮窗（评测 j5 重开项目后浮窗盖住生成钮）。
  React.useEffect(() => useWorkbenchStore.subscribe((state) => state.agentRecallNonce, () => {
    if (shownIgnoringSuppression(surface) === 'ball') requestForm(surface, openFormFor(surface))
  }), [requestForm, surface])
  // 外壳唯一的窄窗判断（narrow.one-threshold）：一条 matchMedia，跨阈值才回调（拖窗过程中不逐帧算）。
  // 挂载时那次对齐不算「跨过」，不播收拢。
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia(NARROW_TIER_QUERY)
    useAgentFormStore.getState().setWindowNarrow(query.matches, { animate: false })
    const onChange = (event: MediaQueryListEvent) => useAgentFormStore.getState().setWindowNarrow(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  // 跨阈值的过渡只播这一次：到点就清。不靠 animationend——减弱动效 / 这一页不是停靠时没有元素在播，
  // 留着的标记会让之后某次手动停靠凭空再播一遍。
  React.useEffect(() => {
    if (!narrowMotion) return undefined
    const timer = window.setTimeout(() => useAgentFormStore.getState().clearNarrowMotion(), NARROW_MOTION_CLEAR_MS)
    return () => window.clearTimeout(timer)
  }, [narrowMotion])
  // Mod+J：打开并聚焦输入框（代替被删掉的那条常驻输入条）。Mod+\：停靠 ↔ 小球（浮窗时收成小球）。
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      // 整窗模态开着时不叫面板，也不把焦点抢出模态；灯箱只盖画布那一格，不算。
      if (modalInputLayerCovers(document.body)) return
      const shown = shownIgnoringSuppression(surface)
      if (event.key.toLowerCase() === 'j') {
        event.preventDefault()
        if (shown === 'ball') requestForm(surface, openFormFor(surface))
        focusComposerSoon()
      } else if (event.key === '\\') {
        event.preventDefault()
        requestForm(surface, shown === 'ball' ? 'dock' : 'ball')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [requestForm, surface])

  // E2E 专用桥（同 TaskCenterButton / ProductionCanvasLandingHost 的既有写法）：仅当 localStorage['__nomiE2E']==='1'
  // 时把小球读的角标投影与形态 store 挂到 window，供零额度走查摆出小球四态截图（不跑真 Agent、不花钱）。生产从不置该标志。
  React.useEffect(() => {
    try {
      if (window.localStorage?.getItem('__nomiE2E') === '1') {
        const w = window as unknown as { __nomiResidentActivityStore?: unknown; __nomiAgentFormStore?: unknown }
        w.__nomiResidentActivityStore = useResidentActivityStore
        w.__nomiAgentFormStore = useAgentFormStore
      }
    } catch {
      // localStorage 不可用 → 跳过
    }
  }, [])

  const slot = React.useMemo<AgentPanelHeaderSlot>(() => ({
    actions: <FormSwitch surface={surface} form={form} />,
    menuItems: [
      { id: 'form-ball', label: t('appShell.agent.toBall'), onSelect: () => requestForm(surface, 'ball') },
      { id: 'form-float', label: t('appShell.agent.toFloat'), onSelect: () => requestForm(surface, 'float') },
      narrow
        ? { id: 'form-dock', label: t('appShell.agent.toDock'), disabled: true, disabledReason: t('appShell.agent.dockNarrow', { width: NARROW_TIER_WIDTH }), onSelect: () => undefined }
        : { id: 'form-dock', label: t('appShell.agent.toDock'), onSelect: () => requestForm(surface, 'dock') },
    ],
    ...(form === 'float' ? { dragHandleClassName: cn(DRAG_HANDLE, 'cursor-move') } : {}),
  }), [form, narrow, requestForm, surface, t])
  // 面板只挂**一棵**稳定的 React 树（react-reverse-portal：InPortal 渲染一次，OutPortal 决定它的 DOM 落在哪）。
  // 三形态切换只是把同一个 DOM 节点挪到停靠栏 / 浮窗 / 隐藏容器，不卸载重挂——待确认卡的勾选与折叠、滚动、
  // 历史分页、线程菜单、草稿都留在原地（#1136 评审阻断 1：此前每种形态 portal 到不同容器，切一次就整棵重挂）。
  const [panelNode] = React.useState<HtmlPortalNode>(() => createHtmlPortalNode({
    attributes: { style: 'display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0', 'data-agent-portal': 'true' },
  }))
  const panelOut = <OutPortal node={panelNode} />
  const floating = (
    <>
      {form === 'ball' ? <AgentBall surface={surface} area={area} /> : null}
      {form === 'float' ? <AgentFloat surface={surface} area={area}>{panelOut}</AgentFloat> : null}
    </>
  )
  return (
    <div ref={setOwnLayer} className="pointer-events-none absolute inset-0 z-[60]" data-shell-agent-layer data-agent-form={form}>
      <InPortal node={panelNode}>
        <AgentPanelHeaderSlotContext.Provider value={slot}>{agent}</AgentPanelHeaderSlotContext.Provider>
      </InPortal>
      {/* 小球形态：同一棵面板挪进看不见的容器（回执效果、计划预览、角标投影照常跑），点开再挪回来。 */}
      <div ref={setHidden} hidden />
      {form === 'dock' && dockTarget ? createPortal(
        // 拉宽跨回阈值：停靠栏里的面板从右侧展回来（只播一次，减弱动效直接出现）。
        <div
          className={cn('flex size-full min-h-0 min-w-0 flex-col', restoring && 'motion-safe:animate-nomi-agent-dock-in')}
          data-agent-dock-motion={restoring ? 'restore' : undefined}
        >
          {panelOut}
        </div>,
        dockTarget,
      ) : null}
      {form === 'ball' && hidden ? createPortal(panelOut, hidden) : null}
      {layerTarget ? createPortal(floating, layerTarget) : floating}
    </div>
  )
}
