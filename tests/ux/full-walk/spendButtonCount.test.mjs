// 监视器读付费确认「答应的是几镜」（铁律 3 card-scope-mismatch 拿它比还没决定的镜数）。
// 2026-11-15 拆开起确认条不画标题问话，数量只在主按钮上：单段那一句「生成」没有数字，读成 1；多段读数字。
// 原场景（2026-10-25 全功能走查 pb01 英文场）：两镜去掉一镜，单数那一句没有数字，监视器回落到出价里的镜数（含去掉的那一镜）读成 2，报了一条假的 card-scope-mismatch。
import { describe, expect, it } from 'vitest'

import { spendButtonCount, UI_LOCALES, uiTextWith } from './invariants.mjs'

describe('spendButtonCount：照词典认主按钮答应的是几镜', () => {
  for (const locale of UI_LOCALES) {
    it(`${locale}：单段「生成」认成 1，「生成 N 段 / 张」读数字，带 ⏎ 也认`, () => {
      expect(spendButtonCount(uiTextWith(locale, 'agentPanelV4.spendCard.generate', {}), locale)).toBe(1)
      expect(spendButtonCount(`${uiTextWith(locale, 'agentPanelV4.spendCard.generate', {})} ⏎`, locale)).toBe(1)
      expect(spendButtonCount(uiTextWith(locale, 'agentPanelV4.spendCard.generateAll', { count: 12 }), locale)).toBe(12)
      expect(spendButtonCount(uiTextWith(locale, 'agentPanelV4.spendCard.generateAllImage', { count: 1 }), locale)).toBe(1)
    })
  }

  it('不是那几句 → null（不猜，交给监视器照实报）', () => {
    expect(spendButtonCount(uiTextWith('en', 'agentPanelV4.spendCard.retry', {}), 'en')).toBeNull()
    expect(spendButtonCount('', 'zh-CN')).toBeNull()
  })
})
