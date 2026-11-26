import React from 'react'
import { useTranslation } from 'react-i18next'
import type { VendorPricePreview } from '../../../../electron/shared/contracts/vendorPricePreview'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { SampleFacts } from '../model/sampleFacts'
import type { ComposerGraph } from '../nodes/composerGraphSnapshot'
import { sendCostDescription, sendCostPillText } from './sendCostFormat'
import { readPricePreviewOnce, sampleFinalPriceRequest, useNodePricePreview, usePricePreview, type NodePricePreview } from './useNodePricePreview'

/** 发送键那一格要说的：键上的积分数、悬停那一句、估价从哪来。 */
export type SendCost = {
  /** 键上的积分数（交给共用发送钮的 `cost`）；算不出 / 忙着 / 新价没回来 = undefined（钮上只剩 ↑，不印数、不印 0）。 */
  credits?: string
  /** 悬停 / 读屏那一句；不走公开价的那家、忙着、新价没回来又没有旧数可留 = undefined。 */
  description?: string
  /** 估价从哪来（走查锚点）。 */
  source?: string
}

/**
 * 画布节点发送键上的约价（板 ModelSurfaces：cost.send-pill / cost.hover）。
 * 只是显示：能不能发、要不要确认，仍归原来的发送流程；这里没有任何一处能创建任务或授权。
 */
export function useSendCost(node: GenerationCanvasNode, graph: ComposerGraph, { idle }: { idle: boolean }): SendCost {
  return useCostOf(useNodePricePreview(node, graph), { idle })
}

/** 节点下方「出高清」钮上的价：样片冻结的请求按成片清晰度约价（同发送键一套暂留 / 防抖 / 不印 0）。 */
export function useSampleFinalCost(sample: SampleFacts | null, resolution: string | undefined, { idle }: { idle: boolean }): SendCost {
  const input = React.useMemo(() => (sample && resolution ? sampleFinalPriceRequest(sample, resolution) : null), [sample, resolution])
  return useCostOf(usePricePreview(input), { idle })
}

/** 第二次出高清确认框主按钮上的价（一次性读）：估不出 / 不走公开价 → undefined（按钮只写字，不印数、不写 0）。 */
export async function sampleFinalCredits(sample: SampleFacts, resolution: string, locale: string): Promise<string | undefined> {
  const input = sampleFinalPriceRequest(sample, resolution)
  const quote = await readPricePreviewOnce(input)
  const state = sendCostState({ vendorKey: input?.vendorKey, quote, pending: false }, { idle: true })
  return state.kind === 'credits' ? sendCostPillText(state.quote, locale) : undefined
}

function useCostOf(preview: NodePricePreview, { idle }: { idle: boolean }): SendCost {
  const { t, i18n } = useTranslation()
  const state = sendCostState(preview, { idle })
  if (state.kind === 'none') return {}
  if (state.kind === 'unknown') return { description: sendCostDescription(null, t, i18n.language) }
  return {
    credits: sendCostPillText(state.quote, i18n.language),
    description: sendCostDescription(state.quote, t, i18n.language),
    source: state.quote.source,
  }
}

/**
 * 发送键那一格该是哪一态（纯函数，单测钉住）：
 * - `none`：不走公开价的那家 / 忙着 / 要先备齐参考 / 新价没回来又没旧数可留 —— 钮原样，不多说一句；
 * - `unknown`：这家走公开价、但这次估不出（价目里没有、读不到、为 0）—— 钮上只剩 ↑，悬停「暂时估不出这次用量」；
 * - `credits`：硬币 + 积分数。
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
