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
        selected: false,
        onPointerDown: () => undefined,
        onExpand: () => undefined,
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
    // 「+」圈不在这张卡上（由画布内核里的编组端口节点画，选中才出）：卡上不能再长出旧的连线按钮。
    expect(html).not.toContain('magnetic-handle')
    expect(html).not.toContain('border-nomi-accent')
    expect(html).not.toContain('style="border-color')
    // 没选过色 = 灰：底色是中性灰 soft token 类名，没有任何行内样式。
    expect(html).toContain('bg-nomi-group-neutral-soft')
    expect(html).not.toMatch(/style="[^"]*(color|background)/)
  })

  it('a chosen color tints the card surface with its soft token; no border', () => {
    const html = renderToStaticMarkup(
      React.createElement(CollapsedGroupCard, {
        card: { groupId: 'group-1', name: '雨夜咖啡馆', memberCount: 8, position: { x: 0, y: 0 }, colorToken: 'ocean' },
        readOnly: false,
        selected: false,
        onPointerDown: () => undefined,
        onExpand: () => undefined,
      }),
    )
    expect(html).toContain('bg-nomi-group-ocean-soft')
    expect(html).not.toContain('bg-nomi-group-neutral-soft')
    for (const id of ['neutral', 'teal', 'amber', 'coral', 'violet', 'rose']) expect(html, `no ${id} border`).not.toContain(`border-nomi-group-${id}`)
    expect(html).not.toMatch(/style="[^"]*(color|background)/)
  })
})
