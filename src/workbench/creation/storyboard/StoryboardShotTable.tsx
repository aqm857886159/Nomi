import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import type { ModelOption } from '../../../config/models'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { storyboardProfileForKey } from '../../generationCanvas/agent/storyboardProfiles'
import {
  addExternalReferenceAnchor,
  danglingAnchorIdsForShot,
  moveShot,
  removeShotAt,
  rememberAnchorReferenceUrl,
  sceneGroupsOf,
  toggleShotAnchor,
  totalDurationSec,
  updateShotPrompt,
  updateShotAt,
  type SceneGroup,
} from '../../generationCanvas/agent/storyboardPlanEdits'
import type { AnchorCardRuntime, StoryboardRowRuntime } from './exec/storyboardRowStatus'
import { useShotMentionSource } from './shotRow/useShotMentionSource'
import StoryboardShotRow from './shotRow/StoryboardShotRow'
import type { MentionSuggestionItem } from '../../assets/AssetMentionSuggestionList'
import { positionsForAnchorFilter } from './storyboardDInteractions'

/**
 * 分镜表主体（v5 场分组 + 执行态）：`sceneGroupsOf` 把镜序切成场组——组头（▾ 场名 · N 镜 ·
 * 合计时长 · 异常计数）+ 可折叠行区。无场旧 plan = 单一隐式组，不渲染组头。
 * 行执行态（rows，与 plan.shots 同序）由编辑器统一 derive 传入——组头计数与行状态同一份
 * （F2 禁静态快照）。拖拽 = 行对行（moveShot 场感知）。合计口径 = totalDurationSec。
 */

type Props = {
  plan: StoryboardPlan
  projectId?: string | null
  /** 行执行 runtime（与 plan.shots 同序；exec/storyboardRowStatus 单源 derive）。 */
  rows: StoryboardRowRuntime[]
  /** C1：参考卡 runtime（供行级 @ 候选）。缺省 = 不开 @ 面板。 */
  anchorCards?: AnchorCardRuntime[]
  imageModelOptions: ModelOption[]
  videoModelOptions: ModelOption[]
  /** 提示词为空的镜号（validatePlan 的 empty-shot-prompt 投影，行红边用）。 */
  emptyPromptShots: Set<number>
  onChange: (plan: StoryboardPlan) => void
  /** 行内「生成」（画面格常驻按钮 / 失败重试）。 */
  onGenerateRow: (runtime: StoryboardRowRuntime) => void
  /** 浮条 ↻ 原地重生成。 */
  onRegenerateRow: (runtime: StoryboardRowRuntime) => void
  /** 浮条 ×3 变体。 */
  onVariantsRow: (runtime: StoryboardRowRuntime) => void
  /** 浮条 🔒/🔓 镜级锁定开关。 */
  onToggleLockRow: (runtime: StoryboardRowRuntime) => void
  /** 结果态双击 / 浮条 ⛶ 放大预览。 */
  onOpenPreviewRow: (runtime: StoryboardRowRuntime) => void
  /** 参考已变「用新图重跑」。 */
  onRerunFreshRefsRow: (runtime: StoryboardRowRuntime) => void
  /** ⏳ 态点参考卡名 → 滚动定位参考卡。 */
  onJumpToAnchor: (anchorId: string) => void
  onSaveResultAsReference: (runtime: StoryboardRowRuntime) => void
  onSetResultAsFirstFrame: (runtime: StoryboardRowRuntime, targetIndex: number) => void
  filterAnchorId?: string | null
}

/**
 * 行级 @ mention 适配层（C1）：useShotMentionSource 需要 shot 作为参数，所以必须在行级调用。
 * 此组件负责把 anchorCards 下发给每行的 ShotRow，但 hook 在行级子组件 ShotRowWrapper 里调用。
 */
