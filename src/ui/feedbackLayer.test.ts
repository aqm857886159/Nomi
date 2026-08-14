import { describe, expect, it } from 'vitest'
import { FEEDBACK_LAYER_Z_INDEX } from './feedbackLayer'
import { FULLSCREEN_Z_INDEX } from '../workbench/generationCanvas/nodes/scene3d/scene3dConstants'
import { NOMI_OVERLAY_Z_INDEX } from '../design/overlayLayers'
import { buildNomiTheme } from '../theme/nomiTheme'

type LayerDefaults = {
  zIndex?: number
  comboboxProps?: { zIndex?: number }
}

function componentDefaults(name: string): LayerDefaults {
  const theme = buildNomiTheme()
  const component = theme.components?.[name] as { defaultProps?: LayerDefaults } | undefined
  return component?.defaultProps ?? {}
}

/**
 * z 层结构不变量。2026-07-24 用户实锤：3D 全屏编辑器曾取 int32 最大值，
 * 编辑器打开期间 toast（2000）与全局付费确认卡（3500）全部被压死不可见，
 * 全景图导入被拒时用户看到的是「点了没反应」。
 */
describe('z-layer invariants', () => {
  it('feedback layer (toast) sits above the 3D fullscreen editor', () => {
    expect(FEEDBACK_LAYER_Z_INDEX).toBeGreaterThan(FULLSCREEN_Z_INDEX)
  })

  it('orders every body Portal tier from persistent panel through final feedback', () => {
    expect(NOMI_OVERLAY_Z_INDEX.floatingPanel).toBeLessThan(NOMI_OVERLAY_Z_INDEX.applicationModal)
    expect(NOMI_OVERLAY_Z_INDEX.applicationModal).toBeLessThan(NOMI_OVERLAY_Z_INDEX.dialog)
    expect(NOMI_OVERLAY_Z_INDEX.dialog).toBeLessThan(NOMI_OVERLAY_Z_INDEX.popover)
    expect(NOMI_OVERLAY_Z_INDEX.popover).toBeLessThan(NOMI_OVERLAY_Z_INDEX.confirmation)
    expect(NOMI_OVERLAY_Z_INDEX.confirmation).toBeLessThan(NOMI_OVERLAY_Z_INDEX.feedback)
    expect(FEEDBACK_LAYER_Z_INDEX).toBe(NOMI_OVERLAY_Z_INDEX.feedback)
  })

  it('3D fullscreen editor stays below global Portal surfaces', () => {
    expect(FULLSCREEN_Z_INDEX).toBeLessThan(NOMI_OVERLAY_Z_INDEX.floatingPanel)
  })

  it('wires Mantine dialogs and dropdowns to the shared Portal tiers', () => {
    expect(componentDefaults('Modal').zIndex).toBe(NOMI_OVERLAY_Z_INDEX.dialog)
    expect(componentDefaults('Drawer').zIndex).toBe(NOMI_OVERLAY_Z_INDEX.dialog)
    expect(componentDefaults('Popover').zIndex).toBe(NOMI_OVERLAY_Z_INDEX.popover)
    expect(componentDefaults('Menu').zIndex).toBe(NOMI_OVERLAY_Z_INDEX.popover)
    expect(componentDefaults('Select').comboboxProps?.zIndex).toBe(NOMI_OVERLAY_Z_INDEX.popover)
    expect(componentDefaults('MultiSelect').comboboxProps?.zIndex).toBe(NOMI_OVERLAY_Z_INDEX.popover)
  })

  it('3D fullscreen editor still covers regular workbench UI (≤2000 tier)', () => {
    expect(FULLSCREEN_Z_INDEX).toBeGreaterThan(2000)
  })
})
