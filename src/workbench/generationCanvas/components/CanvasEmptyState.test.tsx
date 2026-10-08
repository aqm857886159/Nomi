// 空画布：「+ 新建图片」换成一排任务卡，种类 = 左缘工具条常驻那几样（同一张意图表，不新增种类）。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CanvasEmptyState } from './CanvasEmptyState'
import { canvasResidentAddIntents } from './canvasToolbarModel'

vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t: (key: string) => key }) }))

const html = () => renderToStaticMarkup(React.createElement(CanvasEmptyState, { activeCategoryId: 'shots', getInsertionPosition: () => ({ x: 0, y: 0 }) }))

describe('empty canvas task cards', () => {
  it('lists exactly the resident toolbar intents, in toolbar order', () => {
    const out = html()
    const shown = [...out.matchAll(/data-add-intent="([^"]+)"/g)].map((match) => match[1])
    expect(shown).toEqual(canvasResidentAddIntents().map((intent) => intent.id))
  })

  it('ends with a 「更多」 tile that opens the same menu as the toolbar 「+」, and says files can be dropped in', () => {
    const out = html()
    expect(out).toContain('data-canvas-add-more="true"')
    expect(out).toContain('aria-haspopup="menu"')
    expect(out).toContain('generationCommon.canvas.empty.dropHint')
  })

  it('no longer shows the instruction sentence or the single 「+ 新建」 button', () => {
    const out = html()
    expect(out).not.toContain('generationCommon.canvas.empty.description')
    expect(out).not.toContain('generationCommon.canvas.empty.create')
  })
})
