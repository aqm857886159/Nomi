/**
 * 分镜行提示词框的 @ 引用候选源（C1）。
 *
 * 复用 owner：
 * - `AssetMentionSuggestionList`（下拉 UI + 键盘导航）
 * - `useAssetPool`（AssetPicker/AssetLibraryPanel 共用的素材库数据源）
 * - 持久化格式 `@[asset:url]`（promptMentions.ts 单源）
 *
 * 候选来源：
 *   「当前绑定」 = 该镜已在 anchorIds 的 visual 锚（有 resultUrl 才进；文本锚进提示词不进参考槽）
 *   「某镜结果」 = 画布结果（选中后加入 anchorIds，复用来源节点，不复制结果）
 *   「素材库」   = 项目图片/视频/音频资产（选中后加入 anchorIds）
 *   「上传」     = useComposerAttachments 完成的上传（同样加入 anchorIds）
 *
 * onMentionSelect 语义：
 *   - 「当前绑定」：锚已在 anchorIds，url 已有 → 直接返回 chip index（1-based）
 *   - 「所有锚」（未绑定的）：先把锚加入 anchorIds，再返回 chip index
 *   - 「素材库」：暂不自动加锚（@引用直接为图片 url，落画布时提示词 projection 处理）
 *   返回 null = 拒绝插入（无 resultUrl / 槽满等）
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useAssetPool } from '../../../assets/useAssetPool'
import type { MentionSuggestionItem } from '../../../assets/AssetMentionSuggestionList'
import type { AnchorCardRuntime } from '../exec/storyboardRowStatus'
import type { PlanAnchor } from '../../../generationCanvas/agent/storyboardPlan'
import { useComposerAttachments } from '../../../ai/composer/useComposerAttachments'
import type { ComposerAttachment } from '../../../ai/composer/composerAttachmentTypes'
import { getDesktopActiveProjectId } from '../../../../desktop/activeProject'

const MENTION_LIMIT = 24
const MEDIA_KINDS = new Set(['image', 'video', 'audio'])

function textMatches(label: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return label.toLowerCase().includes(q)
}

export type ShotMentionCallbacks = {
  /** 按 query 返回候选列表（传给 PromptEditor.mentionSearch）。 */
  mentionSearch: (query: string) => MentionSuggestionItem[]
  /** 选中候选后的动作；返回 chip index（1-based）；返回 null = 拒绝插入。 */
  onMentionSelect: (item: MentionSuggestionItem) => number | null
  /** @ 候选中的当前绑定媒体 url 有序列表（传给 PromptEditor.mentionCandidates 供 chip 编号）。 */
  currentReferenceUrls: string[]
  mentionUpload: ReturnType<typeof useComposerAttachments>
}

/**
 * 分镜行 @ 引用候选源。
 *
 * @param shot      当前镜头（读 anchorIds 以判断「已绑定」）
 * @param anchors   完整锚列表（plan.anchors）
 * @param anchorCards   锚 runtime 列表（含 resultUrl；deriveAnchorCardRuntimes 产出）
 * @param onToggleAnchor 绑定/解绑锚（toggleShotAnchor 的包装，用于「未绑定锚」选中时先绑定）
 */
