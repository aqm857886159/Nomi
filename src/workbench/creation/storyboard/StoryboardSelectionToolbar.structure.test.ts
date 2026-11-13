import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import StoryboardSelectionToolbar from './StoryboardSelectionToolbar'
it('selection only offers clear, Agent handoff and deletion', () => {
  const html = renderToStaticMarkup(createElement(StoryboardSelectionToolbar, { selectedCount: 3, onClear() {}, onAgentHandoff() {}, onDelete() {} }))
  expect(html.match(/<button/g)).toHaveLength(3)
  expect(html).not.toContain('combobox')
})
