// 付费确认条的条体（2026-11-15 拆开）：条上只有共同参数 + 说明行，不画镜头；行数据交给对话里那一组（GenerationReceiptPointers）。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { AgentPanelV4SpendCardBody, type SpendCardBodyProps } from './AgentPanelV4SpendCardBody'
import { createSpendOfferRowsStore, SpendOfferRowsContext } from './spendCardOfferRows'
import { createReactTestRenderer } from './testReactRenderer'

const pointers = Array.from({ length: 12 }, (_, index) => ({
  shotId: `shot-${index}`, nodeId: `node-${index}`, shotRef: `镜 ${index + 1}`, removed: false, exclusion: 'exclude' as const,
}))

const props = (overrides: Partial<SpendCardBodyProps> = {}): SpendCardBodyProps => ({
  operationId: 'op-1', pointers, summary: 'Seedance 2.0 Fast · 16:9 · 480p', notices: [], busy: false,
  onExclude: vi.fn(), onRestore: vi.fn(), ...overrides,
})

describe('AgentPanelV4SpendCardBody', () => {
  it('draws the common params line and no pointer at all — the shots live in the chat', () => {
    const html = renderToStaticMarkup(<AgentPanelV4SpendCardBody {...props()} />)
    expect(html).toContain('data-v4-block="spend-params"')
    expect(html).toContain('Seedance 2.0 Fast · 16:9 · 480p')
    expect(html).not.toContain('data-node-pointer')
    expect(html).not.toContain('data-spend-exclusion')
  })

  it('3 shots and 12 shots draw the same markup: nothing on the bar grows with the shot count', () => {
    const three = renderToStaticMarkup(<AgentPanelV4SpendCardBody {...props({ pointers: pointers.slice(0, 3) })} />)
    const twelve = renderToStaticMarkup(<AgentPanelV4SpendCardBody {...props()} />)
    expect(three).toBe(twelve)
  })

  it('while sending (no params, no notice) it draws nothing, so the bar is one line', () => {
    expect(renderToStaticMarkup(<AgentPanelV4SpendCardBody {...props({ summary: undefined })} />)).toBe('')
  })

  it('hands the rows to the panel store while mounted, and takes them back on unmount', () => {
    const store = createSpendOfferRowsStore()
    const renderer = createReactTestRenderer({})
    renderer.render(
      <SpendOfferRowsContext.Provider value={store}>
        <AgentPanelV4SpendCardBody {...props()} />
      </SpendOfferRowsContext.Provider>,
    )
    renderer.flushPassiveEffects()
    expect(store.getState().offer?.operationId).toBe('op-1')
    expect(store.getState().offer?.pointers).toHaveLength(12)
    renderer.render(<SpendOfferRowsContext.Provider value={store}>{null}</SpendOfferRowsContext.Provider>)
    renderer.flushPassiveEffects()
    expect(store.getState().offer).toBeNull()
    renderer.close()
  })
})
