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

  // 名字归外壳（2026-11-22）：title 只收一句文字，外壳把它放进 Modal.Title（Mantine 的 aria-labelledby 固定指向它）；
  // 名字之外的东西（图标、副标、封面、链接）走 header 插槽，摆在名字旁边、不进名字元素。挂载后的真名字由 dialogName.browser.test.ts 核。
  const titleElement = (html: string): string => html.match(/<h2[^>]*mantine-Modal-title[^>]*>([\s\S]*?)<\/h2>/)?.[0] ?? ''

  it('名字元素里只有 title 那一句：不带 aria-label、里面没有别的元素', () => {
    const element = titleElement(render({ title: '技能名' }))
    expect(element, '找不到标题元素').not.toBe('')
    expect(element).not.toMatch(/aria-label=/)
    expect(element.replace(/^<h2[^>]*>/, '').replace(/<\/h2>$/, '')).toBe('技能名')
  })

  it('header 插槽：插槽内容在标题栏里、名字元素外，名字元素被插槽原样摆进去', () => {
    const html = render({ title: '技能名', header: (title) => <div data-probe-slot="">{title}<p data-probe-subtitle="">一长段简介</p></div> })
    const element = titleElement(html)
    expect(element.replace(/^<h2[^>]*>/, '').replace(/<\/h2>$/, '')).toBe('技能名')
    expect(element).not.toContain('data-probe-subtitle')
    const header = html.match(/<header[^>]*mantine-Modal-header[\s\S]*?<\/header>/)?.[0] ?? ''
    expect(header, '找不到标题栏').not.toBe('')
    expect(header).toMatch(/data-probe-slot=""><h2[^>]*mantine-Modal-title[^>]*>技能名<\/h2><p data-probe-subtitle="">/)
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
