// 画布 stage 的拖入收口：三种来源 → 建 asset 节点。
//   1) 项目文件树（nomi-local 引用）  2) 素材库（已托管 renderUrl）  3) OS 原始文件（复制+上传）
// 从 GenerationCanvas 抽出，保持组件壳瘦身（R9）。

import type { DragEvent } from 'react'
import { WORKSPACE_FILE_DRAG_MIME, buildWorkspaceFileUrl, parseWorkspaceFileDrag } from '../../explorer/workspaceFileDrag'
import { ASSET_LIBRARY_DRAG_MIME, parseAssetLibraryDrag } from '../../assets/assetLibraryDrag'
import { importImageFilesToGenerationCanvas } from '../adapters/assetImportAdapter'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

export type CanvasStageDropContext = {
  readOnly: boolean
  offset: { x: number; y: number }
  zoom: number
  activeCategoryId?: string
}

function clampNodePos(value: number): number {
  return Math.max(40, Math.round(value))
}

export function handleCanvasStageDrop(event: DragEvent<HTMLDivElement>, ctx: CanvasStageDropContext): void {
  if (ctx.readOnly) return
  const rect = event.currentTarget.getBoundingClientRect()
  const basePosition = {
    x: (event.clientX - rect.left - ctx.offset.x) / ctx.zoom,
    y: (event.clientY - rect.top - ctx.offset.y) / ctx.zoom,
  }

  // 1) 项目文件树拖入：文件已在项目里，直接用 nomi-local 协议引用，创建图片节点。
  const workspaceDrag = parseWorkspaceFileDrag(event.dataTransfer.getData(WORKSPACE_FILE_DRAG_MIME))
  if (workspaceDrag) {
    event.preventDefault()
    event.stopPropagation()
    const url = buildWorkspaceFileUrl(workspaceDrag.projectId, workspaceDrag.relativePath)
    const store = useGenerationCanvasStore.getState()
    const node = store.addNode({
      kind: 'asset',
      title: workspaceDrag.name.replace(/\.[^.]+$/, '') || '本地素材',
      prompt: '',
      position: { x: clampNodePos(basePosition.x), y: clampNodePos(basePosition.y) },
      categoryId: ctx.activeCategoryId,
    })
    const result = { id: `workspace-${node.id}-${Date.now()}`, type: 'image' as const, url, createdAt: Date.now() }
    store.updateNode(node.id, {
      result,
      history: [result],
      status: 'success',
      meta: { ...(node.meta || {}), source: 'workspace-file', fileName: workspaceDrag.name, workspaceRelativePath: workspaceDrag.relativePath },
    })
    return
  }

  // 2) 素材库拖入：素材已在池里（画布产出/项目文件），直接引用 renderUrl 建 asset 节点（图片/视频）。
  const assetDrag = parseAssetLibraryDrag(event.dataTransfer.getData(ASSET_LIBRARY_DRAG_MIME))
  if (assetDrag) {
    event.preventDefault()
    event.stopPropagation()
    const store = useGenerationCanvasStore.getState()
    const node = store.addNode({
      kind: 'asset',
      title: assetDrag.name.replace(/\.[^.]+$/, '') || (assetDrag.kind === 'video' ? '参考视频' : '参考图片'),
      prompt: '',
      position: { x: clampNodePos(basePosition.x), y: clampNodePos(basePosition.y) },
      categoryId: ctx.activeCategoryId,
    })
    const result = { id: `asset-ref-${node.id}-${Date.now()}`, type: assetDrag.kind, url: assetDrag.renderUrl, createdAt: Date.now() }
    const originMeta = assetDrag.origin.source === 'project'
      ? { source: 'workspace-file', fileName: assetDrag.name, workspaceRelativePath: assetDrag.origin.relativePath }
      : { source: 'asset-library', fileName: assetDrag.name, referencedNodeId: assetDrag.origin.nodeId }
    store.updateNode(node.id, {
      result,
      history: [result],
      status: 'success',
      meta: { ...(node.meta || {}), ...originMeta },
    })
    return
  }

  // 3) OS 文件拖入：复制进项目并上传，创建图片节点。
  const files = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith('image/'))
  if (!files.length) return
  event.preventDefault()
  event.stopPropagation()
  void importImageFilesToGenerationCanvas(files, { basePosition, categoryId: ctx.activeCategoryId })
}
