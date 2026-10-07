// 9b 记账：同一节点的「已保存到项目」回执消失后再出现，是新的一次，不能沿用第一次的 firstSeen。
// 真实代码：直接跑页内观察者 installProbe（页面全局换成最小桩），读它的 trackSaved——不是复制一份算法。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installProbe } from './pageProbe.mjs'

function install() {
  const doc = { querySelector: () => null, querySelectorAll: () => [], documentElement: {} }
  vi.stubGlobal('window', { addEventListener() {} })
  vi.stubGlobal('document', doc)
  vi.stubGlobal('MutationObserver', class { observe() {} })
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('setInterval', () => 0)
  vi.stubGlobal('getComputedStyle', () => ({}))
  installProbe({ savedTexts: ['已保存到项目'] })
  return window.__nomiFullWalk
}

describe('pageProbe · 9b 回执记账', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('同一节点第二次出现：重置 firstSeen，停留时长按本次算（pb11 误报的原场景）', () => {
    const state = install()
    state.savedLabels = {}
    state.trackSaved(new Set(['n1']), 1000)
    state.trackSaved(new Set(['n1']), 3000)
    state.trackSaved(new Set(), 4000) // 第一次收了，停留 3s
    state.trackSaved(new Set(), 20000)
    state.trackSaved(new Set(['n1']), 30000) // 第二次
    state.trackSaved(new Set(['n1']), 32000)
    state.trackSaved(new Set(), 33000)
    const entry = state.savedLabels.n1
    expect(entry.firstSeen).toBe(30000)
    expect(entry.gone - entry.firstSeen).toBe(3000)
  })

  it('一直挂着不收仍然看得出来（真 bug 不被吞）', () => {
    const state = install()
    state.savedLabels = {}
    state.trackSaved(new Set(['n2']), 1000)
    state.trackSaved(new Set(['n2']), 17000)
    const entry = state.savedLabels.n2
    expect(entry.gone).toBeNull()
    expect(entry.lastSeen - entry.firstSeen).toBe(16000)
  })
})
