// 画布 stage 的拖入收口：三种来源 → 建 asset 节点。
//   1) 项目文件树（nomi-local 引用）  2) 素材库（已托管 renderUrl）  3) OS 原始文件（复制+上传）
// 从 GenerationCanvas 抽出，保持组件壳瘦身（R9）。

import type { DragEvent } from 'react'
import {
  WORKSPACE_FILE_DRAG_MIME,
  buildWorkspaceFileUrl,
  parseWorkspaceFileDrag,
} from '../../explorer/workspaceFileDrag'
import {
  ASSET_LIBRARY_DRAG_MIME,
  parseAssetLibraryDragItems,
  type AssetLibraryDragPayload,
} from '../../assets/assetLibraryDrag'
import { mediaImportRejectionMessages } from '../../assets/mediaImportMessage'
import { importLocalMediaFilesToGenerationCanvas } from '../adapters/assetImportAdapter'
import { materializeAssetLibraryItems } from '../../assets/assetLibraryMaterialize'
import { getGenerationNodeDefaultSize, getGenerationNodeFootprintSize } from '../model/generationNodeKinds'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { CENTER_PLACEMENT_ANCHOR, placementOrigin } from '../model/canvasPlacement'
import { CANVAS_RESULT_DRAG_MIME, createNodeFromDraggedResult, parseCanvasResultDrag } from './canvasResultDrag'
import { reportCanvasFeedback } from './canvasFeedback'
import { isProjectExecutionContextCurrent, withProjectAction } from '../../project/projectCanvasReadSurface'
import type { BrowserAssetCanvasImportItem } from '../../../ui/browser/overlay/globalAssetPopoverEvents'
import type { TiptapDocJson } from '../model/generationCanvasTypes'
import i18n from '../../../i18n'

export const BROWSER_ASSET_DRAG_MIME = 'application/x-nomi-assets'
export const LEGACY_BROWSER_ASSET_DRAG_MIME = 'application/x-nomi-browser-assets'

export type CanvasStageDropContext = {
  readOnly: boolean
  /** 屏幕坐标 → 画布坐标。只许由画布内核（React Flow screenToFlowPosition）提供，不在这里手算。 */
  toCanvasPoint: (clientX: number, clientY: number) => { x: number; y: number }
  activeCategoryId?: string
}

type BrowserAssetCanvasItem = {
  id: string
  type: 'image' | 'video' | 'prompt'
  title: string
  url?: string
  prompt?: string
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
    x: Math.round(basePosition.x + (index % columns) * cellWidth),
    y: Math.round(basePosition.y + Math.floor(index / columns) * cellHeight),
  }))
}

