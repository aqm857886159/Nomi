// Agent 面板 v4 · 积木 ⑦ 收起坞（我们独有，AI Elements / Beautiful UI 都没有对应件）
//
// 定稿 Collapsed 板：结果全屏时右栏收成一根 **32px** 图标条，Nomi 图标带运行状态点；
// 同一个 composer 和介入槽落到画面下沿居中，**对话不中断**。
// 来源是 MiniMax「在画布中查看」的反向——内容优先时对话别消失。
import React from 'react'
import { cn } from '../../../utils/cn'
import { IconLayoutSidebarRightCollapse, IconMessage } from './AgentPanelV4Icons'

export function V4CollapsedRail({
  running = false,
  labels,
  onOpen,
  onAdjust,
}: {
  running?: boolean
  labels: { conversation: string; adjust: string }
  onOpen?: () => void
  onAdjust?: () => void
}): JSX.Element {
  return (
    <div
      className="flex h-full w-8 flex-col items-center gap-1.5 border-l border-nomi-line-soft bg-nomi-paper pt-2"
      data-v4-block="dock"
    >
      <button
        type="button"
        aria-label={labels.conversation}
        onClick={onOpen}
        className="relative grid size-6 place-items-center rounded-nomi-sm bg-nomi-accent-soft text-nomi-accent"
      >
        <IconMessage size={14} />
        {/* 运行状态点：收起了也要知道 Nomi 还在跑。 */}
        <span
          className={cn(
            'absolute right-0.5 top-0.5 size-1.5 rounded-pill',
            running ? 'bg-nomi-accent' : 'bg-transparent',
          )}
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        aria-label={labels.adjust}
        onClick={onAdjust}
        className="grid size-6 place-items-center rounded-nomi-sm text-nomi-ink-60"
      >
        <IconLayoutSidebarRightCollapse size={14} />
      </button>
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
export const TRANSPORT_BAR_SELECTOR = '.workbench-preview-player__control-bar'

/**
 * 从两个已量到的矩形算空当。抽成纯函数是为了让那条**不变量**能被单测钉住：
 * 空当永远落在 `[0, 宿主高度]` 里，而且只有当走带条**真的被排版过**（有高度）才算。
 *
 * 2026-09-06 真机验收撞到的就是这条不变量破了：在创作面收起面板，composer 跑到了
 * 画面**上方** y=-98，整条对话不见了——与定稿「收起藏的是对话流，不是对话」完全相反。
 * 机制是：预览面即使没在前台也还挂在 DOM 里，它那条走带条 `display:none`、矩形全 0，
 * 于是 `host.bottom - bar.top` = `854 - 0` = 854，`bottom: 854px` 把坞顶出了视口。
 * 原注释担心的是死选择器让空当恒为 0（composer 压住播放键）；真出事的是反方向——
 * 量到一个**比宿主还大**的数。所以判据不能只是「查得到条」，得是「这条真的在排版里」。
 */
export function transportClearanceFrom(
  host: Readonly<{ bottom: number; height: number }>,
  bar: Readonly<{ top: number; height: number }> | null,
): number {
  if (!bar || bar.height <= 0) return 0
  return Math.min(Math.max(0, host.bottom - bar.top), Math.max(0, host.height))
}

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
 * 这里**没有**「叫回 Nomi」按钮：收起后叫回它的入口只有一个，就是最右侧那条 32px 图标条
 * （状态点见 `residentActivity`）。上一版两个入口并存——图标条写「展开 Nomi」、画面右上角
 * 又浮一颗「叫回 Nomi」胶囊——同一个动作两个名字两个位置，还把画面右上角挡掉一块。
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
