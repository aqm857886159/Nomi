import { describe, expect, it } from 'vitest'
import { NODE_NAME_PROMPT_CHARS, resolveNodeName } from './nodeFallbackName'

const deps = { isDefaultTitle: (title: string) => title === '图片', kindLabel: () => '图片' }

describe('resolveNodeName: title, then prompt head, then kind + ordinal', () => {
  it('uses the title the user gave', () => {
    expect(resolveNodeName({ title: '海边灯塔', prompt: '别的提示词', kind: 'image' }, 1, deps)).toBe('海边灯塔')
  })

  it('treats the system default title as no title and falls to the prompt head', () => {
    expect(resolveNodeName({ title: '图片', prompt: '清晨海边的灯塔', kind: 'image' }, 1, deps)).toBe('清晨海边的灯塔')
  })

  it('cuts a long prompt and adds an ellipsis', () => {
    const prompt = '一二三四五六七八九十甲乙丙丁戊己庚辛'
    expect(resolveNodeName({ title: '', prompt, kind: 'image' }, 1, deps)).toBe(`${Array.from(prompt).slice(0, NODE_NAME_PROMPT_CHARS).join('')}…`)
  })

  it('with neither title nor prompt, uses kind + ordinal so two rows never read the same', () => {
    expect(resolveNodeName({ title: '', prompt: '  ', kind: 'image' }, 1, deps)).toBe('图片 1')
    expect(resolveNodeName({ title: undefined, prompt: undefined, kind: 'image' }, 2, deps)).toBe('图片 2')
  })
})
