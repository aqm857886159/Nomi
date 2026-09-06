// Agent 面板 v4 · 积木 ⑦ 收起坞 —— **画面下沿那一坞**（我们独有，AI Elements / Beautiful UI 都没有）。
//
// 收起藏的是**对话流**，不是对话：同一个 composer 掉到画面下沿居中，介入槽跟着它一起。
// 这样一份编辑计划仍然读得到、批得下，不必把整列还给面板。
//
// 「叫回面板」那颗钮**不在这个文件里**：它住顶栏右簇「浏览器」与「设置」之间那一格
// （`src/ui/app-shell/CollapsedAiChip.tsx` + `AgentTopbarChip.tsx`，09-01 定稿 §11.2）。
// 更早的两版都把它画在面板自己的地盘上——先是右侧一条满高 32px rail，后是内容区右上角一枚
// logo——两版共同的毛病是**落点跟着面板走**：切一个面就换一个地方，用户每次都得重新找它。
// 顶栏是唯一跨创作/分镜/生成/预览四个面常驻的 chrome，所以收起角标的家在那儿。
import React from 'react'
import { TRANSPORT_BAR_SELECTOR, transportClearanceFrom } from './agentPanelV4DockClearance'

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
