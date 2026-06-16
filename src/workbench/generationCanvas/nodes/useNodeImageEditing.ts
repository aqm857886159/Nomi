import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { dataUrlToFile, persistNodeImageFile } from '../adapters/persistNodeImage'
import type { CropGridResult, CropGridSize } from './render/ImageCropGridOverlay'
import { computeGridCells, computeSplitLayout } from './render/cropGridGeometry'

// 裁切 / 旋转 / 网格切分都用 canvas.toDataURL 产出 PNG base64。先用 base64 给即时预览，
// 紧接着把它落盘换成 nomi-local:// 替换掉 —— 避免 PNG base64 永久挂在 store（图多即卡）。
// 落盘失败则保留 base64 兜底（可持久化、不丢图）。
function persistEditedNodeImageToLocal(nodeId: string, dataUrl: string, createdAt: number): void {
  const file = dataUrlToFile(dataUrl, `edit-${nodeId}-${createdAt}.png`)
  if (!file) return
  void persistNodeImageFile(file, nodeId).then((localUrl) => {
    if (!localUrl) return
    const store = useGenerationCanvasStore.getState()
    const node = store.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return
    const hosted = { id: `asset-${nodeId}-${createdAt}`, type: 'image' as const, url: localUrl, createdAt }
    store.updateNode(nodeId, {
      result: hosted,
      history: [hosted],
      meta: { ...(node.meta || {}), localOnly: false, uploadStatus: 'uploaded' },
    })
  })
}

// 图片本地编辑（切图 / 裁剪 / 旋转翻转）从 BaseGenerationNode 抽出（A1.5 接缝）。
// 图片类与素材类节点都复用这一处；以后新增图片编辑功能只动这里 + NodeImageEditToolbar，
// 不碰壳、不碰生成逻辑。所有操作都遵循「跳出新节点」原则——原图零改动，衍生物是新节点。

// 切图入口仍是「四视图(2) / 九宫格(3)」两档；裁剪是 1 档。统一由可调框处理（见 CropGridSize）。
export type ImageGridSize = 2 | 3
export type ImageTransformOp = 'rotate-left' | 'rotate-right' | 'flip-h' | 'flip-v'

export const IMAGE_TRANSFORM_LABEL: Record<ImageTransformOp, string> = {
  'rotate-left': '向左旋转 90°',
  'rotate-right': '向右旋转 90°',
  'flip-h': '水平翻转',
  'flip-v': '垂直翻转',
}

// 这几个布局上下界与壳里 resize 用的同名常量保持一致（壳负责 resize，这里负责衍生新节点尺寸）。
const MIN_NODE_WIDTH = 240
const MAX_NODE_WIDTH = 680

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function imageGridTileNodeSize(width: number, height: number, preferredWidth: number): { width: number; height: number; previewHeight: number } | null {
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
}

