import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import type { ModelOption } from '../../../config/models'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import {
  danglingAnchorIdsForShot,
  moveShot,
  removeShotAt,
  sceneGroupsOf,
  toggleShotAnchor,
  totalDurationSec,
  updateShotAt,
  type SceneGroup,
} from '../../generationCanvas/agent/storyboardPlanEdits'
import type { StoryboardRowRuntime } from './exec/storyboardRowStatus'
import StoryboardShotRow from './shotRow/StoryboardShotRow'

/**
 * 分镜表主体（v5 场分组 + 执行态）：`sceneGroupsOf` 把镜序切成场组——组头（▾ 场名 · N 镜 ·
 * 合计时长 · 异常计数）+ 可折叠行区。无场旧 plan = 单一隐式组，不渲染组头。
 * 行执行态（rows，与 plan.shots 同序）由编辑器统一 derive 传入——组头计数与行状态同一份
 * （F2 禁静态快照）。拖拽 = 行对行（moveShot 场感知）。合计口径 = totalDurationSec。
 */

type Props = {
  plan: StoryboardPlan
  /** 行执行 runtime（与 plan.shots 同序；exec/storyboardRowStatus 单源 derive）。 */
  rows: StoryboardRowRuntime[]
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
}

export default function StoryboardShotTable({ plan, rows, imageModelOptions, videoModelOptions, emptyPromptShots, onChange, onGenerateRow, onRegenerateRow, onVariantsRow, onToggleLockRow, onOpenPreviewRow, onRerunFreshRefsRow, onJumpToAnchor }: Props): JSX.Element {
  const { t } = useTranslation()
  const [dragIndex, setDragIndex] = React.useState<number | null>(null)
  const [overIndex, setOverIndex] = React.useState<number | null>(null)
  const [foldedScenes, setFoldedScenes] = React.useState<ReadonlySet<string>>(new Set())

  const groups = sceneGroupsOf(plan)
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
    rows.slice(group.startPos, group.startPos + group.shots.length)

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
                  <span>{t('storyboardEditor.sceneGroup.summary', { count: group.shots.length, seconds: totalDurationSec(group.shots) })}</span>
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
                  const pos = group.startPos + indexInGroup
                  const runtime = rows[pos]
                  return (
                    <StoryboardShotRow
                      key={shot.shotId ?? shot.index}
                      shot={shot}
                      anchors={plan.anchors}
                      modelOptions={shot.shotKind === 'image' ? imageModelOptions : videoModelOptions}
                      danglingIds={danglingAnchorIdsForShot(plan, shot)}
                      promptInvalid={emptyPromptShots.has(shot.index)}
                      exec={runtime?.exec}
                      onGenerate={runtime ? () => onGenerateRow(runtime) : undefined}
                      onRegenerate={runtime ? () => onRegenerateRow(runtime) : undefined}
                      onVariants={runtime ? () => onVariantsRow(runtime) : undefined}
                      onToggleLock={runtime ? () => onToggleLockRow(runtime) : undefined}
                      onOpenPreview={runtime ? () => onOpenPreviewRow(runtime) : undefined}
                      onRerunFreshRefs={runtime ? () => onRerunFreshRefsRow(runtime) : undefined}
                      onJumpToAnchor={onJumpToAnchor}
                      draggable
                      isDragOver={overIndex === pos && dragIndex !== null && dragIndex !== pos}
                      onDragStart={() => setDragIndex(pos)}
                      onDragOver={(event) => {
                        event.preventDefault()
                        setOverIndex(pos)
                      }}
                      onDrop={() => {
                        if (dragIndex !== null && dragIndex !== pos) onChange(moveShot(plan, dragIndex, pos))
                        setDragIndex(null)
                        setOverIndex(null)
                      }}
                      onDragEnd={() => {
                        setDragIndex(null)
                        setOverIndex(null)
                      }}
                      onUpdate={(patch) => onChange(updateShotAt(plan, pos, patch))}
                      onToggleAnchor={(anchorId) => onChange(toggleShotAnchor(plan, pos, anchorId))}
                      onRemove={() => onChange(removeShotAt(plan, pos))}
                      // 只套 params：模型/模式归「全部镜头」批量条管（一功能一个家，§1.5.2）——
                      // 这里再复制 modelKey/modeId 就是第二个改整片模型的入口。
                      onApplyParamsToAll={() => onChange({
                        ...plan,
                        shots: plan.shots.map((s) => ({ ...s, params: shot.params })),
                      })}
                    />
                  )
                })
              : null}
          </React.Fragment>
        )
      })}
    </div>
  )
}
