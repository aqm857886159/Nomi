import { describe, expect, it } from 'vitest'
import { wrapTextToWidth } from './textLayout'

// 等宽度量：每个码点算 1 个单位宽。让折行断言可预测（真实 canvas 传 ctx.measureText().width）。
const unitMeasure = (text: string): number => Array.from(text).length

describe('wrapTextToWidth（预览 word-break:break-word 的单一折行规范）', () => {
  it('保留显式换行：每个段落独立折行', () => {
    expect(wrapTextToWidth('a\nb', 10, unitMeasure)).toEqual(['a', 'b'])
  })

  it('空段落保留为空行', () => {
    expect(wrapTextToWidth('a\n\nb', 10, unitMeasure)).toEqual(['a', '', 'b'])
  })

  it('按空格断词，不把单词拦腰截断（对齐 word-break:break-word）', () => {
    // 宽度 5：'hello'(5) 放一行，'world'(5) 放下一行；绝不拆成 'hell'/'o wor'/'ld'
    expect(wrapTextToWidth('hello world', 5, unitMeasure)).toEqual(['hello', 'world'])
  })

  it('多词在限宽内尽量同行（贪心装箱）', () => {
    // 宽度 11：'foo bar'(7) 同行，加 ' baz'(11) 仍≤11 → 一行；'qux' 溢出到下一行
    expect(wrapTextToWidth('foo bar baz qux', 11, unitMeasure)).toEqual(['foo bar baz', 'qux'])
  })

  it('超长单词（无空格断点）逐字断行——覆盖 URL / 长串', () => {
    // 宽度 4，单词 'abcdefg'(7) 放不下任何空格断点 → 逐字切到限宽
    expect(wrapTextToWidth('abcdefg', 4, unitMeasure)).toEqual(['abcd', 'efg'])
  })

  it('CJK 无空格 → 逐字贪心折行', () => {
    // 宽度 3：'一二三四五' → '一二三' / '四五'
    expect(wrapTextToWidth('一二三四五', 3, unitMeasure)).toEqual(['一二三', '四五'])
  })

  it('行首已满后遇超长词：先断词、剩余继续，不丢字', () => {
    // 宽度 5：'ab'(2) + 超长 'cdefghij'(8)。'ab' 占行，词放不进当前行 → 另起，
    // 然后该词逐字：'cdefg'/'hij'。全字保留、不丢。
    expect(wrapTextToWidth('ab cdefghij', 5, unitMeasure)).toEqual(['ab', 'cdefg', 'hij'])
  })

  it('限宽至少为 1，避免 0/负宽死循环', () => {
    expect(wrapTextToWidth('ab', 0, unitMeasure)).toEqual(['a', 'b'])
  })
})
