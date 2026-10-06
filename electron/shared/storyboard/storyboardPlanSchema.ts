import { z } from 'zod'
import type { StoryboardPlan } from './storyboardPlan'
import { jsonTolerantArray } from '../agentCapabilities/jsonArgTolerance'

const referenceBindingsSchema = z.record(z.array(z.object({
  url: z.string().min(1), name: z.string().optional(), sourceNodeId: z.string().min(1).optional(),
  anchorId: z.string().min(1).optional(), ignore: z.string().optional(),
})))

// **这份 schema 是持久化 / 迁移 / 规划模型输出的读口，所以它永远剥离未知键、绝不因为多一个键
// 判整份无效。** 加过一轮 `.strict()`，代价是：项目记录里任何一份带历史字段的方案会让
// `workbenchProjectPayloadSchema` 整个 safeParse 失败 → `normalizePayload` 抛 corruptPayload →
// **整个项目打不开**；旧键迁移那条路则直接 `return []`，分镜方案静默消失。要严的是「模型入参」
// 那一面（`agentCapabilities/generationPlanSchemas.ts` 的作者 schema 自带 `.strict()`，
// 并且拒收时逐字段说明理由），不是这一面。
// schema 与手写类型分层，避免方案转换器继续膨胀；编译期守卫仍固定在同一份 schema owner。
export const planAnchorSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['character', 'scene', 'prop', 'style']),
  name: z.string().min(1),
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
  shotKind: z.enum(['image', 'video']).optional().describe('Shot media kind: image or video; defaults to image.'),
  durationSec: z.number(),
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
  continuity: z.union([z.string(), z.number(), z.record(z.unknown())]).optional(),
  keyframe: z.object({
    enabled: z.boolean().optional(),
    prompt: z.string().optional(),
    modelKey: z.string().optional(),
    modelVendor: z.string().optional(),
    modeId: z.string().optional(),
    params: z.record(z.unknown()).optional(),
  }).optional(),
})

export const storyboardPlanSchema = z.object({
  title: z.string(),
  // 容错的 owner 在 `electron/shared/agentCapabilities/jsonArgTolerance.ts`。
  // 这里以前有一份逐字重复的 `parseJsonArrayString`，而且只包了 `shots`——
  // 两份实现意味着两次要记得同时改，一次漏掉就是「主进程收得下、渲染层解不开」。
  anchors: jsonTolerantArray(z.array(planAnchorSchema)),
  shots: jsonTolerantArray(z.array(planShotSchema)),
  scenes: z.array(z.object({ id: z.string().min(1), title: z.string() })).optional(),
  // 整片默认画幅。**必须在 schema 里**：zod 默认静默丢未知键，少这一行就等于规划师在方案顶层
  // 写的整片画幅在 parseStoryboardPlan 那一刻消失（2026-09-12 根因合同）。
  aspectRatio: z.string().min(1).optional(),
  profileKey: z.string().min(1).optional(),
  storyboardProfile: storyboardProfileSchema.optional(),
  sourceScriptArtifactId: z.string().min(1).optional(),
  sourceScriptVersion: z.number().int().positive().optional(),
  sourceScriptHash: z.string().min(1).optional(),
})

// 编译期漂移守卫：schema 和手写类型必须互相赋值，防止运行时契约静默漂移。
const _schemaToType = (plan: z.infer<typeof storyboardPlanSchema>): StoryboardPlan => plan
const _typeToSchema = (plan: StoryboardPlan): z.infer<typeof storyboardPlanSchema> => plan
void _schemaToType
void _typeToSchema

// 上面两条互相赋值的守卫**看不见缺席的可选字段**（类型里有、schema 里没有的 `x?:` 两个方向都能赋值），
// 而 zod 会在解析时把它静默丢掉——锚的 modelKey/modelVendor 就是这样在重开项目时消失的。
// 这里按键逐个对账：手写类型里的每个键，schema 必须都有。（main #833 带来，搬家后仍钉在同一份 owner 上。）
type MissingSchemaKeys<TType, TSchema> = Exclude<keyof TType, keyof TSchema>
type AssertNoMissingKeys<T extends never> = T
type _AnchorKeys = AssertNoMissingKeys<MissingSchemaKeys<StoryboardPlan['anchors'][number], z.infer<typeof planAnchorSchema>>>
type _ShotKeys = AssertNoMissingKeys<MissingSchemaKeys<StoryboardPlan['shots'][number], z.infer<typeof planShotSchema>>>
type _KeyframeKeys = AssertNoMissingKeys<MissingSchemaKeys<NonNullable<StoryboardPlan['shots'][number]['keyframe']>, NonNullable<z.infer<typeof planShotSchema>['keyframe']>>>
type _PlanKeys = AssertNoMissingKeys<MissingSchemaKeys<StoryboardPlan, z.infer<typeof storyboardPlanSchema>>>

export function parseStoryboardPlan(raw: unknown): StoryboardPlan {
  return storyboardPlanSchema.parse(raw)
}