export function useShotMentionSource(
  shot: { anchorIds: string[] },
  anchors: readonly PlanAnchor[],
  anchorCards: readonly AnchorCardRuntime[],
  onToggleAnchor: (anchorId: string) => void,
  onRememberAnchorUrl: (anchorId: string, url: string) => void,
  onAddExternalReference: (item: MentionSuggestionItem) => void,
  projectId?: string | null,
): ShotMentionCallbacks {
  const { t } = useTranslation()
  // 复用 AssetPicker/AssetLibraryPanel 的素材池；不在分镜页维护第二份素材列表。
  const assetProjectId = projectId ?? (getDesktopActiveProjectId() || null)
  const { canvasAssets, projectAssets } = useAssetPool(assetProjectId)
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>([])
  const mentionUpload = useComposerAttachments({ attachments, setAttachments })

  // 已绑定的 visual 锚（有 resultUrl 的才进「当前参考」组）
  const boundVisualCards = React.useMemo(
    () =>
      anchorCards.filter(
        (card) => card.visual && card.resultUrl && shot.anchorIds.includes(card.anchor.id),
      ),
    [anchorCards, shot.anchorIds],
  )

  // 未绑定的锚（「所有锚」组，选中后先绑再插 chip；包含 visual 有图和无图的，以及文本锚）
  const unboundCards = React.useMemo(
    () => anchorCards.filter((card) => !shot.anchorIds.includes(card.anchor.id) && card.visual && card.resultUrl),
    [anchorCards, shot.anchorIds],
  )

  // 有序参考 url（当前绑定组，供 chip 编号）
  const currentReferenceUrls = React.useMemo(() => {
    const resultByAnchorId = new Map(boundVisualCards.map((card) => [card.anchor.id, card.resultUrl!]))
    return shot.anchorIds.flatMap((id) => {
      const anchor = anchors.find((candidate) => candidate.id === id)
      return [resultByAnchorId.get(id) || anchor?.referenceUrl || ''].filter(Boolean)
    })
  }, [anchors, boundVisualCards, shot.anchorIds])

  // 素材库图片/视频资产（library 组）
  const libraryAssets = React.useMemo(
    () => projectAssets
      .filter((asset): asset is typeof asset & { kind: 'image' | 'video' | 'audio' } => Boolean(asset.renderUrl) && MEDIA_KINDS.has(asset.kind))
      .map((asset) => ({ id: asset.id, name: asset.name, url: asset.renderUrl, kind: asset.kind })),
    [projectAssets],
  )

  const resultAssets = React.useMemo(
    () => canvasAssets.filter((asset) => Boolean(asset.renderUrl) && !currentReferenceUrls.includes(asset.renderUrl)),
    [canvasAssets, currentReferenceUrls],
  )
  const uploadedAssets = React.useMemo(
    () => attachments.filter((item) => item.status === 'ready' && item.url),
    [attachments],
  )

  const mentionSearch = React.useCallback(
    (query: string): MentionSuggestionItem[] => {
      const out: MentionSuggestionItem[] = []
      const seen = new Set<string>()

      // 「当前参考」组（已绑定 + 有图）
      boundVisualCards.forEach((card, idx) => {
        const url = card.resultUrl!
        const label = card.anchor.name.trim() || t('storyboardEditor.unnamed')
        if (!textMatches(label, query)) return
        seen.add(url)
        out.push({
          key: `current:${card.anchor.id}`,
          url,
          label,
          kind: 'image',
          group: 'current',
          index: idx, // 0-based，List 组件里 +1 显示
        })
      })

      // 「其他锚」组（未绑定但有图的，选中后先加 anchorIds）
      unboundCards.forEach((card) => {
        const url = card.resultUrl!
        if (seen.has(url)) return
        const label = card.anchor.name.trim() || t('storyboardEditor.unnamed')
        if (!textMatches(label, query)) return
        seen.add(url)
        // 用 canvas 组渲染「连上」角标来区分「需要先绑定」
        out.push({
          key: `anchor:${card.anchor.id}`,
          url,
          label,
          kind: 'image',
          group: 'canvas',
        })
      })

      // 某镜结果组直接来自 AssetPicker 的画布源，不把结果复制进分镜状态。
      resultAssets.forEach((asset) => {
        if (seen.has(asset.renderUrl) || out.length >= MENTION_LIMIT) return
        const label = asset.name.trim() || asset.renderUrl.split('/').pop() || asset.id
        if (!textMatches(label, query)) return
        seen.add(asset.renderUrl)
        const origin = asset.origin.source === 'canvas'
          ? `${asset.origin.nodeId}:${asset.origin.resultId}`
          : asset.id
        out.push({ key: `shot-result:${origin}`, url: asset.renderUrl, label, kind: asset.kind as 'image' | 'video' | 'audio', group: 'canvas', groupLabelKey: 'assetLibrary.mentionGroupShotResult' })
      })

      // 「素材库」组
      for (const asset of libraryAssets) {
        if (out.length >= MENTION_LIMIT) break
        if (seen.has(asset.url)) continue
        const label = asset.name.trim() || asset.url.split('/').pop() || asset.id
        if (!textMatches(label, query)) continue
        seen.add(asset.url)
        out.push({
          key: `library:${asset.id}`,
          url: asset.url,
          label,
          kind: asset.kind,
          group: 'library',
        })
      }

      uploadedAssets.forEach((attachment) => {
        if (seen.has(attachment.url!) || out.length >= MENTION_LIMIT) return
        if (!textMatches(attachment.fileName, query)) return
        seen.add(attachment.url!)
        const kind = attachment.kind === 'image' ? 'image' : attachment.contentType.startsWith('audio/') ? 'audio' : 'video'
        out.push({ key: `upload:${attachment.id}`, url: attachment.url!, label: attachment.fileName, kind, group: 'upload' })
      })

      const candidates = out.slice(0, MENTION_LIMIT)
      return candidates
    },
    [boundVisualCards, libraryAssets, resultAssets, t, unboundCards, uploadedAssets],
  )

  const onMentionSelect = React.useCallback(
    (item: MentionSuggestionItem): number | null => {
      if (item.group === 'current') {
        // 已绑定锚：直接给 chip index（1-based）
        const idx = currentReferenceUrls.indexOf(item.url)
        if (idx < 0) return null
        const card = boundVisualCards.find((candidate) => candidate.resultUrl === item.url)
        if (card) onRememberAnchorUrl(card.anchor.id, item.url)
        return idx + 1
      }

      if (item.group === 'canvas') {
        // 「其他锚」选中：先绑 anchorIds，然后算 index
        const anchorId = item.key.replace(/^anchor:/, '')
        const anchor = anchors.find((candidate) => candidate.id === anchorId)
        if (!anchor) return null
        // 先绑定（异步不等，React batch 更新；index 从绑定后的 boundVisualCards derive）
        onToggleAnchor(anchorId)
        onRememberAnchorUrl(anchorId, item.url)
        // 绑定后该锚会进 boundVisualCards，新 index = 当前 length（追加到末尾）
        return currentReferenceUrls.length + 1
      }

      // 画布结果 / 素材库 / composer 上传：仍沿用 anchorIds 这条绑定链，URL 只作为锚卡的来源事实。
      onAddExternalReference(item)
      return currentReferenceUrls.includes(item.url) ? currentReferenceUrls.indexOf(item.url) + 1 : currentReferenceUrls.length + 1
    },
    [anchors, boundVisualCards, currentReferenceUrls, onAddExternalReference, onRememberAnchorUrl, onToggleAnchor],
  )

  return { mentionSearch, onMentionSelect, currentReferenceUrls, mentionUpload }
}
