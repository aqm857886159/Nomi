import { describe, expect, it } from 'vitest'
import { AGENT_FORM_DEFAULTS, EDGE_GAP, FLOAT_MIN, clampRect, defaultFloatRect } from './agentFormStore'

describe('Agent 三形态的几何（10-08 外壳重设计；收起 = 顶栏 Nomi 入口，2026-11-22）', () => {
  it('默认：画布 / 列表收起（顶栏入口）、点开是浮窗，创作、分镜、预览开着停靠', () => {
    expect(AGENT_FORM_DEFAULTS).toEqual({
      creation: { placement: 'dock', collapsed: false },
      storyboard: { placement: 'dock', collapsed: false },
      generation: { placement: 'float', collapsed: true },
      preview: { placement: 'dock', collapsed: false },
    })
  })

  it('默认浮窗贴右下、约半屏高，整块在内容区里', () => {
    const area = { width: 1210, height: 760 }
    const rect = defaultFloatRect(area)
    expect(rect.x + rect.width).toBe(area.width - EDGE_GAP)
    expect(rect.y + rect.height).toBe(area.height - EDGE_GAP)
    expect(rect.height).toBeGreaterThanOrEqual(Math.round(area.height * 0.5))
  })

  it('窗口缩小后浮窗被夹回可见区（旧位置在屏外也回得来）', () => {
    const rect = clampRect({ x: 1400, y: 900, width: 400, height: 420 }, { width: 900, height: 600 })
    expect(rect.x + rect.width).toBeLessThanOrEqual(900)
    expect(rect.y + rect.height).toBeLessThanOrEqual(600)
    expect(rect.x).toBeGreaterThanOrEqual(0)
  })

  it('内容区比浮窗最小尺寸还小时，浮窗收到内容区那么大，不出界', () => {
    const rect = clampRect({ x: 0, y: 0, width: 400, height: 420 }, { width: 280, height: 300 })
    expect(rect.width).toBe(280)
    expect(rect.height).toBe(300)
    expect(FLOAT_MIN.width).toBeGreaterThan(280)
  })

})