/** 放下时光标该压在第一张卡的哪一点：素材库卡带着「抓在哪」就按它，其余来源（系统文件 / 文件树 / 浏览器素材盒）按卡中心。 */
export function resolveDropOrigin(
  cursorPosition: { x: number; y: number },
  dragAnchor: AssetLibraryDragPayload['dragAnchor'] = CENTER_PLACEMENT_ANCHOR,
): { x: number; y: number } {
  return placementOrigin({ point: cursorPosition, anchor: dragAnchor }, getGenerationNodeDefaultSize('asset'))
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
  const type =
    asset.type === 'video' ? 'video' : asset.type === 'image' ? 'image' : asset.type === 'prompt' ? 'prompt' : null
  if (!type) return null
  const title = cleanBrowserAssetTitle(
    asset.title,
    i18n.t(
      type === 'video'
        ? 'generationCommon.defaultTitles.referenceVideo'
        : type === 'image'
          ? 'generationCommon.defaultTitles.referenceImage'
          : 'generationCommon.defaultTitles.prompt',
    ),
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
        title: asset.title.replace(/\.[^.]+$/, '') || i18n.t('generationCommon.defaultTitles.prompt'),
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

/** 素材库条目（已是当前项目的引用）→ 画布素材卡，网格排开、整批选中。 */
function addAssetLibraryNodes(items: readonly AssetLibraryDragPayload[], basePosition: { x: number; y: number }, categoryId?: string): void {
  if (!items.length) return
  const store = useGenerationCanvasStore.getState()
  const positions = layoutBrowserAssetDropPositions(basePosition, items.length)
  const nodeIds = items.map((assetDrag, index) => {
    const node = store.addNode({
      kind: 'asset',
      title: assetDrag.name.replace(/\.[^.]+$/, '') || (assetDrag.kind === 'video' ? '参考视频' : '参考图片'),
      prompt: '',
      position: positions[index],
      categoryId,
      exactPosition: true,
      select: false,
    })
    const result = {
      id: `asset-ref-${node.id}-${Date.now()}`,
      type: assetDrag.kind,
      url: assetDrag.renderUrl,
      // 画布挂落盘边界派生的预览；源留在 url 给编辑/导出/大图。跨项目复制来的条目由复制品的 DTO 重新派生，
      // 不会带着别的项目的封面地址（见 assetLibraryMaterialize）。
      ...(assetDrag.thumbUrl ? { thumbnailUrl: assetDrag.thumbUrl } : {}),
      createdAt: Date.now(),
    }
    const originMeta =
      assetDrag.origin.source === 'project'
        ? { source: 'workspace-file', fileName: assetDrag.name, workspaceRelativePath: assetDrag.origin.relativePath }
        : { source: 'asset-library', fileName: assetDrag.name, referencedNodeId: assetDrag.origin.nodeId }
    store.updateNode(node.id, {
      result,
      history: [result],
      status: 'success',
      meta: { ...(node.meta || {}), ...originMeta },
    })
    return node.id
  })
  nodeIds.forEach((nodeId, index) => store.selectNode(nodeId, index > 0))
}

export function handleCanvasStageDrop(event: DragEvent<HTMLDivElement>, ctx: CanvasStageDropContext): void {
  if (ctx.readOnly) return
  // 用户松手的那一点就是落点：由内核换算成画布坐标（负坐标同样合法，不钳制），卡片压在光标下。
  const cursor = ctx.toCanvasPoint(event.clientX, event.clientY)
  const dropOrigin = resolveDropOrigin(cursor)

  // 0) 结果堆叠里 Alt/⌥ 拖出的某个版本：在松手点复制出一张独立素材卡（components/canvasResultDrag.ts）。
  const resultDrag = parseCanvasResultDrag(event.dataTransfer.getData(CANVAS_RESULT_DRAG_MIME))
  if (resultDrag) {
    event.preventDefault()
    event.stopPropagation()
    createNodeFromDraggedResult(resultDrag, cursor, ctx.activeCategoryId)
    return
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
      position: { x: Math.round(dropOrigin.x), y: Math.round(dropOrigin.y) },
      categoryId: ctx.activeCategoryId,
      exactPosition: true,
    })
    const result = { id: `workspace-${node.id}-${Date.now()}`, type: kind, url, createdAt: Date.now() }
    store.updateNode(node.id, {
      result,
      history: [result],
      status: 'success',
      meta: {
        ...(node.meta || {}),
        source: 'workspace-file',
        fileName: workspaceDrag.name,
        workspaceRelativePath: workspaceDrag.relativePath,
      },
    })
    return
  }

  // 2) 素材库拖入：画布只写当前项目自己的引用。别的项目的素材先由 materializeAssetLibraryItems
  // 复制进当前项目再落卡（不引用别的项目的文件，也不在这里另判一次归属）。
  const assetDragItems = parseAssetLibraryDragItems(event.dataTransfer.getData(ASSET_LIBRARY_DRAG_MIME))
  if (assetDragItems.length) {
    event.preventDefault()
    event.stopPropagation()
    // 放下即动作起点：签发此刻打开的项目；复制回来时项目已经换了就什么都不写。
    const project = withProjectAction((issued) => issued)
    if (!project) return
    const dragAnchor = assetDragItems.find((asset) => asset.dragAnchor)?.dragAnchor
    const anchoredPosition = resolveDropOrigin(cursor, dragAnchor)
    const feedback = { projectId: project.binding.projectId, identity: 'canvas-drop' }
    void materializeAssetLibraryItems(assetDragItems, project).then(({ items, failed }) => {
      if (!isProjectExecutionContextCurrent(project)) return
      if (failed > 0) reportCanvasFeedback(i18n.t('assetLibrary.copyIntoProjectFailed', { count: failed }), 'warning', { ...feedback, reason: 'copy-into-project-failed' })
      const mediaItems = items.filter((asset) => asset.kind !== 'audio')
      if (mediaItems.length < items.length) {
        reportCanvasFeedback(i18n.t('generationCommon.canvas.audioToTimeline'), 'info', { ...feedback, reason: 'audio-target', workspaceMode: 'preview' })
      }
      addAssetLibraryNodes(mediaItems, anchoredPosition, ctx.activeCategoryId)
    })
    return
  }

  // 3) 浏览器素材盒拖入：图片/视频创建媒体 asset 节点；提示词创建 text 节点。
  const browserAssets = parseBrowserAssetDrag(
    event.dataTransfer.getData(BROWSER_ASSET_DRAG_MIME) || event.dataTransfer.getData(LEGACY_BROWSER_ASSET_DRAG_MIME),
  )
  if (browserAssets.length) {
    event.preventDefault()
    event.stopPropagation()
    importBrowserAssetsToGenerationCanvas(
      browserAssets.map((asset) => ({
        id: asset.id,
        type: asset.type,
        title: asset.title,
        previewUrl: asset.url,
        prompt: asset.prompt,
      })),
      {
        basePosition: dropOrigin,
        categoryId: ctx.activeCategoryId,
      },
    )
    return
  }

  // 4) OS 文件拖入：复制进项目并上传，创建图片 / 视频素材节点（音频无可落节点，过滤）。
  const files = Array.from(event.dataTransfer.files || [])
  if (!files.length) return
  event.preventDefault()
  event.stopPropagation()
  // 系统文件的卡面尺寸要读完文件才知道（图片按像素比例），锚点交给导入适配器按真实尺寸换算。
  void importLocalFilesToGenerationCanvas(files, { basePosition: cursor, anchor: CENTER_PLACEMENT_ANCHOR, categoryId: ctx.activeCategoryId, exactPosition: true })
}

