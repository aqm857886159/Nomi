import type React from 'react'
import { describe, expect, it } from 'vitest'
import { badBreaks } from '../../tests/ux/_sentenceBreaks.mjs'
import { enGenerationCommon, zhGenerationCommon } from '../i18n/locales/generationCommon'
import type { TooltipContent } from './tooltip'
import type { HoverCardContent } from './hoverCard'
import { tooltipLines } from './tooltipLines'

// 类型上「写不出来」（D-1121-tooltip-multiline-shared）：墨色提示和悬停卡都不收调用方的类名和样式，
// 墨色提示只收字。谁把这几样加回类型里，这几行的类型检查（check:test-types）就红。
type Props<C> = C extends React.ComponentType<infer P> ? P : C extends React.ForwardRefExoticComponent<infer P> ? P : never
type Banned = 'className' | 'style' | 'asChild'
const tooltipTakesNoClass: Extract<keyof Props<typeof TooltipContent>, Banned> extends never ? true : false = true
const hoverCardTakesNoClass: Extract<keyof Props<typeof HoverCardContent>, Banned> extends never ? true : false = true
const tooltipTakesOnlyText: Props<typeof TooltipContent>['children'] extends string ? true : false = true

const estimate = (lang: 'zh' | 'en'): string => {
  const copy: string = (lang === 'zh' ? zhGenerationCommon : enGenerationCommon).composer.sendCost.estimate
  return copy.replace('{{value}}', '1.95').replace('{{usd}}', '$0.195')
}

describe('tooltipLines 按句分行', () => {
  it('类型上传不进类名、样式，墨色提示只收字', () => {
    expect([tooltipTakesNoClass, hoverCardTakesNoClass, tooltipTakesOnlyText]).toEqual([true, true, true])
  })

  it('约价那一句：中英都一句一行，换行点只在句子之间，拼起来一字不差', () => {
    for (const lang of ['zh', 'en'] as const) {
      const text = estimate(lang)
      const lines = tooltipLines(text)
      expect(lines.length).toBe(2)
      expect(lines.join('')).toBe(text)
      expect(badBreaks(lines)).toEqual([])
    }
  })

  it('数字和文件名里的点不是句末：1.95、$0.195、take3.Final.mp4 都不断', () => {
    for (const text of ['take3.Final.mp4 · Drag onto the canvas', 'About 1.95 credits ($0.195)', '生成中…', 'averyveryverylongstringwithoutanyspaces_take3.Final.mp4']) {
      expect(tooltipLines(text)).toEqual([text])
    }
  })

  it('点不了的原因和约价用「\\n」隔开，各占一行', () => {
    const lines = tooltipLines(`Generating…\n${estimate('en')}`)
    expect(lines[0]).toBe('Generating…\n')
    expect(lines.slice(1).join('')).toBe(estimate('en'))
  })

  it('「全部塞一行」和「每个字一行」都过不了判卷', () => {
    const text = estimate('en')
    expect(tooltipLines(text)).not.toEqual([text])
    expect(badBreaks([...text])).not.toEqual([])
  })
})
