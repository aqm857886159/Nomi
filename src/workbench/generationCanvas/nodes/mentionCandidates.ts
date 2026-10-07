/**
 * @ 引用的候选聚合（图片/视频/音频）。
 *
 * 扩展前：候选只有「当前节点已连好的参考图」——想引一张素材库里的图，得先手动拖进来再 @。
 * 扩展后：素材库 + 画布上任何已出图的节点也能直接 @，**选中即自动建立真实引用**。
 *
 * ⚠️ 这一项最要命的约束是「别抄坏」：竞品那套「语言化引用」靠模型自觉、静默失败。
 * 我们的强项是结构化连线 + 能力校验 + 拒发闸，所以 **@ 的东西必须落到真实结构化引用**：
 * 画布节点 → 建一条真边；素材库图 → 落进上传参考槽。绝不只在文本里留一句话。
 *
 * 为什么只收**已经有 URL** 的候选（还没生成的节点不进候选）：
 * mention 的持久化形态是 `@[asset:<url>]`（promptMentions.ts），身份就是 URL；
 * 发送投影 `projectPromptForSend` 也按 URL 在有序参考数组里查下标换成 `@imageN/@videoN/@audioN`。
 * 一个还没生成的节点没有 URL，要收它就得引入**第二种 mention kind**（按 nodeId 锚定）——
 * 那是文本类引用那一轮的事，这轮不动，免得把「编号一致性」这条唯一真相源搞脏。
 */
import { MENTION_SLOT_BY_MEDIA, type MentionMediaKind } from '../model/canvasReferenceConnection'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { referenceAssetKindForNode } from '../agent/referenceEdgeCapability'
import { resolveReferenceSlots } from '../runner/referenceSlots'
import { resultUrl } from '../runner/referenceUrl'
import type { PromptReference } from '../../assets/promptMentions'
import type { AssetOrigin } from '../../assets/assetTypes'

export type MentionCandidateGroup = 'current' | 'canvas' | 'library'
export type { MentionMediaKind }

export type MentionReference = PromptReference
type ResolvedMentionReference = MentionReference & { label?: string }

export type MentionCandidate = {
  /** React key / 去重键。 */
  key: string
  url: string
  label: string
  kind?: MentionMediaKind
  /** 落盘边界派生的预览；候选列表画它。 */
  thumbnailUrl?: string
  group: MentionCandidateGroup
  /** 'current' 专有：它在有序参考数组里的 0-based 下标（= chip 上显示的「图片N」减一）。 */
  referenceIndex?: number
  /** 'canvas' 专有：来源节点 id；选中后要给它建一条真边。 */
  sourceNodeId?: string
  /** 'library' 专有：这份素材住在哪（别的项目的要先复制进本项目才能用，见 planMentionInsert）。 */
  origin?: AssetOrigin
}

/** 选中一个候选后该干什么。UI 不自己判断，一律问这里。 */
export type MentionInsertPlan =
  /** 本来就是参考 → 直接插 chip。 */
  | { kind: 'insert'; url: string; mediaKind: MentionMediaKind; index: number }
  /** 画布节点 → 先建一条真边（过能力校验），再插 chip。 */
  | { kind: 'connect'; sourceNodeId: string; url: string; mediaKind: MentionMediaKind }
  /** 素材库图（本项目的）/ 画布上的图但这个宿主不能连线 → 落进上传参考槽，再插 chip。 */
  | { kind: 'attach'; url: string; mediaKind: MentionMediaKind }
  /**
   * 别的项目的素材 → 先复制进本项目（素材库拖放那道唯一关口 `materializeAssetLibraryItems`），再把**复制品**落进上传参考槽、插 chip。
   * 画布 / 时间轴只写当前项目自己的地址（2026-08-31 边界）；@ 以前绕过了这道关口，于是付费卡点生成时宿主拒收
   * 「不在本项目素材里」的那张（`generation_reference_asset_unsupported`），画布上则留下一个搬走项目就坏的引用。
   */
  | { kind: 'import'; url: string; mediaKind: MentionMediaKind; label: string; origin: Extract<AssetOrigin, { source: 'project' }> }

/** 选中候选的那个宿主：能不能往画布上连线（只有画布宿主能），以及此刻打开的是哪个项目。 */
export type MentionHost = Readonly<{ canConnect: boolean; projectId: string | null }>

/** 候选上限：打 @ 是为了快速挑一个，铺几百条反而找不着。 */
export const MENTION_CANDIDATE_LIMIT = 24

function matches(label: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return label.toLowerCase().includes(q)
}

/** 当前节点 image_ref 槽里已填好的图片参考（有 URL 的那些），顺序 = 发送时的 `@imageN` 顺序。 */
export function currentReferenceUrls(
  target: GenerationCanvasNode,
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
): string[] {
  const slot = resolveReferenceSlots(target, nodes as GenerationCanvasNode[], edges as GenerationCanvasEdge[])
    .find((candidate) => candidate.slotKind === 'image_ref')
  if (!slot) return []
  return slot.fills.flatMap((fill) => (fill.url ? [fill.url] : []))
}

