import { describe, it, expect } from 'vitest'
import { encodeMention, parsePromptSegments, hasMentions, projectPromptForSend, removeMention } from './promptMentions'

const A = 'nomi-local://asset/p/a.png'
const B = 'https://pub/b.png'

describe('encode / parse round-trip', () => {
  it('encodes a url into a safe inline marker', () => {
    expect(encodeMention(A)).toBe(`@[asset:${encodeURIComponent(A)}]`)
  })

  it('parses text + mention segments in order', () => {
    const prompt = `${encodeMention(A)} 牵着 ${encodeMention(B)} 走过草地`
    expect(parsePromptSegments(prompt)).toEqual([
      { type: 'mention', url: A },
      { type: 'text', value: ' 牵着 ' },
      { type: 'mention', url: B },
      { type: 'text', value: ' 走过草地' },
    ])
  })

  it('plain text → single text segment, no mentions', () => {
    expect(parsePromptSegments('阳光下的猫')).toEqual([{ type: 'text', value: '阳光下的猫' }])
    expect(hasMentions('阳光下的猫')).toBe(false)
    expect(hasMentions(`x ${encodeMention(A)}`)).toBe(true)
  })
})

describe('projectPromptForSend (R6 单源)', () => {
  it('no-op on plain text (向后兼容)', () => {
    expect(projectPromptForSend('阳光下的猫', [A, B])).toBe('阳光下的猫')
  })

  it('替换标记为 character{N},按有序数组定位', () => {
    const prompt = `${encodeMention(A)} 牵着 ${encodeMention(B)} 走`
    expect(projectPromptForSend(prompt, [A, B])).toBe('character1 牵着 character2 走')
  })

  it('编号 = url 在数组中的位置(顺序变则编号变,单源一致)', () => {
    const prompt = `${encodeMention(A)} 和 ${encodeMention(B)}`
    expect(projectPromptForSend(prompt, [B, A])).toBe('character2 和 character1')
  })

  it('数组里没有的 url(tile 已删)→ 标记移除', () => {
    const prompt = `${encodeMention(A)} 牵着 ${encodeMention(B)}`
    expect(projectPromptForSend(prompt, [B])).toBe('牵着 character1')
  })

  it('同一素材多次引用 → 同一编号', () => {
    const prompt = `${encodeMention(A)} 再次 ${encodeMention(A)}`
    expect(projectPromptForSend(prompt, [A])).toBe('character1 再次 character1')
  })
})

describe('removeMention (删 tile 同步清 chip)', () => {
  const CN = 'nomi-local://asset/p/带 空格.png' // 含中文+空格,验 encodeURIComponent 整串匹配

  it('删掉该 url 的 chip,保留别的 chip,清理空格', () => {
    const prompt = `${encodeMention(A)} 牵着 ${encodeMention(B)} 走`
    expect(removeMention(prompt, A)).toBe(`牵着 ${encodeMention(B)} 走`)
  })

  it('同一 url 多次引用全删', () => {
    const prompt = `${encodeMention(A)} 和 ${encodeMention(A)} 一起`
    expect(removeMention(prompt, A)).toBe('和 一起')
  })

  it('含中文/空格的 url 也能精确匹配删除', () => {
    const prompt = `开始 ${encodeMention(CN)} 结束`
    expect(removeMention(prompt, CN)).toBe('开始 结束')
  })

  it('url 不在 prompt 中 → 原样返回(no-op)', () => {
    const prompt = `${encodeMention(A)} x`
    expect(removeMention(prompt, B)).toBe(prompt)
    expect(removeMention('纯文字', A)).toBe('纯文字')
    expect(removeMention('', A)).toBe('')
  })
})
