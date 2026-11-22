import { describe, expect, it } from 'vitest'
import { COMPOSER_YIELD_NONE, composerYieldPick, type ComposerYieldStep } from './composerBarYield'

// 重要性清单的顺序（模型名 > 方式名 > 摘要从后往前的整值 > 钮上的字）只在这里钉住：
// 真窗口 G2–G4 / G6 只判「不多让」，把方式名和摘要调个个儿，两边都还是绿的（2026-11-22 反例①实测）。
// 量具：每件按固定宽算，整条 ≤ 预算就算放得下——和底栏一样只看自己的宽。
const WIDTH = { model: 100, modelEllipsis: 60, mode: 50, summary: [90, 60, 30], send: 40 }
const width = (step: ComposerYieldStep) =>
  (step.modelEllipsis ? WIDTH.modelEllipsis : WIDTH.model)
  + (step.modeIconOnly ? 0 : WIDTH.mode)
  + WIDTH.summary[step.summaryIndex]
  + (step.sendIconOnly ? 0 : WIDTH.send)
const pick = (budget: number) => composerYieldPick({ sendCollapsible: true, modeCollapsible: true, summaryCandidates: 3, fits: (step) => width(step) <= budget })
const shape = (step: ComposerYieldStep) => ({ mode: !step.modeIconOnly, summaryIndex: step.summaryIndex, send: !step.sendIconOnly, modelEllipsis: step.modelEllipsis })

describe('composerYieldPick 按重要性清单放回', () => {
  it('模型名都放不下就全收，后面一样都不放', () => {
    expect(shape(pick(129))).toEqual({ mode: false, summaryIndex: 2, send: false, modelEllipsis: true })
  })

  it('方式名先于任何一个摘要值放回（两样只放得下一样时留方式名）', () => {
    // 全收 130；方式名 +50 = 180 放得下；之后摘要多一个值 +30 = 210 放不下
    expect(shape(pick(180))).toEqual({ mode: true, summaryIndex: 2, send: false, modelEllipsis: false })
  })

  it('摘要的值先于钮上的字放回', () => {
    // 方式名 180 → 摘要两个值 210 → 摘要三个值 240 放不下 → 钮上的字 250 放不下
    expect(shape(pick(220))).toEqual({ mode: true, summaryIndex: 1, send: false, modelEllipsis: false })
  })

  it('放不下的那件跳过，后面放得下的照样放回', () => {
    // 方式名 180 放不下 → 摘要两个值 160 放得下
    expect(shape(pick(170))).toEqual({ mode: false, summaryIndex: 1, send: false, modelEllipsis: false })
  })

  it('全放得下就一件都不收', () => {
    expect(pick(1000)).toEqual(COMPOSER_YIELD_NONE)
  })
})