/** 当前模式所有已解析的数组参考，按每种媒体自己的槽位顺序编号。 */
export function currentReferenceMedia(
  target: GenerationCanvasNode,
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
): ResolvedMentionReference[] {
  // 编号与 @ 落槽读同一张表（MENTION_SLOT_BY_MEDIA），不各写一份。
  const mediaBySlot = Object.fromEntries(Object.entries(MENTION_SLOT_BY_MEDIA).map(([media, slot]) => [slot, media])) as Record<string, MentionMediaKind>
  const counts: Record<MentionMediaKind, number> = { image: 0, video: 0, audio: 0 }
  const out: ResolvedMentionReference[] = []
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  for (const slot of resolveReferenceSlots(target, nodes as GenerationCanvasNode[], edges as GenerationCanvasEdge[])) {
    const kind = mediaBySlot[slot.slotKind]
    if (!kind) continue
    for (const fill of slot.fills) {
      if (!fill.url) continue
      counts[kind] += 1
      const sourceNodeId = fill.origin.type === 'edge' ? fill.origin.sourceNodeId : ''
      const sourceNode = sourceNodeId ? nodesById.get(sourceNodeId) : undefined
      const label = (sourceNode?.title || '').trim() || fill.url.split('/').pop() || undefined
      out.push({ url: fill.url, kind, index: counts[kind], ...(label ? { label } : {}) })
    }
  }
  return out
}

export function buildMentionCandidates(params: {
  target: GenerationCanvasNode
  nodes: readonly GenerationCanvasNode[]
  edges: readonly GenerationCanvasEdge[]
  libraryAssets: readonly { id: string; name: string; url: string; kind?: MentionMediaKind; thumbnailUrl?: string; origin?: AssetOrigin }[]
  query: string
  currentLabel: (index: number, kind: MentionMediaKind) => string
}): MentionCandidate[] {
  const { target, nodes, edges, libraryAssets, query, currentLabel } = params
  const current = currentReferenceMedia(target, nodes, edges)
  const seen = new Set(current.map((reference) => reference.url))
  const out: MentionCandidate[] = []

  current.forEach(({ url, kind, index, label: sourceLabel }) => {
    const indexedLabel = currentLabel(index, kind)
    const label = sourceLabel || indexedLabel
    if (matches(label, query) || matches(indexedLabel, query)) out.push({
      key: `current:${url}`,
      url,
      label,
      group: 'current',
      referenceIndex: index - 1,
      ...(kind === 'image' ? {} : { kind }),
    })
  })

  for (const node of nodes) {
    if (node.id === target.id) continue
    const url = resultUrl(node.result)
    if (!url || seen.has(url)) continue
    const kind = referenceAssetKindForNode(node)
    if (!kind) continue
    const label = (node.title || '').trim() || url.split('/').pop() || node.id
    if (!matches(label, query)) continue
    seen.add(url)
    const thumbnailUrl = String(node.result?.thumbnailUrl || '').trim()
    out.push({ key: `canvas:${node.id}`, url, label, group: 'canvas', sourceNodeId: node.id, ...(kind === 'image' ? {} : { kind }), ...(thumbnailUrl ? { thumbnailUrl } : {}) })
  }

  for (const asset of libraryAssets) {
    if (!asset.url || seen.has(asset.url)) continue
    const label = (asset.name || '').trim() || asset.url.split('/').pop() || asset.id
    if (!matches(label, query)) continue
    seen.add(asset.url)
    const kind = asset.kind ?? 'image'
    out.push({ key: `library:${asset.id}`, url: asset.url, label, group: 'library', ...(kind === 'image' ? {} : { kind }), ...(asset.thumbnailUrl ? { thumbnailUrl: asset.thumbnailUrl } : {}), ...(asset.origin ? { origin: asset.origin } : {}) })
  }

  return out.slice(0, MENTION_CANDIDATE_LIMIT)
}

/**
 * 选中一个候选之后做什么。**候选从哪来只有一份**（当前参考 / 画布上已出图的节点 / 素材库，两个宿主一样）；
 * 宿主不同，只改「怎么落」：
 *   · 画布宿主能连线 → 画布上的图建一条真边；
 *   · 付费确认卡不能改画布（用户还没答应花钱）→ 画布上的图落进卡自己那张框的参考槽——画布连来的参考在卡上本来就住这里
 *     （`placeSpendReferences`），确认时随卡一起发出去、落地后回写到画布节点。以前卡上直接把画布组藏掉，而素材库里同一张图
 *     又因为「画布优先」被去重掉，本项目画布上的图一张都 @ 不到（弹「没有可引用的素材」）。
 *   · 别的项目的素材 → 先复制进本项目再落（见 MentionInsertPlan.import）。
 */
export function planMentionInsert(candidate: MentionCandidate, host: MentionHost): MentionInsertPlan {
  if (candidate.group === 'current') {
    return { kind: 'insert', url: candidate.url, mediaKind: candidate.kind ?? 'image', index: (candidate.referenceIndex ?? 0) + 1 }
  }
  if (candidate.group === 'canvas' && candidate.sourceNodeId && host.canConnect) {
    return { kind: 'connect', sourceNodeId: candidate.sourceNodeId, url: candidate.url, mediaKind: candidate.kind ?? 'image' }
  }
  const origin = candidate.origin
  if (candidate.group === 'library' && origin?.source === 'project' && origin.projectId !== host.projectId) {
    return { kind: 'import', url: candidate.url, mediaKind: candidate.kind ?? 'image', label: candidate.label, origin }
  }
  return { kind: 'attach', url: candidate.url, mediaKind: candidate.kind ?? 'image' }
}
