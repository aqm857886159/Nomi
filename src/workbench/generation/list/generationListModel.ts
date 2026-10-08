// 生成页「列表」视图的投影（唯一 owner，概念 `generation.list-view`）。
//
// 列表**没有第二份数据**：它只是把画布 store 里的节点、连线、分组，加上分镜方案（还没落画布的镜头
// 此刻只住在方案里——第二步账本合一之前的现状）排成「分镜（按镜号）→ 画布分组 → 未分组」三段。
// 纯函数、零写入、零缓存；状态词表读分镜行的那一份（storyboardRowStatus.SHOT_ROW_STATUSES），不另立。
//
// 每个画布节点在列表里**恰好有一个位置**（2026-10-08 用户看板 F 后追加）：
//   - 生成节点（图 / 视频 / 音频 / 文本）→ 一张完整卡；
//   - 在画布上编辑的工具节点（剪辑、导演台、3D、全景、白板、输出、手艺产物、拆片表、镜头便签）→ 一张紧凑卡，点了回画布；
//   - 素材 / 参考（导入素材、角色 / 场景卡、参考分类里的图、分镜首帧图）→ 不单独成卡，作为引用它的卡上的 chip；
//     没有任何卡引用的，收进未分组末尾一条「未被引用的素材」，上传的东西不会凭空消失。
import type { ModelOption } from '../../../config/models'
import type { GenerationCanvasEdge, GenerationCanvasNode, NodeGroup } from '../../generationCanvas/model/generationCanvasTypes'
import type { StoryboardDesign } from '../../workbenchTypes'
import { stableShotId } from '../../generationCanvas/agent/storyboardPlan'
import { isVisualAnchor } from '../../generationCanvas/agent/storyboardPromptCompiler'
import {
  deriveAnchorCardRuntimes,
  deriveNodeRowExec,
  deriveStoryboardRowRuntimes,
  type ShotRowStatus,
} from '../../creation/storyboard/exec/storyboardRowStatus'
import { designCommittedNow } from '../../creation/storyboard/exec/storyboardNodeBinding'
import type { GenerationListFilter } from './generationViewStore'

/** 卡片怎么画：完整生成卡 / 紧凑工具卡（点了回画布）。素材不成卡。 */
export type GenerationListCardVariant = 'generation' | 'tool'

/** 节点在列表里的归类（每个节点恰好落进一类）。 */
export type GenerationListRole = 'generation' | 'tool' | 'asset'

const TOOL_KINDS: ReadonlySet<string> = new Set(['clip', 'director', 'model3d', 'panorama', 'whiteboard', 'output', 'agent-artifact', 'shot_table', 'shot'])
const REFERENCE_KINDS: ReadonlySet<string> = new Set(['asset', 'character', 'scene'])
const REFERENCE_CATEGORIES: ReadonlySet<string> = new Set(['cast', 'scene', 'prop'])

function metaOf(node: GenerationCanvasNode): Record<string, unknown> {
  return node.meta && typeof node.meta === 'object' && !Array.isArray(node.meta) ? node.meta as Record<string, unknown> : {}
}

/** 这个节点在列表里是哪一类。判据只看节点自己，不看它在不在分镜里。 */
export function generationListRole(node: GenerationCanvasNode): GenerationListRole {
  if (TOOL_KINDS.has(node.kind)) return 'tool'
  const meta = metaOf(node)
  if (REFERENCE_KINDS.has(node.kind) || meta.referenceSheet === true || meta.storyboardKeyframe === true) return 'asset'
  if (REFERENCE_CATEGORIES.has(node.categoryId ?? 'shots')) return 'asset'
  return 'generation'
}

export type GenerationListAnchor = { key: string; nodeId: string | null; name: string; ready: boolean }

export type GenerationListCard = {
  /** 节点 id；还没落画布的方案镜是 `plan:<designId>:<shotId>`。 */
  key: string
  nodeId: string | null
  variant: GenerationListCardVariant
  /** 分镜镜序（只有分镜段的卡有）；其余卡用节点标题。 */
  storyboardShotNumber: number | null
  /** 项目里不止一份分镜时，卡名要带的分镜名（「<分镜名> · 镜 03」，同 canvas/storyboardShotLabel）。 */
  storyboardScope: string | null
  title: string
  status: ShotRowStatus | null
  /** 还没落画布的方案镜：方案里的提示词（有节点的卡读节点自己的提示词）。 */
  planPrompt: string | null
  /** 这一镜点名的视觉锚（卡上锚标签）；未定妆 = 还没有可用结果。 */
  anchor: { name: string; ready: boolean } | null
  /** 引用到这张卡上的素材 / 参考节点（卡上 chip）。 */
  referenceNodeIds: string[]
  /** 「接上一镜」：分镜段第 2 张起，两镜都已落画布时才有。 */
  previous: { nodeId: string; connected: boolean } | null
}

