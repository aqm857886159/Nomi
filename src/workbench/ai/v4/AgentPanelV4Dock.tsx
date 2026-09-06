// Agent 面板 v4 · 积木 ⑦ 收起坞（我们独有，AI Elements / Beautiful UI 都没有对应件）
//
// **2026-09-06 用户改**：收起态右上角不再是两颗小 icon，而是 Nomi 一直延续的那枚 **logo 钮**，
// 状态叠在 logo 上（运行中 / 待你确认 N / 刚完成 / 失败），点它展开；底部的 composer 坞不动。
//
// 血统在 `src/ui/app-shell/CollapsedAiChip.tsx`（生成区让位时收进顶栏的那枚角标）：
// 同一枚 `NomiLogoMark`、同一句「有动静就冒角标、纯空会话不冒」、同一个 ghost 钮形态。
// 那枚角标只会「有 / 没有」，这里按宿主投影分出五档——但**不重画 logo**，形状仍由
// `src/design/identity.tsx` 单点持有（P1）。
//
// 为什么是右上角而不是右侧一条 rail：收起的意思是「把屏幕还给内容」。一条贴着右边缘、
// 满高的 32px 条仍然占着一整列的注意力，而且它上面那两颗 icon（对话 / 面板设置）指的是
// **同一个动作**——都是「把面板叫回来」。一枚 logo 就够了，状态叠在它身上。
import React from 'react'
import { cn } from '../../../utils/cn'
import { NomiLogoMark } from '../../../design'
import { IconAlertTriangle, IconCheck } from './AgentPanelV4Icons'
import { TRANSPORT_BAR_SELECTOR, transportClearanceFrom } from './agentPanelV4DockClearance'
import { dockStatusLabel, type V4DockLabels, type V4DockStatus } from './agentPanelV4DockStatus'

/** logo 上那一格叠加物。空闲什么都不叠——「没事」最好的表达方式是不说话。 */
function DockStatusOverlay({ status, pendingCount }: { status: V4DockStatus; pendingCount: number }): JSX.Element | null {
  if (status === 'idle') return null
  const corner = 'absolute -right-1 -top-1 grid place-items-center rounded-pill'
  if (status === 'running') {
    // 呼吸点而不是转圈：定稿 ⑧ 明令禁用「纯转圈无文字」，而这里本来就没有位置写字。
    return (
      <span
        className={cn(corner, 'size-2 animate-pulse bg-nomi-accent motion-reduce:animate-none')}
        data-agent-dock-badge="running"
        aria-hidden="true"
      />
    )
  }
  if (status === 'needs-confirm') {
    return (
      <span
        className={cn(corner, 'h-4 min-w-4 bg-nomi-warning px-1 text-micro font-medium leading-none text-nomi-paper')}
        data-agent-dock-badge="needs-confirm"
        aria-hidden="true"
      >
        {pendingCount}
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span
        className={cn(corner, 'size-4 bg-nomi-danger text-nomi-paper')}
        data-agent-dock-badge="failed"
        aria-hidden="true"
      >
        <IconAlertTriangle size={10} />
      </span>
    )
  }
  return (
    <span
      className={cn(corner, 'size-4 bg-nomi-success text-nomi-paper')}
      data-agent-dock-badge="done"
      aria-hidden="true"
    >
      <IconCheck size={10} />
    </span>
  )
}

/**
 * 收起态右上角的 Nomi logo 钮（2026-09-06 拍板改）。
 *
 * hover 才冒那一行状态字：收起态的合同是「把屏幕还给内容」，常驻一行字就是把它收回来一点。
 * 无障碍名里**始终**带着这句话，所以读屏用户不靠 hover 也听得到。
 */
