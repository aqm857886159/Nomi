// 通用素材引用系统 —— 统一契约（与生成节点解耦，谁用谁声明槽）。
// 这是「一处素材池真相源」的底座：把画布产出 / 项目文件两类来源归一成同一个 AssetRef。
//
// R1 关键设计——「渲染地址」与「传输地址」分离：
//   - renderUrl：给界面看的本地地址（nomi-local:// 或 http），AssetTile 缩略图就读它。
//     它**不保证 vendor 够得着**，所以绝不能直接发给模型。
//   - 传输地址（vendor 可达 URL）**不在此存储**——它在「发送那一刻」由 origin 线索现算
//     （本地素材需先推到 vendor 够得着的地方）。这条传输能力是 P1 发送链的事，此处只负责带上线索。

import type { GenerationCanvasNode } from '../generationCanvasV2/model/generationCanvasTypes'
import type { WorkspaceFileNode } from '../../../electron/workspace/workspaceFileIndex'
import { buildWorkspaceFileUrl } from '../explorer/workspaceFileDrag'

export type AssetKind = 'image' | 'video' | 'audio'
export type AssetSource = 'canvas' | 'project'

/** 发送时解析「传输地址」所需的来源线索（discriminated union，给 R1 解析器用）。 */
export type AssetOrigin =
  | { source: 'canvas'; nodeId: string }
  | { source: 'project'; projectId: string; relativePath: string }

export type AssetRef = {
  /** 稳定身份，用于去重 / React key。画布=节点 id；项目文件=relativePath。 */
  id: string
  kind: AssetKind
  name: string
  /** 渲染地址：界面展示用（nomi-local:// 或 http），不保证 vendor 可达。 */
  renderUrl: string
  /** 可选小预览，缺省回落 renderUrl。 */
  thumbUrl?: string
  source: AssetSource
  /** 传输地址解析线索（见文件头 R1 说明）。 */
  origin: AssetOrigin
}

const ASSET_KINDS: ReadonlySet<string> = new Set<AssetKind>(['image', 'video', 'audio'])

/** 画布节点 → AssetRef；非图/视频结果、无 url 的节点返回 null。 */
export function canvasNodeToAssetRef(node: GenerationCanvasNode): AssetRef | null {
  const result = node.result
  if (!result) return null
  if (result.type !== 'image' && result.type !== 'video') return null
  const renderUrl = String(result.url || result.thumbnailUrl || '').trim()
  if (!renderUrl) return null
  const thumbUrl = String(result.thumbnailUrl || '').trim()
  return {
    id: node.id,
    kind: result.type,
    name: String(node.title || '').trim() || result.type,
    renderUrl,
    thumbUrl: thumbUrl || undefined,
    source: 'canvas',
    origin: { source: 'canvas', nodeId: node.id },
  }
}

/** 项目文件节点 → AssetRef；非素材类（目录/文档/纯文本）返回 null。URL 现算（项目文件不存 url）。 */
export function workspaceNodeToAssetRef(node: WorkspaceFileNode, projectId: string): AssetRef | null {
  if (!ASSET_KINDS.has(node.kind)) return null
  return {
    id: node.relativePath,
    kind: node.kind as AssetKind,
    name: node.name,
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

/** 按种类 + 名字模糊搜索过滤素材（picker 用，纯函数便于单测）。 */
export function filterAssets(assets: AssetRef[], opts: { query?: string; accept?: AssetKind[] } = {}): AssetRef[] {
  const query = (opts.query || '').trim().toLowerCase()
  const accept = opts.accept && opts.accept.length ? opts.accept : null
  return assets.filter((asset) => {
    if (accept && !accept.includes(asset.kind)) return false
    if (query && !asset.name.toLowerCase().includes(query)) return false
    return true
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
