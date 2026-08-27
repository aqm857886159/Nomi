import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CardStackPeeks } from './CardStackPeeks'

describe('CardStackPeeks', () => {
  it('renders two right-side rear cards and the real version count', () => {
    const html = renderToStaticMarkup(
      React.createElement(CardStackPeeks, { count: 12, label: '12 版', expanded: false, onToggle: () => undefined }),
    )
    expect(html.match(/data-card-stack-rear=/g)).toHaveLength(2)
    expect(html).toContain('data-card-stack-side="right"')
    expect(html).toContain('12 版')
  })

  it('does not render a rear card for a single entry', () => {
    const html = renderToStaticMarkup(
      React.createElement(CardStackPeeks, { count: 1, label: '1 版', expanded: false, onToggle: () => undefined, forceTrigger: true }),
    )
    expect(html).not.toContain('data-card-stack-rear=')
    expect(html).toContain('1 版')
  })

  it('omits the whole control when there is nothing behind the cover', () => {
    const html = renderToStaticMarkup(
      React.createElement(CardStackPeeks, { count: 1, label: '1 版', expanded: false, onToggle: () => undefined }),
    )
    expect(html).toBe('')
  })
})