/**
 * 本地文件 → 画布素材节点的**唯一一条路**。拖进画布走它，左缘「导入」钮也走它——
 * 不为按钮另造一条建 asset 节点的路径（P1：无并行版）。
 * C5：超限截断 / 上传失败不再静默——聚合成一句人话提示（此前 >8 张悄悄丢、失败只在节点上红）。
 */
export function importLocalFilesToGenerationCanvas(
  files: readonly File[],
  options: { basePosition: { x: number; y: number }; categoryId?: string; exactPosition?: boolean; anchor?: { xRatio: number; yRatio: number } },
): Promise<void> {
  // 拖入 / 导入钮即动作起点：此刻签发原项目，下游全程只认它（没有打开的项目就什么都不做）。
  // 先同步签发、再挂 .catch：这个命令不会把拒绝丢给调用它的控件。
  const projectContext = withProjectAction((issued) => issued)
  if (!projectContext) return Promise.resolve()
  return importLocalMediaFilesToGenerationCanvas([...files], { ...options, projectContext })
    .then((result) => {
      if (result.cancelled) return
      const notes: string[] = []
      if (result.skippedOverLimitCount > 0) notes.push(`超过 8 个，已忽略 ${result.skippedOverLimitCount} 个`)
      for (const message of mediaImportRejectionMessages(result.rejected)) notes.push(message)
      if (result.failedCount > 0) notes.push(`${result.failedCount} 个导入失败`)
      if (notes.length) reportCanvasFeedback(notes.join('；'), result.failedCount > 0 ? 'error' : 'warning', { projectId: projectContext.binding.projectId, identity: 'canvas-import', reason: 'import-incomplete' })
    })
    .catch(() => {})
}
