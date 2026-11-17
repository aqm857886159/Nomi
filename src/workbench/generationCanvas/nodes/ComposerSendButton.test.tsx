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
  it('平常：浅灰胶囊里硬币 + 积分数，右端还是黑圆 ↑；整颗一个钮，悬停那句进读屏描述，不再挂原生 title', () => {
    const html = render(<ComposerSendButton {...round} title="生成" cost={{ kind: 'credits', text: '19.5' }} description="这次约 19.5 积分" />)
    expect(html).toContain('data-send-cost="credits"')
    expect(html).toMatch(/<button[^>]*bg-nomi-ink-10[^>]*>.*data-send-cost="credits"[^>]*><svg[^>]*>.*<\/svg>19\.5<\/span><span[^>]*bg-nomi-ink[^>]*><svg/)
    expect(html).toContain('aria-description="这次约 19.5 积分"')
    expect(html).not.toContain('title="生成"')
    expect(html.match(/<button/g)).toHaveLength(1)
    // 最挤态也不折行：数字那一段不换行、胶囊不缩。
    expect(html).toMatch(/data-send-cost="credits" class="[^"]*whitespace-nowrap/)
    expect(html).toMatch(/<button[^>]*class="[^"]*shrink-0[^"]*"[^>]*data-bar-segment="generate"|<button[^>]*data-bar-segment="generate"[^>]*class="[^"]*shrink-0/)
  })
  it('余额不够：发送键的位置换成「还差 N 积分」+「去充值」，同一格、没有发送键', () => {
    const html = render(<ComposerSendButton {...round} title="生成" cost={{ kind: 'shortfall', text: '还差 7.6 积分', actionLabel: '去充值', onAction: () => undefined }} />)
    expect(html).toContain('data-send-cost="shortfall"')
    expect(html).toMatch(/whitespace-nowrap text-caption text-nomi-warning-ink/)
    // 高度与圆钮相同（30px），换态时底栏不跳；真窗口里走查量底栏高度相等。
    expect(html).toMatch(/data-send-cost="shortfall" class="[^"]*h-\[30px\]/)
    // 同一行：横排、居中对齐，不许竖排成两行。
    const cls = html.match(/data-send-cost="shortfall" class="([^"]*)"/)?.[1].split(' ') ?? []
    expect(cls).toEqual(expect.arrayContaining(['inline-flex', 'items-center']))
    expect(cls.some(name => /^(flex-col|flex-wrap|grid|block)/.test(name))).toBe(false)
    expect(html).toMatch(/还差 7\.6 积分<\/span><button[^>]*>去充值<svg/)
    expect(html).not.toContain('aria-label="生成"')
    expect(html.match(/<button/g)).toHaveLength(1)
  })
  it('余额不够这一格不在让法里：底栏让到哪一步，「还差 N 积分」和「去充值」都原样、不收不缩', () => {
    const cost = { kind: 'shortfall', text: '还差 7.6 积分', actionLabel: '去充值', onAction: () => undefined } as const
    const crowded = render(<ComposerSendButton {...round} cost={cost} />, true)
    expect(crowded).toBe(render(<ComposerSendButton {...round} cost={cost} />, false))
    expect(crowded).toMatch(/data-send-cost="shortfall" class="[^"]*shrink-0/)
    expect(crowded).toMatch(/还差 7\.6 积分<\/span><button[^>]*>去充值<svg/)
  })
  it('算不出 / 忙着：钮上不印数，和没有花费格时逐字相同', () => {
    expect(render(<ComposerSendButton {...round} />)).not.toContain('data-send-cost')
    expect(render(<ComposerSendButton {...round} busy cost={{ kind: 'credits', text: '19.5' }} />)).toBe(render(<ComposerSendButton {...round} busy />))
    expect(render(<ComposerSendButton {...round} busy cost={{ kind: 'shortfall', text: 'x', actionLabel: 'y', onAction: () => undefined }} />)).toBe(render(<ComposerSendButton {...round} busy />))
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
