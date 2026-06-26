// 画布 stage 的拖入收口：三种来源 → 建 asset 节点。
//   1) 项目文件树（nomi-local 引用）  2) 素材库（已托管 renderUrl）  3) OS 原始文件（复制+上传）
// 从 GenerationCanvas 抽出，保持组件壳瘦身（R9）。

import type { DragEvent } from 'react'
import { WORKSPACE_FILE_DRAG_MIME, buildWorkspaceFileUrl, parseWorkspaceFileDrag } from '../../explorer/workspaceFileDrag'
import { ASSET_LIBRARY_DRAG_MIME, parseAssetLibraryDrag } from '../../assets/assetLibraryDrag'
import { importLocalMediaFilesToGenerationCanvas } from '../adapters/assetImportAdapter'
import { dropKindFromMime } from '../model/nodeAssetDrop'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { toast } from '../../../ui/toast'

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

  // 1) 项目文件树拖入：文件已在项目里，直接用 nomi-local 协议引用，按 kind 建图片/视频 asset 节点。
  const workspaceDrag = parseWorkspaceFileDrag(event.dataTransfer.getData(WORKSPACE_FILE_DRAG_MIME))
  if (workspaceDrag) {
    event.preventDefault()
    event.stopPropagation()
    const kind: 'image' | 'video' = workspaceDrag.kind === 'video' ? 'video' : 'image'
    const url = buildWorkspaceFileUrl(workspaceDrag.projectId, workspaceDrag.relativePath)
    const store = useGenerationCanvasStore.getState()
    const node = store.addNode({
      kind: 'asset',
      title: workspaceDrag.name.replace(/\.[^.]+$/, '') || (kind === 'video' ? '本地视频' : '本地素材'),
      prompt: '',
      position: { x: clampNodePos(basePosition.x), y: clampNodePos(basePosition.y) },
      categoryId: ctx.activeCategoryId,
    })
    const result = { id: `workspace-${node.id}-${Date.now()}`, type: kind, url, createdAt: Date.now() }
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
    // 音频无画布节点（不渲染画面），引导到时间轴音频轨而不是在画布建个哑节点。
    if (assetDrag.kind === 'audio') {
      toast('音频请拖到时间轴的「音频轨」当配乐', 'info')
      return
    }
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

  // 3) OS 文件拖入：复制进项目并上传，创建图片 / 视频素材节点（音频无可落节点，过滤）。
  const files = Array.from(event.dataTransfer.files || []).filter((file) => {
    const kind = dropKindFromMime(file.type)
    return kind === 'image' || kind === 'video'
  })
  if (!files.length) return
  event.preventDefault()
  event.stopPropagation()
  void importLocalMediaFilesToGenerationCanvas(files, { basePosition, categoryId: ctx.activeCategoryId }).then((result) => {
    // C5：超限截断 / 上传失败不再静默——聚合成一句人话提示（此前 >8 张悄悄丢、失败只在节点上红）。
    const notes: string[] = []
    if (result.skippedOverLimitCount > 0) notes.push(`超过 8 个，已忽略 ${result.skippedOverLimitCount} 个`)
    if (result.skippedTooLargeCount > 0) notes.push(`${result.skippedTooLargeCount} 个文件过大`)
    if (result.failedCount > 0) notes.push(`${result.failedCount} 个导入失败`)
    if (notes.length) toast(notes.join('；'), result.failedCount > 0 ? 'error' : 'info')
  }).catch(() => {})
}
