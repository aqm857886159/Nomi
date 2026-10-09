import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { enGenerationCommon, zhGenerationCommon } from '../../../i18n/locales/generationCommon'

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8')

/** 取带某个 data 锚点的那一行 className（预设行 / 「试试」行）。 */
function rowClass(source: string, anchor: string): string {
  const line = source.split('\n').find((candidate) => candidate.includes(anchor))
  if (!line) throw new Error(`row not found: ${anchor}`)
  return line
}

describe('文本节点预设行与「试试」行：中英文都只有一行，从结构上折不了', () => {
  it('两行都是 flex-nowrap + whitespace-nowrap，且没有 flex-wrap', () => {
    for (const [file, anchor] of [
      ['TextNodeComposer.tsx', 'data-text-process-presets'],
      ['render/TextDocumentNode.tsx', 'data-text-empty-try'],
    ] as const) {
      const line = rowClass(read(file), anchor)
      expect(line, `${file} ${anchor}`).toContain('flex-nowrap')
      expect(line, `${file} ${anchor}`).toContain('whitespace-nowrap')
      expect(line, `${file} ${anchor}`).not.toMatch(/\bflex-wrap\b/)
    }
  })

  it('预设名够短：五个预设名加起来的字数有上限（量过：加工框最窄 380px 时英文一行放得下）', () => {
    const budget = (preset: Record<string, string>, modeMenu: string) =>
      [preset.expand, preset.describe, preset.translate, preset.split, modeMenu].join('').length
    const zhText = zhGenerationCommon.textProcess
    const enText = enGenerationCommon.textProcess
    expect(budget(enText.preset, enText.modeMenu)).toBeLessThanOrEqual(42)
    expect(budget(zhText.preset, zhText.modeMenu)).toBeLessThanOrEqual(24)
  })
})
