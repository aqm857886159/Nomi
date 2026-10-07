import React, { type JSX } from 'react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'

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
      {children}
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
