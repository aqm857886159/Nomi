import { useTranslation } from 'react-i18next'
import type { VendorPricePreview } from '../../../../electron/shared/contracts/vendorPricePreview'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { ComposerGraph } from '../nodes/composerGraphSnapshot'
import {
  sendCostDescription,
  sendCostPillText,
  sendCostRateNote,
  sendCostUnitMenuAria,
  sendCostUnitOptions,
  sendCostUnitSwitchAria,
  type SendCostUnitOption,
} from './sendCostFormat'
import { useSendCostUnit, type SendCostUnit } from './sendCostUnitStore'
import { useNodePricePreview } from './useNodePricePreview'

/** 发送键那一格要说的：键上的约数、当前单位与切换菜单数据、悬停那一句、估价从哪来。 */
export type SendCost = {
  /** 键上印的约数（按当前单位格式化且都标「约」）；算不出 / 忙着 / 新价没回来 = undefined（钮上只剩 ↑）。 */
  credits?: string
  /** 当前展示单位（积分 / 人民币 / 美元）。 */
  unit?: SendCostUnit
  /** 单位切换菜单三项与内置汇率日期说明。 */
  unitOptions?: readonly SendCostUnitOption[]
  rateNote?: string
  unitMenuAriaLabel?: string
  unitSwitchAriaLabel?: string
  onUnitChange?: (unit: SendCostUnit) => void
  /** 悬停 / 读屏那一句；不走公开价的那家、忙着、新价没回来又没有旧数可留 = undefined。 */
  description?: string
  /** 估价从哪来（走查锚点）。 */
  source?: string
  /** 已就绪的公开估价原值（仅在有价时提供，供下游独立模块只读消费）。 */
  quote?: VendorPricePreview
  /** 这次请求走的是有公开价目的那家时才有。 */
  vendorKey?: string
}

/**
 * 画布节点发送键上的约价（板 ModelSurfaces：cost.send-pill / cost.hover）。
 * 只是显示：能不能发、要不要确认，仍归原来的发送流程；这里没有任何一处能创建任务或授权。
 */
export function useSendCost(node: GenerationCanvasNode, graph: ComposerGraph, { idle }: { idle: boolean }): SendCost {
  const { t, i18n } = useTranslation()
  const [unit, setUnit] = useSendCostUnit()
  const preview = useNodePricePreview(node, graph)
  const state = sendCostState(preview, { idle })
  if (state.kind === 'none') return { vendorKey: preview.vendorKey }
  if (state.kind === 'unknown') {
    return {
      vendorKey: preview.vendorKey,
      description: sendCostDescription(null, t, i18n.language, unit),
    }
  }
  return {
    credits: sendCostPillText(state.quote, i18n.language, unit, t),
    unit,
    unitOptions: sendCostUnitOptions(state.quote, t, i18n.language),
    rateNote: sendCostRateNote(t, i18n.language),
    unitMenuAriaLabel: sendCostUnitMenuAria(t),
    unitSwitchAriaLabel: sendCostUnitSwitchAria(state.quote, t, i18n.language, unit),
    onUnitChange: setUnit,
    description: sendCostDescription(state.quote, t, i18n.language, unit),
    source: state.quote.source,
    quote: state.quote,
    vendorKey: preview.vendorKey,
  }
}

/**
 * 发送键那一格该是哪一态（纯函数，单测钉住）：
 * - `none`：不走公开价的那家 / 忙着 / 要先备齐参考 / 新价没回来又没旧数可留 —— 钮原样，不多说一句；
 * - `unknown`：这家走公开价、但这次估不出（价目里没有、读不到、为 0）—— 钮上只剩 ↑，悬停「暂时估不出这次用量」；
 * - `credits`：有公开约价，按当前单位展示并允许在发送键旁切换。
 */
export function sendCostState(
  preview: { vendorKey?: string; quote: VendorPricePreview | null; pending: boolean },
  { idle }: { idle: boolean },
): { kind: 'none' } | { kind: 'unknown' } | { kind: 'credits'; quote: VendorPricePreview } {
  if (!idle || !preview.vendorKey) return { kind: 'none' }
  const { quote } = preview
  if (quote && quote.credits > 0 && Number.isFinite(quote.credits)) return { kind: 'credits', quote }
  return preview.pending ? { kind: 'none' } : { kind: 'unknown' }
}
