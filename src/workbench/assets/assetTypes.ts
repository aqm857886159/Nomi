// 通用素材引用系统 —— 统一契约（与生成节点解耦，谁用谁声明槽）。
// 这是「一处素材池真相源」的底座：把画布产出 / 项目文件两类来源归一成同一个 AssetRef。
//
// R1 关键设计——「渲染地址」与「传输地址」分离：
//   - renderUrl：给界面看的本地地址（nomi-local:// 或 http），AssetTile 缩略图就读它。
//     它**不保证 vendor 够得着**，所以绝不能直接发给模型。
//   - 传输地址（vendor 可达 URL）**不在此存储**——它在「发送那一刻」由 origin 线索现算
//     （本地素材需先推到 vendor 够得着的地方）。这条传输能力是 P1 发送链的事，此处只负责带上线索。

import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'
import { listNodeMediaResults, resultIdentity } from '../generationCanvas/model/nodeResultLifecycle'
import type { WorkspaceFileNode } from '../../../electron/workspace/workspaceFileIndex'
import { buildWorkspaceFileUrl } from '../explorer/workspaceFileDrag'

export type AssetKind = 'image' | 'video' | 'audio' | 'model3d'
export type AssetSource = 'canvas' | 'project'

/**
 * Optional intrinsic media dimensions.  They are display metadata only: the
 * asset origin remains the authority used by the transport/write boundaries.
 */
export type AssetDimensions = {
  width: number
  height: number
}

/** 发送时解析「传输地址」所需的来源线索（discriminated union，给 R1 解析器用）。 */
export type AssetOrigin =
  | { source: 'canvas'; nodeId: string; resultId?: string }
  | { source: 'project'; projectId: string; relativePath: string }

export type AssetRef = {
  /** 稳定身份，用于去重 / React key。画布=节点 id；项目文件=relativePath。 */
  id: string
  kind: AssetKind
  name: string
  createdAt?: string
  updatedAt?: string
  /** 渲染地址：界面展示用（nomi-local:// 或 http），不保证 vendor 可达。 */
  renderUrl: string
  /** 可选小预览，缺省回落 renderUrl。 */
  thumbUrl?: string
  /** 已知的媒体内在尺寸；缺省时展示层会保留自己的安全占位比例。 */
  dimensions?: AssetDimensions
  /** 由 sidecar/节点元数据提供的比例（没有完整像素尺寸时的轻量回退）。 */
  aspectRatio?: number
  /** 跨项目素材详情里使用的显示名称；不进入 origin，也不用于传输授权。 */
  sourceProjectName?: string
  /** 落盘素材所属的画布节点；用于从项目素材删除时同步清理全项目素材。 */
  ownerNodeId?: string
  /** 画布节点中的单个生成结果；同一节点多图时用于精确设主图/删除。 */
  ownerResultId?: string
  source: AssetSource
  /** 传输地址解析线索（见文件头 R1 说明）。 */
  origin: AssetOrigin
}

const ASSET_KINDS: ReadonlySet<string> = new Set<AssetKind>(['image', 'video', 'audio', 'model3d'])

function isAssetResult(result: GenerationNodeResult): result is GenerationNodeResult & { type: AssetKind } {
  return ASSET_KINDS.has(result.type)
}

const MAX_ASSET_DIMENSION = 100_000
const MIN_ASSET_ASPECT_RATIO = 0.05
const MAX_ASSET_ASPECT_RATIO = 20

function asMetadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function metadataRecords(metadata: unknown): Record<string, unknown>[] {
  const root = asMetadataRecord(metadata)
  if (!root) return []
  return [root, asMetadataRecord(root.metadata), asMetadataRecord(root.dimensions)]
    .filter((record): record is Record<string, unknown> => Boolean(record))
}

function finiteDimension(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_ASSET_DIMENSION) return undefined
  const rounded = Math.round(parsed)
  return rounded > 0 ? rounded : undefined
}

function finiteAspectRatio(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  if (!Number.isFinite(parsed) || parsed < MIN_ASSET_ASPECT_RATIO || parsed > MAX_ASSET_ASPECT_RATIO) return undefined
  return parsed
}

/**
 * Read only the bounded dimension fields already emitted by canvas/asset
 * metadata.  The nested metadata/dimensions shapes cover older sidecars while
 * keeping this helper deliberately shallow (untrusted JSON must not recurse).
 */
function assetMetadataFieldsFromMetadata(metadata: unknown, kind?: AssetKind): Pick<AssetRef, 'dimensions' | 'aspectRatio'> {
  const records = metadataRecords(metadata)
  const pairs: Array<[string, string]> = kind === 'video'
    ? [['videoWidth', 'videoHeight'], ['width', 'height'], ['imageWidth', 'imageHeight']]
    : [['imageWidth', 'imageHeight'], ['width', 'height'], ['videoWidth', 'videoHeight']]
  for (const record of records) {
    for (const [widthKey, heightKey] of pairs) {
      const width = finiteDimension(record[widthKey])
      const height = finiteDimension(record[heightKey])
      if (width !== undefined && height !== undefined) {
        return { dimensions: { width, height }, aspectRatio: width / height }
      }
    }
  }
  const keys = kind === 'video'
    ? ['videoAspectRatio', 'aspectRatio', 'imageAspectRatio']
    : ['imageAspectRatio', 'aspectRatio', 'videoAspectRatio']
  for (const record of records) {
    for (const key of keys) {
      const ratio = finiteAspectRatio(record[key])
      if (ratio !== undefined) return { aspectRatio: ratio }
    }
  }
  return {}
}

