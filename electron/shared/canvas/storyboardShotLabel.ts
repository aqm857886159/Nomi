// 分镜镜头的**唯一对外编号**（2026-10-08 用户拍板「只留分镜里的号」）。
//
// 一个分镜镜头在画布、列表、Agent、时间轴上只有一个名字：项目里只有一份分镜时是「镜 03」，
// 有多份分镜时是「<分镜名> · 镜 03」。号就是分镜方案里的镜序（`PlanShot.index`）。
// 全局的 `shotIndex`（画布节点「镜头 N」）只留作内部排序键，任何用户 / Agent 看得见的面
// 都不再拿它称呼分镜镜头。
//
// 纯函数、跨进程共用：渲染层从工作台 store 的分镜方案取源，Agent 的 canvas.read 从读面随画布一起带来的
// `storyboards` 投影取源（`storyboardLabelSourceSchema`）。两边同一个解析口，不各算一遍。
import { z } from 'zod'
import { stableShotId } from '../storyboard/storyboardSubjectIdentity'

export const storyboardLabelSourceSchema = z.array(z.object({
  designId: z.string().min(1),
  title: z.string(),
  shots: z.array(z.object({ shotId: z.string().min(1), index: z.number().int().positive() })),
}))
export type StoryboardLabelSource = z.infer<typeof storyboardLabelSourceSchema>

export type StoryboardShotLabel = {
  designId: string
  designTitle: string
  /** 分镜方案里的镜序。 */
  number: number
  /** 项目里不止一份分镜：名字要带分镜名。 */
  scoped: boolean
  /** 这是那一镜的首帧图（不是镜头本体）。 */
  firstFrame: boolean
}

type DesignLike = { id: string; title?: string; plan: { title?: string; shots: ReadonlyArray<{ shotId?: string; index: number }> } }

/** 工作台里的分镜方案 → 编号源（只带编号需要的那几个字段）。 */
export function storyboardLabelSourceFromDesigns(designsByDocumentId: Readonly<Record<string, readonly DesignLike[]>>): StoryboardLabelSource {
  return Object.values(designsByDocumentId).flat().map((design) => ({
    designId: design.id,
    title: (design.title || design.plan.title || '').trim(),
    shots: design.plan.shots.map((shot) => ({ shotId: stableShotId(shot), index: shot.index })),
  }))
}

type NodeLike = { meta?: Record<string, unknown> | null }

/** 这个节点是哪份分镜的哪一镜（不是分镜镜头 = null）。变体、跨分类副本沿用原镜的号。 */
export function resolveStoryboardShotLabel(node: NodeLike, source: StoryboardLabelSource): StoryboardShotLabel | null {
  const meta = node.meta && typeof node.meta === 'object' ? node.meta : {}
  const designId = typeof meta.storyboardDesignId === 'string' ? meta.storyboardDesignId : ''
  const shotId = typeof meta.shotId === 'string' ? meta.shotId : ''
  if (!designId || !shotId) return null
  const design = source.find((candidate) => candidate.designId === designId)
  const shot = design?.shots.find((candidate) => candidate.shotId === shotId)
  if (!design || !shot) return null
  const designs = source.filter((candidate) => candidate.shots.length > 0).length
  return { designId, designTitle: design.title, number: shot.index, scoped: designs > 1, firstFrame: meta.storyboardKeyframe === true }
}

/** Agent 面（模型读的中文画布摘要）用的写法；界面用 i18n 的同一句（generationList.shot / shotScoped）。 */
export function formatStoryboardShotLabelForAgent(label: StoryboardShotLabel): string {
  const number = `镜 ${String(label.number).padStart(2, '0')}`
  const base = label.scoped && label.designTitle ? `${label.designTitle} · ${number}` : number
  return label.firstFrame ? `${base} · 首帧图` : base
}
