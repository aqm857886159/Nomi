import type { JSX } from 'react'
import {
  IconCamera,
  IconLayoutBoard,
  IconPlayerTrackNext,
  IconPlayerTrackPrev,
  IconUser,
  IconViewportWide,
  IconZoomScan,
} from '@tabler/icons-react'

/**
 * 节点快捷动作的**入口表**（2026-10-04 批次 1）。
 *
 * 这张表只回答「浮条上有哪几项、点了要哪一条效果、出图是几行几列」——**提示词正文不在这里**。
 * 正文的唯一 owner 是效果库 `skills/effect-<名字>/SKILL.md`（主进程聚合成提示词库），浮条 / 生成框预设 /
 * 空节点 chip / Agent 都只是入口，读同一份定义。在这里抄一句模板 = 两份定义，改一处漏一处。
 *
 * `effectId` 指向的条目里，`effect-character-three-view` 与 `effect-fill-outpaint` 已存在；
 * 多机位九宫格 / 下一刻 / 前一刻 / 剧情四宫格四条要在接线那一轮按「10 条写法」新写进效果库
 * （任务定性、只改 / 保持成对、格数与阅读顺序写死、每格预分配、防字面化……）。效果库里缺条目时，
 * 菜单项灰掉并说「效果库里缺这一条」，不发空提示词。
 *
 * `upscale` 没有模板：它要的是目录里一个「放大」能力的模型，不是一句提示词（先出线稿再合成的两次生成
 * 做法不做——两次计费、效果未验证）。
 */

export type QuickActionId =
  | 'multi-angle-grid'
  | 'next-moment'
  | 'prev-moment'
  | 'three-view'
  | 'story-four-panel'
  | 'upscale'
  | 'outpaint'

/** 分组：`featured` 是浮条上直接放出来的那一个文字钮（先按判断定：最常用的多机位九宫格，以后有使用数据再调）；`more` 是分体按钮右块 ▾ 下拉里的其余效果；`refine` 是「改图」里花钱的那一段（也是派生，只是改的是这一张）。 */
export type QuickActionGroup = 'featured' | 'more' | 'refine'

/** 出图的版式。宫格类记下行列，出图后浮条直接给「切成 N 张」，不用用户再数。 */
export type QuickActionGrid = Readonly<{ rows: number; cols: number }>

/** 这一项要目录里有什么样的模型才点得了（按能力说，不按供应商说——P4）。 */
export type QuickActionRequirement = 'image-edit' | 'upscale'

type QuickActionIcon = (props: { size?: number; stroke?: number }) => JSX.Element

export type QuickActionDefinition = Readonly<{
  id: QuickActionId
  group: QuickActionGroup
  effectId: string | null
  labelKey:
    | 'generationCommon.quickActions.actions.multiAngleGrid'
    | 'generationCommon.quickActions.actions.nextMoment'
    | 'generationCommon.quickActions.actions.prevMoment'
    | 'generationCommon.quickActions.actions.threeView'
    | 'generationCommon.quickActions.actions.storyFourPanel'
    | 'generationCommon.quickActions.actions.upscale'
    | 'generationCommon.quickActions.actions.outpaint'
  icon: QuickActionIcon
  requires: QuickActionRequirement
  grid?: QuickActionGrid
}>

const icon = (component: unknown): QuickActionIcon => component as QuickActionIcon

/** 顺序即菜单顺序：按常用程度排，高的在上（多机位直接放在浮条上，推演次之，剧情四宫格垫底）。 */
export const QUICK_ACTIONS: readonly QuickActionDefinition[] = [
  { id: 'multi-angle-grid', group: 'featured', effectId: 'effect-multi-angle-grid', labelKey: 'generationCommon.quickActions.actions.multiAngleGrid', icon: icon(IconCamera), requires: 'image-edit', grid: { rows: 3, cols: 3 } },
  { id: 'next-moment', group: 'more', effectId: 'effect-next-moment', labelKey: 'generationCommon.quickActions.actions.nextMoment', icon: icon(IconPlayerTrackNext), requires: 'image-edit' },
  { id: 'prev-moment', group: 'more', effectId: 'effect-prev-moment', labelKey: 'generationCommon.quickActions.actions.prevMoment', icon: icon(IconPlayerTrackPrev), requires: 'image-edit' },
  { id: 'three-view', group: 'more', effectId: 'effect-character-three-view', labelKey: 'generationCommon.quickActions.actions.threeView', icon: icon(IconUser), requires: 'image-edit', grid: { rows: 1, cols: 3 } },
  { id: 'story-four-panel', group: 'more', effectId: 'effect-story-four-panel', labelKey: 'generationCommon.quickActions.actions.storyFourPanel', icon: icon(IconLayoutBoard), requires: 'image-edit', grid: { rows: 2, cols: 2 } },
  { id: 'upscale', group: 'refine', effectId: null, labelKey: 'generationCommon.quickActions.actions.upscale', icon: icon(IconZoomScan), requires: 'upscale' },
  { id: 'outpaint', group: 'refine', effectId: 'effect-fill-outpaint', labelKey: 'generationCommon.quickActions.actions.outpaint', icon: icon(IconViewportWide), requires: 'image-edit' },
]

export function quickActionsInGroup(group: QuickActionGroup): readonly QuickActionDefinition[] {
  return QUICK_ACTIONS.filter((action) => action.group === group)
}

export function findQuickAction(id: QuickActionId): QuickActionDefinition {
  const found = QUICK_ACTIONS.find((action) => action.id === id)
  if (!found) throw new Error(`unknown quick action: ${id}`)
  return found
}
