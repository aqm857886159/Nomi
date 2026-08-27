import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CollapsedGroupCard } from './CollapsedGroupCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number; name?: string }) => {
      if (key.endsWith('nodeStackCount')) return `${values?.count} 节点`
      if (key.endsWith('collapsedAria')) return `${values?.name} · ${values?.count} 节点`
      if (key.endsWith('collapsedBadge')) return '编组'
      if (key.endsWith('dragWhole')) return '拖动整体'
      return key
    },
  }),
}))

describe('CollapsedGroupCard', () => {
  it('labels the stack as nodes instead of versions and keeps the cover at the group position', () => {
    const html = renderToStaticMarkup(
      React.createElement(CollapsedGroupCard, {
        card: { groupId: 'group-1', name: '雨夜咖啡馆', memberCount: 8, position: { x: 120, y: 90 } },
        readOnly: false,
        onPointerDown: () => undefined,
        onExpand: () => undefined,
      }),
    )
    expect(html).toContain('data-collapsed-group-id="group-1"')
    expect(html).toContain('translate(120px, 90px)')
    expect(html).toContain('8 节点')
    expect(html.match(/data-card-stack-rear=/g)).toHaveLength(2)
    expect(html).not.toContain('8 版')
  })
})