export type GenerationListSection = {
  key: string
  kind: 'storyboard' | 'group' | 'ungrouped'
  title: string
  groupId: string | null
  storyboard: { documentId: string; designId: string } | null
  cards: GenerationListCard[]
  /** 只有未分组段末尾才有：没被任何卡引用的素材 / 参考。 */
  unreferencedAssetIds: string[]
}

export type GenerationListModel = {
  sections: GenerationListSection[]
  anchors: GenerationListAnchor[]
  /** 筛选的分镜方案已不存在 → 视图该清掉筛选。 */
  filterMissing: boolean
}

export type GenerationListInput = {
  nodes: readonly GenerationCanvasNode[]
  edges: readonly GenerationCanvasEdge[]
  groups: readonly NodeGroup[]
  designsByDocumentId: Readonly<Record<string, readonly StoryboardDesign[]>>
  imageModelOptions: readonly ModelOption[]
  videoModelOptions: readonly ModelOption[]
  filter: GenerationListFilter
}

export function planShotKey(designId: string, shotId: string): string {
  return `plan:${designId}:${shotId}`
}

/** 行状态词表只认媒体结果；文本节点的「结果」是它写出来的那段字。 */
function listNodeStatus(node: GenerationCanvasNode): ShotRowStatus {
  const status = deriveNodeRowExec(node).status
  if (status !== 'ready' || node.kind !== 'text') return status
  return node.result?.text?.trim() ? 'done' : status
}

function nodeCard(node: GenerationCanvasNode, referenceNodeIds: string[]): GenerationListCard {
  const role = generationListRole(node)
  return {
    key: node.id,
    nodeId: node.id,
    variant: role === 'tool' ? 'tool' : 'generation',
    storyboardShotNumber: null,
    storyboardScope: null,
    title: node.title || '',
    status: role === 'tool' ? null : listNodeStatus(node),
    planPrompt: null,
    anchor: null,
    referenceNodeIds,
    previous: null,
  }
}

