// Agent 三种形态的宿主（10-08 外壳拍板稿 Main / CanvasAgent / CreationDoc / Chrome）：收起 / 浮窗 / 停靠右侧。
// 收起后的入口在顶栏最右（ShellNomiEntry，NomiEntryTopbar 板，2026-11-22「全部收进顶栏」）：内容区里不再有任何浮着的叫回按钮。
// 设计卡 docs/plan/2026-10-08-shell-redesign.md「Agent 三形态状态表」。
//
// 形态归 agentFormStore（唯一 owner，每页一份；人选的、此刻显示的、算出来的分开放）。这里只做四件事：
//   1. 把同一个常驻面板（ProjectAgentResidentShell）摆到对的地方：停靠 → 工作区给的右栏；浮窗 → react-rnd 窗；
//      收起 → 面板挪进看不见的容器（回执效果、计划预览、角标投影照跑），叫回只在顶栏入口；
//   2. 面板头部右端换成「收起 · 浮窗 · 停靠」三选一（AgentPanelHeaderSlotContext），浮窗窄时收进「⋯」；
//   3. 快捷键：Mod+J 打开并聚焦输入框；Mod+\ 当前页在「打开 ↔ 收起」之间切（打开 = 回到上次选的摆法）；
//   4. 浮窗的坐标系：工作区给的「浮层位」（生成页 = 画布那一格，让开底边时间轴），没给就是整块内容区。
// 窄窗档（窗口宽 < NARROW_TIER_WIDTH，WindowNarrow 板）：这里挂唯一的 matchMedia，写 agentFormStore.windowNarrow；
// 停靠的页此刻显示成收起、点开是浮窗，形态切换里「停靠」变灰。这里只调动作（openAgent / collapseAgent / chooseAgentPlacement），
// 只读 useShownForm / shownForm——手里没有形态可以传，「窄窗写不写存档」归 store 管。
// 拖动、改大小、出界约束全交给 react-rnd；窗口缩小后的「夹回可见区」在渲染时算（不回写），见 agentFormStore.clampRect。
import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Rnd } from 'react-rnd'
import { createHtmlPortalNode, InPortal, OutPortal, type HtmlPortalNode } from 'react-reverse-portal'
import { IconLayoutSidebarRight, IconLayoutSidebarRightCollapse, IconPictureInPicture } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../design'
import { modalInputLayerCovers } from '../../../design/modalInputLayer'
import { cn } from '../../../utils/cn'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { useResidentActivityStore } from '../../../workbench/ai/residentActivity'
import { requestResidentComposerFocus } from '../../../workbench/ai/residentComposerFocus'
import { AgentPanelHeaderSlotContext, type AgentPanelHeaderSlot } from './agentPanelHeaderSlot'
import {
  FLOAT_MIN,
  NARROW_MOTION_CLEAR_MS,
  NARROW_TIER_QUERY,
  NARROW_TIER_WIDTH,
  chooseAgentPlacement,
  clampRect,
  clearAgentNarrowMotion,
  collapseAgent,
  defaultFloatRect,
  openAgent,
  setAgentWindowNarrow,
  shownForm,
  useAgentFormStore,
  useAgentNarrowMotion,
  useAgentWindowNarrow,
  useShownForm,
  type AgentForm,
  type AgentFormSurface,
} from './agentFormStore'
import { nomiEntryShortcutPrefix } from './nomiEntryLook'

const DRAG_HANDLE = 'shell-agent-drag-handle'
const MOD = nomiEntryShortcutPrefix(typeof navigator !== 'undefined' ? navigator.platform : '')

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

