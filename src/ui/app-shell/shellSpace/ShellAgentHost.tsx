// Agent 三种形态的宿主（样张 design/shell-space）：小球 / 浮窗 / 停靠右侧。设计卡格 ★4 有完整状态表。
//
// 形态归 agentFormStore（唯一 owner，每页一份）。这里只做三件事：
//   1. 把同一个常驻面板（ProjectAgentResidentShell）摆到对的地方：停靠 → 工作区给的右栏；浮窗 → react-rnd 窗；
//      小球 → 面板收起（不画那条横在页面上的输入条），只留小球；
//   2. 头部换上形态按钮（AgentPanelHeaderSlotContext）；
//   3. 快捷键（Mod+J）打开并聚焦输入框。
// 拖动、改大小、出界约束全交给 react-rnd；窗口缩小后的「夹回可见区」在渲染时算（不回写），见 agentFormStore.clampRect。
import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Rnd } from 'react-rnd'
import { IconAppWindow, IconArrowsDiagonalMinimize2, IconLayoutSidebarRight } from '@tabler/icons-react'
import { NomiLogoMark, WorkbenchMenu, type WorkbenchMenuNode } from '../../../design'
import { cn } from '../../../utils/cn'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { useResidentActivityStore } from '../../../workbench/ai/residentActivity'
import { AgentPanelHeaderSlotContext } from '../../../workbench/ai/v4/agentPanelHeaderSlot'
import {
  BALL_SIZE,
  FLOAT_MIN,
  clampBall,
  clampRect,
  defaultBallPoint,
  defaultFloatRect,
  useAgentFormStore,
  type AgentForm,
  type AgentFormSurface,
} from './agentFormStore'

const DRAG_HANDLE = 'shell-agent-drag-handle'
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
export const AGENT_SHORTCUT_LABEL = isMac ? '⌘J' : 'Ctrl+J'

/**
 * 这一页**此刻**的形态。只有一条派生：生成页列表开着大详情时，停靠 = 小球（详情要整块右边，
 * Agent 不与它抢位置）；关掉详情就回到停靠——不写回 store，所以「回来」不需要记任何东西。
 */
