import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ComposerSendButton } from './ComposerSendButton'
import { COMPOSER_YIELD_NONE, ComposerBarYieldContext, composerYieldPick, modeHasIcon, type ComposerYieldStep } from './composerBarYield'

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

/**
 * 一只底栏的宽（量具替身）：模型和固定件 100，方式名 +76.5，摘要「5s」50.8 →「720p · 5s」+40.3 →「16:9 · 720p · 5s」+36.5，
 * 钮上的字 +31.9。数取自 2026-11-21 方向复盘的真窗口 / 实验室量数。`slack` = 全收之后还剩多宽。
 */
const SUMMARY = [50.8 + 40.3 + 36.5, 50.8 + 40.3, 50.8]
const barWidth = (step: ComposerYieldStep): number => 100 + (step.modeIconOnly ? 0 : 76.5) + SUMMARY[step.summaryIndex] + (step.sendIconOnly ? 0 : 31.9)
const pick = (slack: number, { send = true, mode = true }: { send?: boolean; mode?: boolean } = {}): ComposerYieldStep => composerYieldPick({
  sendCollapsible: send, modeCollapsible: mode, summaryCandidates: 3,
  fits: (step) => barWidth(step) <= barWidth({ sendIconOnly: send, modeIconOnly: mode, summaryIndex: 2, modelEllipsis: false }) + slack,
})

describe('composerYieldPick 重要性清单（模型名 > 方式名 > 摘要从后往前的值 > 钮上的字）', () => {
  it('英文带价默认宽：方式名差 3px 放不下就跳过，摘要「720p · 5s」放得回就放回', () => {
    expect(pick(73.5, { send: false })).toEqual({ sendIconOnly: false, modeIconOnly: true, summaryIndex: 1, modelEllipsis: false })
  })

  it('中文带价默认宽：方式名放下后剩 21.5px，放不下一个整值就留白，不拿方式名去换「720p」', () => {
    const zhMode = 51.9
    const step = composerYieldPick({
      sendCollapsible: false, modeCollapsible: true, summaryCandidates: 3,
      fits: (s) => (s.modeIconOnly ? 0 : zhMode) + SUMMARY[s.summaryIndex] <= SUMMARY[2] + zhMode + 21.5,
    })
    expect(step).toEqual({ sendIconOnly: false, modeIconOnly: false, summaryIndex: 2, modelEllipsis: false })
  })

  it('要紧的先放：两件各自放得下、合起来放不下时，留更要紧的那件', () => {
    // 方式名 76.5 和「720p」40.3 各自都放得下 80，一起放不下：留方式名。
    expect(pick(80, { send: false })).toMatchObject({ modeIconOnly: false, summaryIndex: 2 })
    // 「720p」40.3 和钮上的字 31.9 各自都放得下 45，一起放不下：留摘要的值。
    expect(pick(45, { mode: false })).toMatchObject({ summaryIndex: 1, sendIconOnly: true })
  })

  it('放回以后，每件还缩着的东西放回要的宽都大于剩下的空位（G6 的同一条，逐宽扫）', () => {
    const costs = (step: ComposerYieldStep): number[] => [
      step.modeIconOnly ? 76.5 : Infinity,
      step.summaryIndex > 0 ? SUMMARY[step.summaryIndex - 1] - SUMMARY[step.summaryIndex] : Infinity,
      step.sendIconOnly ? 31.9 : Infinity,
    ]
    const minimal = barWidth({ sendIconOnly: true, modeIconOnly: true, summaryIndex: 2, modelEllipsis: false })
    for (let slack = 0; slack <= 200; slack += 0.5) {
      const step = pick(slack)
      const left = minimal + slack - barWidth(step)
      expect(left).toBeGreaterThanOrEqual(-0.001)
      for (const need of costs(step)) expect(need).toBeGreaterThan(left)
    }
  })

  it('全放得下 = 什么都不让；模型名都放不下 = 全收、模型名省略（终点，后面的一样都不放）', () => {
    expect(pick(1000)).toEqual(COMPOSER_YIELD_NONE)
    const cramped = composerYieldPick({ sendCollapsible: true, modeCollapsible: true, summaryCandidates: 3, fits: () => false })
    expect(cramped).toEqual({ sendIconOnly: true, modeIconOnly: true, summaryIndex: 2, modelEllipsis: true })
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

  it('没有可收的钮 / 方式格时那一件不进清单，永远照原样画', () => {
    const step = composerYieldPick({ sendCollapsible: false, modeCollapsible: false, summaryCandidates: 2, fits: () => false })
    expect(step).toEqual({ sendIconOnly: false, modeIconOnly: false, summaryIndex: 1, modelEllipsis: true })
    expect(composerYieldPick({ sendCollapsible: false, modeCollapsible: false, summaryCandidates: 1, fits: () => true })).toEqual(COMPOSER_YIELD_NONE)
  })
})
