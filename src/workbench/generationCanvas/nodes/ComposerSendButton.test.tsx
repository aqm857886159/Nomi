import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ComposerSendButton } from './ComposerSendButton'
import { COMPOSER_YIELD_NONE, ComposerBarYieldContext, composerYieldLadder, modeHasIcon } from './composerBarYield'

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

describe('ComposerSendButton 花费格（板 ModelSurfaces：cost.send-pill / cost.low-balance）', () => {
  const round = { ariaLabel: '生成', onClick: () => undefined }
  it('有估价：硬币 + 积分数 + ↑ 在同一颗钮里，悬停那句进读屏描述', () => {
    const html = render(<ComposerSendButton {...round} cost={{ text: '19.5', coin: true }} description="预计 19.5 积分" />)
    expect(html).toContain('data-send-cost="credits"')
    expect(html).toMatch(/data-send-cost="credits"[^>]*><svg[^>]*>.*<\/svg>19\.5<\/span><svg/)
    expect(html).toContain('aria-description="预计 19.5 积分"')
  })
  it('余额为 0：钮上换成动作字、不带硬币', () => {
    const html = render(<ComposerSendButton {...round} cost={{ text: '去充值', coin: false }} />)
    expect(html).toContain('data-send-cost="action"')
    expect(html).toContain('>去充值</span>')
  })
  it('算不出 / 忙着：钮上不印数，和没有花费格时逐字相同', () => {
    expect(render(<ComposerSendButton {...round} />)).not.toContain('data-send-cost')
    expect(render(<ComposerSendButton {...round} busy cost={{ text: '19.5', coin: true }} />)).toBe(render(<ComposerSendButton {...round} busy />))
  })
})

describe('composerYieldLadder 让法顺序', () => {
  it('① 生成钮 → ② 摘要整值地减 → ③ 方式格只剩图标 → ④ 模型名最后省略', () => {
    const ladder = composerYieldLadder({ sendCollapsible: true, modeCollapsible: true, summaryCandidates: 3 })
    expect(ladder[0]).toEqual(COMPOSER_YIELD_NONE)
    expect(ladder.slice(1)).toEqual([
      { sendIconOnly: true, modeIconOnly: false, summaryIndex: 0, modelEllipsis: false },
      { sendIconOnly: true, modeIconOnly: false, summaryIndex: 1, modelEllipsis: false },
      { sendIconOnly: true, modeIconOnly: false, summaryIndex: 2, modelEllipsis: false },
      { sendIconOnly: true, modeIconOnly: true, summaryIndex: 2, modelEllipsis: false },
      { sendIconOnly: true, modeIconOnly: true, summaryIndex: 2, modelEllipsis: true },
    ])
    // 模型名永远是最后一步。
    expect(ladder.findIndex((step) => step.modelEllipsis)).toBe(ladder.length - 1)
  })

  it('方式格有图标就收（撞图标也收），没图标保留文字', () => {
    const A = (): null => null
    const B = (): null => null
    const opts = [{ value: 't2v', glyph: <A /> }, { value: 'ref', glyph: <B /> }, { value: 'edit', glyph: <B /> }, { value: 'x' }]
    expect(modeHasIcon(opts, 't2v')).toBe(true)
    expect(modeHasIcon(opts, 'ref')).toBe(true)
    expect(modeHasIcon(opts, 'edit')).toBe(true)
    expect(modeHasIcon(opts, 'x')).toBe(false)
    expect(modeHasIcon(undefined, 't2v')).toBe(false)
  })

  it('没有可收的钮 / 方式格时跳过那一步，顺序不变', () => {
    const ladder = composerYieldLadder({ sendCollapsible: false, modeCollapsible: false, summaryCandidates: 2 })
    expect(ladder.map((step) => [step.sendIconOnly, step.modeIconOnly, step.summaryIndex, step.modelEllipsis])).toEqual([
      [false, false, 0, false], [false, false, 1, false], [false, false, 1, true],
    ])
  })
})