function ShotRowWithMention(props: {
  shot: Parameters<typeof StoryboardShotRow>[0]['shot']
  anchors: Parameters<typeof StoryboardShotRow>[0]['anchors']
  anchorCards: AnchorCardRuntime[]
  modelOptions: Parameters<typeof StoryboardShotRow>[0]['modelOptions']
  danglingIds: string[]
  promptInvalid: boolean
  exec: Parameters<typeof StoryboardShotRow>[0]['exec']
  onGenerate: (() => void) | undefined
  onRegenerate: (() => void) | undefined
  onVariants: (() => void) | undefined
  onToggleLock: (() => void) | undefined
  targetShots: Parameters<typeof StoryboardShotRow>[0]['targetShots']
  onSaveAsReference: (() => void) | undefined
  onSetAsFirstFrame: Parameters<typeof StoryboardShotRow>[0]['onSetAsFirstFrame']
  onOpenPreview: (() => void) | undefined
  onRerunFreshRefs: (() => void) | undefined
  onJumpToAnchor: (anchorId: string) => void
  draggable: boolean
  isDragOver: boolean
  onDragStart: () => void
  onDragOver: (event: React.DragEvent) => void
  onDrop: () => void
  onDragEnd: () => void
  onUpdate: (patch: Partial<Parameters<typeof StoryboardShotRow>[0]['shot']>) => void
  onToggleAnchor: (anchorId: string) => void
  onRememberAnchorUrl: (anchorId: string, url: string) => void
  onAddExternalReference: (item: MentionSuggestionItem) => void
  onRemove: () => void
  onApplyParamsToAll: () => void
  storyboardProfile: ReturnType<typeof storyboardProfileForKey>
  projectId?: string | null
}): JSX.Element {
  const { shot, anchors, anchorCards, onToggleAnchor } = props
  // C1：useShotMentionSource 在行级调用（每行 shot 不同），复用 owner 见 useShotMentionSource.ts。
  const { mentionSearch, onMentionSelect, currentReferenceUrls, mentionUpload } = useShotMentionSource(
    shot,
    anchors,
    anchorCards,
    onToggleAnchor,
    props.onRememberAnchorUrl,
    props.onAddExternalReference,
    props.projectId,
  )
  return (
    <StoryboardShotRow
      shot={props.shot}
      anchors={props.anchors}
      modelOptions={props.modelOptions}
      danglingIds={props.danglingIds}
      promptInvalid={props.promptInvalid}
      exec={props.exec}
      onGenerate={props.onGenerate}
      onRegenerate={props.onRegenerate}
      onVariants={props.onVariants}
      onToggleLock={props.onToggleLock}
      targetShots={props.targetShots}
      onSaveAsReference={props.onSaveAsReference}
      onSetAsFirstFrame={props.onSetAsFirstFrame}
      onOpenPreview={props.onOpenPreview}
      onRerunFreshRefs={props.onRerunFreshRefs}
      onJumpToAnchor={props.onJumpToAnchor}
      storyboardProfile={props.storyboardProfile}
      draggable={props.draggable}
      isDragOver={props.isDragOver}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      onUpdate={props.onUpdate as (patch: Partial<Parameters<typeof StoryboardShotRow>[0]['shot']>) => void}
      onToggleAnchor={props.onToggleAnchor}
      onRemove={props.onRemove}
      onApplyParamsToAll={props.onApplyParamsToAll}
      mentionSearch={mentionSearch}
      onMentionSelect={onMentionSelect}
      currentRefUrls={currentReferenceUrls}
      mentionUpload={mentionUpload}
    />
  )
}

