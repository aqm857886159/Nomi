import React from 'react'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { dataUrlToFile, persistNodeImageFile } from '../adapters/persistNodeImage'
import type { CropGridResult, CropGridSize } from './render/ImageCropGridOverlay'
import { computeGridCells } from './render/cropGridGeometry'
import { blobToDataUrl, removeBackgroundBlob } from '../../../lib/removeBackground'
import i18n from '../../../i18n'

// 裁切 / 旋转 / 网格切分都用 canvas.toDataURL 产出 PNG base64。先用 base64 给即时预览，
// 紧接着把它落盘换成 nomi-local:// 替换掉对应 result —— 避免 PNG base64 永久挂在 store（图多即卡）。
// 落盘失败则保留 base64 兜底（可持久化、不丢图）。
function persistEditedNodeImageToLocal(
  nodeId: string,
  resultId: string,
  dataUrl: string,
  createdAt: number,
  index = 0,
): void {
  const file = dataUrlToFile(dataUrl, `edit-${nodeId}-${createdAt}-${index}.png`)
  if (!file) return
  void persistNodeImageFile(file, nodeId).then((localUrl) => {
    if (!localUrl) return
    const store = useGenerationCanvasStore.getState()
    const node = store.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return
    const replaceUrl = (result: GenerationNodeResult | undefined): GenerationNodeResult | undefined =>
      result?.id === resultId ? { ...result, url: localUrl } : result
    const nextResult = replaceUrl(node.result)
    const nextHistory = (node.history || []).map((entry) => replaceUrl(entry) || entry)
    const patch: Partial<GenerationCanvasNode> = {
      history: nextHistory,
    }
    if (nextResult && nextResult !== node.result) {
      patch.result = nextResult
      patch.meta = { ...(node.meta || {}), localOnly: false, uploadStatus: 'uploaded' }
    }
    store.updateNode(nodeId, patch)
  })
}

function mergeNodeImageHistory(
  currentResult: GenerationNodeResult | undefined,
  currentHistory: GenerationNodeResult[] | undefined,
  newResults: GenerationNodeResult[],
): GenerationNodeResult[] {
  const merged: GenerationNodeResult[] = []
  const seen = new Set<string>()
  const add = (result: GenerationNodeResult | undefined) => {
    if (!result) return
    const key = result.id || result.url || result.thumbnailUrl || result.text || ''
    if (!key || seen.has(key)) return
    seen.add(key)
    merged.push(result)
  }
  newResults.forEach(add)
  add(currentResult)
  ;(currentHistory || []).forEach(add)
  return merged
}

// 图片本地编辑（切图 / 裁剪 / 旋转翻转）从 BaseGenerationNode 抽出（A1.5 接缝）。
// 图片类与素材类节点都复用这一处；以后新增图片编辑功能只动这里 + NodeImageEditToolbar，
// 不碰壳、不碰生成逻辑。编辑产物统一写回当前节点历史堆叠，并切为主图。

// 切图入口仍是「四视图(2) / 九宫格(3)」两档；裁剪是 1 档。统一由可调框处理（见 CropGridSize）。
export type ImageGridSize = 2 | 3
export type ImageTransformOp = 'rotate-left' | 'rotate-right' | 'flip-h' | 'flip-v'

export const IMAGE_TRANSFORM_LABEL: Record<ImageTransformOp, string> = {
  'rotate-left': '向左旋转 90°',
  'rotate-right': '向右旋转 90°',
  'flip-h': '水平翻转',
  'flip-v': '垂直翻转',
}

// 这几个布局上下界与壳里 resize 用的同名常量保持一致（壳负责 resize，这里负责编辑后主图尺寸）。
const MIN_NODE_WIDTH = 240
const MAX_NODE_WIDTH = 680

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function removeBackgroundProgressMessage(key: string): string {
  if (key.includes('decode')) return '读取图片中'
  if (key.includes('inference')) return '识别主体中'
  if (key.includes('mask')) return '生成透明遮罩'
  if (key.includes('encode')) return '导出透明 PNG'
  if (key.includes('model')) return '加载抠图模型'
  return '抠图中'
}

function imageGridTileNodeSize(
  width: number,
  height: number,
  preferredWidth: number,
): { width: number; height: number; previewHeight: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const aspectRatio = width / height
  const nodeWidth = clampNumber(preferredWidth, MIN_NODE_WIDTH, MAX_NODE_WIDTH)
  const previewHeight = Math.max(1, Math.round(nodeWidth / aspectRatio))
  return { width: nodeWidth, height: previewHeight, previewHeight }
}

function loadImageForCanvas(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to load image.'))
    if (!url.startsWith('data:') && !url.startsWith('blob:')) {
      image.crossOrigin = 'anonymous'
    }
    image.src = url
  })
}

