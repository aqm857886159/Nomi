/**
 * 模型配置 - 与TaskNode保持一致
 */
import type { BillingModelKind } from '../workbench/api/modelCatalogApi'

// 价目的形状与算式住在中立契约层（`electron/shared/contracts/shotPricingRule.ts`）：
// 主进程封印合同、付费确认卡本地重算、画布确认条预估，三处必须报同一个数，
// 所以形状与算式都只留一份（2026-09-11 收敛；此前渲染层另有一份只累加基价的算法，
// 有规格加价时比真正要扣的少报——少报比不报更坏）。
export type { ModelPricingSpec as ModelOptionPricingSpec, ModelPricing as ModelOptionPricing } from '../../electron/shared/contracts/shotPricingRule'
import type { ModelPricing as ModelOptionPricing } from '../../electron/shared/contracts/shotPricingRule'
import type { ModelNameSource } from '../../electron/shared/modelArchetypes/modelNameSource'

/** Display grouping only; each option still addresses its own executable catalog row. */
type ModelOptionVariant = Readonly<{
  familyKey: string
  familyLabel: string
  variantLabel: string
  defaultVariant: boolean
}>

export interface ModelOption {
  value: string
  label: string
  vendor?: string
  /** 厂商显示名（catalog vendor.name；自定义中转的 key 是派生串不宜直显）。节点下拉标注用。 */
  vendorName?: string
  modelKey?: string
  modelAlias?: string | null
  /** Catalog billing kind. Kept alongside the option so non-media models (chat) retain their identity. */
  kind?: BillingModelKind
  /**
   * 供应商最近一次给的清单里没有它（旁注，不是停用——见 `ModelCatalogModelDto.unlisted`）。
   * 模型框据此在那一行后面加一句实话；它**不**影响可选性，用户照样选得了。
   */
  unlisted?: true
  /** 这一行发出的型号名由档案提供还是就是这一行的 key（目录随行下发，见 ModelCatalogModelDto.modelNameSource）。 */
  modelNameSource?: ModelNameSource
  /** 已单独挂了自定义调用脚本的模式 ID（如 modes.layers.script 非空），供能力准入排除结构化回执无法经脚本返回的模式。 */
  customCallScriptModes?: readonly string[]
  meta?: unknown
  pricing?: ModelOptionPricing
  variant?: ModelOptionVariant
}

const TEXT_MODELS: ModelOption[] = [
  { value: 'gpt-5.2', label: 'GPT-5.2', vendor: 'openai' },
  { value: 'gpt-5.1', label: 'GPT-5.1', vendor: 'openai' },
  { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', vendor: 'openai' },
  { value: 'glm-4.6', label: 'GLM-4.6 (Claude兼容)', vendor: 'anthropic' },
  { value: 'glm-4.5', label: 'GLM-4.5', vendor: 'anthropic' },
  { value: 'glm-4.5-air', label: 'GLM-4.5-Air', vendor: 'anthropic' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', vendor: 'gemini' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', vendor: 'gemini' },
  { value: 'gemini-2.5-flash-think', label: 'Gemini 2.5 Flash Think', vendor: 'gemini' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', vendor: 'gemini' },
  { value: 'gemini-3-pro', label: 'Gemini 3 Pro', vendor: 'gemini' },
  { value: 'models/gemini-3-pro-preview', label: 'Gemini 3 Pro Preview', vendor: 'gemini' },
]

const DEFAULT_IMAGE_MODEL_VALUE = 'gemini-3.1-flash-image-preview'

const IMAGE_MODELS: ModelOption[] = [
  { value: DEFAULT_IMAGE_MODEL_VALUE, label: 'Gemini 3.1 Flash Image Preview', vendor: 'gemini' },
  { value: 'nano-banana', label: 'Nano Banana', vendor: 'gemini' },
  { value: 'nano-banana-fast', label: 'Nano Banana Fast', vendor: 'gemini' },
  { value: 'nano-banana-pro', label: 'Nano Banana Pro', vendor: 'gemini' },
  { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', vendor: 'gemini' },
  { value: 'qwen-image-plus', label: 'Qwen Image Plus', vendor: 'qwen' },
]

export const VIDEO_MODELS: ModelOption[] = [
  { value: 'veo3.1-pro', label: 'Veo 3.1 Pro', vendor: 'veo' },
  { value: 'veo3.1-fast', label: 'Veo 3.1 Fast', vendor: 'veo' },
  { value: 'veo_3_1_i2v_s_fast_fl_landscape', label: 'Veo 3.1 i2v (Fast, FL, Landscape)', vendor: 'veo' },
]

// 声音模型（apimart 同步族）：合 1 个 catalog 条目，档案两模式（配音 TTS / 转写 Whisper）经 modelEnum
// 注入真实模型名。meta.archetypeId 指针让档案驱动模式切换 + 参数/槽（仿 HappyHorse）。
export const AUDIO_MODELS: ModelOption[] = [
  { value: 'nomi-audio', label: '声音', vendor: 'apimart', modelKey: 'nomi-audio', meta: { archetypeId: 'nomi-audio' } },
]

export type NodeKind =
  | 'text'
  | 'image'
  | 'imageEdit'
  | 'video'
  | 'audio'
  | 'subtitle'
  | 'character'
  | 'model3d'

export function getAllowedModelsByKind(kind?: NodeKind): ModelOption[] {
  switch (kind) {
    case 'image':
    case 'imageEdit':
      return IMAGE_MODELS
    case 'video':
      return VIDEO_MODELS
    case 'audio':
      return AUDIO_MODELS
    case 'character':
    case 'text':
    default:
      return TEXT_MODELS
  }
}

