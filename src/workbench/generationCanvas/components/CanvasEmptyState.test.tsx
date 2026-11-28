// 空画布：「+ 新建图片」换成一排任务卡，种类 = 左缘工具条常驻那几样（同一张意图表，不新增种类）。
import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CanvasEmptyState } from './CanvasEmptyState'
import { canvasResidentAddIntents, resolveCanvasCreationSurface } from './canvasToolbarModel'

vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t: (key: string) => key }) }))

const html = (readOnly = false) =>
  renderToStaticMarkup(
    React.createElement(CanvasEmptyState, {
      activeCategoryId: 'shots',
      getInsertionPosition: () => ({ x: 0, y: 0 }),
      ...(readOnly ? { readOnly: true } : {}),
    } as React.ComponentProps<typeof CanvasEmptyState>),
  )

describe('empty canvas task cards & toolbar exclusivity', () => {
  it('lists exactly the resident toolbar intents in toolbar order and exposes matching data-node-kind attributes', () => {
    const out = html()
    const intents = canvasResidentAddIntents()
    const shown = [...out.matchAll(/data-add-intent="([^"]+)"/g)].map((match) => match[1])
    expect(shown).toEqual(intents.map((intent) => intent.id))
    const kinds = [...out.matchAll(/data-node-kind="([^"]+)"/g)].map((match) => match[1])
    expect(kinds).toEqual(intents.flatMap((intent) => (intent.kind ? [intent.kind] : [])))
  })

  it('ends with a 「更多」 tile that opens the same menu as the toolbar 「+」, and says files can be dropped in', () => {
    const out = html()
    expect(out).toContain('data-canvas-add-more="true"')
    expect(out).toContain('aria-haspopup="menu"')
    expect(out).toContain('generationCommon.canvas.empty.dropHint')
  })

  it('hides interactive starter tiles and drop hint when canvas is readOnly', () => {
    const out = html(true)
    expect(out).toContain('generationCommon.canvas.empty.title')
    expect(out).not.toContain('data-empty-canvas-tasks="true"')
    expect(out).not.toContain('generationCommon.canvas.empty.dropHint')
  })

  it('enforces strict mutual exclusion between empty-canvas starter tiles and bottom CanvasToolbar', () => {
    expect(resolveCanvasCreationSurface({ readOnly: false, nodeCount: 0 })).toBe('empty-starter')
    expect(resolveCanvasCreationSurface({ readOnly: false, nodeCount: 1 })).toBe('toolbar')
    expect(resolveCanvasCreationSurface({ readOnly: false, nodeCount: 12 })).toBe('toolbar')
    expect(resolveCanvasCreationSurface({ readOnly: true, nodeCount: 0 })).toBe('none')
    expect(resolveCanvasCreationSurface({ readOnly: true, nodeCount: 3 })).toBe('none')

    const stageSource = fs.readFileSync(new URL('../reactFlow/GenerationCanvasReactFlow.tsx', import.meta.url), 'utf8')
    const overlaysSource = fs.readFileSync(new URL('../reactFlow/GenerationCanvasReactFlowOverlays.tsx', import.meta.url), 'utf8')
    expect(stageSource).not.toContain('CanvasToolbar')
    expect(overlaysSource).toContain("resolveCanvasCreationSurface({ readOnly, nodeCount: nodes.length }) === 'toolbar'")
    expect(overlaysSource).toContain('readOnly={readOnly}')
  })

  it('no longer shows the instruction sentence or the single 「+ 新建」 button', () => {
    const out = html()
    expect(out).not.toContain('generationCommon.canvas.empty.description')
    expect(out).not.toContain('generationCommon.canvas.empty.create')
  })
})
