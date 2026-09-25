/**
 * 提示词框 @ 引用的候选来源 + 选中动作。
 *
 * 核心约束（别抄坏竞品那套「语言化引用」）：**@ 到的东西必须落成真实结构化引用**。
 * 所以选中「画布」组要先建一条真边、选中「素材库」组要先落进上传参考槽，
 * 而且两者都得**过同一把能力校验闸**——目标模型收不下这类参考时当场人话拒绝，
 * 绝不插一个「看起来引用了、发送时被静默删掉」的假 chip。
 *
 * 编号一致性也在这里守住：建立引用之后**重新问一次有序参考数组**拿最终下标，
 * 而不是拿建立前的长度猜——槽位排序（边按 order、上传补空位）不保证新来的就在最后。
 */
import React from 'react'
import { useNodeWriteAccess, type NodeWriteAccess } from './nodeWriteAccess'
import { useTranslation } from 'react-i18next'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { applyArchetypeModeSwitch, currentArchetypeMode, referenceSlotStorage } from './controls/archetypeMeta'
import { archetypeForNode, validateReferenceEdge } from '../agent/referenceEdgeCapability'
import { MENTION_SLOT_BY_MEDIA, resolveMentionReference } from '../model/canvasReferenceConnection'
import { translateModelDisplayText } from '../../../i18n/modelDisplayText'
import { buildMentionCandidates, currentReferenceMedia, currentReferenceUrls, planMentionInsert } from './mentionCandidates'
import type { MentionSuggestionItem } from '../../assets/AssetMentionSuggestionList'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

type LibraryAsset = { id: string; name: string; url: string; kind?: 'image' | 'video' | 'audio'; thumbnailUrl?: string }

export function useNodeMentionSource(node: GenerationCanvasNode, libraryAssets: readonly LibraryAsset[], reportFeedback: (message: string) => void, writeAccess?: NodeWriteAccess): {
  /** 有序图片参考 url（兼容旧的图片 chip 编号）；视频/音频编号由 mediaReferences 提供。 */
  orderedReferenceUrls: string[]
  orderedMediaReferences: ReturnType<typeof currentReferenceMedia>
  mentionSearch: (query: string) => MentionSuggestionItem[]
  onMentionSelect: (item: MentionSuggestionItem) => number | null
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

  const mentionSearch = React.useCallback((query: string): MentionSuggestionItem[] => {
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
    // 连不了线的宿主不摆「从画布上接一个」这一组：给一个按下去必然做不成的选项比不给更糟。
    // 已有的引用（`current` 组）照常摆——它们是这次生成真的会发出去的东西。
    .filter((candidate) => candidate.group !== 'canvas' || Boolean(access.connectNodes))
  }, [libraryAssets, node, t, access])

  const onMentionSelect = React.useCallback((item: MentionSuggestionItem): number | null => {
    if (access.canWrite?.() === false) return null
    reportFeedback('')
    const plan = planMentionInsert({
      key: item.key,
      url: item.url,
      label: item.label,
      group: item.group as 'current' | 'canvas' | 'library',
      ...(item.kind ? { kind: item.kind } : {}),
      ...(item.index === undefined ? {} : { referenceIndex: item.index }),
      ...(item.key.startsWith('canvas:') ? { sourceNodeId: item.key.slice('canvas:'.length) } : {}),
    })
    if (plan.kind === 'insert') return plan.index

    const store = useGenerationCanvasStore.getState()
    const target = access.latestNode(node.id)
    if (!target) return null

    // @ 只有「参考」一种意思（resolveMentionReference）：先定落哪个参考槽、要不要切生成方式、放不放得下。
    const route = resolveMentionReference(target, store.nodes, store.edges, plan.mediaKind)
    if (!route.ok) {
      reportFeedback(route.reason === 'full'
        ? t('connection.mentionSlotsFull', { max: route.max })
        : route.reason === 'blocked_by_frame_edges' ? t('connection.mentionBlockedByFrameEdges') : t('connection.unsupported'))
      return null
    }
    const metaBefore = target.meta
    const edgeIdsBefore = new Set(store.edges.map((edge) => edge.id))
    const archetype = route.switchToModeId ? archetypeForNode(target) : null
    if (archetype && route.switchToModeId) {
      const switched = applyArchetypeModeSwitch((target.meta || {}) as Record<string, unknown>, archetype, route.switchToModeId)
      access.updateNode(node.id, { meta: switched })
      reportFeedback(t('connection.mentionModeSwitched', { mode: translateModelDisplayText(currentArchetypeMode(archetype, switched).vendorTerm) }))
    }

    if (plan.kind === 'connect') {
      // 没有连边权能就明说，别掉进下面那条「当素材库上传处理」的路——那会把一个画布节点
      // 的 url 塞进上传槽，看起来成了、发出去的却是另一回事。
      if (!access.connectNodes) { reportFeedback(t('connection.unsupported')); return null }
      const source = store.nodes.find((candidate) => candidate.id === plan.sourceNodeId)
      if (!source) return null
      // 源有没有能被引用的产物：和手动拖把柄同一把闸。
      const verdict = validateReferenceEdge(source, target, route.edgeMode)
      if (!verdict.ok) {
        reportFeedback(verdict.reason === 'source_not_referenceable'
            ? t('connection.sourceUnavailable')
            : t('connection.unsupported'))
        return null
      }
      access.connectNodes(plan.sourceNodeId, node.id, route.edgeMode)
    } else {
      // 素材库媒体 → 落进对应参考槽的上传位（与拖文件进卡同一条存储路径）；槽与容量已由 resolveMentionReference 定好。
      const storage = referenceSlotStorage({ kind: MENTION_SLOT_BY_MEDIA[plan.mediaKind] })
      if (!storage) return null
      const meta = (access.latestNode(node.id)?.meta || {}) as Record<string, unknown>
      const existing = Array.isArray(meta[storage.metaKey]) ? (meta[storage.metaKey] as string[]) : []
      if (!existing.includes(plan.url)) {
        access.updateNode(node.id, { meta: { ...meta, [storage.metaKey]: [...existing, plan.url] } })
      }
    }

    // 建立完再问一次最终顺序——槽位排序不保证新来的排在最后（边按 order、上传只补空位）。
    const after = useGenerationCanvasStore.getState()
    const afterTarget = access.latestNode(node.id)
    if (!afterTarget) return null
    const media = currentReferenceMedia(afterTarget, after.nodes, after.edges)
    const index = media.find((reference) => reference.url === plan.url && reference.kind === plan.mediaKind)?.index ?? -1
    if (index < 0) {
      // 引用没真落进槽 → 不插 chip、明着说，并把这次建的边 / 上传 / 模式切换撤回，不在画布上留一条没用的线。
      for (const edge of after.edges) if (!edgeIdsBefore.has(edge.id) && edge.target === node.id) after.disconnectEdge(edge.id)
      access.updateNode(node.id, { meta: metaBefore })
      reportFeedback(t('connection.referenceFull'))
      return null
    }
    // currentReferenceMedia 已返回每种媒体自己的 1-based 编号；不要再次递增。
    return index
  }, [node.id, reportFeedback, t, access])

  return { orderedReferenceUrls, orderedMediaReferences, mentionSearch, onMentionSelect }
}
