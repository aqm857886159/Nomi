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
import { useTranslation } from 'react-i18next'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { showInfoToast } from '../../../utils/showInfoToast'
import { resolveReferenceSlots } from '../runner/referenceSlots'
import { referenceSlotStorage } from './controls/archetypeMeta'
import { selectConnectionEdgeMode, validateReferenceEdge } from '../agent/referenceEdgeCapability'
import { buildMentionCandidates, currentReferenceMedia, currentReferenceUrls, planMentionInsert } from './mentionCandidates'
import type { MentionSuggestionItem } from '../../assets/AssetMentionSuggestionList'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

type LibraryAsset = { id: string; name: string; url: string; kind?: 'image' | 'video' | 'audio' }

export function useNodeMentionSource(node: GenerationCanvasNode, libraryAssets: readonly LibraryAsset[]): {
  /** 有序图片参考 url（兼容旧的图片 chip 编号）；视频/音频编号由 mediaReferences 提供。 */
  orderedReferenceUrls: string[]
  orderedMediaReferences: ReturnType<typeof currentReferenceMedia>
  mentionSearch: (query: string) => MentionSuggestionItem[]
  onMentionSelect: (item: MentionSuggestionItem) => number | null
} {
  const { t } = useTranslation()
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)

  const orderedReferenceUrls = React.useMemo(
    () => currentReferenceUrls(node, nodes, edges),
    [node, nodes, edges],
  )
  const orderedMediaReferences = React.useMemo(
    () => currentReferenceMedia(node, nodes, edges),
    [node, nodes, edges],
  )

  const mentionSearch = React.useCallback((query: string): MentionSuggestionItem[] => {
    const state = useGenerationCanvasStore.getState()
    const target = state.nodes.find((candidate) => candidate.id === node.id) ?? node
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
      group: candidate.group as 'current' | 'canvas' | 'library',
      ...(candidate.referenceIndex === undefined ? {} : { index: candidate.referenceIndex }),
    }))
  }, [libraryAssets, node, t])

  const onMentionSelect = React.useCallback((item: MentionSuggestionItem): number | null => {
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
    const target = store.nodes.find((candidate) => candidate.id === node.id)
    if (!target) return null

    if (plan.kind === 'connect') {
      const source = store.nodes.find((candidate) => candidate.id === plan.sourceNodeId)
      if (!source) return null
      // 和手动拖把柄同一把闸：收不下就当场说清，不留假引用。
      const verdict = validateReferenceEdge(source, target, undefined)
      if (!verdict.ok) {
        showInfoToast(
          verdict.reason === 'source_not_referenceable'
            ? t('connection.sourceUnavailable')
            : t('connection.unsupported'),
        )
        return null
      }
      const existingEdgesToTarget = store.edges.filter((edge) => edge.target === node.id)
      store.connectNodes(plan.sourceNodeId, node.id, selectConnectionEdgeMode(source, target, existingEdgesToTarget))
    } else {
      // 素材库媒体 → 落进对应参考槽的上传位（与拖文件进卡同一条存储路径）。
      const desiredSlotKind = plan.mediaKind === 'video' ? 'video_ref' : plan.mediaKind === 'audio' ? 'audio_ref' : 'image_ref'
      const slot = resolveReferenceSlots(target, store.nodes, store.edges).find((s) => s.slotKind === desiredSlotKind)
      if (!slot) { showInfoToast(t('connection.unsupported')); return null }
      if (slot.max !== undefined && slot.fills.length >= slot.max) {
        showInfoToast(t('connection.slotsFull', { max: slot.max }))
        return null
      }
      const storage = referenceSlotStorage({ kind: desiredSlotKind })
      if (!storage) return null
      const meta = (target.meta || {}) as Record<string, unknown>
      const existing = Array.isArray(meta[storage.metaKey]) ? (meta[storage.metaKey] as string[]) : []
      if (!existing.includes(plan.url)) {
        store.updateNode(node.id, { meta: { ...meta, [storage.metaKey]: [...existing, plan.url] } })
      }
    }

    // 建立完再问一次最终顺序——槽位排序不保证新来的排在最后（边按 order、上传只补空位）。
    const after = useGenerationCanvasStore.getState()
    const afterTarget = after.nodes.find((candidate) => candidate.id === node.id)
    if (!afterTarget) return null
    const media = currentReferenceMedia(afterTarget, after.nodes, after.edges)
    const index = media.find((reference) => reference.url === plan.url && reference.kind === plan.mediaKind)?.index ?? -1
    if (index < 0) {
      // 引用没真落进槽（例如被 placeAt 丢弃）→ 不插 chip，且明着说，别静默。
      showInfoToast(t('connection.referenceFull'))
      return null
    }
    // currentReferenceMedia 已返回每种媒体自己的 1-based 编号；不要再次递增。
    return index
  }, [node.id, t])

  return { orderedReferenceUrls, orderedMediaReferences, mentionSearch, onMentionSelect }
}
