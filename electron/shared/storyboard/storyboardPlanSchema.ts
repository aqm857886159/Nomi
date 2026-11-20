import { z } from 'zod'
import { LEGACY_OMITTED_SHOT_KIND, type PlanShot, type StoryboardPlan } from './storyboardPlan'
import { jsonTolerantArray } from '../agentCapabilities/jsonArgTolerance'
import { admitNumber } from '../videoCapabilities/paramValue'

const referenceBindingsSchema = z.record(z.array(z.object({
  url: z.string().min(1), name: z.string().optional(), sourceNodeId: z.string().min(1).optional(),
  anchorId: z.string().min(1).optional(), ignore: z.string().optional(),
})))

// 草稿面只约束编辑器可往返的结构；模型/Agent 的必填内容仅在下方严格扩展中加入。
// 两面都剥离历史未知键，绝不因新增键否决整个旧项目。
export const draftPlanAnchorSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['character', 'scene', 'prop', 'style']),
  name: z.string(),
  description: z.string(),
  staticFeatures: z.string().optional().describe('Identity features that must remain consistent across shots, such as face shape, hair, bone structure and distinguishing marks.'),
  dynamicFeatures: z.string().optional().describe('Clothing, accessories and temporary state; may vary between shots and do not define identity.'),
  carrier: z.enum(['visual', 'text']),
  scope: z.enum(['all', 'selective']).optional(),
  variants: z.array(z.string()).optional().describe('Variants or states of the same anchor; omit when none are needed.'),
  referenceUrl: z.string().min(1).optional(),
  referenceKind: z.enum(['image', 'video', 'audio']).optional(),
  referenceSourceNodeId: z.string().min(1).optional(),
  modelKey: z.string().optional(), modelVendor: z.string().optional(), modeId: z.string().optional(),
  params: z.record(z.unknown()).optional(), referenceBindings: referenceBindingsSchema.optional(),
})

const promptSegmentRangeSchema = z.object({
  key: z.string().min(1),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
})

const storyboardProfileSchema = z.object({
  aspect: z.string().min(1),
  dialogue: z.boolean(),
  promptSkeleton: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    kind: z.literal('enum'),
    options: z.array(z.string().min(1)),
  })),
})

export const planShotSchema = z.object({
  index: z.number().int(),
  shotId: z.string().min(1).optional().describe('Stable shot id; the host assigns one when omitted.'),
  sceneId: z.string().min(1).optional().describe('Scene id; omit when the story has no scene grouping.'),
  shotKind: z.enum(['image', 'video']).optional().describe(`Shot media kind: image or video; omitted means ${LEGACY_OMITTED_SHOT_KIND} (legacy drafts); state it explicitly.`),
  durationSec: z.number().finite(),
  anchorIds: z.array(z.string()),
  /** 按槽的参考绑定：键 = 槽 kind（未知键原样保留，前向兼容），值 = 有序素材。 */
  referenceBindings: referenceBindingsSchema.optional(),
  /** 自动引用的账本（锚 id）：补过一次就不再补，用户删掉的 @ 不回来。只由自动引用写。 */
  autoReferenced: z.array(z.string()).optional(),
  prompt: z.string(),
  promptSegments: z.array(promptSegmentRangeSchema).optional(),
  modelKey: z.string().optional(),
  modelVendor: z.string().optional(),
  modeId: z.string().optional(),
  params: z.record(z.unknown()).optional(),
  variationType: z.enum(['large', 'medium', 'small']).optional(),
  camIdx: z.number().int().min(0).optional(),
  ffDesc: z.string().optional(),
  lfDesc: z.string().optional(),
  motionDesc: z.string().optional(),
  continuity: z.union([z.string(), z.number().finite(), z.record(z.unknown())]).optional(),
  keyframe: z.object({
    enabled: z.boolean().optional(),
    prompt: z.string().optional(),
    modelKey: z.string().optional(),
    modelVendor: z.string().optional(),
    modeId: z.string().optional(),
    params: z.record(z.unknown()).optional(),
  }).optional(),
})

export const storyboardDraftPlanSchema = z.object({
  title: z.string(),
  // 容错的 owner 在 `electron/shared/agentCapabilities/jsonArgTolerance.ts`。
  // 这里以前有一份逐字重复的 `parseJsonArrayString`，而且只包了 `shots`——
  // 两份实现意味着两次要记得同时改，一次漏掉就是「主进程收得下、渲染层解不开」。
  anchors: jsonTolerantArray(z.array(draftPlanAnchorSchema)),
  shots: jsonTolerantArray(z.array(planShotSchema)),
  scenes: z.array(z.object({ id: z.string().min(1), title: z.string() })).optional(),
  // 整片默认画幅。**必须在 schema 里**：zod 默认静默丢未知键，少这一行就等于规划师在方案顶层
  // 写的整片画幅在 parseStoryboardPlan 那一刻消失（2026-09-12 根因合同）。
  aspectRatio: z.string().optional(),
  profileKey: z.string().min(1).optional(),
  storyboardProfile: storyboardProfileSchema.optional(),
  sourceScriptArtifactId: z.string().min(1).optional(),
  sourceScriptVersion: z.number().int().positive().optional(),
  sourceScriptHash: z.string().min(1).optional(),
})