export function V4CollapsedLogoDock({
  status,
  pendingCount = 0,
  labels,
  onOpen,
}: {
  status: V4DockStatus
  pendingCount?: number
  labels: V4DockLabels
  onOpen?: () => void
}): JSX.Element {
  const statusLabel = dockStatusLabel(status, pendingCount, labels)
  return (
    // `flex-row-reverse`：钮在 DOM 里排前面（`peer` 只作用于后面的兄弟），视觉上仍在最右。
    <div
      className="flex flex-row-reverse items-center gap-1.5"
      data-v4-block="dock"
      data-agent-dock-status={status}
      data-agent-dock-pending={pendingCount}
    >
      <button
        type="button"
        className="peer relative grid size-8 place-items-center rounded-nomi-sm border border-nomi-line bg-nomi-paper shadow-nomi-sm transition-[background,box-shadow] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05 hover:shadow-nomi-md"
        aria-label={`${labels.open} · ${statusLabel}`}
        data-v4-control="dock-open"
        onClick={onOpen}
      >
        <NomiLogoMark size={18} />
        <DockStatusOverlay status={status} pendingCount={pendingCount} />
      </button>
      <span
        className="pointer-events-none whitespace-nowrap rounded-pill border border-nomi-line bg-nomi-paper px-2 py-0.5 text-micro text-nomi-ink-60 opacity-0 shadow-nomi-sm transition-opacity duration-[var(--nomi-transition-fast)] peer-hover:opacity-100 peer-focus-visible:opacity-100"
        data-agent-dock-hint="true"
        aria-hidden="true"
      >
        {statusLabel}
      </span>
    </div>
  )
}

/**
 * 收起后 composer 落到画面下沿要留出的空当。
 *
 * 坞挂在常驻面板所在的那个框的底边上，而播放器的走带条又挂在它里面的底边上——
 * 直接 `bottom: 0` 会把 composer 压在播放/暂停和时间码上，也就是盖住「结果全屏」
 * 本来要还给用户的那几个控件。走带条在窄宽度下会折行，所以高度是**量**出来的不是猜的。
 *
 * 宿主框从坞自己的 `offsetParent` 读，不用一个写死的舞台 class：剪辑面 2026-09-05 搬到
 * 面板系统之后，旧的 `.workbench-preview__stage` 选择器一个都不匹配了。死选择器在这里
 * 是**静默失败**——空当恒为 0，composer 又落回走带条上——所以锚点必须是结构性的。
 */
function useTransportClearance(dockRef: React.RefObject<HTMLDivElement | null>): number {
  const [clearance, setClearance] = React.useState(0)
  React.useLayoutEffect(() => {
    const host = dockRef.current?.offsetParent
    if (!(host instanceof HTMLElement)) return undefined
    // 量的是「宿主底边到走带条顶边」的距离，不是走带条自己的高度：播放器在条下面还留了
    // 自己的内边距，只按高度算照样会落在播放键上。每次测量重新查一次条，晚挂载的播放器也能接上。
    // 查询范围是**宿主自己**，不是整个文档：别的面（预览面常驻在 DOM 里）那条走带条
    // 不是这个坞的邻居，量它只会量到一个没有意义的数。
    const findBar = (): HTMLElement | null => host.querySelector<HTMLElement>(TRANSPORT_BAR_SELECTOR)
    const measure = (): void => {
      const bar = findBar()
      setClearance(transportClearanceFrom(host.getBoundingClientRect(), bar?.getBoundingClientRect() ?? null))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    const bar = findBar()
    if (bar) observer.observe(bar)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
    // composer 每敲一个键都会重渲；那么频繁地重建观察器是浪费。宿主 resize（拖面板、
    // 走带条折行）本来就会重新测量，而 `measure` 每次都重查条，晚到的播放器也接得上。
  }, [dockRef])
  return clearance
}

/**
 * 收起后的画面下沿坞（定稿 Collapsed 板）。
 *
 * 收起藏的是**对话流**，不是对话：同一个 composer 掉到预览舞台的下边缘居中，
 * 介入槽跟着它一起——这样一份编辑计划仍然读得到、批得下，不必把整列还给面板。
 *
 * 这里**没有**「叫回 Nomi」按钮：收起后叫回它的入口只有一个，就是右上角那枚 logo 钮
 * （`V4CollapsedLogoDock`）。再更早的一版两个入口并存——rail 上写「展开 Nomi」、画面右上角
 * 又浮一颗「叫回 Nomi」胶囊——同一个动作两个名字两个位置。
 */
export function V4CollapsedDock({ children }: { children: React.ReactNode }): JSX.Element {
  const dockRef = React.useRef<HTMLDivElement>(null)
  const transportClearance = useTransportClearance(dockRef)
  return (
    <div
      ref={dockRef}
      className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-4 pb-3"
      style={{ bottom: transportClearance }}
    >
      <div className="pointer-events-auto grid w-full max-w-[560px] gap-1.5" data-agent-collapsed-dock="true">
        {children}
      </div>
    </div>
  )
}
