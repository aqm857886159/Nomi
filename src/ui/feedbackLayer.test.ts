import { describe, expect, it } from 'vitest'
import { FEEDBACK_LAYER_Z_INDEX } from './feedbackLayer'
import { FULLSCREEN_Z_INDEX } from '../workbench/generationCanvas/nodes/scene3d/scene3dConstants'

/**
 * z 层结构不变量。2026-07-24 用户实锤：3D 全屏编辑器曾取 int32 最大值，
 * 编辑器打开期间 toast（2000）与全局付费确认卡（3500）全部被压死不可见，
 * 全景图导入被拒时用户看到的是「点了没反应」。
 */
describe('z-layer invariants', () => {
  it('feedback layer (toast) sits above the 3D fullscreen editor', () => {
    expect(FEEDBACK_LAYER_Z_INDEX).toBeGreaterThan(FULLSCREEN_Z_INDEX)
  })

  it('3D fullscreen editor stays below global modal tier (3400+: spend confirm 3500, library panels 4000, lightbox 4200)', () => {
    expect(FULLSCREEN_Z_INDEX).toBeLessThan(3400)
  })

  it('3D fullscreen editor still covers regular workbench UI (≤2000 tier)', () => {
    expect(FULLSCREEN_Z_INDEX).toBeGreaterThan(2000)
  })
})