async function cropImageRegion(
  url: string,
  rect: { x: number; y: number; w: number; h: number },
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (typeof document === 'undefined') return null
  const image = await loadImageForCanvas(url)
  const imageWidth = image.naturalWidth || image.width
  const imageHeight = image.naturalHeight || image.height
  if (!imageWidth || !imageHeight) return null
  const sx = clampNumber(Math.round(rect.x * imageWidth), 0, imageWidth - 1)
  const sy = clampNumber(Math.round(rect.y * imageHeight), 0, imageHeight - 1)
  const sw = clampNumber(Math.round(rect.w * imageWidth), 1, imageWidth - sx)
  const sh = clampNumber(Math.round(rect.h * imageHeight), 1, imageHeight - sy)
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh)
  return { dataUrl: canvas.toDataURL('image/png'), width: sw, height: sh }
}

async function transformImage(
  url: string,
  op: ImageTransformOp,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (typeof document === 'undefined') return null
  const image = await loadImageForCanvas(url)
  const imageWidth = image.naturalWidth || image.width
  const imageHeight = image.naturalHeight || image.height
  if (!imageWidth || !imageHeight) return null
  const rotated = op === 'rotate-left' || op === 'rotate-right'
  const canvas = document.createElement('canvas')
  canvas.width = rotated ? imageHeight : imageWidth
  canvas.height = rotated ? imageWidth : imageHeight
  const context = canvas.getContext('2d')
  if (!context) return null
  if (op === 'rotate-left' || op === 'rotate-right') {
    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate(op === 'rotate-right' ? Math.PI / 2 : -Math.PI / 2)
    context.drawImage(image, -imageWidth / 2, -imageHeight / 2)
  } else if (op === 'flip-h') {
    context.translate(imageWidth, 0)
    context.scale(-1, 1)
    context.drawImage(image, 0, 0)
  } else {
    context.translate(0, imageHeight)
    context.scale(1, -1)
    context.drawImage(image, 0, 0)
  }
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
}

export type NodeImageEditing = {
  /** 当前打开的可调框：null=未开，1=裁剪，2/3=切图（四视图/九宫格）。 */
  editGrid: CropGridSize | null
  openEdit: (gridSize: CropGridSize) => void
  cancelEdit: () => void
  imageOpBusy: boolean
  handleEditConfirm: (result: CropGridResult) => Promise<void>
  handleImageTransform: (op: ImageTransformOp) => Promise<void>
  handleRemoveBackground: () => Promise<void>
}

