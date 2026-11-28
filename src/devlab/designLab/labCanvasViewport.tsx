import React, { type JSX } from 'react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { NodeOutsideRowsViewport } from '../../workbench/generationCanvas/nodes/NodeLabelRow'

/**
 * 实验室格子里的「画布视口」：节点浮条和生成浮框的反向缩放读的是 React Flow 的 transform
 * （画布缩放的唯一真相，见 workbench/generationCanvas/reactFlow/canvasViewportScale.ts）。
 * 实验室里没有真画布，这里给样张一个只装缩放的 React Flow store——浮层和真画布读同一个来源，
 * 不再靠往 workbenchStore 里写「记住的视角」去冒充。外框用 `scale(zoom)` 模拟视口缩放的格子，这里报同一个数。
 */
export function LabCanvasViewport({ zoom = 1, children }: { zoom?: number; children: React.ReactNode }): JSX.Element {
  return (
    <ReactFlowProvider>
      <LabCanvasZoom zoom={zoom} />
      <NodeOutsideRowsViewport>{children}</NodeOutsideRowsViewport>
    </ReactFlowProvider>
  )
}

function LabCanvasZoom({ zoom }: { zoom: number }): null {
  const store = useStoreApi()
  React.useLayoutEffect(() => {
    store.setState({ transform: [0, 0, zoom] })
  }, [store, zoom])
  return null
}

/**
 * 实验室格子里「画布上的一张节点卡」的宿主（2026-10-18）。
 * 生产里节点卡挂在 React Flow 的节点外壳里，`.generation-canvas-react-flow .generation-canvas-v2-node`
 * 把卡改成 relative、铺满外壳（generationCanvasReactFlow.css）；全局的 `.generation-canvas-v2-node`
 * 是 absolute（旧画布定位）。实验室是一整个页面打包，只要任何一屏引了画布样式表，裸放的节点卡就按
 * absolute 去找页面里的定位祖先、撑出格子——拆解表那一屏就这样把底栏挤出了截图（门岗截到的不是真样子）。
 * 这里给出与生产同一个宿主语境：带 React Flow 宿主类、按节点尺寸定大小、自己当定位祖先。
 */
export function LabCanvasNodeHost({ width, height, children }: { width: number; height: number; children: React.ReactNode }): JSX.Element {
  return (
    <div className="generation-canvas-react-flow relative" style={{ width, height }} data-lab-canvas-node-host="">
      {children}
    </div>
  )
}
