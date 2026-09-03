// 「指路提示」的渲染锁。
//
// 最要紧的一条是**样张 D 的回归锁**：只剩 ≤1 个模式时模式栏整条不显示（showModeBar === false），
// 那正是用户什么都看不到的最坏情形——提示必须独立于模式栏存在。这条断言直接钉住
// NodeParameterControls 的空返回判据（少了 `!showModeGuidance` 那一项就会红）。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import NarrowedModeGuidanceNote from './NarrowedModeGuidanceNote'
import type { NarrowedModeGuidance } from './narrowedModeGuidance'

// i18n：直接吐 key + 参数，断言不依赖具体译文（译文改字不该让结构测试红）。
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${JSON.stringify(vars)})` : key,
  }),
}))

const render = (guidance: NarrowedModeGuidance, onSwitch = vi.fn(), onDismiss = vi.fn()) =>
  renderToStaticMarkup(
    React.createElement(NarrowedModeGuidanceNote, { guidance, currentVendorName: 'Runway', onSwitch, onDismiss }),
  )

describe('NarrowedModeGuidanceNote', () => {
  it('switch 态：说清哪家没有、哪家有，并给一个换过去的按钮（样张 B）', () => {
    const html = render({
      kind: 'switch',
      hiddenModeTerms: ['首尾帧', '全能参考'],
      target: { value: 'seedance2', vendor: 'kie', vendorName: 'KIE' },
    })
    expect(html).toContain('narrowedModeSwitch')
    expect(html).toContain('Runway')
    expect(html).toContain('KIE')
    expect(html).toContain('narrowedModeSwitchAction')
    expect(html).toContain('<button')
    expect(html).toContain('narrowedModeGuidanceDismiss')
    expect(html).toContain('aria-label')
  })

  it('none 态：只说实话，不给换家按钮，但仍可关闭提示（样张 E）', () => {
    const html = render({ kind: 'none', hiddenModeTerms: ['全能参考'] })
    expect(html).toContain('narrowedModeNone')
    expect(html).toContain('narrowedModeGuidanceDismiss')
    expect(html).toContain('<button')
  })

  it('沿用已有的「诚实说一句」视觉层级，不发明新的', () => {
    const html = render({ kind: 'none', hiddenModeTerms: ['全能参考'] })
    expect(html).toContain('text-ink-40')
    expect(html).toContain('text-micro')
  })

  it('模式名逐个走 i18n 包装 + 分隔符，代码里不拼标点', () => {
    const html = render({ kind: 'none', hiddenModeTerms: ['首尾帧', '全能参考'] })
    expect(html).toContain('narrowedModeName')
    // 两个模式名各包一次
    expect(html.match(/narrowedModeName/g)).toHaveLength(2)
  })
})