export function useNodeImageEditing(
  node: GenerationCanvasNode,
  visualSize: { width: number; height: number },
): NodeImageEditing {
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const storeConnectNodes = useGenerationCanvasStore((state) => state.connectNodes)
  const [editGrid, setEditGrid] = React.useState<CropGridSize | null>(null)
  const [imageOpBusy, setImageOpBusy] = React.useState(false)
  const openEdit = React.useCallback((gridSize: CropGridSize) => setEditGrid(gridSize), [])
  const cancelEdit = React.useCallback(() => setEditGrid(null), [])

  const visualWidth = visualSize.width
  const nodeId = node.id
  const nodeTitle = node.title
  const nodePositionX = node.position.x
  const nodePositionY = node.position.y
  const nodeResult = node.result

  // 裁剪 / 切图统一走可调框确认：computeGridCells 把「外框 + 框内线」换算成 N 个 image 归一化
  // cell，逐 cell cropImageRegion 裁出新节点。1 cell = 裁剪（单节点）；N cell = 切图（展开网格）。
  // 「跳出新节点、原图零改动」原则不变。
  const handleEditConfirm = React.useCallback(async (confirmed: CropGridResult) => {
    const imageUrl = nodeResult?.type === 'image' ? nodeResult.url : undefined
    const grid = editGrid
    cancelEdit()
    if (!imageUrl || grid == null || imageOpBusy) return
    setImageOpBusy(true)
    try {
      const cells = computeGridCells(confirmed.rect, confirmed.cols, confirmed.rows)
      const isSplit = cells.length > 1
      const createdAt = Date.now()
      // 落点紧贴原图右侧(小偏移)，不再 +80 远铺。
      const baseX = Math.round(nodePositionX + visualWidth + 40)
      const baseY = Math.round(nodePositionY)

      const crops = await Promise.all(cells.map((cell) => cropImageRegion(imageUrl, cell)))

      // 落点/尺寸由纯函数 computeSplitLayout 算（已单测锁「紧凑方块」不变量）：整块≈源宽、小间距、
      // 行列对齐。裁剪(1 格)退化为单盒，与切图共用同一布局（P1）。块原点紧贴原图右侧。
      const aspects = cells.map((cell, i) => {
        const crop = crops[i]
        return crop && crop.height ? crop.width / crop.height : cell.w / Math.max(0.0001, cell.h)
      })
      const blockWidth = clampNumber(visualWidth, MIN_NODE_WIDTH, MAX_NODE_WIDTH)
      const layout = computeSplitLayout(cells, confirmed.rect.w, blockWidth, aspects).map((box) => ({
        x: baseX + box.x,
        y: baseY + box.y,
        width: box.width,
        height: box.height,
      }))

      cells.forEach((cell, index) => {
        const crop = crops[index]
        if (!crop) return
        const slot = layout[index]
        const newNode = addNode({
          kind: 'asset',
          title: isSplit ? `${nodeTitle || '图片'} ${grid}x${grid} 切片 ${index + 1}` : `${nodeTitle || '图片'} 裁剪`,
          prompt: isSplit ? `${grid}x${grid} 图片切片 ${cell.row + 1}-${cell.column + 1}` : '图片裁剪',
          position: { x: slot.x, y: slot.y },
          // 切图瓦片是成组紧凑布局：信任落点、跳过逐卡避让(否则被推散)。裁剪单卡照常避让。
          exactPosition: isSplit,
          select: !isSplit,
        })
        const resultAsset = {
          id: `image-${isSplit ? 'split' : 'crop'}-${newNode.id}-${createdAt}-${index}`,
          type: 'image' as const,
          url: crop.dataUrl,
          createdAt,
        }
        updateNode(newNode.id, {
          result: resultAsset,
          history: [resultAsset],
          status: 'success',
          size: { width: slot.width, height: slot.height },
          meta: {
            ...(newNode.meta || {}),
            source: isSplit ? `image-grid-split-${grid}x${grid}` : 'image-crop',
            sourceNodeId: nodeId,
            localOnly: true,
            ...(isSplit ? { gridSize: grid, gridRow: cell.row, gridColumn: cell.column } : {}),
            imageWidth: crop.width,
            imageHeight: crop.height,
            imageAspectRatio: crop.width / Math.max(1, crop.height),
            previewHeight: slot.height,
          },
        })
        storeConnectNodes(nodeId, newNode.id, 'reference')
        persistEditedNodeImageToLocal(newNode.id, crop.dataUrl, createdAt)
      })
    } catch {
      // 裁剪/切图可能因 CORS 无法把源图读进 canvas 而失败。
    } finally {
      setImageOpBusy(false)
    }
  }, [addNode, cancelEdit, editGrid, imageOpBusy, nodeId, nodePositionX, nodePositionY, nodeResult, nodeTitle, storeConnectNodes, updateNode, visualWidth])

  // 旋转 / 翻转：同款「跳出新素材节点」原则 —— canvas 处理后派生新节点，原图保留。
  const handleImageTransform = React.useCallback(async (op: ImageTransformOp) => {
    const imageUrl = nodeResult?.type === 'image' ? nodeResult.url : undefined
    if (!imageUrl || imageOpBusy) return
    setImageOpBusy(true)
    try {
      const out = await transformImage(imageUrl, op)
      if (!out) return
      const createdAt = Date.now()
      const preferredWidth = clampNumber(visualWidth, MIN_NODE_WIDTH, MAX_NODE_WIDTH)
      const newSize = imageGridTileNodeSize(out.width, out.height, preferredWidth)
      const opNode = addNode({
        kind: 'asset',
        title: `${nodeTitle || '图片'} ${IMAGE_TRANSFORM_LABEL[op]}`,
        prompt: IMAGE_TRANSFORM_LABEL[op],
        position: {
          x: Math.round(nodePositionX + visualWidth + 80),
          y: Math.round(nodePositionY),
        },
        select: true,
      })
      const result = {
        id: `image-${op}-${opNode.id}-${createdAt}`,
        type: 'image' as const,
        url: out.dataUrl,
        createdAt,
      }
      updateNode(opNode.id, {
        result,
        history: [result],
        status: 'success',
        ...(newSize ? { size: { width: newSize.width, height: newSize.height } } : {}),
        meta: {
          ...(opNode.meta || {}),
          source: `image-${op}`,
          sourceNodeId: nodeId,
          localOnly: true,
          imageWidth: out.width,
          imageHeight: out.height,
          imageAspectRatio: out.width / Math.max(1, out.height),
          previewHeight: newSize?.previewHeight,
        },
      })
      storeConnectNodes(nodeId, opNode.id, 'reference')
      persistEditedNodeImageToLocal(opNode.id, out.dataUrl, createdAt)
    } catch {
      // Transform can fail if the source image cannot be loaded into a canvas due to CORS.
    } finally {
      setImageOpBusy(false)
    }
  }, [addNode, imageOpBusy, nodeId, nodePositionX, nodePositionY, nodeResult, nodeTitle, storeConnectNodes, updateNode, visualWidth])

  return {
    editGrid,
    openEdit,
    cancelEdit,
    imageOpBusy,
    handleEditConfirm,
    handleImageTransform,
  }
}
