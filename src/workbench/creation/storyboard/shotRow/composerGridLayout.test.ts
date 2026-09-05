import { describe, expect, it } from 'vitest'
import { COMPOSER_GRID_SLOTS } from './composerBarModel'
import {
  COMPOSER_GRID_GAP,
  COMPOSER_WRAP_COLUMNS,
  composerGridTemplate,
  composerGridWidth,
  planComposerGrid,
} from './composerGridLayout'

/** 2026-09-06 真机量到的一行：底栏可用 492px，七格自然宽度如下（该行装不下）。 */
const REAL_ROW = [73, 110, 64, 85, 70, 126, 42]

/** 一份 plan 里，每一格实际拿到的宽度（跨列的把它跨的轨道加起来）。 */
function cellWidths(plan: ReturnType<typeof planComposerGrid>): number[] {
  return plan.placement.map((cell) =>
    composerGridWidth(plan.tracks.slice(cell.column - 1, cell.column - 1 + cell.span), COMPOSER_GRID_GAP))
}

describe('底栏七列排布', () => {
  it('装得下就一行七列，每格拿到自己的自然宽度', () => {
    const plan = planComposerGrid(REAL_ROW, 1000)
    expect(plan.wrapped).toBe(false)
    expect(plan.tracks).toEqual(REAL_ROW)
    expect(plan.placement.map((cell) => cell.row)).toEqual([1, 1, 1, 1, 1, 1, 1])
  })

  it('装不下就换成两行四列：模型|模式|画幅|时长 / 清晰度|音频·尾帧|生成', () => {
    const plan = planComposerGrid(REAL_ROW, 492)
    expect(plan.wrapped).toBe(true)
    expect(plan.tracks).toHaveLength(COMPOSER_WRAP_COLUMNS)
    expect(plan.placement.map((cell) => cell.row)).toEqual([1, 1, 1, 1, 2, 2, 2])
    // 主按钮落在第 4 列——换不换行都待在同一个角落。
    expect(plan.placement[COMPOSER_GRID_SLOTS.indexOf('generate')]).toEqual({ row: 2, column: 4, span: 1 })
  })

  it('无论换不换行，每一格拿到的宽度都 ≥ 它的自然宽度（这就是「不截断、不重叠」）', () => {
    for (const available of [1000, 700, 492, 400]) {
      const plan = planComposerGrid(REAL_ROW, available)
      cellWidths(plan).forEach((width, index) => {
        expect(width).toBeGreaterThanOrEqual(REAL_ROW[index])
      })
    }
  })

  it('列宽来自"该列的最大值"——某一行继承画幅（空格子）也不会把画幅列压没', () => {
    // 作用域喂进来的是全表逐列最大值，不是某一行自己的宽度。
    const columnMax = planComposerGrid(REAL_ROW, 492)
    const thisRowOnly = planComposerGrid([...REAL_ROW.slice(0, 2), 0, ...REAL_ROW.slice(3)], 492)
    expect(columnMax.tracks[2]).toBe(REAL_ROW[2])
    expect(thisRowOnly.tracks[2]).toBeLessThan(REAL_ROW[2])
    expect(columnMax.tracks).not.toEqual(thisRowOnly.tracks)
  })

  it('换行版的轨道逐列取两行的较大值', () => {
    const plan = planComposerGrid(REAL_ROW, 492)
    expect(plan.tracks[0]).toBe(Math.max(REAL_ROW[0], REAL_ROW[4]))
    expect(plan.tracks[3]).toBe(Math.max(REAL_ROW[3], REAL_ROW[6]))
  })

  it('跨列的格子比它跨的轨道还宽时，差额平摊回那几列，不让它自己溢出', () => {
    const mediaHeavy = [40, 30, 30, 40, 40, 400, 40]
    const plan = planComposerGrid(mediaHeavy, 300)
    expect(plan.wrapped).toBe(true)
    expect(composerGridWidth(plan.tracks.slice(1, 3), COMPOSER_GRID_GAP)).toBeGreaterThanOrEqual(400)
  })

  it('还没量到宽度（available <= 0）时按不换行处理，不凭空猜一个断点', () => {
    expect(planComposerGrid(REAL_ROW, 0).wrapped).toBe(false)
  })

  it('模板末列吃余量，主按钮因此贴右', () => {
    const template = composerGridTemplate(planComposerGrid(REAL_ROW, 492))
    // `minmax(94px, 1fr)` 自己带空格，所以按 px 轨道数点，不按空格切。
    expect(template.match(/\d+px/g)).toHaveLength(COMPOSER_WRAP_COLUMNS)
    expect(template.endsWith('1fr)')).toBe(true)
  })
})
