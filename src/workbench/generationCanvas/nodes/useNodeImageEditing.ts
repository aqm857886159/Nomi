import React from 'react'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { persistNodeImageBlob } from '../adapters/persistNodeImage'
import type { CropGridResult, CropGridSize } from './render/ImageCropGridOverlay'
import { computeGridCells, computeSplitLayout, type GridCell } from './render/cropGridGeometry'
import { removeBackgroundBlob } from '../../../lib/removeBackground'
import { IMAGE_EDIT_PHASE, REMOVE_BACKGROUND_PHASE, removeBackgroundProgressMessage } from './localImageOpPhase'
import { withCanvasGestureContext } from '../events/canvasGestureContext'
import { useWorkbenchStore } from '../../workbenchStore'
// 尺寸上下界与"卡片实际渲染多大"都从 nodeSizing 拿——这里再抄一份就是布局错位的温床。
import { MAX_NODE_WIDTH, MIN_NODE_WIDTH, resolveNodeVisualSize } from './nodeSizing'
import i18n from '../../../i18n'

// 裁切 / 旋转 / 网格切分统一产 PNG **Blob**，落盘换 nomi-local:// 之后才写 store。
//
// 根因笔记（2026-08-20「九宫格直接卡死」，取证见 docs/plan/2026-08-20-grid-split-freeze.md）：
// 旧管线每个 cell 都 new Image() 重新解码整张源图、再 canvas.toDataURL 同步编码成 base64，
// 9 段 base64 先塞进 store 再逐个落盘替换 —— 主线程连冻 1.6s（9 次同步 PNG 编码就占 700ms），
// 且 1+9 次 updateNode 每次都被 emitCanvasGesture 做 JSON 深拷贝，共 60MB 走一遍 JSON。
// 现在三件事都堵在源头：源图只解码一次；裁剪+编码交给 createImageBitmap/convertToBlob（不占主线程）；
// store 只收门牌号、只写一次。落盘失败才退回 base64 兜底（可持久化、不丢图）。
const PNG_TYPE = 'image/png'

type EditedTile = { blob: Blob; width: number; height: number }

/** 源图解码一次，所有 cell 共用这一张位图（旧管线是每格重解一次整图）。 */
async function decodeSourceBitmap(url: string): Promise<ImageBitmap> {
  return createImageBitmap(await loadImageForCanvas(url))
}

/** OffscreenCanvas → PNG Blob。convertToBlob 是异步的，编码不占主线程（toDataURL 是同步的，占）。 */
async function canvasToPngBlob(canvas: OffscreenCanvas, width: number, height: number): Promise<EditedTile | null> {
  const blob = await canvas.convertToBlob({ type: PNG_TYPE })
  return blob ? { blob, width, height } : null
}

/** 从已解码的源位图上裁一格（归一化坐标 → 像素）。 */
async function cropBitmapRegion(source: ImageBitmap, rect: { x: number; y: number; w: number; h: number }): Promise<EditedTile | null> {
  const sx = clampNumber(Math.round(rect.x * source.width), 0, source.width - 1)
  const sy = clampNumber(Math.round(rect.y * source.height), 0, source.height - 1)
  const sw = clampNumber(Math.round(rect.w * source.width), 1, source.width - sx)
  const sh = clampNumber(Math.round(rect.h * source.height), 1, source.height - sy)
  const canvas = new OffscreenCanvas(sw, sh)
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
  return canvasToPngBlob(canvas, sw, sh)
}

