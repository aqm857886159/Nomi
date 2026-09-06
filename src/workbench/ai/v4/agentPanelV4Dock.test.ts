// 收起坞的空当算法。这一条是**位置**不变量，不是长相：算错了 composer 会离开画面，
// 而「收起藏的是对话流，不是对话」这句承诺就当场作废——2026-09-06 真机验收正是这么撞上的。
import { describe, expect, it } from 'vitest'
import { transportClearanceFrom } from './AgentPanelV4Dock'

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
