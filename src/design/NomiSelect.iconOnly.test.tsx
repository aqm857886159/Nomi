import React from 'react'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NomiSelect, type NomiSelectProps } from './NomiSelect'

/**
 * triggerIconOnly（2026-11-14 协调批准的唯一新属性）：底栏窄时方式格只剩图标。
 * ① 不传时触发器和今天逐字相同；② 选中项没有图标时照旧画字（不出空触发器）；
 * ③ 收起时全名走设计系统的提示和读屏描述，不靠原生 title。
 */
const glyph = <svg data-probe-glyph="" />
const base: NomiSelectProps = {
  value: 'i2v',
  onChange: () => undefined,
  ariaLabel: '方式',
  options: [
    { value: 't2v', label: '文生视频', glyph },
    { value: 'i2v', label: '首帧生视频', glyph },
  ],
}
const render = (props: Partial<NomiSelectProps> = {}): string => renderToStaticMarkup(
  <MantineProvider env="test"><NomiSelect {...base} {...props} /></MantineProvider>,
)
const trigger = (html: string): string => html.match(/<button[^>]*aria-label="方式"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? ''

describe('NomiSelect triggerIconOnly', () => {
  it('不传 = 传 false：DOM 逐字相同；触发器带全名字样和原生 title', () => {
    const html = render()
    expect(render({ triggerIconOnly: false })).toBe(html)
    expect(trigger(html)).toContain('>首帧生视频</span>')
    expect(trigger(html)).toContain('title="首帧生视频"')
    expect(trigger(html)).not.toContain('aria-description')
    expect(trigger(html)).not.toContain('data-state')
  })

  it('为 true 且选中项有图标：不画字，全名进读屏描述和提示（Radix 触发器），不留原生 title', () => {
    const button = trigger(render({ triggerIconOnly: true }))
    expect(button).toContain('data-probe-glyph')
    expect(button).not.toContain('首帧生视频</span>')
    expect(button).not.toContain('title=')
    expect(button).toContain('aria-description="首帧生视频"')
    expect(button).toContain('aria-label="方式"')
    expect(button).toContain('data-state="closed"')
  })

  it('为 true 但选中项没有图标：照旧画字，和不收时逐字相同', () => {
    const plain = { options: [{ value: 't2v', label: '文生视频' }, { value: 'i2v', label: '首帧生视频' }] }
    expect(render({ ...plain, triggerIconOnly: true })).toBe(render(plain))
  })
})
