import { describe, expect, it } from 'vitest'
import { EDITING_PANEL_RAIL_WIDTH, editingPanelResizeEffect } from './panelLayout'

describe('editingPanelResizeEffect — 「收起」只有 visibility 一份真相', () => {
  it('把展开的左栏 / 属性栏拖成收起条：写回 visibility=false（此前被丢掉，内容挤进 32px）', () => {
    expect(editingPanelResizeEffect('sourceWidth', EDITING_PANEL_RAIL_WIDTH, true)).toEqual({ kind: 'visibility', panel: 'source', visible: false })
    expect(editingPanelResizeEffect('inspectorWidth', EDITING_PANEL_RAIL_WIDTH, true)).toEqual({ kind: 'visibility', panel: 'inspector', visible: false })
  })

  it('从收起条拖开：写回 visibility=true', () => {
    expect(editingPanelResizeEffect('sourceWidth', 260, false)).toEqual({ kind: 'visibility', panel: 'source', visible: true })
  })

  it('普通拖宽只镜像像素；收起态量到的 rail 宽不写回', () => {
    expect(editingPanelResizeEffect('sourceWidth', 287.6, true)).toEqual({ kind: 'size', size: 288 })
    expect(editingPanelResizeEffect('sourceWidth', EDITING_PANEL_RAIL_WIDTH, false)).toBeNull()
    expect(editingPanelResizeEffect('timelineHeight', 200, true)).toEqual({ kind: 'size', size: 200 })
  })
})
