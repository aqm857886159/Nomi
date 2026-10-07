import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DerivedReadyBadge } from './DerivedReadyBadge'
import { isDerivedPromptReady, QUICK_ACTION_META_KEY } from './deriveFromNode'

vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t: (key: string) => key }) }))

const derived = (over: Record<string, unknown> = {}) => ({
  status: 'idle' as const,
  meta: { [QUICK_ACTION_META_KEY]: { id: 'multi-angle-grid', sourceNodeId: 's', promptReady: true } },
  ...over,
}) as never
const html = (node: never) => renderToStaticMarkup(React.createElement(DerivedReadyBadge, { node }))

describe('「已备好 · 未生成」小标', () => {
  it('派生出来、提示词已填好、没跑过：显示（success-soft 底 + success-edge 边）', () => {
    const out = html(derived())
    expect(out).toContain('derivedReadyBadge')
    expect(out).toContain('bg-nomi-success-soft')
    expect(out).toContain('border-nomi-success-edge')
  })

  it('点 ↑ 之后（生成中 / 有运行记录 / 有结果 / 失败）不再显示', () => {
    for (const over of [{ status: 'running' }, { runs: [{ id: 'r' }] }, { result: { id: 'x', type: 'image', url: 'u', createdAt: 1 } }, { status: 'error' }]) {
      expect(html(derived(over)), JSON.stringify(over)).toBe('')
      expect(isDerivedPromptReady(derived(over))).toBe(false)
    }
  })

  it('「+」新建的空节点（没有派生标记）、没带模板的派生（高清）都不显示', () => {
    expect(html({ status: 'idle', meta: {} } as never)).toBe('')
    expect(html(derived({ meta: { [QUICK_ACTION_META_KEY]: { id: 'upscale', sourceNodeId: 's' } } }))).toBe('')
    // 只有提示词、没有派生标记：不靠「提示词非空」猜。
    expect(html({ status: 'idle', prompt: 'something', meta: {} } as never)).toBe('')
  })
})
