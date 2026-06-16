import React from 'react'
import { IconDownload } from '@tabler/icons-react'
import { useResultDownload } from './useResultDownload'
import { FloatingToolbarShell, TOOLBAR_ICON as I, ToolbarButton } from './NodeFloatingToolbar'
import NodeVideoFrameToolbar from './NodeVideoFrameToolbar'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// 非图片结果（视频等）的浮条：视频结果 → 抽首帧/抽尾帧 + 下载（NodeVideoFrameToolbar）；
// 其它非图片结果 → 仅下载。图片结果的下载在 NodeImageEditToolbar。仅在选中且有可下载结果时渲染。

type Props = {
  node: GenerationCanvasNode
  selected: boolean
}

export default function NodeResultDownloadButton({ node, selected }: Props): JSX.Element | null {
  const { canDownload, downloading, download } = useResultDownload(node)
  if (!selected || !canDownload || node.result?.type === 'image') return null

  // 视频结果 → 专用浮条（抽首/尾帧 + 下载）。
  if (node.result?.type === 'video') {
    return <NodeVideoFrameToolbar node={node} downloading={downloading} onDownload={download} />
  }

  return (
    <FloatingToolbarShell ariaLabel="结果操作">
      <ToolbarButton
        icon={<IconDownload size={I.size} stroke={I.stroke} />}
        label="下载"
        title="下载 / 另存到本地"
        disabled={downloading}
        onClick={download}
      />
    </FloatingToolbarShell>
  )
}
