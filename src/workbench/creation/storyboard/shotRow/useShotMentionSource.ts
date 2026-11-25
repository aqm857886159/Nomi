/**
 * 分镜行提示词框的 @ 引用候选源（C1）。
 *
 * 复用 owner：
 * - `AssetMentionSuggestionList`（下拉 UI + 键盘导航）
 * - `useAssetPool`（AssetPicker/AssetLibraryPanel 共用的素材库数据源；整张表取一份，见 `useShotMentionPool`）
 * - 持久化格式 `@[asset:url]`（promptMentions.ts 单源）
 *
 * 候选来源：
 *   「当前绑定」 = 这一行参考列里已摆着的、来自某张锚的绑定（有 resultUrl 才进）
 *   「某镜结果」 = 画布结果
 *   「素材库」   = 项目图片/视频/音频资产
 *   「上传」     = useComposerAttachments 完成的上传
 *
 * onMentionSelect 语义（2026-09-30）：@ 一个素材 = **往这一行的参考列里放一张**（referenceBindings），
 * chip 编号就是它在参考列里的位置。发出去的参考图只有参考列里摆着的——@ 不再往 anchorIds 里记关系，
 * 那个关系会被展开成看不见的追加与参考边（「巨龙」变人物的成因）。
 *   - 「当前绑定」：参考列里已有这张 → 直接返回 chip index（1-based）
 *   - 其余：交给 onBindReference 放进参考列；这一行当前模式没有能收它的槽 → 返回 null（拒绝插入，不假装会用）
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useAssetPool, type AssetPool } from '../../../assets/useAssetPool'
import type { MentionSuggestionItem } from '../../../assets/AssetMentionSuggestionList'
import type { AnchorCardRuntime } from '../exec/storyboardRowStatus'
import type { PlanAnchor, PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { shotBindsAnchor } from './shotRowModel'
import { useComposerAttachments } from '../../../ai/composer/useComposerAttachments'
import type { ComposerAttachment } from '../../../ai/composer/composerAttachmentTypes'
import { useOpenProjectId } from '../../../project/useOpenProjectId'

const MENTION_LIMIT = 24
const MEDIA_KINDS = new Set(['image', 'video', 'audio'])

function textMatches(label: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return label.toLowerCase().includes(q)
}

type ShotMentionCallbacks = {
  /** 按 query 返回候选列表（传给 PromptEditor.mentionSearch）。 */
  mentionSearch: (query: string) => MentionSuggestionItem[]
  /** 选中候选后的动作；返回 chip index（1-based）；返回 null = 拒绝插入。 */
  onMentionSelect: (item: MentionSuggestionItem) => number | null
  /** @ 候选中的当前绑定媒体 url 有序列表（传给 PromptEditor.mentionCandidates 供 chip 编号）。 */
  currentReferenceUrls: string[]
  mentionUpload: ReturnType<typeof useComposerAttachments>
}

/** @ 候选里「某镜结果」与「素材库」两组的数据源：整张表一份（`useShotMentionPool`），各行只读。 */
export type ShotMentionPool = Pick<AssetPool, 'canvasAssets' | 'projectAssets'>

/**
 * 整张分镜表**一份**素材池。复用 AssetPicker/AssetLibraryPanel 的素材池；不在分镜页维护第二份素材列表。
 *
 * 为什么不在每行各取一份：素材池挂载即列一次项目文件（`useWorkspaceFiles` → 主进程扫目录，上限 2000 个），
 * 每行一份 = 打开 N 镜的方案就让主进程扫 N 遍同一个目录（2026-10-16 C-trace：320 镜打开的放大项之一）。
 * 同一张表所有行看到的是同一个项目、同一份文件，所以只取一次、递给每一行。
 */
export function useShotMentionPool(projectId?: string | null): ShotMentionPool {
  const openProjectId = useOpenProjectId()
  const { canvasAssets, projectAssets } = useAssetPool(projectId ?? openProjectId)
  return React.useMemo(() => ({ canvasAssets, projectAssets }), [canvasAssets, projectAssets])
}

/**
 * 分镜行 @ 引用候选源。
 *
 * @param shot      当前镜头（读 referenceBindings 以判断「已绑定」）
 * @param anchors   完整锚列表（plan.anchors）
 * @param anchorCards   锚 runtime 列表（含 resultUrl；deriveAnchorCardRuntimes 产出）
 * @param onBindReference 把选中的素材放进这一行的参考列；放不进（模式没有槽 / 槽满）返回 false
 * @param pool      整张表共用的素材池（`useShotMentionPool`）
 */
