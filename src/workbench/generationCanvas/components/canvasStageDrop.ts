// 画布 stage 的拖入收口：三种来源 → 建 asset 节点。
//   1) 项目文件树（nomi-local 引用）  2) 素材库（已托管 renderUrl）  3) OS 原始文件（复制+上传）
// 从 GenerationCanvas 抽出，保持组件壳瘦身（R9）。

import type { DragEvent } from 'react'
import { WORKSPACE_FILE_DRAG_MIME, buildWorkspaceFileUrl, parseWorkspaceFileDrag } from '../../explorer/workspaceFileDrag'
import {
  ASSET_LIBRARY_DRAG_MIME,
  parseAssetLibraryDragItems,
  type AssetLibraryDragPayload,
} from '../../assets/assetLibraryDrag'
import { importLocalMediaFilesToGenerationCanvas } from '../adapters/assetImportAdapter'
import { getGenerationNodeDefaultSize, getGenerationNodeFootprintSize } from '../model/generationNodeKinds'
import { dropKindFromMime } from '../model/nodeAssetDrop'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { toast } from '../../../ui/toast'
import type { BrowserAssetCanvasImportItem } from '../../../ui/browser/overlay/globalAssetPopoverEvents'
import type { TiptapDocJson } from '../model/generationCanvasTypes'

export const BROWSER_ASSET_DRAG_MIME = 'application/x-nomi-assets'
export const LEGACY_BROWSER_ASSET_DRAG_MIME = 'application/x-nomi-browser-assets'

export type CanvasStageDropContext = {
  readOnly: boolean
  offset: { x: number; y: number }
  zoom: number
  activeCategoryId?: string
}

type BrowserAssetCanvasItem = {
  id: string
  type: 'image' | 'video' | 'prompt'
  title: string
  url?: string
  prompt?: string
}

function clampNodePos(value: number): number {
  return Math.max(40, Math.round(value))
}

function layoutColumns(count: number): number {
  if (count <= 1) return 1
  return Math.min(4, Math.ceil(Math.sqrt(count)))
}

export function layoutBrowserAssetDropPositions(
  basePosition: { x: number; y: number },
  count: number,
): Array<{ x: number; y: number }> {
  if (count <= 0) return []
  const columns = layoutColumns(count)
  const footprint = getGenerationNodeFootprintSize('asset')
  const cellWidth = footprint.width + 36
  const cellHeight = footprint.height + 36
  return Array.from({ length: count }, (_, index) => ({
    x: clampNodePos(basePosition.x + (index % columns) * cellWidth),
    y: clampNodePos(basePosition.y + Math.floor(index / columns) * cellHeight),
  }))
}

export function resolveAssetLibraryDropPosition(
  cursorPosition: { x: number; y: number },
  dragAnchor?: AssetLibraryDragPayload['dragAnchor'],
): { x: number; y: number } {
  if (!dragAnchor) return cursorPosition
  const size = getGenerationNodeDefaultSize('asset')
  return {
    x: cursorPosition.x - size.width * dragAnchor.xRatio,
    y: cursorPosition.y - size.height * dragAnchor.yRatio,
  }
}

function cleanBrowserAssetTitle(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function cleanBrowserAssetPrompt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function tiptapDocFromPlainText(text: string): TiptapDocJson {
  const lines = text ? text.split(/\r?\n/) : ['']
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  }
}

function normalizeBrowserAssetCanvasItem(item: unknown): BrowserAssetCanvasItem | null {
  if (!item || typeof item !== 'object') return null
  const asset = item as {
    id?: unknown
    type?: unknown
    title?: unknown
    subtitle?: unknown
    previewUrl?: unknown
    url?: unknown
    prompt?: unknown
    text?: unknown
    content?: unknown
  }
  const type = asset.type === 'video' ? 'video' : asset.type === 'image' ? 'image' : asset.type === 'prompt' ? 'prompt' : null
  if (!type) return null
  const title = cleanBrowserAssetTitle(
    asset.title,
    type === 'video' ? '参考视频' : type === 'image' ? '参考图片' : '提示词',
  )
  if (type === 'prompt') {
    const prompt =
      cleanBrowserAssetPrompt(asset.prompt) ||
      cleanBrowserAssetPrompt(asset.text) ||
      cleanBrowserAssetPrompt(asset.content) ||
      cleanBrowserAssetPrompt(asset.subtitle) ||
      title
    return {
      id: typeof asset.id === 'string' ? asset.id : `browser-prompt-${title}`,
      type,
      title,
      prompt,
    }
  }
  const url =
    (typeof asset.previewUrl === 'string' ? asset.previewUrl.trim() : '') ||
    (typeof asset.url === 'string' ? asset.url.trim() : '')
  if (!url) return null
  return {
    id: typeof asset.id === 'string' ? asset.id : `browser-asset-${url}`,
    type,
    title,
    url,
  }
}