export function useEffectiveAgentForm(surface: AgentFormSurface): AgentForm {
  const stored = useAgentFormStore((state) => state.bySurface[surface].form)
  const dockSuppressed = useAgentFormStore((state) => state.dockSuppressed)
  if (dockSuppressed && stored === 'dock') return 'ball'
  return stored
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

function FormButtons({ surface, form }: { surface: AgentFormSurface; form: AgentForm }): JSX.Element {
  const { t } = useTranslation()
  const setForm = useAgentFormStore((state) => state.setForm)
  const button = 'grid size-6 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink'
  return (
    <>
      {form === 'dock' ? (
        <button type="button" className={button} aria-label={t('shellSpace.agent.toFloat')} title={t('shellSpace.agent.toFloat')} data-agent-form-to="float" onClick={() => setForm(surface, 'float')}>
          <IconAppWindow size={15} />
        </button>
      ) : (
        <button type="button" className={button} aria-label={t('shellSpace.agent.toDock')} title={t('shellSpace.agent.toDock')} data-agent-form-to="dock" onClick={() => setForm(surface, 'dock')}>
          <IconLayoutSidebarRight size={15} />
        </button>
      )}
      <button type="button" className={button} aria-label={t('shellSpace.agent.toBall')} title={t('shellSpace.agent.toBall')} data-agent-form-to="ball" onClick={() => setForm(surface, 'ball')}>
        <IconArrowsDiagonalMinimize2 size={15} />
      </button>
    </>
  )
}

function AgentBall({ surface, area }: { surface: AgentFormSurface; area: { width: number; height: number } }): JSX.Element | null {
  const { t } = useTranslation()
  const status = useResidentActivityStore((state) => state.dockStatus)
  const pending = useResidentActivityStore((state) => state.dockPendingCount)
  const stored = useAgentFormStore((state) => state.bySurface[surface].ball)
  const setBallPoint = useAgentFormStore((state) => state.setBallPoint)
  const setForm = useAgentFormStore((state) => state.setForm)
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null)
  const dragStart = React.useRef<{ x: number; y: number } | null>(null)
  const pill = status === 'needs-confirm' && pending > 0
  const width = pill ? 132 : BALL_SIZE
  if (!area.width || !area.height) return null
  const base = stored ?? defaultBallPoint(area)
  // 胶囊比球宽：以右缘为准往左长，「同一位置」= 右下角不动。
  const anchored = { x: base.x + BALL_SIZE - width, y: base.y }
  const point = clampBall(anchored, area, { width, height: BALL_SIZE })
  const open = () => {
    setForm(surface, 'float')
    focusComposerSoon()
  }
  const label = pill
    ? t('shellSpace.agent.ballPending', { count: pending })
    : status === 'running' ? t('shellSpace.agent.ballRunning')
      : status === 'failed' ? t('shellSpace.agent.ballFailed')
        : t('shellSpace.agent.ballOpen', { shortcut: AGENT_SHORTCUT_LABEL })
  const items: WorkbenchMenuNode[] = [
    { id: 'float', label: t('shellSpace.agent.toFloat'), icon: IconAppWindow, onSelect: () => setForm(surface, 'float') },
    { id: 'dock', label: t('shellSpace.agent.toDock'), icon: IconLayoutSidebarRight, onSelect: () => setForm(surface, 'dock') },
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
          if (start && Math.abs(start.x - data.x) + Math.abs(start.y - data.y) < 4) return
          setBallPoint(surface, { x: data.x - BALL_SIZE + width, y: data.y })
        }}
      >
        <button
          type="button"
          className={cn(
            'relative flex size-full items-center justify-center gap-1.5 rounded-pill shadow-nomi-lg',
            'transition-[background,color,width] duration-nomi-fast ease-nomi-fast',
            pill ? 'bg-nomi-accent px-3 text-body-sm font-medium text-nomi-paper' : 'border border-nomi-line bg-nomi-paper text-nomi-ink hover:bg-nomi-ink-05',
          )}
          aria-label={label}
          title={`${label} · ${t('shellSpace.agent.formMenu')}`}
          data-agent-ball={pill ? 'pending' : status ?? 'idle'}
          onClick={open}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenu({ x: event.clientX, y: event.clientY })
          }}
        >
          {pill ? (
            <>
              <span className="grid size-5 place-items-center rounded-full bg-nomi-paper"><NomiLogoMark size={14} /></span>
              <span className="whitespace-nowrap tabular-nums">{label}</span>
            </>
          ) : <NomiLogoMark size={22} />}
          {status === 'running' ? (
            <span className="pointer-events-none absolute -inset-0.5 animate-spin rounded-full border-2 border-nomi-accent border-l-transparent border-t-transparent motion-reduce:animate-none" data-agent-ball-progress aria-hidden="true" />
          ) : null}
          {status === 'failed' ? <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-nomi-danger" aria-hidden="true" /> : null}
        </button>
      </Rnd>
      <WorkbenchMenu open={menu !== null} onOpenChange={(next) => { if (!next) setMenu(null) }} point={menu ?? { x: 0, y: 0 }} items={items} side="top" ariaLabel={t('shellSpace.agent.formMenu')} />
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
      className="pointer-events-auto overflow-hidden rounded-nomi bg-nomi-paper shadow-nomi-lg"
      bounds="parent"
      size={{ width: rect.width, height: rect.height }}
      position={{ x: rect.x, y: rect.y }}
      minWidth={Math.min(FLOAT_MIN.width, area.width)}
      minHeight={Math.min(FLOAT_MIN.height, area.height)}
      dragHandleClassName={DRAG_HANDLE}
      cancel="button, input, textarea, [contenteditable='true'], [role='menu']"
      onDragStop={(_event, data) => setFloatRect(surface, { ...rect, x: data.x, y: data.y })}
      onResizeStop={(_event, _direction, element, _delta, position) => setFloatRect(surface, {
        x: position.x, y: position.y, width: element.offsetWidth, height: element.offsetHeight,
      })}
    >
      <section className="size-full" aria-label={t('shellSpace.agent.floatAria')} data-agent-float={surface}>
        {children}
      </section>
    </Rnd>
  )
}

