import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CollapsedGroupCard } from './CollapsedGroupCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number; name?: string }) => {
      if (key.endsWith('nodeStackCount')) return `${values?.count} 节点`
      if (key.endsWith('collapsedAria')) return `${values?.name} · ${values?.count} 节点`
      if (key.endsWith('dragWhole')) return '拖动整体'
      if (key.endsWith('connectInput')) return '连接到整组'
      if (key.endsWith('connectOutput')) return '从整组连接'
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
        pendingConnection: false,
        pendingConnectionSource: false,
        onPointerDown: () => undefined,
        onExpand: () => undefined,
        onStartConnection: () => undefined,
        onCompleteConnection: () => undefined,
      }),
    )
    expect(html).toContain('data-collapsed-group-id="group-1"')
    expect(html).toContain('data-group-id="group-1"')
    expect(html).toContain('translate(120px, 90px)')
    expect(html).toContain('8 节点')
    expect(html.match(/data-card-stack-rear=/g)).toHaveLength(2)
    expect(html).not.toContain('8 版')
    // 折叠卡上只留框标题与计数：「编组」是我们自己的词汇，用户看的是他给这个框起的名字
    // （2026-09-07 用户指出）。这条断言防的是「顺手把徽标加回来」。
    expect(html).not.toContain('编组')
    expect(html).toContain('aria-label="连接到整组"')
    expect(html).toContain('aria-label="从整组连接"')
    expect(html).not.toContain('border-nomi-accent')
    expect(html).not.toContain('style="border-color')
  })
})
