import { z } from 'zod'
import type { StoryboardPlan } from './storyboardPlan'

// schema 与手写类型分层，避免方案转换器继续膨胀；编译期守卫仍固定在同一份 schema owner。
const planAnchorSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['character', 'scene', 'prop', 'style']),
  name: z.string().min(1),
  description: z.string(),
  staticFeatures: z.string().optional().describe('身份 DNA（脸型/发色/骨相/标志物）——跨镜必须一致、身份轴对照基准。从资产卡「基础面容锚点」填。'),
  dynamicFeatures: z.string().optional().describe('服装/配饰/状态（允许跨镜变，不进身份匹配）。从资产卡「服装层次/特殊状态」填。'),
  carrier: z.enum(['visual', 'text']),
  scope: z.enum(['all', 'selective']).optional(),
  variants: z.array(z.string()).optional().describe('同一锚的变体/状态；无明显形态差异时省略。'),
  referenceUrl: z.string().min(1).optional(),
  referenceKind: z.enum(['image', 'video', 'audio']).optional(),
  referenceSourceNodeId: z.string().min(1).optional(),
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

const planShotSchema = z.object({
  index: z.number().int(),
  shotId: z.string().min(1).optional().describe('稳定镜头 ID；缺省时由系统按镜号生成。'),
  sceneId: z.string().min(1).optional().describe('所属场 id；无分场故事省略。'),
  shotKind: z.enum(['image', 'video']).optional().describe("镜头种类:'image'=图片分镜,'video'=视频分镜。默认 image。"),
  durationSec: z.number(),
  anchorIds: z.array(z.string()),
  /** 按槽的参考绑定：键 = 槽 kind（未知键原样保留，前向兼容），值 = 有序素材。 */
  referenceBindings: z.record(z.array(z.object({
    url: z.string().min(1),
    name: z.string().optional(),
    sourceNodeId: z.string().min(1).optional(),
  }))).optional(),
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
  subtitle: z.string().optional(),
  dialogue: z.string().optional(),
  transition: z.object({
    type: z.enum(['cut', 'dissolve', 'fade', 'match_cut', 'whip_pan']),
    durationFrames: z.number().int().positive().optional(),
  }).optional(),
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

function parseJsonArrayString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return value
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : value
  } catch {
    return value
  }
}

export const storyboardPlanSchema = z.object({
  title: z.string(),
  anchors: z.array(planAnchorSchema),
  shots: z.preprocess(parseJsonArrayString, z.array(planShotSchema)),
  scenes: z.array(z.object({ id: z.string().min(1), title: z.string() })).optional(),
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

export function parseStoryboardPlan(raw: unknown): StoryboardPlan {
  return storyboardPlanSchema.parse(raw)
}
