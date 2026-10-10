/**
 * 分组的显示文字：框头与分组工具条共用的**唯一**显示函数（10-10 拍板：不能一处带前缀、一处不带）。
 *
 * 分镜组判断只看归属章 `materializationOperationId`（分镜多镜物化通道写入；用户手建组与旧快照没有）。
 * 显示规则：分镜组 →「分镜 · 组名」+「N 镜」；普通组 → 「组名」+「N 个」。前缀只是显示规则，改名改的仍是组名本身。
 * 拖动中计数写「from → to」。
 */
import type { NodeGroup } from '../model/generationCanvasTypes'

/** 分镜组 = 有多镜物化归属章。 */
export function isStoryboardGroup(group: Pick<NodeGroup, 'materializationOperationId'>): boolean {
  return Boolean(group.materializationOperationId)
}

type Translate = (key: string, options?: Record<string, unknown>) => string

export type GroupFrameLabelInput = {
  name: string
  storyboard: boolean
  memberCount: number
  /** 拖动中松手后的成员数；null = 没有在飞的预览。 */
  previewCount: number | null
}

/** 标题（组名，分镜组带前缀）与计数（「6 镜」「3 个」，拖动中「6 → 5」）。 */
export function groupFrameLabel(t: Translate, input: GroupFrameLabelInput): { title: string; count: string } {
  const { name, storyboard, memberCount, previewCount } = input
  const title = storyboard ? `${t('generationCommon.canvas.group.storyboardPrefix')}${name}` : name
  const count = previewCount === null
    ? t(storyboard ? 'generationCommon.canvas.group.countShots' : 'generationCommon.canvas.group.countItems', { count: memberCount })
    : t('generationCommon.canvas.group.countPreview', { from: memberCount, to: previewCount })
  return { title, count }
}
