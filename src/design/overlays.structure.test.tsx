import React from 'react'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DesignModal, type DesignModalProps } from './overlays'

// 设计系统 §3.5「弹窗的高度与滚动」：标题栏和决定栏不滚，中间内容区自己滚；决定栏在任何窗口尺寸下都完整可见。
// 这里守外壳的结构：决定栏是中间滚动区的兄弟（不在滚动区里），三段是一列、只有中间那段会缩会滚。
const render = (props: Partial<DesignModalProps> = {}): string => renderToStaticMarkup(
  <MantineProvider env="test">
    <DesignModal opened onClose={() => undefined} title="title" {...props}>
      <p data-probe-body="">body</p>
    </DesignModal>
  </MantineProvider>,
)

const classTokens = (html: string, marker: string): string[] => {
  const match = html.match(new RegExp(`<[a-z]+[^>]*${marker}[^>]*>`))
  expect(match, `找不到 ${marker}`).not.toBeNull()
  return (match![0].match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/)
}

describe('DesignModal 外壳：高度与滚动归属（§3.5）', () => {
  it('决定栏住在中间滚动区之外，紧跟在它后面', () => {
    const html = render({ actions: <button type="button" data-probe-primary="">ok</button> })
    expect(html).toMatch(/<p data-probe-body="">body<\/p><\/div><div data-design-modal-actions="[^"]*"/)
    expect(html.indexOf('data-probe-primary')).toBeGreaterThan(html.indexOf('data-design-modal-actions'))
  })

  it('不传决定栏就没有决定栏那一行', () => {
    expect(render()).not.toContain('data-design-modal-actions')
  })

  it('三段是一列：整块不滚，中间那段会缩、自己滚，决定栏不缩', () => {
    const html = render({ actions: <button type="button">ok</button> })
    expect(classTokens(html, 'data-design-modal-scroll')).toEqual(expect.arrayContaining(['min-h-0', 'flex-1', 'overflow-y-auto']))
    expect(classTokens(html, 'data-design-modal-actions')).toContain('shrink-0')
    expect(classTokens(html, 'mantine-Modal-content')).toEqual(expect.arrayContaining(['flex', 'flex-col', 'overflow-hidden']))
    expect(classTokens(html, 'mantine-Modal-body')).toEqual(expect.arrayContaining(['flex', 'flex-col', 'min-h-0', 'flex-1', 'overflow-hidden']))
  })

  it('默认中间区不成列（内容里自带滚动的段落保持原高）；innerScroll 才成列、把高度分给内容', () => {
    const block = classTokens(render(), 'data-design-modal-scroll')
    expect(block).not.toContain('flex-col')
    expect(render()).toContain('data-design-modal-scroll="block"')
    const inner = render({ innerScroll: true })
    expect(classTokens(inner, 'data-design-modal-scroll')).toEqual(expect.arrayContaining(['flex', 'flex-col', 'min-h-0', 'overflow-y-auto']))
    expect(inner).toContain('data-design-modal-scroll="inner"')
  })
})
