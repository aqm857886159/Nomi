// 生成框里「这次是不是图层分离、放了几张图、层数能不能选」——提示词占位、效果小胶囊、发送键禁用原因、底栏上方那一句
// 都问这一处（设计卡 docs/plan/2026-11-26-layer-split.md；板 2026-11-26-layer-split）。
// 方式只由 effectiveArchetypeMode 现算（唯一 owner）；这里不另判方式，只把结论收成生成框要用的几件。
import { resolveModelArchetype, variantRecordedInMeta } from '../../../../electron/shared/modelArchetypes'
import { isLayerSplitMode, LAYER_COUNT_KEY } from '../../../../electron/shared/modelArchetypes/layerSplit'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { collectModeInputs, effectiveArchetypeMode, type ModeGraph } from './controls/archetypeMeta'

export type LayerSplitComposerState = {
  /** 这次放进来的输入件数（画布边 + 上传）。0 = 还没放要拆的图；> 1 = 只拆第 1 张。 */
  inputCount: number
  /** 层数写死（方式没有层数参数，如 Seedream 5.0 Pro）。 */
  fixed: boolean
  /** 方式声明的层数上限（含底图）。 */
  maxLayers: number
}

export function layerSplitComposerState(node: Pick<GenerationCanvasNode, 'id' | 'meta' | 'kind'>, graph: ModeGraph): LayerSplitComposerState | null {
  const meta = (node.meta || {}) as Record<string, unknown>
  const archetype = resolveModelArchetype({
    modelKey: typeof meta.modelKey === 'string' ? meta.modelKey : undefined,
    modelAlias: typeof meta.modelAlias === 'string' ? meta.modelAlias : undefined,
    vendorKey: typeof meta.modelVendor === 'string' ? meta.modelVendor : typeof meta.vendor === 'string' ? meta.vendor : null,
    meta,
  }, { variant: variantRecordedInMeta(meta, meta.modelKey) })
  if (!archetype || archetype.kind !== 'image') return null
  const { mode } = effectiveArchetypeMode(archetype, node, graph)
  if (!isLayerSplitMode(mode) || !mode.layerSplit) return null
  return {
    inputCount: collectModeInputs(node, graph).inputs.length,
    fixed: !mode.params.some((control) => control.key === LAYER_COUNT_KEY),
    maxLayers: mode.layerSplit.maxLayers,
  }
}

type ReminderUnit = 'credits' | 'cny' | 'usd'

/**
 * 「层数多就贵」那句里的数：发送键当前单位的裸数（单位菜单那一项，和键上同一个格式化出口），不带键上的「≤ / ≈」号——
 * 句子自己说了「约」。键上没印数（算不出 / 忙着）→ null，句子退成不带数的那一版。
 */
export function layerSplitReminderAmount(cost: {
  credits?: string
  unit?: ReminderUnit
  unitOptions?: readonly { unit: ReminderUnit; formatted: string }[]
} | null | undefined): { unit: ReminderUnit; value: string } | null {
  if (!cost?.credits) return null
  const unit = cost.unit ?? 'credits'
  const value = cost.unitOptions?.find((option) => option.unit === unit)?.formatted
  return value ? { unit, value } : null
}
