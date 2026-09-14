// 收起坞的空当算法。这一条是**位置**不变量，不是长相：算错了 composer 会离开画面，
// 而「收起藏的是对话流，不是对话」这句承诺就当场作废——2026-09-06 真机验收正是这么撞上的。
import { describe, expect, it } from 'vitest'
import { bottomDockClearanceFrom, transportClearanceFrom } from './agentPanelV4DockClearance'

const HOST = { bottom: 854, height: 798 } as const

describe('收起坞 · 走带条空当', () => {
  it('真有一条排版过的走带条时，量宿主底边到条顶边', () => {
    expect(transportClearanceFrom(HOST, { top: 800, height: 48 })).toBe(54)
  })

  it('没有走带条（创作面）时空当是 0，composer 贴宿主下沿', () => {
    expect(transportClearanceFrom(HOST, null)).toBe(0)
  })

  it('条在 DOM 里但没被排版（矩形全 0）时算 0，而不是把 composer 顶出视口', () => {
    // 这就是真机上的那一幕：预览面没在前台，它那条走带条 display:none、矩形全 0，
    // 旧算法得出 854（= 宿主底边 − 0），`bottom: 854px` 把 composer 送到 y=-98。
    expect(transportClearanceFrom(HOST, { top: 0, height: 0 })).toBe(0)
  })

  it('无论量到什么，空当都不会超过宿主自己的高度', () => {
    expect(transportClearanceFrom(HOST, { top: -5000, height: 48 })).toBe(HOST.height)
  })

  it('条比宿主底边还低时不产生负空当', () => {
    expect(transportClearanceFrom(HOST, { top: 900, height: 48 })).toBe(0)
  })
})

/**
 * 坞还要让开**横向与它重叠**的底部停靠区（2026-09-15）。
 *
 * 这一条是把「压住时间轴」修掉之后冒出来的第二个受害者的答案：坞收进内容行之后落在
 * 画布下沿，那儿常驻着画布工具簇。判据只认横向真的重叠的那几块——迷你画面窗在右下角、
 * 与居中的坞不相交，算进来会把坞顶得莫名其妙地高（实测确实发生过，只是当时是漏订
 * ResizeObserver 造成的 latch）。
 */
describe('收起坞 · 底部停靠区空当', () => {
  const HOST = { bottom: 703, height: 647 } as const
  const SELF = { left: 390, right: 950 } as const
  const navStack = { left: 76, right: 428, top: 648, bottom: 690 }
  const miniPreview = { left: 1020, right: 1268, top: 517, bottom: 690 }

  it('横向重叠的那块抬多少就让多少（宿主底边到它顶边）', () => {
    expect(bottomDockClearanceFrom(HOST, SELF, [navStack])).toBe(703 - 648)
  })

  it('横向不重叠的一概不算——否则右下角那块会把居中的坞顶到半空', () => {
    expect(bottomDockClearanceFrom(HOST, SELF, [miniPreview])).toBe(0)
    expect(bottomDockClearanceFrom(HOST, SELF, [navStack, miniPreview])).toBe(703 - 648)
  })

  it('多块重叠时听最高的那块', () => {
    const taller = { left: 400, right: 600, top: 500, bottom: 690 }
    expect(bottomDockClearanceFrom(HOST, SELF, [navStack, taller])).toBe(703 - 500)
  })

  it('没有停靠区 / 量不到自己的矩形时是 0，坞贴宿主下沿', () => {
    expect(bottomDockClearanceFrom(HOST, SELF, [])).toBe(0)
    expect(bottomDockClearanceFrom(HOST, null, [navStack])).toBe(0)
  })

  it('矩形全 0 的停靠区不算（同走带条那一坑：display:none 也还在 DOM 里）', () => {
    expect(bottomDockClearanceFrom(HOST, SELF, [{ left: 0, right: 0, top: 0, bottom: 0 }])).toBe(0)
  })

  it('无论量到什么，空当都不会超过宿主自己的高度', () => {
    expect(bottomDockClearanceFrom(HOST, SELF, [{ left: 400, right: 600, top: -5000, bottom: 10 }])).toBe(HOST.height)
  })

  it('停靠区比宿主底边还低时不产生负空当', () => {
    expect(bottomDockClearanceFrom(HOST, SELF, [{ left: 400, right: 600, top: 900, bottom: 980 }])).toBe(0)
  })
})
