import { describe, expect, it } from 'vitest'
import { clipPathForHoles, occludedHoles } from './useCanvasChromeOcclusion'

const dock = { left: 100, top: 700, right: 300, bottom: 740 }

describe('外框控件被生成框压住的那一块', () => {
  it('不相交 → 没有洞，也不加任何裁剪', () => {
    const holes = occludedHoles(dock, [{ left: 0, top: 0, right: 90, bottom: 690 }])
    expect(holes).toEqual([])
    expect(clipPathForHoles(200, 40, holes)).toBeUndefined()
  })

  it('相交 → 洞是交集，坐标相对外框控件左上角', () => {
    const holes = occludedHoles(dock, [{ left: 250, top: 600, right: 500, bottom: 720 }])
    expect(holes).toEqual([{ left: 150, top: 0, right: 200, bottom: 20 }])
  })

  it('洞转成 clip-path：外框比盒子大一圈（不剪投影），洞反向缠绕挖空', () => {
    const path = clipPathForHoles(200, 40, [{ left: 150, top: 0, right: 200, bottom: 20 }])
    expect(path).toBe('path(nonzero,"M-24 -24H224V64H-24ZM150 0V20H200V0Z")')
  })

  it('只擦边（不足半像素）不算压住', () => {
    expect(occludedHoles(dock, [{ left: 300.2, top: 700, right: 400, bottom: 740 }])).toEqual([])
  })
})
