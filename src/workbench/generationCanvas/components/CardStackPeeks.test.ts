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

  it('keeps the group corner above the centered connection hit area', () => {
    const html = renderToStaticMarkup(
      React.createElement(CardStackPeeks, { count: 3, label: '3 节点', expanded: false, tone: 'group', onToggle: () => undefined }),
    )
    expect(html).toContain('top-0')
    expect(html).not.toContain('top-4')
    expect(html).not.toContain('nomi-accent')
  })

  // 2026-09-10 反馈 #11：视频节点后面那摞空白伪卡被读成「图片占位 = 生成几个」。
  it('marks the rear stack with the media it belongs to, on the outermost card only', () => {
    const html = renderToStaticMarkup(
      React.createElement(CardStackPeeks, {
        count: 4,
        label: '4 版',
        expanded: false,
        onToggle: () => undefined,
        mediaKind: 'video',
        mediaGlyph: React.createElement('svg', { 'data-test-glyph': 'video' }),
      }),
    )
    expect(html).toContain('data-card-stack-media="video"')
    expect(html.match(/data-card-stack-glyph/g)).toHaveLength(1)
    expect(html).toContain('data-test-glyph="video"')
  })

  it('keeps the plain appearance when the caller declares no media, so group stacks are unchanged', () => {
    const html = renderToStaticMarkup(
      React.createElement(CardStackPeeks, { count: 4, label: '4 节点', expanded: false, tone: 'group', onToggle: () => undefined }),
    )
    expect(html).not.toContain('data-card-stack-glyph')
    expect(html).not.toContain('data-card-stack-media')
  })
})
