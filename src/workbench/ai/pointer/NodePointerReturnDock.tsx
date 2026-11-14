// 窄窗口里点了指向元素、对话收成小球之后，生成页画布那一格底部正中的「回到对话」（NodePointer 板 pointer.narrow.back）。
//
// 第②步它只挂在设计实验室（板 A4 的三步布景）。第③步聊天里有了真宿主（付费卡、完成收据），真画布上要有它：
// 不然对话收成小球之后只剩点小球一条路，Esc 也回不去（Esc 挂在这颗按钮上，按钮不在就没有）。这里是它在真画布上的家。
//
// 摆法：底部正中，压在底部停靠区（加节点条 / 缩放簇 / 迷你画面窗）的上面（算式在 returnDockPlacement.ts）。停靠区现量
// （useCanvasBottomDockRects，和选择浮条同一个量法），不抄它们的高度。
// 只在「点了指向、对话收成了小球」那段时间里在：用户没经「回到对话」就把对话叫回来了（点小球），这一枚作废、清掉，
// 免得以后因为别的原因收成小球时，底部冒出一颗指着旧镜头的「回到对话」。
import React, { type JSX } from 'react'
import { useEffectiveAgentForm, type AgentFormSurface } from '../../../ui/app-shell/shell/agentFormStore'
import { useCanvasBottomDockRects } from '../../generationCanvas/reactFlow/useCanvasBottomDockRects'
import { NodePointerReturnToChat } from './NodePointerGroup'
import { useNodePointerStore } from './nodePointerStore'
import { RETURN_DOCK_EDGE_GAP, returnDockBottom } from './returnDockPlacement'

/** 画布那一格里的「回到对话」：对话因为点指向收成了小球时才摆出来。 */
export function NodePointerReturnDock({ surface }: { surface: AgentFormSurface }): JSX.Element | null {
  const mine = useNodePointerStore((state) => state.returnTo?.surface === surface)
  // 此刻显示的形态（窄窗档里收成小球的是派生，不改存档；看存档就会漏掉它）。
  const form = useEffectiveAgentForm(surface)
  const active = mine && form === 'ball'
  // 对话从小球回来、却没经过「回到对话」（returnToChat 会先清掉这一枚）：作废。只认「从小球离开」这一下，
  // 收起那一刻（先记 returnTo、再收成小球）不会被误清。
  const previousForm = React.useRef(form)
  React.useEffect(() => {
    const was = previousForm.current
    previousForm.current = form
    if (mine && was === 'ball' && form !== 'ball') useNodePointerStore.getState().setReturnTo(null)
  }, [mine, form])
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
