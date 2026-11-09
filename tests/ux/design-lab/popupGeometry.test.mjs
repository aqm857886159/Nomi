import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { probePopupGeometry } from './popupGeometry.mjs'

// 几何判据只读浏览器给的矩形；这里分别固定视口、可见性和祖先裁切，验证判据边界。
function fixture({ actionBottom = 640, parentBottom = 680, dialogBottom = 680, overflowY = 'hidden' } = {}) {
  const rect = (bottom) => ({ left: 10, top: 20, right: 300, bottom, width: 290, height: bottom - 20 })
  const element = (bottom, children = [], parentElement = null) => ({
    parentElement, textContent: 'Save', tagName: 'DIV',
    getBoundingClientRect: () => rect(bottom), getAttribute: () => null,
    querySelectorAll: () => children,
  })
  const parent = element(parentBottom)
  const action = element(actionBottom, [], parent)
  const dialog = element(dialogBottom, [action])
  vi.stubGlobal('innerWidth', 1100)
  vi.stubGlobal('innerHeight', 720)
  vi.stubGlobal('document', { body: { children: [] }, querySelectorAll: selector => selector.includes('role=') ? [dialog] : [] })
  vi.stubGlobal('getComputedStyle', el => ({ visibility: 'visible', opacity: '1', display: 'block', overflowX: 'visible', overflowY: el === parent ? overflowY : 'visible' }))
}
afterEach(() => vi.unstubAllGlobals())

describe('弹窗决定栏几何普查', () => {
  it('完整可见时绿，必须实际数到决定按钮', () => {
    fixture()
    expect(probePopupGeometry()).toMatchObject({ dialogs: 1, decisions: 1, violations: [] })
  })
  it('决定栏被滚动祖先裁掉时红，即使仍在视口里', () => {
    fixture({ parentBottom: 600, overflowY: 'auto' })
    expect(probePopupGeometry().violations).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'dialog-decision-clipped' })]))
  })
  it('固定高度超出最小窗口时红', () => {
    fixture({ actionBottom: 900, parentBottom: 950, dialogBottom: 950 })
    expect(probePopupGeometry().violations.map(v => v.rule)).toEqual(['dialog-out-of-viewport', 'dialog-decision-clipped'])
  })
  it('overflow:visible 的正文不算裁切祖先', () => {
    fixture({ parentBottom: 600, overflowY: 'visible' })
    expect(probePopupGeometry().violations).toEqual([])
  })
  it('最小窗口档直接消费主进程同一份尺寸，不另抄数值', () => {
    const main = fs.readFileSync('electron/main.ts', 'utf8')
    const census = fs.readFileSync('tests/ux/design-lab/popupGeometry.census.mjs', 'utf8')
    expect(main).toContain('import MIN_WINDOW_SIZE from "./shared/mainWindowSize.json"')
    expect(main).toContain('...MIN_WINDOW_SIZE,')
    expect(main).not.toMatch(/minWidth:\s*\d+|minHeight:\s*\d+/)
    expect(census).toContain("new URL('../../../electron/shared/mainWindowSize.json', import.meta.url)")
    expect(census.match(/viewport: \{ width: minimum.minWidth, height: minimum.minHeight \}/g)).toHaveLength(2)
    expect(census).toContain("locale: 'en'")
  })
})
