/**
 * 分镜行提示词框的 @ 引用候选源（C1）。
 *
 * 复用 owner：
 * - `AssetMentionSuggestionList`（下拉 UI + 键盘导航）
 * - `useAllProjectAssets`（library 组数据源）
 * - 持久化格式 `@[asset:url]`（promptMentions.ts 单源）
 *
 * 候选两组（分镜页没有直接建画布边的通道，不提供 canvas 组）：
 *   「当前绑定」 = 该镜已在 anchorIds 的 visual 锚（有 resultUrl 才进；文本锚进提示词不进参考槽）
 *   「素材库」   = 项目图片/视频资产（选中后加入 anchorIds 绑定一个新锚，或直接作为 prompt 引用）
 *
 * onMentionSelect 语义：
 *   - 「当前绑定」：锚已在 anchorIds，url 已有 → 直接返回 chip index（1-based）
 *   - 「所有锚」（未绑定的）：先把锚加入 anchorIds，再返回 chip index
 *   - 「素材库」：暂不自动加锚（@引用直接为图片 url，落画布时提示词 projection 处理）
 *   返回 null = 拒绝插入（无 resultUrl / 槽满等）
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useAllProjectAssets } from '../../../assets/useAllProjectAssets'
import type { MentionSuggestionItem } from '../../../assets/AssetMentionSuggestionList'
import type { AnchorCardRuntime } from '../exec/storyboardRowStatus'
import type { PlanAnchor } from '../../../generationCanvas/agent/storyboardPlan'

const MENTION_LIMIT = 24

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
  /** @ 候选中的当前绑定图片 url 有序列表（传给 PromptEditor.mentionCandidates 供 chip 编号）。 */
  currentReferenceUrls: string[]
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
): ShotMentionCallbacks {
  const { t } = useTranslation()
  const { assets: projectAssets } = useAllProjectAssets()

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
  const currentReferenceUrls = React.useMemo(
    () => boundVisualCards.map((card) => card.resultUrl!),
    [boundVisualCards],
  )

  // 素材库图片/视频资产（library 组）
  const libraryAssets = React.useMemo(
    () =>
      projectAssets
        .filter((asset): asset is typeof asset & { renderUrl: string } =>
          Boolean(asset.renderUrl) && (asset.kind === 'image' || asset.kind === 'video'))
        .map((asset) => ({ id: asset.id, name: asset.name, url: asset.renderUrl, kind: asset.kind as 'image' | 'video' })),
    [projectAssets],
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

      // 「素材库」组
      for (const asset of libraryAssets) {
        if (seen.has(asset.url) || out.length >= MENTION_LIMIT) break
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

      return out.slice(0, MENTION_LIMIT)
    },
    [boundVisualCards, unboundCards, libraryAssets, t],
  )

  const onMentionSelect = React.useCallback(
    (item: MentionSuggestionItem): number | null => {
      if (item.group === 'current') {
        // 已绑定锚：直接给 chip index（1-based）
        const idx = currentReferenceUrls.indexOf(item.url)
        return idx >= 0 ? idx + 1 : null
      }

      if (item.group === 'canvas') {
        // 「其他锚」选中：先绑 anchorIds，然后算 index
        const anchorId = item.key.replace(/^anchor:/, '')
        const anchor = anchors.find((candidate) => candidate.id === anchorId)
        if (!anchor) return null
        // 先绑定（异步不等，React batch 更新；index 从绑定后的 boundVisualCards derive）
        onToggleAnchor(anchorId)
        // 绑定后该锚会进 boundVisualCards，新 index = 当前 length（追加到末尾）
        return currentReferenceUrls.length + 1
      }

      // 素材库：直接插 url chip（无编号，不创建锚；体验目标：快速引用单张图）
      // 注：prompt 里的 @[asset:url] 在落画布时按 projectPromptForSend 规则处理
      // 返回 null（不插编号 chip），改由外部在插入后处理
      // 实际上 PromptEditor.command 只要 index !== null 就插 chip，index=null 则只删 @ token
      // 素材库图没有编号：返回一个「超出当前参考数」的 index 暂位（-1 表示未在槽里，chip 不显 @N）
      // 最简化方案：index=0（图N=1），后续重编时会按真实槽位刷新
      return null
    },
    [anchors, currentReferenceUrls, onToggleAnchor],
  )

  return { mentionSearch, onMentionSelect, currentReferenceUrls }
}
