import { z } from 'zod'
import { ARCHETYPE_REFERENCE_SLOT_KINDS, BILLING_MODEL_KINDS } from '../contracts/modelAccessCapabilities'
import type { ModelParameterControl } from '../videoCapabilities/types'
import type { AgentModelEntry } from './availableModels'

const text = z.string().max(8192)
const value = z.union([text, z.number().finite(), z.boolean()])
// 参数控件的键表与 `ModelParameterControl` 编译期绑定：类型多一个键或少一个键，这里没跟上，typecheck 就红。
// 两处投影把档案的 params 原样带过来、这道门又是 strict，键表要是手抄（2026-11-27 前就是），类型新加的可选键
// 编译照过、运行时整轮回合被拒（图层分离的 presets / note 让目录里有 Seedream 5.5 时 Agent 一轮都发不出去）。
const agentParamShape = {
  key: text, label: text, type: z.enum(['select', 'number', 'text', 'boolean', 'image-url']),
  mediaKind: z.enum(['image', 'video', 'audio']).optional(),
  options: z.array(z.object({ value, label: text, priceLabel: text.optional() }).strict()).max(1024),
  optionConstraints: z.array(z.object({
    // 参数 ↔ 参数，或参数 ↔ 参考槽（`slotEmpty`：这个槽没放东西时只剩 values；判定只在 crossFieldConstraints）。
    when: z.union([z.object({ key: text, value }).strict(), z.object({ slotEmpty: z.enum(ARCHETYPE_REFERENCE_SLOT_KINDS) }).strict()]),
    values: z.array(value).max(1024),
  }).strict()).max(1024).optional(),
  defaultValue: value.optional(), min: z.number().finite().optional(), max: z.number().finite().optional(),
  step: z.number().finite().optional(), placeholder: text.optional(),
  presets: z.array(z.number().finite()).max(64).optional(), note: text.optional(),
  // 报文写法只由声明门写（paramValue.ts），渲染层投影的控件原样带过来。
  wireEncoding: z.literal('numeric-string').optional(),
} satisfies Record<keyof ModelParameterControl, z.ZodTypeAny>

// Validate the serializable capability facts at the IPC boundary, never executable authority.
export const agentModelEntrySchema: z.ZodType<AgentModelEntry> = z.object({
  modelId: text.min(1), modelAlias: text.nullable(), vendor: text.nullable(), label: text, displayName: text.optional(),
  kind: z.enum(BILLING_MODEL_KINDS), archetypeId: text.optional(), defaultModeId: text,
  modes: z.array(z.object({
    modeId: text, vendorTerm: text, intent: text, hint: text,
    consumesAnchors: z.array(text).max(64).optional(),
    params: z.array(z.object(agentParamShape).strict()).max(128),
    slots: z.array(z.object({ kind: z.enum(ARCHETYPE_REFERENCE_SLOT_KINDS), label: text,
      max: z.number().finite().optional(), characterIndexed: z.boolean().optional(),
    }).strict()).max(64),
  }).strict()).max(64),
  variants: z.array(z.object({ id: text.min(1), label: text, modelKey: text.optional() }).strict()).max(64).optional(),
  defaultVariantId: text.optional(),
}).strict()