function parseBrowserAssetDrag(raw: string | null | undefined): BrowserAssetCanvasItem[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    const items = Array.isArray(value) ? value : [value]
    return items.flatMap((item) => {
      const asset = normalizeBrowserAssetCanvasItem(item)
      return asset ? [asset] : []
    })
  } catch {
    return []
  }
}

export type BrowserAssetsToCanvasResult = {
  createdCount: number
  skippedCount: number
  nodeIds: string[]
}

export function importBrowserAssetsToGenerationCanvas(
  assets: readonly BrowserAssetCanvasImportItem[],
  options: { basePosition: { x: number; y: number }; categoryId?: string },
): BrowserAssetsToCanvasResult {
  const normalized = assets.flatMap((asset) => {
    const item = normalizeBrowserAssetCanvasItem(asset)
    return item ? [item] : []
  })
  if (!normalized.length) return { createdCount: 0, skippedCount: assets.length, nodeIds: [] }

  const store = useGenerationCanvasStore.getState()
  const positions = layoutBrowserAssetDropPositions(options.basePosition, normalized.length)
  const nodeIds: string[] = []

  normalized.forEach((asset, index) => {
    const sourceMeta = { source: 'browser-asset', browserAssetId: asset.id, fileName: asset.title }
    if (asset.type === 'prompt') {
      const prompt = asset.prompt || asset.title
      const node = store.addNode({
        kind: 'text',
        title: asset.title.replace(/\.[^.]+$/, '') || '提示词',
        prompt,
        position: positions[index],
        categoryId: options.categoryId,
        exactPosition: true,
        select: false,
        meta: sourceMeta,
      })
      store.updateNode(node.id, { contentJson: tiptapDocFromPlainText(prompt) })
      nodeIds.push(node.id)
      return
    }

    if (!asset.url) return
    const node = store.addNode({
      kind: 'asset',
      title: asset.title.replace(/\.[^.]+$/, '') || (asset.type === 'video' ? '参考视频' : '参考图片'),
      prompt: '',
      position: positions[index],
      categoryId: options.categoryId,
      exactPosition: true,
      select: false,
      meta: sourceMeta,
    })
    const result = {
      id: `browser-asset-${node.id}-${Date.now()}`,
      type: asset.type,
      url: asset.url,
      createdAt: Date.now(),
    }
    store.updateNode(node.id, {
      result,
      history: [result],
      status: 'success',
      meta: { ...(node.meta || {}), ...sourceMeta },
    })
    nodeIds.push(node.id)
  })

  if (nodeIds.length) {
    nodeIds.forEach((nodeId, index) => store.selectNode(nodeId, index > 0))
  }

  return {
    createdCount: nodeIds.length,
    skippedCount: assets.length - nodeIds.length,
    nodeIds,
  }
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
  const assetDragItems = parseAssetLibraryDragItems(event.dataTransfer.getData(ASSET_LIBRARY_DRAG_MIME))
  if (assetDragItems.length) {
    event.preventDefault()
    event.stopPropagation()
    const mediaItems = assetDragItems.filter((asset) => asset.kind !== 'audio')
    if (!mediaItems.length) {
      toast('音频请拖到时间轴的「音频轨」当配乐', 'info')
      return
    }
    const store = useGenerationCanvasStore.getState()
    const dragAnchor = assetDragItems.find((asset) => asset.dragAnchor)?.dragAnchor
    const anchoredPosition = resolveAssetLibraryDropPosition(basePosition, dragAnchor)
    const positions = layoutBrowserAssetDropPositions(anchoredPosition, mediaItems.length)
    const nodeIds: string[] = []
    mediaItems.forEach((assetDrag, index) => {
      const node = store.addNode({
        kind: 'asset',
        title: assetDrag.name.replace(/\.[^.]+$/, '') || (assetDrag.kind === 'video' ? '参考视频' : '参考图片'),
        prompt: '',
        position: positions[index],
        categoryId: ctx.activeCategoryId,
        exactPosition: true,
        select: false,
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
      nodeIds.push(node.id)
    })
    nodeIds.forEach((nodeId, index) => store.selectNode(nodeId, index > 0))
    if (mediaItems.length < assetDragItems.length) toast('音频请拖到时间轴的「音频轨」当配乐', 'info')
    return
  }

  // 3) 浏览器素材盒拖入：图片/视频创建媒体 asset 节点；提示词创建 text 节点。
  const browserAssets = parseBrowserAssetDrag(
    event.dataTransfer.getData(BROWSER_ASSET_DRAG_MIME) || event.dataTransfer.getData(LEGACY_BROWSER_ASSET_DRAG_MIME),
  )
  if (browserAssets.length) {
    event.preventDefault()
    event.stopPropagation()
    importBrowserAssetsToGenerationCanvas(browserAssets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      title: asset.title,
      previewUrl: asset.url,
      prompt: asset.prompt,
    })), {
      basePosition,
      categoryId: ctx.activeCategoryId,
    })
    return
  }

  // 4) OS 文件拖入：复制进项目并上传，创建图片 / 视频素材节点（音频无可落节点，过滤）。
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
