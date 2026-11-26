// 图层分离那一格的让位（板 2026-11-26-layer-split · layers.composer-cell；裁定 C-E5）：
// 清晰度「自动」先退，层数后退，方式名不退；再挤只剩叠层图标（候选末尾的空串），悬停给全文。
// 拿档案里真实的控件（seedream55 / seedream5Pro 的图层分离方式）验，不手搓理想控件。
import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES } from '../../../../electron/shared/modelArchetypes/builtInCatalog'
import { layerSplitModeOf } from '../../../../electron/shared/modelArchetypes/modeForInputs'
import { buildDynamicControls } from './controls/parameterControlModel'
import { layerSplitHeadlineParts, summaryFitCandidates } from './composerHeadlineSummary'
import { composerYieldPick } from './composerBarYield'

const modeOf = (id: string) => {
  const mode = layerSplitModeOf(MODEL_ARCHETYPES.find((archetype) => archetype.id === id))
  if (!mode?.layerSplit) throw new Error(`no layer split mode on ${id}`)
  return mode
}
const controlsOf = (id: string) => buildDynamicControls({
  parameterControls: modeOf(id).params, imageCatalogConfig: null, videoCatalogConfig: null, isImageLike: true, isVideoLike: false,
})
// 文案由调用方翻译后传进来；这里用中性记号（MODE / nL / ≤n / AUTO），只验「挑哪几个值、按什么序退」。
const cell = (id: string, meta: Record<string, unknown> = {}) => layerSplitHeadlineParts({
  modeName: 'MODE',
  controls: controlsOf(id),
  meta,
  maxLayers: modeOf(id).layerSplit!.maxLayers,
  formatLayers: (count) => `${count}L`,
  formatUpTo: (count) => `≤${count}`,
  autoLabel: 'AUTO',
})
/** 底栏真用的候选：整值退完再加「只剩图标」一档（InlineParameterBar 带 summaryIcon 时）。 */
const candidates = (parts: ReturnType<typeof cell>['parts']) => [...summaryFitCandidates(parts), '']

describe('图层分离那一格', () => {
  it('5.5 默认：方式名 · 30 层 · 自动，可点开面板', () => {
    const { parts, fixed } = cell('seedream-5-5')
    expect(fixed).toBe(false)
    expect(parts.map((part) => part.text)).toEqual(['MODE', '30L', 'AUTO'])
  })

  it('让位：自动先退，层数后退，最后只剩图标', () => {
    expect(candidates(cell('seedream-5-5').parts)).toEqual(['MODE · 30L · AUTO', 'MODE · 30L', 'MODE', ''])
  })

  it('自定义 60 层 + 2K：格里跟着写', () => {
    expect(cell('seedream-5-5', { layer_count: 60, layer_size: '2K' }).parts.map((part) => part.text)).toEqual(['MODE', '60L', '2K'])
  })

  it('5.0 Pro 层数写死：方式名 · 最多 17 层，静态格（不带 ▾）', () => {
    const { parts, fixed } = cell('seedream-5-pro')
    expect(fixed).toBe(true)
    expect(parts.map((part) => part.text).join(' · ')).toBe('MODE · ≤17')
  })

  it('按宽挑：放得下几个整值留几个，模型名 / 生成钮的字优先', () => {
    const texts = candidates(cell('seedream-5-5').parts)
    // 每一档的宽（示意数：一个字 12px）；可用宽只够「方式名 · 30 层」。
    const width = (text: string) => text.length * 12
    const budget = width('MODE · 30L')
    const step = composerYieldPick({
      sendCollapsible: false, modeCollapsible: false, summaryCandidates: texts.length,
      fits: (candidate) => width(texts[candidate.summaryIndex]!) <= budget,
    })
    expect(texts[step.summaryIndex]).toBe('MODE · 30L')
    // 再窄到一个字都放不下：只剩图标（空串），不截半个值。
    const iconOnly = composerYieldPick({
      sendCollapsible: false, modeCollapsible: false, summaryCandidates: texts.length,
      fits: (candidate) => width(texts[candidate.summaryIndex]!) <= 10,
    })
    expect(texts[iconOnly.summaryIndex]).toBe('')
  })
})
