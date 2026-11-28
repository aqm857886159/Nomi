import React, { type JSX } from 'react'
import type { NodeComposerHost } from './NodeGenerationComposer'
import { composerCanvasPlacement } from './composerCanvasPlacement'
import { useCanvasLiveZoom } from '../reactFlow/canvasViewportScale'
import { NodeBelowRowSpace } from './nodeOutsideRows'

export type ComposerAnchorProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onWheel' | 'onClick'> & {
  /** 在普通内容流里（面板 / 列表详情宿主）：不是钉在画布节点下沿的定位锚。 */
  inFlow: boolean
  anchorRef: React.Ref<HTMLDivElement>
  visualSize: { width: number; height: number }
  'data-composer-host': NodeComposerHost
  /** 文本节点的加工框：和节点同宽、紧贴在下面（见 composerCanvasPlacement）。 */
  placement?: 'standard' | 'match-node'
}

const stopAtComposer = (event: React.SyntheticEvent): void => { event.stopPropagation() }

/**
 * 浮框最外层：面板 / 列表详情宿主是普通内容流里的一个 div；画布宿主是钉在节点下沿的定位锚。
 *
 * 浮框和节点的事件边界归这里，调用方不再各抄一份：按下不起拖 / 框选、滚轮不缩放画布、点击不算「点这个节点」。
 * 点击那条是 2026-10-18 走查补的——浮框里的菜单是 portal，React 合成事件沿组件树冒泡，不拦就冒到 React Flow 的节点
 * onClick，框里的动作刚选中别的节点，同一下点击又把选中改回宿主节点（浮条同理，见 NodeFloatingToolbar 的 FloatingToolbarFrame）。
 */
export function ComposerAnchor({ inFlow, anchorRef, visualSize, placement, ...rest }: ComposerAnchorProps): JSX.Element {
  const guarded = { ...rest, onPointerDown: stopAtComposer, onWheel: stopAtComposer, onClick: stopAtComposer }
  return inFlow ? <div ref={anchorRef} {...guarded} /> : <CanvasComposerAnchor anchorRef={anchorRef} visualSize={visualSize} placement={placement} {...guarded} />
}

/**
 * 画布宿主的定位锚：位置 = composerCanvasPlacement(节点尺寸, 画布缩放)。
 * 缩放读 React Flow 的 transform（唯一真相，见 reactFlow/canvasViewportScale）——不读 workbenchStore 里「记住的视角」：
 * 那份只在手势 / 动画结束时才写，中途和贴在屏幕上的缩放差一截，浮框就忽大忽小（2026-10-06 同源问题把节点浮条带进了无限更新）。
 * 单独成一层：缩放每帧变时只有这一层重渲，里面的编辑器（children 引用不变）不跟着重渲。
 * 面板宿主不在 React Flow 里、订不到它，所以只有画布宿主走这里。
 */
function CanvasComposerAnchor({ anchorRef, visualSize, style, placement = 'standard', ...rest }: Omit<ComposerAnchorProps, 'inFlow'>): JSX.Element {
  const canvasZoom = useCanvasLiveZoom()
  const below = React.useContext(NodeBelowRowSpace)
  return <div ref={anchorRef} {...rest} style={{ ...composerCanvasPlacement(visualSize, canvasZoom, placement, below), ...style }} />
}
