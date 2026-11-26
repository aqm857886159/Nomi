import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { V4ContextRing } from './AgentPanelV4Context'
import type { ContextUsage } from './agentPanelV4Types'

const labels = { context: 'context', input: 'input', output: 'output', reasoning: 'reasoning', cache: 'cache', threadCost: 'cost', unknown: 'unknown', usedOnly: '{{amount}}' }
const render = (usage: ContextUsage, expanded = false) =>
  renderToStaticMarkup(<V4ContextRing usage={usage} labels={labels} expanded={expanded} />)

describe('V4ContextRing', () => {
  it.each([{}, { max: 200000 }, { input: '0', output: '0', cache: '0', reasoning: labels.unknown, cost: labels.unknown }, { used: 0, max: 200000 }])('omits an empty session %o', (usage) => {
    expect(render(usage)).toBe('')
  })
  it.each([{ used: 1 }, { used: 62400, max: 200000 }, { input: '1' }, { output: '1' }, { reasoning: '1' }, { cache: '1' }, { used: 0, cost: '0.01' }, { cost: 'USD 0.00' }])('shows reported usage %o', (usage) => {
    expect(render(usage)).toContain('data-v4-block="context"')
  })
  it('preserves the explicitly expanded empty state', () => {
    expect(render({}, true)).toContain('<details')
  })
})