export default function StoryboardShotTable({ plan, projectId, rows, anchorCards, imageModelOptions, videoModelOptions, emptyPromptShots, onChange, onGenerateRow, onRegenerateRow, onVariantsRow, onToggleLockRow, onOpenPreviewRow, onRerunFreshRefsRow, onJumpToAnchor, onSaveResultAsReference, onSetResultAsFirstFrame, filterAnchorId }: Props): JSX.Element {
  const { t } = useTranslation()
  const [dragIndex, setDragIndex] = React.useState<number | null>(null)
  const [overIndex, setOverIndex] = React.useState<number | null>(null)
  const [foldedScenes, setFoldedScenes] = React.useState<ReadonlySet<string>>(new Set())

  const visiblePositions = positionsForAnchorFilter(plan, filterAnchorId ?? null)
  const visiblePlan = filterAnchorId ? { ...plan, shots: visiblePositions.map((position) => plan.shots[position]) } : plan
  const groups = sceneGroupsOf(visiblePlan)
  const allGroups = sceneGroupsOf(plan)
  // 单一隐式组 = 无分场故事：不显组头（表退化成今天的平铺行为）。
  const showHeads = !(groups.length === 1 && groups[0].scene === null)

  const foldKeyOf = (group: SceneGroup): string => group.scene?.id ?? '__implicit__'
  const toggleFold = (group: SceneGroup): void => {
    const key = foldKeyOf(group)
    setFoldedScenes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const headTitleOf = (group: SceneGroup, groupIndex: number): string => {
    if (group.scene === null) return t('storyboardEditor.sceneGroup.unassigned')
    return group.scene.title.trim() || t('storyboardEditor.sceneGroup.untitled', { index: groupIndex + 1 })
  }

  // 组头小结：与行状态同一份 derive（rows 按 startPos 切片；F2 禁静态快照）。
  const groupRowsOf = (group: SceneGroup): StoryboardRowRuntime[] =>
    group.shots
      .map((_shot, index) => rows[visiblePositions[group.startPos + index]])
      .filter((row): row is StoryboardRowRuntime => Boolean(row))

  return (
    <div className="border border-nomi-line rounded-nomi divide-y divide-nomi-line-soft overflow-hidden" data-storyboard-rows="true">
      {groups.map((group, groupIndex) => {
        const folded = foldedScenes.has(foldKeyOf(group))
        const groupRows = groupRowsOf(group)
        const missingCount = groupRows.filter((row) => row.exec.status === 'missing-required').length
        const doneCount = groupRows.filter((row) => row.exec.status === 'done' || row.exec.status === 'locked').length
        const lockedCount = groupRows.filter((row) => row.exec.status === 'locked').length
        return (
          <React.Fragment key={foldKeyOf(group)}>
            {showHeads ? (
              <button
                type="button"
                onClick={() => toggleFold(group)}
                aria-expanded={!folded}
                className="w-full flex items-center gap-2 px-3 py-1.5 bg-nomi-ink-05 hover:bg-nomi-ink-10 text-left"
              >
                {folded ? (
                  <IconChevronRight size={13} stroke={1.8} className="shrink-0 text-nomi-ink-40" aria-hidden />
                ) : (
                  <IconChevronDown size={13} stroke={1.8} className="shrink-0 text-nomi-ink-40" aria-hidden />
                )}
                <span className="min-w-0 truncate text-caption font-medium text-nomi-ink-80">{headTitleOf(group, groupIndex)}</span>
                <span className="ml-auto shrink-0 flex items-center gap-2.5 text-micro text-nomi-ink-40">
                  <span>{(() => {
                    const allGroup = allGroups.find((candidate) => foldKeyOf(candidate) === foldKeyOf(group))
                    return filterAnchorId && allGroup
                      ? t('storyboardEditor.sceneGroup.filteredSummary', { visible: group.shots.length, total: allGroup.shots.length, seconds: totalDurationSec(group.shots) })
                      : t('storyboardEditor.sceneGroup.summary', { count: group.shots.length, seconds: totalDurationSec(group.shots) })
                  })()}</span>
                  {doneCount > 0 ? (
                    <span className="text-workbench-success">{t('storyboardEditor.sceneGroup.doneCount', { count: doneCount })}</span>
                  ) : null}
                  {lockedCount > 0 ? (
                    <span>{t('storyboardEditor.sceneGroup.lockedCount', { count: lockedCount })}</span>
                  ) : null}
                  {missingCount > 0 ? (
                    <span className="text-workbench-danger">{t('storyboardEditor.sceneGroup.missingRequired', { count: missingCount })}</span>
                  ) : null}
                </span>
              </button>
            ) : null}
            {!folded
              ? group.shots.map((shot, indexInGroup) => {
                  const pos = visiblePositions[group.startPos + indexInGroup]
                  const runtime = rows[pos]
                  // C1：anchorCards 有时用 ShotRowWithMention（含 useShotMentionSource），
                  // 缺省（编辑器没提供 anchorCards）退回 StoryboardShotRow（无 @ 面板）。
                  const RowComponent = anchorCards ? ShotRowWithMention : null
                  const commonRowProps = {
                    key: shot.shotId ?? shot.index,
                    shot,
                    anchors: plan.anchors,
                    modelOptions: shot.shotKind === 'image' ? imageModelOptions : videoModelOptions,
                    danglingIds: danglingAnchorIdsForShot(plan, shot),
                    promptInvalid: emptyPromptShots.has(shot.index),
                    exec: runtime?.exec,
                    onGenerate: runtime ? () => onGenerateRow(runtime) : undefined,
                    onRegenerate: runtime ? () => onRegenerateRow(runtime) : undefined,
                    onVariants: runtime ? () => onVariantsRow(runtime) : undefined,
                    onToggleLock: runtime ? () => onToggleLockRow(runtime) : undefined,
                    targetShots: plan.shots.filter((candidate) => candidate.shotId !== shot.shotId && candidate.index !== shot.index),
                    onSaveAsReference: runtime ? () => onSaveResultAsReference(runtime) : undefined,
                    onSetAsFirstFrame: runtime ? (targetIndex: number) => onSetResultAsFirstFrame(runtime, targetIndex) : undefined,
                    onOpenPreview: runtime ? () => onOpenPreviewRow(runtime) : undefined,
                    onRerunFreshRefs: runtime ? () => onRerunFreshRefsRow(runtime) : undefined,
                    onJumpToAnchor,
                    draggable: true as const,
                    isDragOver: overIndex === pos && dragIndex !== null && dragIndex !== pos,
                    onDragStart: () => setDragIndex(pos),
                    onDragOver: (event: React.DragEvent) => { event.preventDefault(); setOverIndex(pos) },
                    onDrop: () => {
                      if (dragIndex !== null && dragIndex !== pos) onChange(moveShot(plan, dragIndex, pos))
                      setDragIndex(null); setOverIndex(null)
                    },
                    onDragEnd: () => { setDragIndex(null); setOverIndex(null) },
                    onUpdate: (patch: Partial<typeof shot>) => {
                      if (typeof patch.prompt !== 'string') {
                        onChange(updateShotAt(plan, pos, patch))
                        return
                      }
                      const next = updateShotPrompt(plan, pos, patch.prompt)
                      onChange(updateShotAt(next, pos, { promptSegments: patch.promptSegments }))
                    },
                    onToggleAnchor: (anchorId: string) => onChange(toggleShotAnchor(plan, pos, anchorId)),
                    onRememberAnchorUrl: (anchorId: string, url: string) => onChange(rememberAnchorReferenceUrl(plan, anchorId, url)),
                    onAddExternalReference: (item: MentionSuggestionItem) => {
                      const sourceNodeId = item.group === 'canvas' && item.key.startsWith('shot-result:')
                        ? item.key.slice('shot-result:'.length).split(':')[0]
                        : undefined
                      const added = addExternalReferenceAnchor(plan, { id: item.key, name: item.label, url: item.url, kind: item.kind ?? 'image', ...(sourceNodeId ? { sourceNodeId } : {}) })
                      const nextShot = plan.shots[pos]
                      const anchorIds = nextShot.anchorIds.includes(added.anchorId) ? nextShot.anchorIds : [...nextShot.anchorIds, added.anchorId]
                      onChange(updateShotAt(added.plan, pos, { anchorIds }))
                    },
                    onRemove: () => onChange(removeShotAt(plan, pos)),
                    // 只套 params：模型/模式归「全部镜头」批量条管（一功能一个家，§1.5.2）
                    onApplyParamsToAll: () => onChange({ ...plan, shots: plan.shots.map((s) => ({ ...s, params: shot.params })) }),
                    storyboardProfile: storyboardProfileForKey(plan.profileKey),
                  }
                  return RowComponent && anchorCards
                    ? <RowComponent {...commonRowProps} anchorCards={anchorCards} projectId={projectId} />
                    : <StoryboardShotRow {...commonRowProps} />
                })
              : null}
          </React.Fragment>
        )
      })}
    </div>
  )
}
