import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ComposerSendButton } from './ComposerSendButton'
import { COMPOSER_YIELD_NONE, ComposerBarYieldContext, composerYieldLadder } from './composerBarYield'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

/**
 * 生成钮的第①步让法（2026-11-14 协调约束）：
 * 1) context 默认 = 不收：底栏外的用法（没有 provider）渲染和今天逐字相同；
 * 2) 只有收成「↑」时才有提示，提示写钮上原来的字，读屏名不变；
 * 3) 让到第几步只由 InlineParameterBar 经 context 发来，钮自己不量宽。
 */
const props = { label: '生成', ariaLabel: '生成第 3 镜', onClick: () => undefined }
const render = (node: React.ReactElement, sendIconOnly?: boolean): string => renderToStaticMarkup(
  sendIconOnly === undefined ? node : <ComposerBarYieldContext.Provider value={{ sendIconOnly }}>{node}</ComposerBarYieldContext.Provider>,
)

describe('ComposerSendButton 让法', () => {
  it('没有 provider = provider 给「不收」：带字钮、圆钮、忙态都逐字相同，且不带提示触发器', () => {
    for (const node of [
      <ComposerSendButton key="a" {...props} />,
      <ComposerSendButton key="b" {...props} busy />,
      <ComposerSendButton key="c" ariaLabel="生成" onClick={() => undefined} />,
      <ComposerSendButton key="d" {...props} title="缺提示词" disabled />,
    ]) {
      const html = render(node)
      expect(render(node, false)).toBe(html)
      expect(html).not.toContain('data-state')
    }
    expect(render(<ComposerSendButton {...props} />)).toContain('>生成<svg')
  })

  it('收成「↑」：钮上没有字，读屏名不变，提示写「生成」（不是读屏名）', () => {
    const html = render(<ComposerSendButton {...props} />, true)
    expect(html).toContain('aria-label="生成第 3 镜"')
    expect(html).not.toMatch(/>生成</)
    expect(html).toContain('data-icon-only=""')
    expect(html).toContain('data-state="closed"')
  })

  it('圆钮（画布，不带字）没有可收的字：收不收都一样', () => {
    const node = <ComposerSendButton ariaLabel="生成" onClick={() => undefined} />
    expect(render(node, true)).toBe(render(node))
  })
})

describe('composerYieldLadder 让法顺序', () => {
  it('① 生成钮 → ② 方式格 → ③ 摘要整值地减 → ④ 模型名最后省略', () => {
    const ladder = composerYieldLadder({ sendCollapsible: true, modeCollapsible: true, summaryCandidates: 3 })
    expect(ladder[0]).toEqual(COMPOSER_YIELD_NONE)
    expect(ladder.slice(1)).toEqual([
      { sendIconOnly: true, modeIconOnly: false, summaryIndex: 0, modelEllipsis: false },
      { sendIconOnly: true, modeIconOnly: true, summaryIndex: 0, modelEllipsis: false },
      { sendIconOnly: true, modeIconOnly: true, summaryIndex: 1, modelEllipsis: false },
      { sendIconOnly: true, modeIconOnly: true, summaryIndex: 2, modelEllipsis: false },
      { sendIconOnly: true, modeIconOnly: true, summaryIndex: 2, modelEllipsis: true },
    ])
  })

  it('没有可收的钮 / 方式格时跳过那一步，顺序不变', () => {
    const ladder = composerYieldLadder({ sendCollapsible: false, modeCollapsible: false, summaryCandidates: 2 })
    expect(ladder.map((step) => [step.sendIconOnly, step.modeIconOnly, step.summaryIndex, step.modelEllipsis])).toEqual([
      [false, false, 0, false], [false, false, 1, false], [false, false, 1, true],
    ])
  })
})