// 规划模型、Agent 作者入参、落画布仍使用严格面。内容规则只在这一侧增加。
export const planAnchorSchema = draftPlanAnchorSchema.extend({ name: z.string().min(1) })
export const storyboardPlanSchema = storyboardDraftPlanSchema.extend({
  anchors: jsonTolerantArray(z.array(planAnchorSchema)),
  aspectRatio: z.string().min(1).optional(),
})

// 编译期漂移守卫钉草稿面：每个可编辑字段必须先能持久化，严格扩展不能独占新字段。
const _schemaToType = (plan: z.infer<typeof storyboardDraftPlanSchema>): StoryboardPlan => plan
const _typeToSchema = (plan: StoryboardPlan): z.infer<typeof storyboardDraftPlanSchema> => plan
void _schemaToType
void _typeToSchema

// 上面两条互相赋值的守卫**看不见缺席的可选字段**（类型里有、schema 里没有的 `x?:` 两个方向都能赋值），
// 而 zod 会在解析时把它静默丢掉——锚的 modelKey/modelVendor 就是这样在重开项目时消失的。
// 这里按键逐个对账：手写类型里的每个键，schema 必须都有。（main #833 带来，搬家后仍钉在同一份 owner 上。）
type MissingSchemaKeys<TType, TSchema> = Exclude<keyof TType, keyof TSchema>
type AssertNoMissingKeys<T extends never> = T
type _AnchorKeys = AssertNoMissingKeys<MissingSchemaKeys<StoryboardPlan['anchors'][number], z.infer<typeof draftPlanAnchorSchema>>>
type _ShotKeys = AssertNoMissingKeys<MissingSchemaKeys<StoryboardPlan['shots'][number], z.infer<typeof planShotSchema>>>
type _KeyframeKeys = AssertNoMissingKeys<MissingSchemaKeys<NonNullable<StoryboardPlan['shots'][number]['keyframe']>, NonNullable<z.infer<typeof planShotSchema>['keyframe']>>>
type _PlanKeys = AssertNoMissingKeys<MissingSchemaKeys<StoryboardPlan, z.infer<typeof storyboardDraftPlanSchema>>>

export function parseStoryboardPlan(raw: unknown): StoryboardPlan {
  return reconcilePlanShotDurations(storyboardPlanSchema.parse(raw))
}

/**
 * 视频镜头的时长只有一个家：`durationSec`（行上显示、合计、落画布写进节点的都是它）。方案进门时把 `params.duration` 收掉——
 * 外来方案（`parseStoryboardPlan`）与 store 的写入口、载入（`workbenchDocumentSlice`）各调一次：
 *  · `durationSec` 大于 0：以它为准，丢掉 `params.duration`。创作者行上一直看到的、片子按的都是它（用户 2026-11-17 定，不提示）；
 *  · `durationSec` 不大于 0、`params.duration` 过得了值门且大于 0：收进 `durationSec`。助手在字符串时长档案上起草的镜头就是这个形状，
 *    0 是旧适配器没认出 `"12"` 留下的，助手写的就是 12（协调 2026-11-17 定）；
 *  · 读不出秒数：原样留着，不当 0、不当默认。
 * 图片镜头不动。纯函数，没变就返回原对象（渲染层靠引用相等省重算）。
 */
export function reconcileShotDuration<T extends Pick<PlanShot, 'shotKind' | 'durationSec' | 'params'>>(shot: T): T {
  if ((shot.shotKind ?? LEGACY_OMITTED_SHOT_KIND) !== 'video' || !shot.params || !('duration' in shot.params)) return shot
  const { duration, ...params } = shot.params
  if (shot.durationSec > 0) return { ...shot, params }
  const seconds = admitNumber(duration)
  return seconds !== undefined && seconds > 0 ? { ...shot, durationSec: seconds, params } : shot
}

/** 整份方案逐镜过 `reconcileShotDuration`；一镜都没变就返回原方案。 */
export function reconcilePlanShotDurations<T extends { shots: readonly PlanShot[] }>(plan: T): T {
  let changed = false
  const shots = plan.shots.map((shot) => {
    const next = reconcileShotDuration(shot)
    if (next !== shot) changed = true
    return next
  })
  return changed ? { ...plan, shots } : plan
}