export function useNodeImageEditing(
  node: GenerationCanvasNode,
  visualSize: { width: number; height: number },
): NodeImageEditing {
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const [editGrid, setEditGrid] = React.useState<CropGridSize | null>(null)
  const [imageOpBusy, setImageOpBusy] = React.useState(false)
  const openEdit = React.useCallback((gridSize: CropGridSize) => setEditGrid(gridSize), [])
  const cancelEdit = React.useCallback(() => setEditGrid(null), [])

  const visualWidth = visualSize.width
  const nodeId = node.id
  const nodeResult = node.result
  const nodeHistory = node.history
  const nodeMeta = node.meta
  const nodeStatus = node.status

  // 裁剪 / 切图统一走可调框确认：computeGridCells 把「外框 + 框内线」换算成 N 个 image 归一化
  // cell，逐 cell cropImageRegion 产出结果后写回当前节点 history。1 cell = 裁剪；N cell = 切图堆叠。
  const handleEditConfirm = React.useCallback(
    async (confirmed: CropGridResult) => {
      const imageUrl = nodeResult?.type === 'image' ? nodeResult.url : undefined
      const grid = editGrid
      cancelEdit()
      if (!imageUrl || grid == null || imageOpBusy) return
      setImageOpBusy(true)
      try {
        const cells = computeGridCells(confirmed.rect, confirmed.cols, confirmed.rows)
        const isSplit = cells.length > 1
        const createdAt = Date.now()
        const crops = await Promise.all(cells.map((cell) => cropImageRegion(imageUrl, cell)))
        const outputs = cells
          .map((cell, index) => {
            const crop = crops[index]
            if (!crop) return null
            const result: GenerationNodeResult = {
              id: `image-${isSplit ? 'split' : 'crop'}-${nodeId}-${createdAt}-${index}`,
              type: 'image' as const,
              url: crop.dataUrl,
              createdAt,
            }
            return { cell, crop, index, result }
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        const main = outputs[0]
        if (!main) return
        const preferredWidth = clampNumber(visualWidth, MIN_NODE_WIDTH, MAX_NODE_WIDTH)
        const newSize = imageGridTileNodeSize(main.crop.width, main.crop.height, preferredWidth)
        const results = outputs.map((entry) => entry.result)
        updateNode(nodeId, {
          result: main.result,
          history: mergeNodeImageHistory(nodeResult, nodeHistory, results),
          status: 'success',
          error: undefined,
          ...(newSize && nodeMeta?.userResized !== true
            ? { size: { width: newSize.width, height: newSize.height } }
            : {}),
          meta: {
            ...(nodeMeta || {}),
            source: isSplit ? `image-grid-split-${grid}x${grid}` : 'image-crop',
            localOnly: true,
            ...(isSplit ? { gridSize: grid, gridRow: main.cell.row, gridColumn: main.cell.column } : {}),
            imageWidth: main.crop.width,
            imageHeight: main.crop.height,
            imageAspectRatio: main.crop.width / Math.max(1, main.crop.height),
            previewHeight: newSize?.previewHeight,
          },
        })
        outputs.forEach((entry) =>
          persistEditedNodeImageToLocal(nodeId, entry.result.id, entry.crop.dataUrl, createdAt, entry.index),
        )
      } catch {
        // 裁剪/切图可能因 CORS 无法把源图读进 canvas 而失败。
      } finally {
        setImageOpBusy(false)
      }
    },
    [cancelEdit, editGrid, imageOpBusy, nodeHistory, nodeId, nodeMeta, nodeResult, updateNode, visualWidth],
  )

  // 旋转 / 翻转：写回当前节点历史堆叠，并切换为当前主图。
  const handleImageTransform = React.useCallback(
    async (op: ImageTransformOp) => {
      const imageUrl = nodeResult?.type === 'image' ? nodeResult.url : undefined
      if (!imageUrl || imageOpBusy) return
      setImageOpBusy(true)
      try {
        const out = await transformImage(imageUrl, op)
        if (!out) return
        const createdAt = Date.now()
        const preferredWidth = clampNumber(visualWidth, MIN_NODE_WIDTH, MAX_NODE_WIDTH)
        const newSize = imageGridTileNodeSize(out.width, out.height, preferredWidth)
        const result: GenerationNodeResult = {
          id: `image-${op}-${nodeId}-${createdAt}`,
          type: 'image' as const,
          url: out.dataUrl,
          createdAt,
        }
        updateNode(nodeId, {
          result,
          history: mergeNodeImageHistory(nodeResult, nodeHistory, [result]),
          status: 'success',
          error: undefined,
          ...(newSize && nodeMeta?.userResized !== true
            ? { size: { width: newSize.width, height: newSize.height } }
            : {}),
          meta: {
            ...(nodeMeta || {}),
            source: `image-${op}`,
            localOnly: true,
            imageWidth: out.width,
            imageHeight: out.height,
            imageAspectRatio: out.width / Math.max(1, out.height),
            previewHeight: newSize?.previewHeight,
          },
        })
        persistEditedNodeImageToLocal(nodeId, result.id, out.dataUrl, createdAt)
      } catch {
        // Transform can fail if the source image cannot be loaded into a canvas due to CORS.
      } finally {
        setImageOpBusy(false)
      }
    },
    [imageOpBusy, nodeHistory, nodeId, nodeMeta, nodeResult, updateNode, visualWidth],
  )

  const handleRemoveBackground = React.useCallback(async () => {
    const imageUrl = nodeResult?.type === 'image' ? nodeResult.url : undefined
    if (!imageUrl || imageOpBusy) return
    setImageOpBusy(true)
    const createdAt = Date.now()
    const previousStatus = nodeStatus || 'success'
    updateNode(nodeId, {
      status: 'running',
      progress: {
        runId: `remove-bg-${nodeId}-${createdAt}`,
        taskKind: 'asset',
        phase: 'remove-background',
        message: '抠图中',
        percent: 0,
        updatedAt: createdAt,
      },
      meta: {
        ...(nodeMeta || {}),
        removeBackgroundSource: imageUrl,
      },
    })
    try {
      const blob = await removeBackgroundBlob(imageUrl, ({ key, current, total }) => {
        const percent = total > 0 ? Math.round((current / total) * 100) : undefined
        updateNode(
          nodeId,
          {
            progress: {
              runId: `remove-bg-${nodeId}-${createdAt}`,
              taskKind: 'asset',
              phase: 'remove-background',
              message: removeBackgroundProgressMessage(key),
              percent,
              updatedAt: Date.now(),
            },
          },
          { persist: false },
        )
      })
      const file = new File([blob], `remove-bg-${nodeId}-${createdAt}.png`, { type: 'image/png' })
      const localUrl = await persistNodeImageFile(file, nodeId)
      const finalUrl = localUrl ?? (await blobToDataUrl(blob))
      const result: GenerationNodeResult = {
        id: `image-remove-bg-${nodeId}-${createdAt}`,
        type: 'image' as const,
        url: finalUrl,
        createdAt,
      }
      updateNode(nodeId, {
        result,
        history: mergeNodeImageHistory(nodeResult, nodeHistory, [result]),
        status: 'success',
        error: undefined,
        progress: undefined,
        meta: {
          ...(nodeMeta || {}),
          removeBackgroundSource: imageUrl,
          localOnly: !localUrl,
          uploadStatus: localUrl ? 'uploaded' : undefined,
        },
      })
    } catch {
      // removeBackground 失败（离线/CDN 不通）时静默报错 toast
      updateNode(nodeId, {
        status: previousStatus,
        progress: undefined,
      })
      const { toast } = await import('../../../ui/toast')
      toast(i18n.t('generationCommon.whiteboard.removeBackgroundFailed'), 'error')
    } finally {
      setImageOpBusy(false)
    }
  }, [imageOpBusy, nodeHistory, nodeId, nodeMeta, nodeResult, nodeStatus, updateNode])

  return {
    editGrid,
    openEdit,
    cancelEdit,
    imageOpBusy,
    handleEditConfirm,
    handleImageTransform,
    handleRemoveBackground,
  }
}
