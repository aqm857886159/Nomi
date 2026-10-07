import React from 'react'
import { useNodesInitialized, useStore } from '@xyflow/react'
import { markProjectOpenMoment, projectOpenTimelineEnabled } from './projectOpenTimeline'

/**
 * 打开项目的最后两个时刻：React Flow 量完节点（节点真挂上屏）、画布里第一张图 / 第一段视频解码出来。
 * 只在 `nomi:perf-marks` 打开时挂载（见 projectOpenTimeline），产品默认不渲染、不订阅。
 * 媒体用捕获阶段的 load 监听整块画布：不改任何节点组件，轻量节点和完整节点一视同仁。
 */
function ProjectOpenFlowProbeActive(): null {
  const nodesInitialized = useNodesInitialized()
  const domNode = useStore((state) => state.domNode)
  React.useEffect(() => {
    if (nodesInitialized) markProjectOpenMoment('flow-nodes-mounted')
  }, [nodesInitialized])
  React.useEffect(() => {
    if (!domNode) return
    const onMediaReady = (event: Event): void => {
      if (event.target instanceof HTMLImageElement || event.target instanceof HTMLVideoElement) {
        markProjectOpenMoment('first-media-decoded')
      }
    }
    domNode.addEventListener('load', onMediaReady, true)
    domNode.addEventListener('loadeddata', onMediaReady, true)
    return () => {
      domNode.removeEventListener('load', onMediaReady, true)
      domNode.removeEventListener('loadeddata', onMediaReady, true)
    }
  }, [domNode])
  return null
}

// .ts 而不是 .tsx：它不画任何界面（返回 null），只是挂在 React Flow 里的一个订阅。
export function ProjectOpenFlowProbe(): React.ReactElement | null {
  return projectOpenTimelineEnabled ? React.createElement(ProjectOpenFlowProbeActive) : null
}