export function deriveGenerationList(input: GenerationListInput): GenerationListModel {
  const { nodes, edges, groups, designsByDocumentId, filter } = input
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const roleById = new Map(nodes.map((node) => [node.id, generationListRole(node)]))
  // 素材 → 引用它的卡：一条边的源是素材、目标是卡，这个素材就是那张卡上的 chip。
  const referencesByTarget = new Map<string, string[]>()
  const referencedAssets = new Set<string>()
  for (const edge of edges) {
    if (roleById.get(edge.source) !== 'asset') continue
    const targetRole = roleById.get(edge.target)
    if (!targetRole || targetRole === 'asset') continue
    referencedAssets.add(edge.source)
    const list = referencesByTarget.get(edge.target) ?? []
    if (!list.includes(edge.source)) list.push(edge.source)
    referencesByTarget.set(edge.target, list)
  }
  const refsOf = (nodeId: string) => referencesByTarget.get(nodeId) ?? []

  const placed = new Set<string>()
  const sections: GenerationListSection[] = []
  const anchors: GenerationListAnchor[] = []
  const allDesigns = Object.values(designsByDocumentId).flat()
  const filterMissing = Boolean(filter && !allDesigns.some((design) => design.id === filter.designId && design.documentId === filter.documentId))
  const activeFilter = filterMissing ? null : filter

  // 编号作用域与 canvas/storyboardShotLabel 同一判据：有镜头的分镜不止一份，名字就带分镜名。
  const scoped = allDesigns.filter((design) => design.plan.shots.length > 0).length > 1

  // ── 分镜：按方案镜序；还没落画布的镜头也在（「生成整组」要能勾它）。──
  for (const design of allDesigns) {
    if (activeFilter && design.id !== activeFilter.designId) continue
    if (!activeFilter && !designCommittedNow(design, nodes)) continue
    if (!design.plan.shots.length) continue
    const runtimes = deriveStoryboardRowRuntimes({
      plan: design.plan,
      designId: design.id,
      imageModelOptions: input.imageModelOptions,
      videoModelOptions: input.videoModelOptions,
      nodes,
    })
    const anchorRuntimes = deriveAnchorCardRuntimes({ plan: design.plan, designId: design.id, nodes })
    for (const runtime of anchorRuntimes) {
      if (!isVisualAnchor(runtime.anchor)) continue
      if (runtime.node) placed.add(runtime.node.id)
      if (anchors.some((existing) => existing.name === runtime.anchor.name)) continue
      anchors.push({ key: `${design.id}:${runtime.anchor.id}`, nodeId: runtime.node?.id ?? null, name: runtime.anchor.name, ready: Boolean(runtime.resultUrl) })
    }
    const anchorReady = new Map(anchorRuntimes.map((runtime) => [runtime.anchor.id, { name: runtime.anchor.name, ready: Boolean(runtime.resultUrl), visual: isVisualAnchor(runtime.anchor), nodeId: runtime.node?.id ?? null }]))
    const cards: GenerationListCard[] = []
    let previousNode: GenerationCanvasNode | null = null
    for (const runtime of runtimes) {
      const { shot, exec } = runtime
      const node = exec.node
      if (exec.keyframeNode) placed.add(exec.keyframeNode.id)
      const anchorId = shot.anchorIds.find((id) => anchorReady.get(id)?.visual)
      const anchor = anchorId ? anchorReady.get(anchorId) ?? null : null
      const previous = node && previousNode && cards.length > 0
        ? { nodeId: previousNode.id, connected: edges.some((edge) => edge.source === previousNode!.id && edge.target === node.id && edge.mode === 'first_frame') }
        : null
      if (node) placed.add(node.id)
      cards.push({
        key: node?.id ?? planShotKey(design.id, stableShotId(shot)),
        nodeId: node?.id ?? null,
        variant: 'generation',
        storyboardShotNumber: shot.index,
        storyboardScope: scoped ? design.title || design.plan.title : null,
        title: node?.title || '',
        status: exec.status,
        planPrompt: node ? null : shot.prompt,
        anchor: anchor ? { name: anchor.name, ready: anchor.ready } : null,
        // 锚标签已经点了这张锚卡的名，chip 里不再重复它。
        referenceNodeIds: node ? refsOf(node.id).filter((id) => id !== anchor?.nodeId) : [],
        previous,
      })
      previousNode = node
    }
    sections.push({
      key: `storyboard:${design.id}`,
      kind: 'storyboard',
      title: design.title || design.plan.title,
      groupId: null,
      storyboard: { documentId: design.documentId, designId: design.id },
      cards,
      unreferencedAssetIds: [],
    })
  }
  if (activeFilter) {
    return { sections, anchors, filterMissing }
  }

  // ── 画布分组：组里的成员按组内顺序；已在分镜段里的不再出现。──
  for (const group of groups) {
    const cards = group.nodeIds
      .map((id) => nodesById.get(id))
      .filter((node): node is GenerationCanvasNode => Boolean(node) && !placed.has(node!.id) && roleById.get(node!.id) !== 'asset')
      .map((node) => {
        placed.add(node.id)
        return nodeCard(node, refsOf(node.id))
      })
    if (!cards.length) continue
    sections.push({ key: `group:${group.id}`, kind: 'group', title: group.name, groupId: group.id, storyboard: null, cards, unreferencedAssetIds: [] })
  }

  // ── 未分组：剩下的卡 + 没人引用的素材。──
  // 生成卡在前、工具卡（紧凑）在后，免得一排大画面里夹一张小卡。
  const ungroupedNodes = nodes.filter((node) => !placed.has(node.id) && roleById.get(node.id) !== 'asset')
  const ungroupedCards = [
    ...ungroupedNodes.filter((node) => roleById.get(node.id) === 'generation'),
    ...ungroupedNodes.filter((node) => roleById.get(node.id) === 'tool'),
  ].map((node) => nodeCard(node, refsOf(node.id)))
  const unreferencedAssetIds = nodes
    .filter((node) => !placed.has(node.id) && roleById.get(node.id) === 'asset' && !referencedAssets.has(node.id))
    .map((node) => node.id)
  if (ungroupedCards.length || unreferencedAssetIds.length) {
    sections.push({ key: 'ungrouped', kind: 'ungrouped', title: '', groupId: null, storyboard: null, cards: ungroupedCards, unreferencedAssetIds })
  }
  return { sections, anchors, filterMissing }
}

/** 列表里能找到这个节点的那张卡（检查器、「在列表里看」用）；素材返回 null。 */
export function findGenerationListCard(model: GenerationListModel, key: string): GenerationListCard | null {
  for (const section of model.sections) {
    const card = section.cards.find((candidate) => candidate.key === key)
    if (card) return card
  }
  return null
}

/** 卡片 / 检查器标题：分镜卡用分镜号「镜 03」/「<分镜名> · 镜 03」，其余用节点标题。 */
export function shotLabel(t: (key: string, options?: Record<string, unknown>) => string, card: Pick<GenerationListCard, 'storyboardShotNumber' | 'storyboardScope' | 'title'>): string {
  if (card.storyboardShotNumber == null) return card.title || t('generationList.untitled')
  const index = String(card.storyboardShotNumber).padStart(2, '0')
  return card.storyboardScope ? t('generationList.shotScoped', { storyboard: card.storyboardScope, index }) : t('generationList.shot', { index })
}
