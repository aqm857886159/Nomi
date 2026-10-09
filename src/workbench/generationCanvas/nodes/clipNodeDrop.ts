// 素材拖进剪辑节点轴：认哪些拖放载荷、怎么变成轴上的片段。接收口只有这一处，轴组件只管事件与落点指示。
// 来源两种，载荷格式不动：画布素材节点的「拖到时间轴」把手（TIMELINE_GENERATION_NODE_DRAG_MIME），
// 素材库（ASSET_LIBRARY_DRAG_MIME）。全局 TimelineTrack 认的是同一对 MIME。
import { ASSET_LIBRARY_DRAG_MIME, parseAssetLibraryDragItems, type AssetLibraryDragPayload } from '../../assets/assetLibraryDrag'
import { decodeTimelineGenerationNodeDragPayload, TIMELINE_GENERATION_NODE_DRAG_MIME } from '../../timeline/timelineDragPayload'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { ClipNodeSource } from './clipNodeModel'

export type ClipDropPayload = {
  assets: AssetLibraryDragPayload[]
  /** 画布素材节点载荷里带的节点（落地时按 id 再读一次活的）。 */
  nodeId: string | null
  node: GenerationCanvasNode | null
}

/** dragover 只能读 types，读不到内容：凡是可能是素材的载荷都先接住并画指示，内容合不合适在 drop 时判。 */
export function acceptsClipDropTypes(types: readonly string[]): boolean {
  return types.includes(TIMELINE_GENERATION_NODE_DRAG_MIME) || types.includes(ASSET_LIBRARY_DRAG_MIME)
}

export function readClipDropPayload(dataTransfer: Pick<DataTransfer, 'getData'>): ClipDropPayload | null {
  const assets = parseAssetLibraryDragItems(dataTransfer.getData(ASSET_LIBRARY_DRAG_MIME))
  const generation = decodeTimelineGenerationNodeDragPayload(dataTransfer.getData(TIMELINE_GENERATION_NODE_DRAG_MIME))
  if (!assets.length && !generation) return null
  return { assets, nodeId: generation?.nodeId ?? null, node: generation?.node ?? null }
}

/** 画布节点的结果 -> 轴上的片段（与连线自动灌入用同一套字段；图片 4 秒、视频用结果时长）。 */
export function clipNodeSourceFromGenerationNode(node: GenerationCanvasNode): ClipNodeSource | null {
  const result = node.result
  if (!result?.url || (result.type !== 'image' && result.type !== 'video')) return null
  const durationSeconds = result.type === 'image' ? 4 : (result.durationSeconds && result.durationSeconds > 0 ? result.durationSeconds : 6)
  return {
    id: node.id,
    sourceNodeId: node.id,
    type: result.type,
    label: node.title || result.type,
    url: result.url,
    ...(result.thumbnailUrl ? { thumbnailUrl: result.thumbnailUrl } : {}),
    durationSeconds,
    trimStart: 0,
    trimEnd: durationSeconds,
  }
}