/**
 * 摆面板。`dockTarget` 是工作区给的右栏（只有停靠形态用它）；`area` 是内容区那一层（浮窗与小球的坐标系）。
 */
export function ShellAgentHost({
  surface,
  dockTarget,
  agent,
}: {
  surface: AgentFormSurface
  dockTarget: HTMLDivElement | null
  agent: React.ReactNode
}): JSX.Element {
  const form = useEffectiveAgentForm(surface)
  const setForm = useAgentFormStore((state) => state.setForm)
  const [layer, setLayer] = React.useState<HTMLDivElement | null>(null)
  const [hidden, setHidden] = React.useState<HTMLDivElement | null>(null)
  const area = useAreaSize(layer)

  // 「面板占不占位」今天归 projectAgentDockCollapsed（它也是 Agent layout.read/write 的契约）。
  // 样张期由形态单向驱动它；实现线删掉那个布尔，改由形态派生（设计卡格 ★2）。
  React.useEffect(() => {
    const store = useWorkbenchStore.getState()
    const collapsed = form === 'ball'
    if (store.projectAgentDockCollapsed !== collapsed) store.setProjectAgentDockCollapsed(collapsed)
  }, [form])
  // 别处叫回面板（任务中心「定位到制作」、预览页 ⌘\）：小球 → 这一页的默认展开形态。
  React.useEffect(() => useWorkbenchStore.subscribe((state, previous) => {
    if (previous.projectAgentDockCollapsed && !state.projectAgentDockCollapsed && useAgentFormStore.getState().bySurface[surface].form === 'ball') {
      setForm(surface, surface === 'generation' ? 'float' : 'dock')
    }
  }), [setForm, surface])
  // Mod+J：打开并聚焦输入框（代替被删掉的那条常驻输入条）。
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'j') return
      event.preventDefault()
      if (useAgentFormStore.getState().bySurface[surface].form === 'ball') setForm(surface, surface === 'generation' ? 'float' : 'dock')
      focusComposerSoon()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setForm, surface])

  // 样张走查钩子（只在样张开关开着时挂上，生产恒无）：切形态、往角标投影里写一档显示态（拍「等你确认 2」那一屏，
  // 那屏是显示态注入、不是一张真付费卡——设计卡格 8 记为 unverified）。
  React.useEffect(() => {
    const hook = {
      setForm: (target: AgentFormSurface, next: AgentForm) => useAgentFormStore.getState().setForm(target, next),
      setDockBadge: (status: 'idle' | 'running' | 'needs-confirm' | 'done' | 'failed', pending: number) => useResidentActivityStore.getState().setResidentDockBadge(status, pending, pending),
    }
    ;(window as unknown as { __nomiShellSpecimen?: typeof hook }).__nomiShellSpecimen = hook
  }, [])
  const slot = React.useMemo(() => ({
    actions: <FormButtons surface={surface} form={form} />,
    ...(form === 'float' ? { dragHandleClassName: cn(DRAG_HANDLE, 'cursor-move') } : {}),
  }), [form, surface])
  const wrapped = <AgentPanelHeaderSlotContext.Provider value={slot}>{agent}</AgentPanelHeaderSlotContext.Provider>
  return (
    <div ref={setLayer} className="pointer-events-none absolute inset-0 z-[60]" data-shell-agent-layer data-agent-form={form}>
      {/* 小球形态：面板仍挂着（收起支路 = 回执效果、计划预览、角标投影都还在），但挂在看不见的地方——
          那条横在页面上的输入条不再出现。 */}
      <div ref={setHidden} hidden />
      {form === 'dock' && dockTarget ? createPortal(wrapped, dockTarget) : null}
      {form === 'ball' && hidden ? createPortal(wrapped, hidden) : null}
      {form === 'ball' ? <AgentBall surface={surface} area={area} /> : null}
      {form === 'float' ? <AgentFloat surface={surface} area={area}>{wrapped}</AgentFloat> : null}
    </div>
  )
}
