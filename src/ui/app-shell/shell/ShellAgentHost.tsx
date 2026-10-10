// Agent 三种形态的宿主（10-08 外壳拍板稿 Main / CanvasAgent / CreationDoc / Chrome）：小球 / 浮窗 / 停靠右侧。
// 设计卡 docs/plan/2026-10-08-shell-redesign.md「Agent 三形态状态表」。
//
// 形态归 agentFormStore（唯一 owner，每页一份）。这里只做四件事：
//   1. 把同一个常驻面板（ProjectAgentResidentShell）摆到对的地方：停靠 → 工作区给的右栏；浮窗 → react-rnd 窗；
//      小球 → 面板收起（回执效果、计划预览、角标投影照跑），只留小球；
//   2. 面板头部右端换成「小球 · 浮窗 · 停靠」三选一（AgentPanelHeaderSlotContext），浮窗窄时收进「⋯」；
//   3. 快捷键：Mod+J 打开并聚焦输入框；Mod+\ 当前页在「停靠 ↔ 小球」之间切（浮窗时收成小球）；
//   4. 小球 / 浮窗的坐标系：工作区给的「浮层位」（生成页 = 画布那一格，让开底边时间轴），没给就是整块内容区。
// 拖动、改大小、出界约束全交给 react-rnd；窗口缩小后的「夹回可见区」在渲染时算（不回写），见 agentFormStore.clampRect。
import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Rnd } from 'react-rnd'
import { createHtmlPortalNode, InPortal, OutPortal, type HtmlPortalNode } from 'react-reverse-portal'
import { IconLayoutSidebarRight, IconPictureInPicture } from '@tabler/icons-react'
import { WorkbenchMenu, type WorkbenchMenuNode } from '../../../design'
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
  agentBallIsPill,
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
    if (input) input.focus()
    else if (frames++ < 20) window.requestAnimationFrame(tick)
  }
  window.requestAnimationFrame(tick)
}

function BallIcon(): JSX.Element {
  return <span className="block size-2 rounded-full bg-current" aria-hidden="true" />
}

/** 面板头部右端：小球 · 浮窗 · 停靠 三选一，当前形态高亮（CanvasAgent 板 .form）。 */
function FormSwitch({ surface, form }: { surface: AgentFormSurface; form: AgentForm }): JSX.Element {
  const { t } = useTranslation()
  const setForm = useAgentFormStore((state) => state.setForm)
  const options: { id: AgentForm; label: string; icon: JSX.Element }[] = [
    { id: 'ball', label: t('appShell.agent.toBall'), icon: <BallIcon /> },
    { id: 'float', label: t('appShell.agent.toFloat'), icon: <IconPictureInPicture size={15} stroke={1.5} aria-hidden="true" /> },
    { id: 'dock', label: t('appShell.agent.toDock'), icon: <IconLayoutSidebarRight size={15} stroke={1.5} aria-hidden="true" /> },
  ]
  return (
    <span className="ml-0.5 inline-flex h-7 shrink-0 items-center gap-0.5 rounded-pill bg-nomi-ink-05 p-0.5" role="radiogroup" aria-label={t('appShell.agent.formMenu')} data-agent-form-switch>
      {options.map((option) => {
        const on = option.id === form
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={option.label}
            title={option.label}
            data-agent-form-to={option.id}
            onClick={() => {
              setForm(surface, option.id)
              if (option.id !== 'ball') focusComposerSoon()
            }}
            className={cn(
              'grid h-6 w-7 place-items-center rounded-pill border-0 p-0 transition-[background,color,box-shadow] duration-nomi-fast',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-accent',
              on ? 'bg-nomi-paper text-nomi-ink shadow-nomi-sm' : 'bg-transparent text-nomi-ink-60 hover:text-nomi-ink',
            )}
          >
            {option.icon}
          </button>
        )
      })}
    </span>
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
  const setForm = useAgentFormStore((state) => state.setForm)
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null)
  const dragStart = React.useRef<{ x: number; y: number } | null>(null)
  const pill = agentBallIsPill(status, pending)
  const width = pill ? PILL_WIDTH : BALL_SIZE
  if (!area.width || !area.height) return null
  const base = stored ?? defaultBallPoint(area)
  // 胶囊比球宽：以右缘为准往左长，「同一位置」= 右下角不动。
  const point = clampBall({ x: base.x + BALL_SIZE - width, y: base.y }, area, { width, height: BALL_SIZE })
  const open = () => {
    setForm(surface, openFormFor(surface))
    focusComposerSoon()
  }
  const statusText = status ? dockStatusLabel(status, pending, labels.dock) : labels.dock.idle
  const label = pill ? t('appShell.agent.ballPending', { count: pending }) : t('appShell.agent.ballOpen', { shortcut: `${MOD}J` })
  // 未读（不含等你确认那几条——那几条已经在胶囊里点名）：悬停 / 读屏说「N 条新消息」。
  const unreadOnly = pill ? 0 : Math.max(0, unread - pending)
  const title = [label, statusText, unreadOnly > 0 ? t('appShell.agent.ballUnread', { count: unreadOnly }) : null].filter(Boolean).join(' · ')
  const items: WorkbenchMenuNode[] = [
    { id: 'float', label: t('appShell.agent.toFloat'), icon: IconPictureInPicture, onSelect: () => { setForm(surface, 'float'); focusComposerSoon() } },
    { id: 'dock', label: t('appShell.agent.toDock'), icon: IconLayoutSidebarRight, onSelect: () => { setForm(surface, 'dock'); focusComposerSoon() } },
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
          className={pill ? 'w-full' : undefined}
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
  const setForm = useAgentFormStore((state) => state.setForm)
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
    if (useAgentFormStore.getState().bySurface[surface].form === 'ball') setForm(surface, openFormFor(surface))
  }), [setForm, surface])
  // Mod+J：打开并聚焦输入框（代替被删掉的那条常驻输入条）。Mod+\：停靠 ↔ 小球（浮窗时收成小球）。
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      const current = useAgentFormStore.getState().bySurface[surface].form
      if (event.key.toLowerCase() === 'j') {
        event.preventDefault()
        if (current === 'ball') setForm(surface, openFormFor(surface))
        focusComposerSoon()
      } else if (event.key === '\\') {
        event.preventDefault()
        setForm(surface, current === 'ball' ? 'dock' : 'ball')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setForm, surface])

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
      { id: 'form-ball', label: t('appShell.agent.toBall'), onSelect: () => setForm(surface, 'ball') },
      { id: 'form-float', label: t('appShell.agent.toFloat'), onSelect: () => setForm(surface, 'float') },
      { id: 'form-dock', label: t('appShell.agent.toDock'), onSelect: () => setForm(surface, 'dock') },
    ],
    ...(form === 'float' ? { dragHandleClassName: cn(DRAG_HANDLE, 'cursor-move') } : {}),
  }), [form, setForm, surface, t])
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
      {form === 'dock' && dockTarget ? createPortal(panelOut, dockTarget) : null}
      {form === 'ball' && hidden ? createPortal(panelOut, hidden) : null}
      {layerTarget ? createPortal(floating, layerTarget) : floating}
    </div>
  )
}
