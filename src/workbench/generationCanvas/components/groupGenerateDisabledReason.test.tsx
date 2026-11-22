// 「生成整组」置灰时说清为什么（设计系统 C1 / C4）：禁用的 <button> 自己不出 title，原因挂在包着它的那一层上。
// 组工具条和框右键菜单都只读调用方给的原因（来自共用主人的分行，见 groupGenerate.groupGenerateDisabledReason），不自己另写。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CanvasGroupToolbar } from './CanvasGroupToolbar'
import FrameContextMenu from './FrameContextMenu'

vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t: (key: string) => key }) }))

const REASON = 'reason-from-owner'
const noop = () => undefined

const toolbar = (canGenerate: boolean) => renderToStaticMarkup(React.createElement(CanvasGroupToolbar, {
  group: { id: 'g', name: 'G', categoryId: 'shots', nodeIds: ['a', 'b'] },
  canvasZoom: 1,
  placement: { side: 'above', offset: 8 },
  horizontal: { frameLeft: 0, frameWidth: 400, offsetX: 0, stageWidth: 1200 },
  memberCount: 2,
  canGenerate,
  generateDisabledReason: canGenerate ? undefined : REASON,
  canSendToTimeline: false,
  canDownload: false,
  onGenerate: noop, onSendToTimeline: noop, onDissolve: noop, onArrange: noop, onColor: noop, onDownload: noop, onEdit: noop, onCollapse: noop, onDelete: noop,
}))

/** 找到「生成整组」那颗按钮，返回包着它的那一层的开标签。 */
function wrapperOfGenerate(html: string): string {
  const button = html.indexOf('aria-label="generationCommon.canvas.group.toolbarGenerate"')
  expect(button, '工具条上有「生成整组」').toBeGreaterThan(-1)
  const open = html.lastIndexOf('<span', button)
  return html.slice(open, html.indexOf('>', open) + 1)
}

describe('greyed-out group generate says why', () => {
  it('toolbar: disabled → the wrapping layer carries the owner reason as title', () => {
    const html = toolbar(false)
    expect(wrapperOfGenerate(html)).toContain(`title="${REASON}"`)
  })

  it('toolbar: enabled → no reason title', () => {
    expect(toolbar(true)).not.toContain(REASON)
  })

  it('frame menu: disabled generate shows the given reason, not the generic sentence', () => {
    const html = renderToStaticMarkup(React.createElement(FrameContextMenu, { frameName: 'G', canGenerate: false, generateDisabledReason: REASON, canSendToTimeline: true, onAction: noop }))
    expect(html).toContain(`title="${REASON}"`)
  })
})