/** 面板头部右端：收起 · 浮窗 · 停靠 三选一，当前形态高亮（CanvasAgent 板 .form；第一项见 NomiEntryTopbar 板 panel.form-switch）。 */
function FormSwitch({ surface, form }: { surface: AgentFormSurface; form: AgentForm }): JSX.Element {
  const { t } = useTranslation()
  const narrow = useAgentWindowNarrow()
  // data-agent-form-to 写动作（collapse / float / dock），id 是形态本身。
  const options: { id: AgentForm; to: 'collapse' | 'float' | 'dock'; label: string; icon: JSX.Element }[] = [
    { id: 'collapsed', to: 'collapse', label: t('appShell.agent.withShortcut', { label: t('appShell.agent.toCollapse'), shortcut: `${MOD}\\` }), icon: <IconLayoutSidebarRightCollapse size={15} stroke={1.5} aria-hidden="true" /> },
    { id: 'float', to: 'float', label: t('appShell.agent.toFloat'), icon: <IconPictureInPicture size={15} stroke={1.5} aria-hidden="true" /> },
    { id: 'dock', to: 'dock', label: t('appShell.agent.toDock'), icon: <IconLayoutSidebarRight size={15} stroke={1.5} aria-hidden="true" /> },
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
              data-agent-form-to={option.to}
              data-agent-form-blocked={blocked ? 'narrow' : undefined}
              onClick={() => {
                if (blocked) return
                if (option.id === 'collapsed') collapseAgent(surface)
                else {
                  chooseAgentPlacement(surface, option.id)
                  requestResidentComposerFocus()
                }
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
              <TooltipContent side="top" data-agent-form-blocked-hint>{narrowHint}</TooltipContent>
            </Tooltip>
          )
        })}
      </span>
    </TooltipProvider>
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
 * （浮窗的坐标系，生成页 = 画布那一格）；没给就用整块内容区（本组件自己那一层）。
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
  const form = useShownForm(surface)
  const narrow = useAgentWindowNarrow()
  const narrowMotion = useAgentNarrowMotion()
  const restoring = narrowMotion === 'restore'
  const [ownLayer, setOwnLayer] = React.useState<HTMLDivElement | null>(null)
  const [hidden, setHidden] = React.useState<HTMLDivElement | null>(null)
  const layer = layerTarget ?? ownLayer
  const area = useAreaSize(layer)

  // 「面板占不占位」是显示态 projectAgentDockCollapsed（Agent layout.read 的 visibility.assistant 读它）。
  // 形态是它的写入者：collapsed ⇔ 收起。单向驱动；这是挂载 / 切页 / 窗口变化时的显示同步，**不让项目落盘**——
  // setProjectAgentDockCollapsed 在布局登记表里是 display 层，结构上碰不到落盘那份（跟机器走，2026-11-13）。
  React.useEffect(() => {
    const store = useWorkbenchStore.getState()
    const collapsed = form === 'collapsed'
    if (store.projectAgentDockCollapsed !== collapsed) store.setProjectAgentDockCollapsed(collapsed)
  }, [form])
  // 别处叫回面板（任务中心「定位到制作」、Agent 自己的 layout.write）：人要 Nomi 出来 = 打开（回到这一页上次选的摆法）。
  // 看的是「叫回」计数（agentRecallNonce），不是 projectAgentDockCollapsed 的翻转：重开项目时那个投影会被还原 / 重置翻一下，
  // 按翻转去猜，面板就会在用户什么也没点时自己弹成浮窗（评测 j5 重开项目后浮窗盖住生成钮）。
  React.useEffect(() => useWorkbenchStore.subscribe((state) => state.agentRecallNonce, () => {
    if (shownForm(surface) === 'collapsed') openAgent(surface)
  }), [surface])
  // 外壳唯一的窄窗判断（narrow.one-threshold）：一条 matchMedia，跨阈值才回调（拖窗过程中不逐帧算）。
  // 挂载时那次对齐不算「跨过」，不播收拢。
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia(NARROW_TIER_QUERY)
    setAgentWindowNarrow(query.matches, { animate: false })
    const onChange = (event: MediaQueryListEvent) => setAgentWindowNarrow(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  // 跨阈值的过渡只播这一次：到点就清。不靠 animationend——减弱动效 / 这一页不是停靠时没有元素在播，
  // 留着的标记会让之后某次手动停靠凭空再播一遍。
  React.useEffect(() => {
    if (!narrowMotion) return undefined
    const timer = window.setTimeout(clearAgentNarrowMotion, NARROW_MOTION_CLEAR_MS)
    return () => window.clearTimeout(timer)
  }, [narrowMotion])
  // Mod+J：打开并聚焦输入框（代替被删掉的那条常驻输入条）。Mod+\：收起 / 展开 Nomi（快捷键表原话）——开着就收起，
  // 收着就打开到上次选的摆法，和点顶栏 Nomi 入口同一个动作（用户 2026-11-14「收起再打开回到上次选的」）；选停靠 / 浮窗只在形态切换和菜单里。
  // 聚焦只发请求，由输入框的主人自己落焦点（residentComposerFocus）——外壳不在页面里找输入框。
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      // 整窗模态开着时不叫面板，也不把焦点抢出模态；灯箱只盖画布那一格，不算。
      if (modalInputLayerCovers(document.body)) return
      const shown = shownForm(surface)
      if (event.key.toLowerCase() === 'j') {
        event.preventDefault()
        if (shown === 'collapsed') openAgent(surface)
        requestResidentComposerFocus()
      } else if (event.key === '\\') {
        event.preventDefault()
        if (shown === 'collapsed') openAgent(surface)
        else collapseAgent(surface)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [surface])

  // E2E 专用桥（同 TaskCenterButton / ProductionCanvasLandingHost 的既有写法）：仅当 localStorage['__nomiE2E']==='1'
  // 时把顶栏入口读的角标投影与形态 store 挂到 window，供零额度走查摆出入口各态截图（不跑真 Agent、不花钱）。生产从不置该标志。
  React.useEffect(() => {
    try {
      if (window.localStorage?.getItem('__nomiE2E') === '1') {
        const w = window as unknown as { __nomiResidentActivityStore?: unknown; __nomiAgentFormStore?: unknown; __nomiAgentForm?: unknown }
        w.__nomiResidentActivityStore = useResidentActivityStore
        // 走查读浮窗位置用 store 本身；读「此刻显示的形态」只经唯一读函数，种存档走真动作。
        w.__nomiAgentFormStore = useAgentFormStore
        w.__nomiAgentForm = { shownForm, openAgent, collapseAgent, chooseAgentPlacement }
      }
    } catch {
      // localStorage 不可用 → 跳过
    }
  }, [])

  const slot = React.useMemo<AgentPanelHeaderSlot>(() => ({
    actions: <FormSwitch surface={surface} form={form} />,
    menuItems: [
      { id: 'form-collapse', label: t('appShell.agent.toCollapse'), onSelect: () => collapseAgent(surface) },
      { id: 'form-float', label: t('appShell.agent.toFloat'), onSelect: () => chooseAgentPlacement(surface, 'float') },
      narrow
        ? { id: 'form-dock', label: t('appShell.agent.toDock'), disabled: true, disabledReason: t('appShell.agent.dockNarrow', { width: NARROW_TIER_WIDTH }), onSelect: () => undefined }
        : { id: 'form-dock', label: t('appShell.agent.toDock'), onSelect: () => chooseAgentPlacement(surface, 'dock') },
    ],
    ...(form === 'float' ? { dragHandleClassName: cn(DRAG_HANDLE, 'cursor-move') } : {}),
  }), [form, narrow, surface, t])
  // 面板只挂**一棵**稳定的 React 树（react-reverse-portal：InPortal 渲染一次，OutPortal 决定它的 DOM 落在哪）。
  // 三形态切换只是把同一个 DOM 节点挪到停靠栏 / 浮窗 / 隐藏容器，不卸载重挂——待确认卡的勾选与折叠、滚动、
  // 历史分页、线程菜单、草稿都留在原地（#1136 评审阻断 1：此前每种形态 portal 到不同容器，切一次就整棵重挂）。
  const [panelNode] = React.useState<HtmlPortalNode>(() => createHtmlPortalNode({
    attributes: { style: 'display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0', 'data-agent-portal': 'true' },
  }))
  const panelOut = <OutPortal node={panelNode} />
  const floating = form === 'float' ? <AgentFloat surface={surface} area={area}>{panelOut}</AgentFloat> : null
  return (
    <div ref={setOwnLayer} className="pointer-events-none absolute inset-0 z-[60]" data-shell-agent-layer data-agent-form={form}>
      <InPortal node={panelNode}>
        <AgentPanelHeaderSlotContext.Provider value={slot}>{agent}</AgentPanelHeaderSlotContext.Provider>
      </InPortal>
      {/* 收起：同一棵面板挪进看不见的容器（回执效果、计划预览、角标投影照常跑），点顶栏入口再挪回来。 */}
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
      {form === 'collapsed' && hidden ? createPortal(panelOut, hidden) : null}
      {layerTarget ? createPortal(floating, layerTarget) : floating}
    </div>
  )
}