export function assetDimensionsFromMetadata(metadata: unknown, kind?: AssetKind): AssetDimensions | undefined {
  return assetMetadataFieldsFromMetadata(metadata, kind).dimensions
}

/** Read an existing aspect-ratio field when a sidecar has no W/H pair. */
export function assetAspectRatioFromMetadata(metadata: unknown, kind?: AssetKind): number | undefined {
  return assetMetadataFieldsFromMetadata(metadata, kind).aspectRatio
}

/** Resolve a safe CSS aspect ratio for an asset card. */
export function assetAspectRatio(asset: Pick<AssetRef, 'dimensions' | 'aspectRatio'>): number | undefined {
  const fromDimensions = asset.dimensions && asset.dimensions.height > 0
    ? asset.dimensions.width / asset.dimensions.height
    : undefined
  return finiteAspectRatio(fromDimensions ?? asset.aspectRatio)
}

/** 画布节点 → 全部媒体 AssetRef；主结果与 history 去重展开，同一节点多图不再只露主图。 */
export function canvasNodeToAssetRefs(node: GenerationCanvasNode): AssetRef[] {
  return listNodeMediaResults(node).filter(isAssetResult).map((result) => {
    const identity = resultIdentity(result)
    const renderUrl = String(result.url || result.thumbnailUrl || '').trim()
    const thumbUrl = String(result.thumbnailUrl || '').trim()
    const mediaMetadata = assetMetadataFieldsFromMetadata(node.meta, result.type)
    const resultMetadata = assetMetadataFieldsFromMetadata(result, result.type)
    const rawMetadata = assetMetadataFieldsFromMetadata(result.raw, result.type)
    const dimensions = mediaMetadata.dimensions ?? resultMetadata.dimensions ?? rawMetadata.dimensions
    const aspectRatio = dimensions
      ? dimensions.width / dimensions.height
      : mediaMetadata.aspectRatio ?? resultMetadata.aspectRatio ?? rawMetadata.aspectRatio
    return {
      id: `${node.id}:${identity}`,
      kind: result.type,
      name: String(node.title || '').trim() || result.type,
      createdAt: result.createdAt ? new Date(result.createdAt).toISOString() : undefined,
      updatedAt: result.createdAt ? new Date(result.createdAt).toISOString() : undefined,
      renderUrl,
      thumbUrl: thumbUrl || undefined,
      ...(dimensions ? { dimensions } : {}),
      ...(aspectRatio !== undefined ? { aspectRatio } : {}),
      ownerNodeId: node.id,
      ownerResultId: identity,
      source: 'canvas',
      origin: { source: 'canvas', nodeId: node.id, resultId: identity },
    }
  })
}

/** 项目文件节点 → AssetRef；非素材类（目录/文档/纯文本）返回 null。URL 现算（项目文件不存 url）。 */
export function workspaceNodeToAssetRef(node: WorkspaceFileNode, projectId: string): AssetRef | null {
  const kind = node.kind === 'file' && node.contentType === 'model/gltf-binary' ? 'model3d' : node.kind
  if (!ASSET_KINDS.has(kind)) return null
  return {
    id: node.relativePath,
    kind: kind as AssetKind,
    name: node.name,
    updatedAt: node.updatedAt,
    renderUrl: buildWorkspaceFileUrl(projectId, node.relativePath),
    source: 'project',
    origin: { source: 'project', projectId, relativePath: node.relativePath },
  }
}

/** 数组内移动一项(from→to),返回新数组;越界/同位 → 原样返回。tile 拖拽重排用,纯函数便于单测。 */
export function moveArrayItem<T>(arr: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return arr.slice()
  const next = arr.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** 按种类 + 素材名模糊搜索过滤素材（picker/素材库共用，纯函数便于单测）。 */
export function filterAssets(assets: AssetRef[], opts: { query?: string; accept?: AssetKind[] } = {}): AssetRef[] {
  const query = (opts.query || '').trim().toLowerCase()
  const accept = opts.accept && opts.accept.length ? opts.accept : null
  return assets.filter((asset) => {
    if (accept && !accept.includes(asset.kind)) return false
    return !query || asset.name.toLowerCase().includes(query)
  })
}

/** 把项目文件树（含目录 children）压平成节点列表，供 mapper 逐个解析。 */
export function flattenWorkspaceFiles(nodes: WorkspaceFileNode[]): WorkspaceFileNode[] {
  const out: WorkspaceFileNode[] = []
  const walk = (list: WorkspaceFileNode[]) => {
    for (const node of list) {
      out.push(node)
      if (node.children && node.children.length) walk(node.children)
    }
  }
  walk(nodes)
  return out
}
