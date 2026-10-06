/**
 * 结果堆叠里「Alt/⌥ 拖出一个版本 → 松手处出一张独立素材卡」（2026-09-21，LibTV「Option + 拖动」同款）。
 *
 * 拖拽走 HTML5 拖放：来源是版本托盘里的一行（nodes/NodeResultStack.tsx），落点是画布舞台的
 * `onDrop`（components/canvasStageDrop.ts）——舞台落点的屏幕→画布换算只有那一处，由画布内核
 * screenToFlowPosition 提供，这里不再手算坐标。新卡以**中心**压在松手点（与系统文件拖入同一约定）。
 *
 * 只在按着 Alt/⌥ 时生效；不按时版本托盘里的拖动什么也不做（托盘带 nodrag，画布也不会被拖走），
 * 点一下仍是「切换为当前版本」。原节点与它的版本堆叠不变——这是**复制**，不是搬走。
 */
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { listNodeResultVersions, resultIdentity } from '../model/nodeResultLifecycle'
import { CENTER_PLACEMENT_ANCHOR, placementOrigin } from '../model/canvasPlacement'
import { getGenerationNodeDefaultSize } from '../model/generationNodeKinds'
import { computeMediaMetaPatch, resolveNodeVisualSize } from '../nodes/nodeSizing'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { withCanvasGestureContext } from '../events/canvasGestureContext'

export const CANVAS_RESULT_DRAG_MIME = 'application/x-nomi-canvas-result'

export type CanvasResultDragPayload = {
  sourceNodeId: string
  resultIdentity: string
  /** 拖起那一刻从托盘缩略图读到的原图像素（只有缩略图就是原图时才有）；让新卡出生即是真实比例。 */
  width?: number
  height?: number
}

export function encodeCanvasResultDrag(payload: CanvasResultDragPayload): string {
  return JSON.stringify(payload)
}

export function parseCanvasResultDrag(raw: string): CanvasResultDragPayload | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<CanvasResultDragPayload>
    if (typeof value.sourceNodeId !== 'string' || !value.sourceNodeId) return null
    if (typeof value.resultIdentity !== 'string' || !value.resultIdentity) return null
    const width = typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0 ? value.width : undefined
    const height = typeof value.height === 'number' && Number.isFinite(value.height) && value.height > 0 ? value.height : undefined
    return { sourceNodeId: value.sourceNodeId, resultIdentity: value.resultIdentity, ...(width && height ? { width, height } : {}) }
  } catch {
    return null
  }
}

function copiedMediaMeta(source: GenerationCanvasNode, entry: GenerationNodeResult, payload: CanvasResultDragPayload): Record<string, unknown> {
  const base = { source: 'result-stack-copy', referencedNodeId: source.id }
  if (payload.width && payload.height) {
    return computeMediaMetaPatch({ resultType: entry.type, meta: base, width: payload.width, height: payload.height })?.meta ?? base
  }
  // 拖的正是当前版本：原卡已量过的像素就是它的，直接带上（不同版本可能比例不同，所以只认当前版本）。
  if (source.result && resultIdentity(source.result) === resultIdentity(entry)) {
    const meta = source.meta ?? {}
    const keys = entry.type === 'video'
      ? ['videoWidth', 'videoHeight', 'videoAspectRatio', 'videoDuration']
      : ['imageWidth', 'imageHeight', 'imageAspectRatio']
    return { ...base, ...Object.fromEntries(keys.filter((key) => meta[key] !== undefined).map((key) => [key, meta[key]])) }
  }
  return base
}

/** 在 `cursor`（画布坐标，已由内核换算）处建出这个版本的独立素材卡；返回新节点 id。一次撤销点。 */
export function createNodeFromDraggedResult(
  payload: CanvasResultDragPayload,
  cursor: { x: number; y: number },
  fallbackCategoryId?: string,
): string | null {
  const store = useGenerationCanvasStore.getState()
  const source = store.nodes.find((node) => node.id === payload.sourceNodeId)
  if (!source) return null
  const entry = listNodeResultVersions(source).find((candidate) => resultIdentity(candidate) === payload.resultIdentity)
  if (!entry?.url) return null
  const createdAt = Date.now()
  // 复制出来的是一张新素材卡的第 1 版：版本号属于原节点，不跟着走（否则新卡一出生就叫「第 5 版」）。
  const { versionNo: sourceVersionNo, ...copied } = entry
  const result: GenerationNodeResult = { ...copied, id: `result-copy-${source.id}-${createdAt}` }
  const meta = copiedMediaMeta(source, entry, payload)
  // 与 addNode 出生时同一份默认尺寸（节点工厂取 kind 默认）+ 真实比例 → 卡面尺寸唯一真相源换算。
  const size = resolveNodeVisualSize({ kind: 'asset', size: getGenerationNodeDefaultSize('asset'), meta, result })
  const origin = placementOrigin({ point: cursor, anchor: CENTER_PLACEMENT_ANCHOR }, size)
  // 建卡 + 填结果是两次 store 写入；第一次放行撤销点，第二次压住——⌘Z 一次撤掉整张卡（同切图 useNodeImageEditing）。
  const created = withCanvasGestureContext({ source: 'user', txnId: result.id }, () => store.addNode({
    kind: 'asset',
    title: `${source.title || ''} · ${sourceVersionNo}`.trim(),
    prompt: '',
    position: { x: Math.round(origin.x), y: Math.round(origin.y) },
    categoryId: source.categoryId || fallbackCategoryId,
    meta,
    exactPosition: true,
  }))
  withCanvasGestureContext({ source: 'user', txnId: result.id, suppressUndoBarriers: true }, () => {
    useGenerationCanvasStore.getState().updateNode(created.id, {
      result,
      history: [result],
      status: 'success',
      meta: { ...(created.meta || {}), ...meta },
    })
  })
  return created.id
}