/** 旋转 / 翻转：同一条 Blob 管线（不留第二个 base64 入口）。 */
async function transformBitmap(source: ImageBitmap, op: ImageTransformOp): Promise<EditedTile | null> {
  const rotated = op === 'rotate-left' || op === 'rotate-right'
  const width = rotated ? source.height : source.width
  const height = rotated ? source.width : source.height
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) return null
  if (rotated) {
    context.translate(width / 2, height / 2)
    context.rotate(op === 'rotate-right' ? Math.PI / 2 : -Math.PI / 2)
    context.drawImage(source, -source.width / 2, -source.height / 2)
  } else if (op === 'flip-h') {
    context.translate(source.width, 0)
    context.scale(-1, 1)
    context.drawImage(source, 0, 0)
  } else {
    context.translate(0, source.height)
    context.scale(1, -1)
    context.drawImage(source, 0, 0)
  }
  return canvasToPngBlob(canvas, width, height)
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
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
  const nodeTitle = node.title
  const nodeCategoryId = node.categoryId
  const nodePositionX = node.position.x
  const nodePositionY = node.position.y

  // 切图（N 格）：每切好一格就**当场落一个节点**在画布上，一张接一张冒出来（用户拍板 2026-08-20）——
  // 进度就是画面本身，不用另加进度条；切完把这批瓦片编成一组，整组能一起拖走。
  // 落点走纯函数 computeSplitLayout（紧凑方块，单测锁不变量）+ exactPosition 信任落点，
  // 否则逐卡避让会把成组瓦片推散（「切完飘」的老根因）。原图零改动。
  const splitIntoTiles = React.useCallback(
    async (imageUrl: string, grid: CropGridSize, cells: GridCell[], frameWidth: number) => {
      const store = useGenerationCanvasStore.getState()
      const createdAt = Date.now()
      const baseX = Math.round(nodePositionX + visualWidth + 40)
      const baseY = Math.round(nodePositionY)
      const blockWidth = clampNumber(visualWidth, MIN_NODE_WIDTH, MAX_NODE_WIDTH)
      const tileIds: string[] = []
      // 一次切图 = 一个 Cmd+Z 步：第一张打 barrier，其余瓦片与编组挂同一 txn 且抑制自带 barrier
      // （否则撤销一次九宫格要按 10 次）。只包**同步**段——canvasGestureContext 明令禁止跨 await：
      // 异步间隙用户手势会插队，上下文会串台。
      const txnId = `txn_split_${createdAt}`
      let barrierPushed = false
      const inSplitTxn = <T,>(fn: () => T): T => {
        // 只有整次切图的**第一个** store 写入放行 barrier（addNode 与随后的 updateNode 各会打一个，
        // 所以按调用逐个关，不能按"第几张瓦片"关）。
        const suppressUndoBarriers = barrierPushed
        barrierPushed = true
        return withCanvasGestureContext({ source: 'user', txnId, suppressUndoBarriers }, fn)
      }
      const source = await decodeSourceBitmap(imageUrl)
      // 落点在切之前就定死（瓦片是"填进既定格位"，不是边切边挪）。尺寸**问壳要**：
      // resolveNodeVisualSize 是卡片实际渲染尺寸的唯一真相源（宽度有 240 地板价等一堆夹取规则）。
      // 自己按比例复刻一遍就会错位——上一版按 129px 步距摆、卡片却各渲染 240 宽，九张糊成一团。
      const tileSizes = cells.map((cell) => {
        const pixelAspect = (cell.w * source.width) / Math.max(1, cell.h * source.height)
        const width = clampNumber(Math.round((cell.w / Math.max(0.0001, frameWidth)) * blockWidth), MIN_NODE_WIDTH, MAX_NODE_WIDTH)
        const height = Math.max(1, Math.round(width / Math.max(0.0001, pixelAspect)))
        return resolveNodeVisualSize({
          kind: 'asset',
          size: { width, height },
          meta: { source: `image-grid-split-${grid}x${grid}`, previewHeight: height },
          result: { id: 'probe', type: 'image', url: 'probe', createdAt },
        })
      })
      const layout = computeSplitLayout(cells, tileSizes)
      try {
        for (const [index, cell] of cells.entries()) {
          const tile = await cropBitmapRegion(source, cell)
          if (!tile) continue
          const stored = await persistNodeImageBlob(tile.blob, nodeId, `split-${nodeId}-${createdAt}-${index}.png`)
          const slot = layout[index]
          const created = inSplitTxn(() =>
            store.addNode({
              kind: 'asset',
              title: i18n.t('generationCommon.imageToolbar.tileTitle', {
                source: nodeTitle || i18n.t('generationCommon.imageToolbar.image'),
                index: index + 1,
              }),
              position: { x: baseX + slot.x, y: baseY + slot.y },
              categoryId: nodeCategoryId,
              exactPosition: true,
              select: false,
            }),
          )
          inSplitTxn(() => {
            const result: GenerationNodeResult = {
              id: `image-split-${created.id}-${createdAt}`,
              type: 'image' as const,
              url: stored.url,
              createdAt,
            }
            updateNode(created.id, {
              result,
              history: [result],
              status: 'success',
              size: { width: slot.width, height: slot.height },
              meta: {
                ...(created.meta || {}),
                source: `image-grid-split-${grid}x${grid}`,
                sourceNodeId: nodeId,
                localOnly: stored.localOnly,
                ...(stored.localOnly ? {} : { uploadStatus: 'uploaded' as const }),
                gridSize: grid,
                gridRow: cell.row,
                gridColumn: cell.column,
                imageWidth: tile.width,
                imageHeight: tile.height,
                imageAspectRatio: tile.width / Math.max(1, tile.height),
                previewHeight: slot.height,
              },
            })
          })
          tileIds.push(created.id)
        }
      } finally {
        source.close()
      }
      if (tileIds.length < 2) return tileIds.length
      // 编组：这 9 张是一件东西的九个部分，整组能一起选、一起拖、一起删。
      inSplitTxn(() => {
        const latest = useGenerationCanvasStore.getState()
        latest.selectNodes(tileIds)
        latest.groupSelectedNodes(
          nodeCategoryId || 'shots',
          i18n.t('generationCommon.imageToolbar.tileGroupName', { grid, source: nodeTitle || i18n.t('generationCommon.imageToolbar.image') }),
        )
      })
      // 九张摊开比原图占地大得多，多半有一半落在视口外——用批量落节点那套既有的 fit 信号
      // 把整块揭出来（同 3D 录完 take 的做法），否则用户只看到左边两列，以为切歪了。
      useWorkbenchStore.getState().requestCanvasFit(nodeCategoryId)
      return tileIds.length
    },
    [nodeCategoryId, nodeId, nodePositionX, nodePositionY, nodeTitle, updateNode, visualWidth],
  )

  // 可调框确认：computeGridCells 把「外框 + 框内线」换算成 N 个 image 归一化 cell。
  // 1 cell = 裁剪 → 原地改这张（进本节点堆叠）；N cell = 切图 → 摊成 N 个节点（splitIntoTiles）。
  // 逐格 await 是有意的：让出主线程，切图期间画布仍可拖可点。
  const handleEditConfirm = React.useCallback(
    async (confirmed: CropGridResult) => {
      const imageUrl = nodeResult?.type === 'image' ? nodeResult.url : undefined
      const grid = editGrid
      cancelEdit()
      if (!imageUrl || grid == null || imageOpBusy) return
      setImageOpBusy(true)
      const cells = computeGridCells(confirmed.rect, confirmed.cols, confirmed.rows)
      const isSplit = cells.length > 1
      const createdAt = Date.now()
      const previousStatus = nodeStatus || 'success'
      // 进度反馈走节点既有的 running + progress（与抠图同一套：图保留、加模糊呼吸），不新造 UI。
      // persist:false —— 这是转瞬即逝的中间态，不该把项目标脏触发存盘。
      const reportProgress = (done: number) =>
        updateNode(
          nodeId,
          {
            status: 'running',
            progress: {
              runId: `image-edit-${nodeId}-${createdAt}`,
              taskKind: 'asset',
              phase: IMAGE_EDIT_PHASE,
              message: i18n.t(isSplit ? 'generationCommon.imageToolbar.splitting' : 'generationCommon.imageToolbar.cropping'),
              percent: Math.round((done / cells.length) * 100),
              updatedAt: Date.now(),
            },
          },
          { persist: false },
        )
      try {
        reportProgress(0)
        // 切图 = 摊成 N 个节点（原图不动）；裁剪 = 原地改这张（进本节点堆叠）。
        if (isSplit) {
          const made = await splitIntoTiles(imageUrl, grid, cells, confirmed.rect.w)
          if (made === 0) throw new Error('image split produced no tile')
          updateNode(nodeId, { status: previousStatus, progress: undefined }, { persist: false })
          return
        }
        const source = await decodeSourceBitmap(imageUrl)
        let cropped: EditedTile | null = null
        try {
          cropped = await cropBitmapRegion(source, cells[0])
        } finally {
          source.close()
        }
        if (!cropped) throw new Error('image crop produced no tile')
        reportProgress(1)
        const stored = await persistNodeImageBlob(cropped.blob, nodeId, `crop-${nodeId}-${createdAt}.png`)
        const result: GenerationNodeResult = {
          id: `image-crop-${nodeId}-${createdAt}`,
          type: 'image' as const,
          url: stored.url,
          createdAt,
        }
        const preferredWidth = clampNumber(visualWidth, MIN_NODE_WIDTH, MAX_NODE_WIDTH)
        const newSize = imageGridTileNodeSize(cropped.width, cropped.height, preferredWidth)
        updateNode(nodeId, {
          result,
          history: mergeNodeImageHistory(nodeResult, nodeHistory, [result]),
          status: 'success',
          error: undefined,
          progress: undefined,
          ...(newSize && nodeMeta?.userResized !== true
            ? { size: { width: newSize.width, height: newSize.height } }
            : {}),
          meta: {
            ...(nodeMeta || {}),
            source: 'image-crop',
            localOnly: stored.localOnly,
            ...(stored.localOnly ? {} : { uploadStatus: 'uploaded' as const }),
            imageWidth: cropped.width,
            imageHeight: cropped.height,
            imageAspectRatio: cropped.width / Math.max(1, cropped.height),
            previewHeight: newSize?.previewHeight,
          },
        })
      } catch {
        // 源图读不进画布（CORS/解码失败）时别再静默——用户点了确认什么都没发生，看起来就是「卡死」。
        updateNode(nodeId, { status: previousStatus, progress: undefined })
        const { toast } = await import('../../../ui/toast')
        toast(i18n.t('generationCommon.imageToolbar.editFailed'), 'error')
      } finally {
        setImageOpBusy(false)
      }
    },
    [cancelEdit, editGrid, imageOpBusy, nodeHistory, nodeId, nodeMeta, nodeResult, nodeStatus, splitIntoTiles, updateNode, visualWidth],
  )

  // 旋转 / 翻转：写回当前节点历史堆叠，并切换为当前主图。
  const handleImageTransform = React.useCallback(
    async (op: ImageTransformOp) => {
      const imageUrl = nodeResult?.type === 'image' ? nodeResult.url : undefined
      if (!imageUrl || imageOpBusy) return
      setImageOpBusy(true)
      const createdAt = Date.now()
      try {
        const source = await decodeSourceBitmap(imageUrl)
        let out: EditedTile | null = null
        try {
          out = await transformBitmap(source, op)
        } finally {
          source.close()
        }
        if (!out) throw new Error('image transform produced no tile')
        const stored = await persistNodeImageBlob(out.blob, nodeId, `edit-${nodeId}-${createdAt}-${op}.png`)
        const preferredWidth = clampNumber(visualWidth, MIN_NODE_WIDTH, MAX_NODE_WIDTH)
        const newSize = imageGridTileNodeSize(out.width, out.height, preferredWidth)
        const result: GenerationNodeResult = {
          id: `image-${op}-${nodeId}-${createdAt}`,
          type: 'image' as const,
          url: stored.url,
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
            localOnly: stored.localOnly,
            ...(stored.localOnly ? {} : { uploadStatus: 'uploaded' as const }),
            imageWidth: out.width,
            imageHeight: out.height,
            imageAspectRatio: out.width / Math.max(1, out.height),
            previewHeight: newSize?.previewHeight,
          },
        })
      } catch {
        const { toast } = await import('../../../ui/toast')
        toast(i18n.t('generationCommon.imageToolbar.editFailed'), 'error')
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
        phase: REMOVE_BACKGROUND_PHASE,
      message: i18n.t('generationCommon.imageToolbar.removingBackground'),
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
              phase: REMOVE_BACKGROUND_PHASE,
              message: removeBackgroundProgressMessage(key),
              percent,
              updatedAt: Date.now(),
            },
          },
          { persist: false },
        )
      })
      const stored = await persistNodeImageBlob(blob, nodeId, `remove-bg-${nodeId}-${createdAt}.png`)
      const result: GenerationNodeResult = {
        id: `image-remove-bg-${nodeId}-${createdAt}`,
        type: 'image' as const,
        url: stored.url,
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
          localOnly: stored.localOnly,
          uploadStatus: stored.localOnly ? undefined : 'uploaded',
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
