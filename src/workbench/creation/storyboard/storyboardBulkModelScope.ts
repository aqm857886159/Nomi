import type { ModelOption } from '../../../config/models'
import type { PlanShot, StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'

/**
 * 多选「统一模型」的**镜种作用域**（纯函数，无 React）。
 *
 * 2026-09-11 用户实测反馈：多选几镜点「统一模型」，下拉里图片模型和视频模型混在一条平列表里，
 * 看不出哪个是哪个，选错一条整批必失败。根因不是文案而是**清单是拼出来的**：
 * `StoryboardShotTable` 曾用 `[...imageModelOptions, ...videoModelOptions]` 去重成一份——
 * 而全表其它地方（行级 `shot.shotKind === 'image' ? image : video`、
 * `deriveStoryboardRowRuntimes`、`StoryboardBulkBar`）读的都是「按镜种取那一份」。
 * 同一个语义两份规则，混的那份就是错的那份。
 *
 * 这里把那条规则收成一份，并按**选中集合里真实存在的镜种**分组：
 * 分组 = 画布框选工具条的做法（一个执行组一个下拉、`leadingLabel` 写明「图片 ×3」），
 * 所以选中混了图片和视频时得到两个下拉，各自只列得动的模型——「选错」在结构上不再可能。
 * 应用时仍按 `kind` 二次核对（`applyBulkModelToShots`）：镜种不合的镜**原样不动**，
 * 不做静默转进、不给它安一个跑不了的模型。
 */

export type StoryboardShotKind = 'image' | 'video'

/** 镜种判据单源：`shotKind` 缺省（旧草稿）按 video，与 storyboardRowStatus / 行级下拉同一句。 */
export function storyboardShotKind(shot: Pick<PlanShot, 'shotKind'>): StoryboardShotKind {
  return shot.shotKind === 'image' ? 'image' : 'video'
}

export type StoryboardBulkModelGroup = {
  kind: StoryboardShotKind
  /** 选中集合里属于这一档的镜数——下拉的 `leadingLabel` 要写出来（「图片 ×3」）。 */
  count: number
  options: readonly ModelOption[]
}

/** 分组顺序固定（image 在前），与表里镜种胶囊的排法一致；选中集合里没有的档不出现。 */
const KIND_ORDER: readonly StoryboardShotKind[] = ['image', 'video']

export function storyboardBulkModelGroups(input: {
  shots: readonly Pick<PlanShot, 'shotKind'>[]
  imageModelOptions: readonly ModelOption[]
  videoModelOptions: readonly ModelOption[]
}): readonly StoryboardBulkModelGroup[] {
  const counts = new Map<StoryboardShotKind, number>()
  for (const shot of input.shots) {
    const kind = storyboardShotKind(shot)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return KIND_ORDER.flatMap((kind) => {
    const count = counts.get(kind) ?? 0
    if (count === 0) return []
    const options = kind === 'image' ? input.imageModelOptions : input.videoModelOptions
    // 这一档一个模型都没接入 = 没有可统一的东西；给一个点开是空的下拉比不给更糟。
    if (options.length === 0) return []
    return [{ kind, count, options }]
  })
}

/**
 * 把 (modelKey, vendor) 写进选中镜里**镜种相符**的那些；不符的原样返回。
 *
 * 身份是 `(vendor, modelKey)` 两半（`PlanShot.modelVendor` 的注释即此）：只写 key 会在落画布时
 * 按 key 反查命中目录里第一家，用户选的那家丢掉。模式与参数跟着模型走，所以一起清空。
 */
export function applyBulkModelToShots(input: {
  plan: StoryboardPlan
  isSelected: (shot: PlanShot) => boolean
  kind: StoryboardShotKind
  modelKey: string
  vendor?: string | undefined
}): StoryboardPlan {
  const { plan, isSelected, kind, modelKey, vendor } = input
  if (!modelKey) return plan
  return {
    ...plan,
    shots: plan.shots.map((shot) => (
      isSelected(shot) && storyboardShotKind(shot) === kind
        ? { ...shot, modelKey, modelVendor: vendor || undefined, modeId: undefined, params: undefined }
        : shot
    )),
  }
}