export function useShotMentionSource(
  shot: PlanShot,
  anchors: readonly PlanAnchor[],
  anchorCards: readonly AnchorCardRuntime[],
  onBindReference: (reference: { url: string; name: string; kind: 'image' | 'video' | 'audio'; anchorId?: string; sourceNodeId?: string }) => boolean,
  pool: ShotMentionPool,
): ShotMentionCallbacks {
  const { t } = useTranslation()
  const { canvasAssets, projectAssets } = pool
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>([])
  const mentionUpload = useComposerAttachments({ attachments, setAttachments })

  // 已绑定的 visual 锚（有 resultUrl 的才进「当前参考」组）
  const boundVisualCards = React.useMemo(
    () =>
      anchorCards.filter(
        (card) => card.visual && card.resultUrl && shotBindsAnchor(shot, card.anchor.id),
      ),
    [anchorCards, shot],
  )

  // 未绑定的锚（「所有锚」组，选中后先绑再插 chip；包含 visual 有图和无图的，以及文本锚）
  const unboundCards = React.useMemo(
    () => anchorCards.filter((card) => !shotBindsAnchor(shot, card.anchor.id) && card.visual && card.resultUrl),
    [anchorCards, shot],
  )

  // 有序参考 url = 这一行参考列里摆着的全部绑定（供 chip 编号；发出去的就是它们）
  const currentReferenceUrls = React.useMemo(
    () => Object.values(shot.referenceBindings ?? {}).flatMap((bindings) => (Array.isArray(bindings) ? bindings : []).map((binding) => binding?.url).filter((url): url is string => Boolean(url))),
    [shot.referenceBindings],
  )

  // 素材库图片/视频资产（library 组）
  const libraryAssets = React.useMemo(
    () => projectAssets
      .filter((asset): asset is typeof asset & { kind: 'image' | 'video' | 'audio' } => Boolean(asset.renderUrl) && MEDIA_KINDS.has(asset.kind))
      .map((asset) => ({ id: asset.id, name: asset.name, url: asset.renderUrl, kind: asset.kind, ...(asset.thumbUrl ? { thumbnailUrl: asset.thumbUrl } : {}) })),
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

      // 「其他锚」组（参考列里还没摆、但有图的：选中后放进参考列）
      unboundCards.forEach((card) => {
        const url = card.resultUrl!
        if (seen.has(url)) return
        const label = card.anchor.name.trim() || t('storyboardEditor.unnamed')
        if (!textMatches(label, query)) return
        seen.add(url)
        // 用 canvas 组渲染「连上」角标来区分「选中后要先放进参考列」
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
        out.push({ key: `shot-result:${origin}`, url: asset.renderUrl, label, kind: asset.kind as 'image' | 'video' | 'audio', group: 'canvas', groupLabelKey: 'assetLibrary.mentionGroupShotResult', ...(asset.thumbUrl ? { thumbnailUrl: asset.thumbUrl } : {}) })
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
          ...(asset.thumbnailUrl ? { thumbnailUrl: asset.thumbnailUrl } : {}),
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
        return idx < 0 ? null : idx + 1
      }
      const anchorId = item.group === 'canvas' && item.key.startsWith('anchor:') ? item.key.replace(/^anchor:/, '') : undefined
      if (anchorId && !anchors.some((candidate) => candidate.id === anchorId)) return null
      const sourceNodeId = item.group === 'canvas' && item.key.startsWith('shot-result:')
        ? item.key.slice('shot-result:'.length).split(':')[0]
        : undefined
      const bound = onBindReference({ url: item.url, name: item.label, kind: item.kind ?? 'image', ...(anchorId ? { anchorId } : {}), ...(sourceNodeId ? { sourceNodeId } : {}) })
      if (!bound) return null
      const existing = currentReferenceUrls.indexOf(item.url)
      return existing >= 0 ? existing + 1 : currentReferenceUrls.length + 1
    },
    [anchors, currentReferenceUrls, onBindReference],
  )

  return { mentionSearch, onMentionSelect, currentReferenceUrls, mentionUpload }
}
