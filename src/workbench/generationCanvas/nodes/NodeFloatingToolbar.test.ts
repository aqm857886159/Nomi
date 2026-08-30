import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ToolbarDuplicateVariantButton } from './NodeFloatingToolbar'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: () => '复制为新变体' }),
}))

describe('ToolbarDuplicateVariantButton', () => {
  it('exposes the shared duplicate-as-variant action as one toolbar button', () => {
    const html = renderToStaticMarkup(React.createElement(ToolbarDuplicateVariantButton, { nodeId: 'shot-1' }))
    expect(html).toContain('<button')
    expect(html).toContain('aria-label="复制为新变体"')
    expect(html).toContain('title="复制为新变体"')
    expect(html.match(/<button/g)).toHaveLength(1)
  })
})
