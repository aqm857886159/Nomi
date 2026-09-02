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
import { missingRequiredSlots, resolveShotArchetypeMode } from './shotRow/shotRowModel'
import StoryboardShotRow from './shotRow/StoryboardShotRow'

/**
 * 分镜表主体（v5 场分组）：`sceneGroupsOf` 把镜序切成场组——组头（▾ 场名 · N 镜 · 合计时长 ·
 * 缺必填计数）+ 可折叠行区。无场旧 plan = 单一隐式组，不渲染组头（行为等同没有分场）。
 * 拖拽 = 行对行（moveShot 场感知：落点在哪个场就改挂哪个场的 sceneId，镜号自动重排跨场连续）。
 * 合计口径 = totalDurationSec（图片镜按停留时长计入，与方案卡/顺播同源）。
 */

type Props = {
  plan: StoryboardPlan
  imageModelOptions: ModelOption[]
  videoModelOptions: ModelOption[]
  /** 提示词为空的镜号（validatePlan 的 empty-shot-prompt 投影，行红边用）。 */
  emptyPromptShots: Set<number>
  onChange: (plan: StoryboardPlan) => void
}

export default function StoryboardShotTable({ plan, imageModelOptions, videoModelOptions, emptyPromptShots, onChange }: Props): JSX.Element {
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

  // 缺必填计数与画面格红态同一判定（shotRowModel 单源）：按该镜种类取对应模型清单解析档案。
  const missingCountOf = (group: SceneGroup): number =>
    group.shots.filter((shot) => {
      const options = shot.shotKind === 'image' ? imageModelOptions : videoModelOptions
      const modelOption = options.find((option) => option.value === shot.modelKey) ?? null
      const mode = resolveShotArchetypeMode(modelOption, shot.modeId)?.mode ?? null
      return missingRequiredSlots(mode, shot, plan.anchors).length > 0
    }).length

  return (
    <div className="border border-nomi-line rounded-nomi divide-y divide-nomi-line-soft overflow-hidden">
      {groups.map((group, groupIndex) => {
        const folded = foldedScenes.has(foldKeyOf(group))
        const missingCount = missingCountOf(group)
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
                  {missingCount > 0 ? (
                    <span className="text-workbench-danger">{t('storyboardEditor.sceneGroup.missingRequired', { count: missingCount })}</span>
                  ) : null}
                </span>
              </button>
            ) : null}
            {!folded
              ? group.shots.map((shot, indexInGroup) => {
                  const pos = group.startPos + indexInGroup
                  return (
                    <StoryboardShotRow
                      key={shot.shotId ?? shot.index}
                      shot={shot}
                      anchors={plan.anchors}
                      modelOptions={shot.shotKind === 'image' ? imageModelOptions : videoModelOptions}
                      danglingIds={danglingAnchorIdsForShot(plan, shot)}
                      promptInvalid={emptyPromptShots.has(shot.index)}
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
