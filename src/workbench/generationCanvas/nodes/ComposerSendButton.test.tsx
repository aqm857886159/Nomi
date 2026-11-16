import fs from 'node:fs'
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

describe('ComposerSendButton 约价（板 ModelSurfaces：cost.send-pill / cost.hover）', () => {
  const round = { ariaLabel: '生成这一格', onClick: () => undefined }
  const priced = { credits: '19.5', description: '这次约 19.5 积分（$1.95）。' }
  /** 去掉标签后剩下的字：键面上创作者读得到的全部文字。 */
  const visibleText = (html: string): string => html.replace(/<[^>]*>/g, '')
  const svgClasses = (html: string): string[] => [...html.matchAll(/<svg[^>]*class="([^"]*)"/g)].map(m => m[1])

  it('有价：一颗钮里只有硬币图标、积分数、↑；悬停那一句进读屏描述，不再挂原生 title', () => {
    const html = render(<ComposerSendButton {...round} title="生成" cost={priced} />)
    expect(html.match(/<button/g)).toHaveLength(1)
    // 键面上的字只有积分数——多塞任何一段文字（另起一行、加个说明）都在这里红。
    expect(visibleText(html)).toBe('19.5')
    // 图标恰好两枚：先硬币、后 ↑。换成别的图标或多加一枚都红。
    const icons = svgClasses(html)
    expect(icons).toHaveLength(2)
    expect(icons[0]).toMatch(/\btabler-icon-coin\b/)
    expect(icons[1]).toMatch(/\btabler-icon-arrow-up\b/)
    expect(html).toMatch(/data-send-cost="credits"[^>]*><svg[^>]*tabler-icon-coin[^>]*>.*<\/svg>19\.5<\/span>/)
    expect(html).toContain('aria-description="这次约 19.5 积分（$1.95）。"')
    expect(html).not.toContain('title="生成"')
    // 最挤态也不折行：数字那一段不换行、胶囊不缩。
    expect(html).toMatch(/data-send-cost="credits" class="[^"]*whitespace-nowrap/)
    expect(html).toMatch(/<button[^>]*class="[^"]*shrink-0[^"]*"/)
  })

  it('禁用 + 有价：钮是禁用的，数字仍在（不拿忙态顶替）', () => {
    const html = render(<ComposerSendButton {...round} title="缺首帧时的提示" disabled cost={priced} />)
    expect(html).toMatch(/<button[^>]*disabled=""/)
    expect(html).not.toContain('aria-busy="true"')
    expect(visibleText(html)).toBe('19.5')
    expect(svgClasses(html)[0]).toMatch(/\btabler-icon-coin\b/)
  })

  it('估不出：钮上只剩 ↑，不印数、不印 0、不印横杠；悬停那一句仍在', () => {
    const html = render(<ComposerSendButton {...round} cost={{ description: '估不出时的那一句' }} />)
    expect(html).not.toContain('data-send-cost=')
    expect(visibleText(html)).toBe('')
    expect(svgClasses(html)).toHaveLength(1)
    expect(svgClasses(html)[0]).toMatch(/\btabler-icon-arrow-up\b/)
    expect(html).toContain('aria-description="估不出时的那一句"')
    expect(html).toContain('data-send-cost-trigger=""')
  })

  it('忙着 / 不传：和没有约价时逐字相同；带字钮（分镜行、镜头条）传了也不接', () => {
    expect(render(<ComposerSendButton {...round} busy cost={priced} />)).toBe(render(<ComposerSendButton {...round} busy />))
    expect(render(<ComposerSendButton {...round} busy title="生成中…" cost={priced} />)).toBe(render(<ComposerSendButton {...round} busy title="生成中…" />))
    expect(render(<ComposerSendButton {...round} />)).not.toContain('data-send-cost')
    for (const yieldIcon of [undefined, true]) {
      expect(render(<ComposerSendButton {...props} cost={priced} />, yieldIcon)).toBe(render(<ComposerSendButton {...props} />, yieldIcon))
      expect(render(<ComposerSendButton {...props} busy cost={priced} />, yieldIcon)).toBe(render(<ComposerSendButton {...props} busy />, yieldIcon))
    }
  })

  it('悬停那一句用共用提示组件原样画：不自带定位、边框、圆角', () => {
    const source = fs.readFileSync(new URL('./ComposerSendButton.tsx', import.meta.url), 'utf8')
    const tag = source.match(/<TooltipContent[^>]*data-send-cost-hover[^>]*>/)?.[0]
    expect(tag).toBeTruthy()
    expect(tag).not.toMatch(/\b(side|align|sideOffset|alignOffset|style)=/)
    const className = tag!.match(/className="([^"]*)"/)?.[1] ?? ''
    expect(className.split(/\s+/).filter(c => /^(rounded|border|shadow|top-|left-|right-|bottom-|m[trblxy]?-|-m|translate|absolute|fixed|bg-|text-nomi)/.test(c))).toEqual([])
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
