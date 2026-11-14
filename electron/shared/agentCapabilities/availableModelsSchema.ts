import { z } from 'zod'
import { ARCHETYPE_REFERENCE_SLOT_KINDS, BILLING_MODEL_KINDS } from '../contracts/modelAccessCapabilities'
import type { AgentModelEntry } from './availableModels'

const text = z.string().max(8192)
const value = z.union([text, z.number().finite(), z.boolean()])
// Validate the serializable capability facts at the IPC boundary, never executable authority.
export const agentModelEntrySchema: z.ZodType<AgentModelEntry> = z.object({
  modelId: text.min(1), modelAlias: text.nullable(), vendor: text.nullable(), label: text, displayName: text.optional(),
  kind: z.enum(BILLING_MODEL_KINDS), archetypeId: text.optional(), defaultModeId: text,
  modes: z.array(z.object({
    modeId: text, vendorTerm: text, intent: text, hint: text,
    consumesAnchors: z.array(text).max(64).optional(),
    params: z.array(z.object({
      key: text, label: text, type: z.enum(['select', 'number', 'text', 'boolean', 'image-url']),
      mediaKind: z.enum(['image', 'video']).optional(),
      options: z.array(z.object({ value, label: text, priceLabel: text.optional() }).strict()).max(1024),
      optionConstraints: z.array(z.object({
        // 参数 ↔ 参数，或参数 ↔ 参考槽（`slotEmpty`：这个槽没放东西时只剩 values；判定只在 crossFieldConstraints）。
        when: z.union([z.object({ key: text, value }).strict(), z.object({ slotEmpty: z.enum(ARCHETYPE_REFERENCE_SLOT_KINDS) }).strict()]),
        values: z.array(value).max(1024),
      }).strict()).max(1024).optional(),
      defaultValue: value.optional(), min: z.number().finite().optional(), max: z.number().finite().optional(),
      step: z.number().finite().optional(), placeholder: text.optional(),
    }).strict()).max(128),
    slots: z.array(z.object({ kind: z.enum(ARCHETYPE_REFERENCE_SLOT_KINDS), label: text,
      max: z.number().finite().optional(), characterIndexed: z.boolean().optional(),
    }).strict()).max(64),
  }).strict()).max(64),
  variants: z.array(z.object({ id: text.min(1), label: text, modelKey: text.optional() }).strict()).max(64).optional(),
  defaultVariantId: text.optional(),
}).strict()
