import { describe, expect, it } from 'vitest'
import { canvasImportAvailabilitySource } from './useCanvasImportAvailability'

// contained 素材盒到画布的可用性「从哪来」是 dfc47477 回归的确切点：
// 旧代码在 contained 下无条件 false、从不消费已传入的探针 → ready 素材永远送不进画布（P0）。
// 这层纯决策锁死：contained + 有探针 必须走 probe（跨窗），绝不能退化成 none。
describe('canvasImportAvailabilitySource', () => {
  it('contained + 有探针 → probe（回归根因：绝不能是 none）', () => {
    expect(canvasImportAvailabilitySource(true, true, true)).toBe('probe')
  })

  it('contained + 无探针 → none（无从判断，不谎报可用）', () => {
    expect(canvasImportAvailabilitySource(true, true, false)).toBe('none')
  })

  it('应用内浮窗 → dom（本窗查画布目标）', () => {
    expect(canvasImportAvailabilitySource(true, false, false)).toBe('dom')
    expect(canvasImportAvailabilitySource(true, false, true)).toBe('dom')
  })

  it('未打开 → none（且不触发任何探测）', () => {
    expect(canvasImportAvailabilitySource(false, true, true)).toBe('none')
    expect(canvasImportAvailabilitySource(false, false, false)).toBe('none')
  })
})
