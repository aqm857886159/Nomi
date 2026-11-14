// 窄窗口里点了指向元素、对话收成小球之后，生成页画布那一格底部正中的「回到对话」（NodePointer 板 pointer.narrow.back）。
//
// 第②步它只挂在设计实验室（板 A4 的三步布景）。第③步聊天里有了真宿主（付费卡、完成收据），真画布上要有它：
// 不然对话收成小球之后只剩点小球一条路，Esc 也回不去（Esc 挂在这颗按钮上，按钮不在就没有）。这里是它在真画布上的家。
//
// 摆法：底部正中，压在底部停靠区（加节点条 / 缩放簇 / 迷你画面窗）的上面（算式在 returnDockPlacement.ts）。停靠区现量
// （useCanvasBottomDockRects，和选择浮条同一个量法），不抄它们的高度。
// 只在「点了指向、对话让开成小球」那段时间里在，而且**只从让位算出来**（useMachineGaveWay）：让位因为任何一条路结束——
// 拉宽 / 拉窄、人点小球、⌘J、⌘\、选摆法、离开项目、关掉重开——这一枚同一拍就没了。「在不在」没有第二份要跟着清的记录；returnTo 只放回到哪一项、带哪个标签。
import React, { type JSX } from 'react'
import { useMachineGaveWay, type AgentFormSurface } from '../../../ui/app-shell/shell/agentFormStore'
import { useCanvasBottomDockRects } from '../../generationCanvas/reactFlow/useCanvasBottomDockRects'
import { NodePointerReturnToChat } from './NodePointerGroup'
import { useNodePointerStore } from './nodePointerStore'
import { RETURN_DOCK_EDGE_GAP, returnDockBottom } from './returnDockPlacement'

/** 画布那一格里的「回到对话」：对话因为点指向收成了小球时才摆出来。 */
export function NodePointerReturnDock({ surface }: { surface: AgentFormSurface }): JSX.Element | null {
  const mine = useNodePointerStore((state) => state.returnTo?.surface === surface)
  const gaveWay = useMachineGaveWay(surface)
  const active = mine && gaveWay
  const hostRef = React.useRef<HTMLDivElement>(null)
  const docks = useCanvasBottomDockRects(hostRef, active)
  const [bottom, setBottom] = React.useState(RETURN_DOCK_EDGE_GAP)
  React.useLayoutEffect(() => {
    const host = hostRef.current
    if (!active || !host) return
    const rect = host.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 0)) return
    const button = host.querySelector('[data-node-pointer-return]')?.getBoundingClientRect()
    const next = returnDockBottom({ host: rect, buttonWidth: button?.width ?? 0, docks })
    setBottom((previous) => (Math.abs(previous - next) < 1 ? previous : next))
  }, [active, docks])
  if (!active) return null
  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-[61]" data-node-pointer-return-dock={surface}>
      <div className="pointer-events-auto absolute left-1/2 -translate-x-1/2" style={{ bottom }}>
        <NodePointerReturnToChat />
      </div>
    </div>
  )
}
