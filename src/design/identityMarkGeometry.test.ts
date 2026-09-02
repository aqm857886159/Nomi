// 品牌标记的**几何不变量**:不论渲染多大,那个底板永远是「圆角方」,不许变成圆。
//
// 2026-09-02 修的就是这个:NomiBrand 里写过
//     const rx = Math.round((markSize / 28) * 7)
// rx 是 **viewBox 单位**(viewBox 恒 0 0 28 28),缩放本来就由 viewBox 负责;
// 再按渲染像素乘一次 = 双重缩放。markSize 一大,rx 就超过半边长 14,被 SVG 规范截断成**正圆**。
// 开屏标版把 mark 钳在 56–96px,所以它**一直**是个圆——而 README/系统图标/宣传片资产都是圆角方。
// 用户两次反馈「宣传片/开屏的 logo 是圆的、产品是方的」;2026-08-07 那轮只查了营销资产与默认尺寸,
// 因此判成「未证实」——默认 markSize=26 时 rx 恰好算成 7,看不出问题。
//
// 故这道按**多个尺寸**断言,专门盯「大尺寸才现形」这一类:只测默认尺寸会重新漏掉。

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import '../i18n'
import { NomiBrand, NomiLogoMark } from './identity'

/** viewBox 是 28×28;rx 达到半边长(14)即为正圆。 */
const VIEWBOX_SIDE = 28
const EXPECTED_RX = 7

function outerRectRx(markup: string): number {
  // 底板是第一个 <rect>,带 --nomi-logo-ground 填充。
  const match = markup.match(/<rect[^>]*width="28"[^>]*rx="([\d.]+)"/)
  if (!match) throw new Error(`没找到底板 rect,标记结构变了:\n${markup.slice(0, 300)}`)
  return Number(match[1])
}

describe('品牌标记几何', () => {
  // 覆盖开屏实际用到的区间(56–96)与常规 UI 尺寸;大尺寸是这个 bug 唯一现形的地方。
  const sizes = [16, 26, 28, 40, 56, 72, 75, 96, 160]

  it('NomiBrand 的圆角恒为 7,不随渲染尺寸变化', () => {
    const wrong: string[] = []
    for (const markSize of sizes) {
      const rx = outerRectRx(renderToStaticMarkup(createElement(NomiBrand, { markSize })))
      if (rx !== EXPECTED_RX) wrong.push(`markSize=${markSize} → rx=${rx}`)
    }
    expect(wrong, `圆角必须恒为 ${EXPECTED_RX}(viewBox 单位),实测:\n${wrong.join('\n')}`).toEqual([])
  })

  it('任何尺寸下都不会退化成正圆', () => {
    for (const markSize of sizes) {
      const rx = outerRectRx(renderToStaticMarkup(createElement(NomiBrand, { markSize })))
      expect(rx, `markSize=${markSize} 时 rx=${rx} ≥ 半边长 ${VIEWBOX_SIDE / 2},会被渲染成圆`).toBeLessThan(
        VIEWBOX_SIDE / 2,
      )
    }
  })

  it('NomiLogoMark 与 NomiBrand 用同一份几何(单一真相源)', () => {
    const brand = renderToStaticMarkup(createElement(NomiBrand, { markSize: 64 }))
    const mark = renderToStaticMarkup(createElement(NomiLogoMark, { size: 64 }))
    expect(outerRectRx(mark)).toBe(EXPECTED_RX)
    expect(outerRectRx(mark)).toBe(outerRectRx(brand))
    // 双竖 + 斜杠也必须一致——两处曾各写一份,改一处漏一处就会分叉。
    for (const shape of ['x="5.5"', 'x="18.5"', 'points="9.5,5.5 13.5,5.5 18.5,22.5 14.5,22.5"']) {
      expect(brand, `NomiBrand 缺 ${shape}`).toContain(shape)
      expect(mark, `NomiLogoMark 缺 ${shape}`).toContain(shape)
    }
  })

  it('与 public/nomi-logo.svg(README 与 favicon 用的那份)同形', async () => {
    const { readFileSync } = await import('node:fs')
    const svg = readFileSync(new URL('../../public/nomi-logo.svg', import.meta.url), 'utf8')
    expect(outerRectRx(svg), 'SVG 资产与组件的圆角必须一致').toBe(EXPECTED_RX)
  })
})
