import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES } from '../../electron/shared/modelArchetypes'
import { fittedOptionsHeight, NOMI_SELECT_WHOLE_ROWS } from './NomiSelect'

/**
 * NomiSelect 自己的一条规则（2026-11-14 方向检查：共用组件的能力不靠各调用方各带开关）：
 * 选项不超过 8 行的菜单整个露出、不滚；超过 8 行的照旧按固定最高（380 / 240）在菜单里滚。
 * 量法是纯 DOM：这里用最小的假元素喂几何，测的是取高度的规则本身；真窗口里的样子由实验室格和走查截图看。
 */
function fakeList({ rows, rowHeight, chrome = 30 }: { rows: number; rowHeight: number; chrome?: number }) {
  const contentHeight = rows * rowHeight
  const list = {
    scrollHeight: contentHeight,
    getBoundingClientRect: () => ({ top: 100, height: contentHeight }),
    parentElement: { getBoundingClientRect: () => ({ height: contentHeight + chrome }) },
  }
  return list as unknown as HTMLElement
}

const source = readFileSync(fileURLToPath(new URL('./NomiSelect.tsx', import.meta.url)), 'utf8')

describe('NomiSelect：不超过 8 行整个露出', () => {
  it('门槛是 8 行', () => {
    expect(NOMI_SELECT_WHOLE_ROWS).toBe(8)
  })

  it('6 行带说明（Seedance 2.5 方式菜单，每行约 52 = 312，超过旧的 240）：可视高度 = 内容高度，不滚', () => {
    const list = fakeList({ rows: 6, rowHeight: 52 })
    const height = fittedOptionsHeight(list, 2000)
    expect(height).toBe(list.scrollHeight)
    expect(height).toBeGreaterThan(240)
  })

  it('最小窗口（700×720）放不下：取窗口剩余高度减去滚动区外的小标题，在菜单里滚、不顶出窗外', () => {
    expect(fittedOptionsHeight(fakeList({ rows: 6, rowHeight: 52, chrome: 30 }), 200)).toBe(170)
  })

  it('整露只看行数，不看调用方：组件不收「最多几行」这类入参', () => {
    expect(source).not.toMatch(/maxVisibleRows|maxRows\??:/)
    expect(source).toContain('const showWhole = visibleOptions.length <= NOMI_SELECT_WHOLE_ROWS')
  })

  it('超过 8 行：最高高度和今天一样（带图带说明 380，其余 240），中间件只有 flip / shift', () => {
    expect(source).toContain("showWhole ? undefined : hasRichRows ? 'max-h-[380px]' : 'max-h-[240px]'")
    expect(source).toContain('rowFit ? { flip: true, shift: true, size: rowFit } : { flip: true, shift: true }')
    expect(source).toMatch(/const rowFit = showWhole \? \{/)
  })

  it('全目录方式最多几种：不超过 8（方式菜单永远整个露出）', () => {
    const most = Math.max(...MODEL_ARCHETYPES.map((archetype) => archetype.modes.length))
    console.info('[mode-menu rows] most modes in catalog:', most)
    expect(most).toBeLessThanOrEqual(NOMI_SELECT_WHOLE_ROWS)
  })
})
