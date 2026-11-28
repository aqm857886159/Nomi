// 「层数多就贵：最多按 N 张图扣，约 X。」里的 X（板 2026-11-26-layer-split · layers.params-panel）：
// 取发送键当前单位的裸数，不带键上的「≤ / ≈」——句子自己说了「约」，不印成「约 ≤8.46」「约 ≈¥5.68」。
// 反例：直接拿键上的字（cost.credits）→ 前两条红。
import { describe, expect, it } from 'vitest'
import { layerSplitReminderAmount } from './layerSplitComposerState'

const options = [
  { unit: 'credits', formatted: '8.46' },
  { unit: 'cny', formatted: '¥5.68' },
  { unit: 'usd', formatted: '$0.846' },
] as const

describe('层数多就贵那句里的数', () => {
  it('积分：键上「≤8.46」，句子里是 8.46', () => {
    expect(layerSplitReminderAmount({ credits: '≤8.46', unit: 'credits', unitOptions: options })).toEqual({ unit: 'credits', value: '8.46' })
  })
  it('换成人民币 / 美元：跟着键的单位，仍是裸数', () => {
    expect(layerSplitReminderAmount({ credits: '≤¥5.68', unit: 'cny', unitOptions: options })).toEqual({ unit: 'cny', value: '¥5.68' })
    expect(layerSplitReminderAmount({ credits: '≤$0.846', unit: 'usd', unitOptions: options })).toEqual({ unit: 'usd', value: '$0.846' })
  })
  it('没写单位按积分', () => {
    expect(layerSplitReminderAmount({ credits: '≤8.46', unitOptions: options })).toEqual({ unit: 'credits', value: '8.46' })
  })
  it('键上没印数（算不出 / 忙着）→ 不带数，句子退成不带约价那一版；不报 0', () => {
    expect(layerSplitReminderAmount(undefined)).toBeNull()
    expect(layerSplitReminderAmount({ unit: 'credits', unitOptions: options })).toBeNull()
    expect(layerSplitReminderAmount({ credits: '≤8.46', unit: 'credits' })).toBeNull()
  })
})
