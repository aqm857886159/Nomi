// 语义状态色淡底棘轮自证：#1660 真实走灰样本与各类 transparent 摊薄写法必抓，-soft / 中性半透明 / 描边写法零误伤。
import { describe, expect, it } from 'vitest'

import { countSemanticSoftTintInLine, countSemanticSoftTintInText } from './lib/semanticSoftTintScan.mjs'

describe('countSemanticSoftTintInLine', () => {
  it('抓住 #1660 O5 真实走灰写法及四语义状态色 bg-*/透明度 类名', () => {
    for (const bad of [
      'className="flex flex-col gap-2.5 rounded-field border border-nomi-warning/30 bg-nomi-warning/10 p-3 text-caption text-nomi-ink"',
      'tone === "required" ? "bg-nomi-warning/15 text-nomi-warning" : "bg-nomi-accent-soft text-nomi-accent"',
      'hover:bg-workbench-danger/15',
      'dark:bg-nomi-success/20',
      'bg-nomi-info/[0.12]',
      'bg-workbench-warning/12',
    ]) {
      expect(countSemanticSoftTintInLine(bad), bad).toBe(1)
    }
  })

  it('抓住任意值与 CSS / 行内样式把状态主色向 transparent 混合做底色的写法', () => {
    expect(
      countSemanticSoftTintInLine("className='bg-[color-mix(in_oklab,var(--nomi-warning)_10%,transparent)]'"),
    ).toBe(1)
    expect(
      countSemanticSoftTintInLine("style={{ backgroundColor: 'color-mix(in oklab, var(--workbench-danger) 12%, transparent)' }}"),
    ).toBe(1)
    expect(
      countSemanticSoftTintInLine('  background: color-mix(in srgb, var(--nomi-info) 15%, transparent);'),
    ).toBe(1)
  })

  it('不误伤：独立 -soft 档（含悬停微调）、实心状态底、描边透明度、中性色半透明、向 paper 混合与注释', () => {
    for (const ok of [
      'border border-nomi-warning-edge bg-nomi-warning-soft text-nomi-warning-ink',
      'bg-workbench-danger-soft hover:bg-workbench-danger-soft/80 text-workbench-danger-ink',
      'bg-nomi-success-soft border-nomi-success-edge text-nomi-success-ink',
      'bg-workbench-danger text-nomi-paper',
      'border-nomi-warning/40 text-nomi-warning',
      'bg-nomi-paper/80 backdrop-blur bg-nomi-ink-05/60',
      "bg-[color-mix(in_srgb,var(--nomi-warning)_12%,var(--nomi-paper))]",
      '// 旧错例：bg-nomi-warning/10 会塌缩成灰泥色',
      ' * bg-workbench-danger/15',
    ]) {
      expect(countSemanticSoftTintInLine(ok), ok).toBe(0)
    }
  })
})

describe('countSemanticSoftTintInText', () => {
  it('跨行累计命中数', () => {
    expect(
      countSemanticSoftTintInText(
        [
          '<div className="bg-nomi-warning-soft">',
          '  <span className="bg-nomi-warning/10" />',
          '  <span className="bg-workbench-danger/20" />',
          '</div>',
        ].join('\n'),
      ),
    ).toBe(2)
  })
})
