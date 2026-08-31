// 生成中遮罩的节点级接线（从 BaseGenerationNode 拆出，760>739 体积门倒逼 · R9）。
// 职责：判「这是不是带 ws 实时进度的 ComfyUI 任务」→ 是则给 GeneratingOverlay 喂
// 确定进度/人话/活预览/遮罩取消（P 轨 2026-08-01 拍板 A 位）；不是则渲染旧样默认遮罩（云任务零变化）。
import React from 'react'
import { GeneratingOverlay } from './render/CardCommon'
import { useComfyuiPreviewStore } from '../store/comfyuiPreviewStore'
import { requestComfyuiCancel } from '../runner/comfyuiTaskControl'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

export function NodeGeneratingOverlay({ node }: { node: GenerationCanvasNode }): JSX.Element {
  const comfyLive =
    node.progress?.phase === 'comfyui-node' || node.progress?.phase === 'comfyui-queued'
      ? node.progress
      : null
  const previewUrl = useComfyuiPreviewStore((state) => state.byNode[node.id])
  const handleCancel = React.useCallback(() => requestComfyuiCancel(node), [node])
  if (!comfyLive) return <GeneratingOverlay />
  return (
    <GeneratingOverlay
      percent={comfyLive.percent}
      message={comfyLive.message}
      previewUrl={previewUrl}
      onCancel={handleCancel}
    />
  )
}
