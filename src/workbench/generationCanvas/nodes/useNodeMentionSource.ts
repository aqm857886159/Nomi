/**
 * 提示词框 @ 引用的候选来源 + 选中动作。
 *
 * 核心约束（别抄坏竞品那套「语言化引用」）：**@ 到的东西必须落成真实结构化引用**。
 * 所以选中「画布」组要先建一条真边（或在不能改画布的付费卡上落进卡自己的参考槽）、选中「素材库」组要先落进上传参考槽，
 * 而且都得**过同一把能力校验闸**——目标模型收不下这类参考时当场人话拒绝，
 * 绝不插一个「看起来引用了、发送时被静默删掉」的假 chip。
 *
 * 编号一致性也在这里守住：建立引用之后**重新问一次有序参考数组**拿最终下标，
 * 而不是拿建立前的长度猜——槽位排序（边按 order、上传补空位）不保证新来的就在最后。
 */
import React from 'react'
import type { TFunction } from 'i18next'
import { useNodeWriteAccess, type NodeWriteAccess } from './nodeWriteAccess'
import { useTranslation } from 'react-i18next'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { applyArchetypeModeSwitch, currentArchetypeMode, referenceSlotStorage } from './controls/archetypeMeta'
import { archetypeForNode, validateReferenceEdge } from '../agent/referenceEdgeCapability'
import { MENTION_SLOT_BY_MEDIA, resolveMentionReference } from '../model/canvasReferenceConnection'
import { translateModelDisplayText } from '../../../i18n/modelDisplayText'
import { buildMentionCandidates, currentReferenceMedia, currentReferenceUrls, planMentionInsert, type MentionMediaKind } from './mentionCandidates'
import type { MentionSuggestionItem } from '../../assets/AssetMentionSuggestionList'
import type { MentionSelection } from '../../assets/AssetMentionSuggestion'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { AssetOrigin } from '../../assets/assetTypes'
import { materializeAssetLibraryItems } from '../../assets/assetLibraryMaterialize'
import { withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'

export type MentionLibraryAsset = { id: string; name: string; url: string; kind?: 'image' | 'video' | 'audio'; thumbnailUrl?: string; origin?: AssetOrigin }

export type MentionSelectDeps = Readonly<{
  nodeId: string
  access: NodeWriteAccess
  libraryAssets: readonly MentionLibraryAsset[]
  reportFeedback: (message: string) => void
  t: TFunction
  /** 用户这一下点击时打开的项目（素材库那道关口按它复制）。缺省 = 当场签发（withProjectAction）。 */
  issueProject?: () => ProjectExecutionContext | undefined
  /** 素材库「别的项目的先复制进来」那道唯一关口。缺省 = 生产那一个。 */
  materialize?: typeof materializeAssetLibraryItems
}>

/**
 * 选中一个 @ 候选：先真的建立引用，再给出 chip 编号（同步）或「复制完再插」的那一份（异步，别的项目的素材）。
 * 两个宿主（画布节点 / 付费确认卡）走这同一个函数，差别只在写入面（`access`）——付费卡没有连线权能，画布上的图就落进卡自己的参考槽。
 */
export function createMentionSelect(deps: MentionSelectDeps): (item: MentionSuggestionItem) => MentionSelection {
  const { nodeId, access, reportFeedback, t } = deps
  const copyFailed = (): null => { reportFeedback(t('assetLibrary.copyIntoProjectFailed', { count: 1 })); return null }

  const routeFor = (mediaKind: MentionMediaKind) => {
    const target = access.latestNode(nodeId)
    if (!target) return null
    const store = useGenerationCanvasStore.getState()
    // @ 只有「参考」一种意思（resolveMentionReference）：先定落哪个参考槽、要不要切生成方式、放不放得下。
    const route = resolveMentionReference(target, store.nodes, store.edges, mediaKind)
    if (!route.ok) {
      reportFeedback(route.reason === 'full'
        ? t('connection.mentionSlotsFull', { max: route.max })
        : route.reason === 'blocked_by_frame_edges' ? t('connection.mentionBlockedByFrameEdges') : t('connection.unsupported'))
      return null
    }
    return { target, route }
  }

  const switchMode = (target: GenerationCanvasNode, switchToModeId: string | null | undefined): void => {
    const archetype = switchToModeId ? archetypeForNode(target) : null
    if (!archetype || !switchToModeId) return
    const switched = applyArchetypeModeSwitch((target.meta || {}) as Record<string, unknown>, archetype, switchToModeId)
    access.updateNode(nodeId, { meta: switched })
    reportFeedback(t('connection.mentionModeSwitched', { mode: translateModelDisplayText(currentArchetypeMode(archetype, switched).vendorTerm) }))
  }

  /** 建立完再问一次最终顺序——槽位排序不保证新来的排在最后（边按 order、上传只补空位）。没真落进槽 → 撤回、明说。 */
  const finalIndexOrUndo = (url: string, mediaKind: MentionMediaKind, metaBefore: GenerationCanvasNode['meta'], edgeIdsBefore: ReadonlySet<string>): number | null => {
    const after = useGenerationCanvasStore.getState()
    const afterTarget = access.latestNode(nodeId)
    if (!afterTarget) return null
    const media = currentReferenceMedia(afterTarget, after.nodes, after.edges)
    const index = media.find((reference) => reference.url === url && reference.kind === mediaKind)?.index ?? -1
    if (index < 0) {
      // 引用没真落进槽 → 不插 chip、明着说，并把这次建的边 / 上传 / 模式切换撤回，不在画布上留一条没用的线。
      for (const edge of after.edges) if (!edgeIdsBefore.has(edge.id) && edge.target === nodeId) after.disconnectEdge(edge.id)
      access.updateNode(nodeId, { meta: metaBefore })
      reportFeedback(t('connection.referenceFull'))
      return null
    }
    // currentReferenceMedia 已返回每种媒体自己的 1-based 编号；不要再次递增。
    return index
  }

  /** 落进这张框对应的上传参考槽（与拖文件进卡同一条存储路径；槽与容量由 resolveMentionReference 定）。 */
  const attach = (url: string, mediaKind: MentionMediaKind): number | null => {
    const resolved = routeFor(mediaKind)
    if (!resolved) return null
    const metaBefore = resolved.target.meta
    const edgeIdsBefore = new Set(useGenerationCanvasStore.getState().edges.map((edge) => edge.id))
    switchMode(resolved.target, resolved.route.switchToModeId)
    const storage = referenceSlotStorage({ kind: MENTION_SLOT_BY_MEDIA[mediaKind] })
    if (!storage) return null
    const meta = (access.latestNode(nodeId)?.meta || {}) as Record<string, unknown>
    const existing = Array.isArray(meta[storage.metaKey]) ? (meta[storage.metaKey] as string[]) : []
    if (!existing.includes(url)) access.updateNode(nodeId, { meta: { ...meta, [storage.metaKey]: [...existing, url] } })
    return finalIndexOrUndo(url, mediaKind, metaBefore, edgeIdsBefore)
  }

  return (item) => {
    if (access.canWrite?.() === false) return null
    reportFeedback('')
    // 用户这一下点击就是动作起点：此刻打开的项目在这里签发，之后的复制只认它（withProjectAction 的约定）。
    const project = (deps.issueProject ?? (() => withProjectAction((issued) => issued, () => undefined)))()
    const libraryAsset = item.key.startsWith('library:') ? deps.libraryAssets.find((asset) => `library:${asset.id}` === item.key) : undefined
    const plan = planMentionInsert({
      key: item.key,
      url: item.url,
      label: item.label,
      group: item.group as 'current' | 'canvas' | 'library',
      ...(item.kind ? { kind: item.kind } : {}),
      ...(item.index === undefined ? {} : { referenceIndex: item.index }),
      ...(item.key.startsWith('canvas:') ? { sourceNodeId: item.key.slice('canvas:'.length) } : {}),
      ...(libraryAsset?.origin ? { origin: libraryAsset.origin } : {}),
    }, { canConnect: Boolean(access.connectNodes), projectId: project?.binding.projectId ?? null })
    if (plan.kind === 'insert') return plan.index
    if (plan.kind === 'attach') return attach(plan.url, plan.mediaKind)

    if (plan.kind === 'import') {
      // 别的项目的素材：先过素材库那道唯一关口复制进本项目，再把**复制品**落槽——画布和付费卡都只认本项目的地址。
      // 放不放得下先问一次，放不下就不白复制一份。
      if (!routeFor(plan.mediaKind)) return null
      if (!project) return copyFailed()
      return (deps.materialize ?? materializeAssetLibraryItems)([{ kind: plan.mediaKind, name: plan.label, renderUrl: plan.url, origin: plan.origin }], project)
        .then(({ items }) => {
          const copied = items[0]
          if (!copied) return copyFailed()
          const index = attach(copied.renderUrl, plan.mediaKind)
          return index === null ? null : { url: copied.renderUrl, index }
        }, copyFailed)
    }

    // plan.kind === 'connect'：画布节点 → 过和手动拖把柄同一把闸，再建一条真边。
    const resolved = routeFor(plan.mediaKind)
    const connectNodes = access.connectNodes
    if (!resolved || !connectNodes) return null
    const store = useGenerationCanvasStore.getState()
    const source = store.nodes.find((candidate) => candidate.id === plan.sourceNodeId)
    if (!source) return null
    const verdict = validateReferenceEdge(source, resolved.target, resolved.route.edgeMode)
    if (!verdict.ok) {
      reportFeedback(verdict.reason === 'source_not_referenceable' ? t('connection.sourceUnavailable') : t('connection.unsupported'))
      return null
    }
    const metaBefore = resolved.target.meta
    const edgeIdsBefore = new Set(store.edges.map((edge) => edge.id))
    switchMode(resolved.target, resolved.route.switchToModeId)
    connectNodes(plan.sourceNodeId, nodeId, resolved.route.edgeMode)
    return finalIndexOrUndo(plan.url, plan.mediaKind, metaBefore, edgeIdsBefore)
  }
}

/**
 * 打 @ 时列哪些候选。两个宿主摆**同一份**（当前参考 / 画布上已出图的节点 / 素材库）——付费卡上也摆画布上的图：
 * 宿主不同只改「选中之后怎么落」（planMentionInsert）。以前卡上把画布组藏掉，素材库里同一张图又因「画布优先」被去重掉，
 * 本项目画布上的图在卡上一张都 @ 不到。
 */
export function createMentionSearch(deps: Readonly<{ node: GenerationCanvasNode; access: NodeWriteAccess; libraryAssets: readonly MentionLibraryAsset[]; t: TFunction }>): (query: string) => MentionSuggestionItem[] {
  const { node, access, libraryAssets, t } = deps
  return (query) => {
    const state = useGenerationCanvasStore.getState()
    const target = access.latestNode(node.id) ?? node
    return buildMentionCandidates({
      target,
      nodes: state.nodes,
      edges: state.edges,
      libraryAssets,
      query,
      currentLabel: (index, kind) => t(
        kind === 'video'
          ? 'assetLibrary.referenceVideoIndexed'
          : kind === 'audio'
            ? 'assetLibrary.referenceAudioIndexed'
            : 'assetLibrary.referenceImageIndexed',
        { index },
      ),
    }).map((candidate) => ({
      key: candidate.key,
      url: candidate.url,
      label: candidate.label,
      ...(candidate.kind ? { kind: candidate.kind } : {}),
      ...(candidate.thumbnailUrl ? { thumbnailUrl: candidate.thumbnailUrl } : {}),
      group: candidate.group as 'current' | 'canvas' | 'library',
      ...(candidate.referenceIndex === undefined ? {} : { index: candidate.referenceIndex }),
    }))
  }
}

export function useNodeMentionSource(node: GenerationCanvasNode, libraryAssets: readonly MentionLibraryAsset[], reportFeedback: (message: string) => void, writeAccess?: NodeWriteAccess): {
  /** 有序图片参考 url（兼容旧的图片 chip 编号）；视频/音频编号由 mediaReferences 提供。 */
  orderedReferenceUrls: string[]
  orderedMediaReferences: ReturnType<typeof currentReferenceMedia>
  mentionSearch: (query: string) => MentionSuggestionItem[]
  onMentionSelect: (item: MentionSuggestionItem) => MentionSelection
} {
  const inheritedAccess = useNodeWriteAccess()
  const access = writeAccess ?? inheritedAccess
  const { t } = useTranslation()
  // 边**照读**，两个宿主读的是同一张图：付费确认卡上印的参考数量必须等于真正会发出去的那些
  // （连线接进来的首帧/参考卡也算）。只有**改**图的权能才归画布宿主（`access.connectNodes`）。
  // 按内容订阅（序列化成字符串）：订整张 nodes / edges 会让每敲一个字都产出新数组、编辑器跟着重排 chip 编号
  // （2026-09-25 画布跟手）。内容没变就沿用同一个数组。
  const referenceUrlsKey = useGenerationCanvasStore((state) => JSON.stringify(currentReferenceUrls(node, state.nodes, state.edges)))
  const referenceMediaKey = useGenerationCanvasStore((state) => JSON.stringify(currentReferenceMedia(node, state.nodes, state.edges)))
  const orderedReferenceUrls = React.useMemo(() => JSON.parse(referenceUrlsKey) as ReturnType<typeof currentReferenceUrls>, [referenceUrlsKey])
  const orderedMediaReferences = React.useMemo(() => JSON.parse(referenceMediaKey) as ReturnType<typeof currentReferenceMedia>, [referenceMediaKey])

  const mentionSearch = React.useMemo(
    () => createMentionSearch({ node, access, libraryAssets, t }),
    [libraryAssets, node, t, access],
  )

  const onMentionSelect = React.useMemo(
    () => createMentionSelect({ nodeId: node.id, access, libraryAssets, reportFeedback, t }),
    [node.id, access, libraryAssets, reportFeedback, t],
  )

  return { orderedReferenceUrls, orderedMediaReferences, mentionSearch, onMentionSelect }
}
