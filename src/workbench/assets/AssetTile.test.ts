// hover 放大浮层定位（#52「鼠标放置参考图自动弹出放大图片」）。默认贴块右侧，贴边翻左/夹回视口。
import { describe, expect, it } from 'vitest'
import { computeHoverZoomPosition } from './assetHoverZoom'

const VIEWPORT = { width: 1440, height: 900 }

describe('computeHoverZoomPosition', () => {
  it('右侧空间够 → 放块右侧（right+8）', () => {
    const pos = computeHoverZoomPosition({ left: 200, right: 256, top: 300 }, VIEWPORT, 320)
    expect(pos.left).toBe(264)
    expect(pos.top).toBe(300)
  })

  it('贴右边（右侧放不下）→ 翻到块左侧', () => {
    const pos = computeHoverZoomPosition({ left: 1300, right: 1356, top: 300 }, VIEWPORT, 320)
    expect(pos.left).toBe(1300 - 320 - 8) // 972
  })

  it('贴顶部 → top 夹到 ≥8', () => {
    const pos = computeHoverZoomPosition({ left: 200, right: 256, top: 2 }, VIEWPORT, 320)
    expect(pos.top).toBe(8)
  })

  it('贴底部 → top 上移到浮层不溢出视口', () => {
    const pos = computeHoverZoomPosition({ left: 200, right: 256, top: 880 }, VIEWPORT, 320)
    expect(pos.top).toBe(900 - 320 - 16) // 564
  })

  it('左侧也不够（窄视口）→ left 夹到 ≥8，不跑出屏幕', () => {
    const pos = computeHoverZoomPosition({ left: 40, right: 96, top: 300 }, { width: 200, height: 900 }, 320)
    expect(pos.left).toBe(8)
  })
})
