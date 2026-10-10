import { describe, expect, it } from 'vitest'

import { TEXT_PROCESS_PRESETS, TEXT_PROCESS_PRESET_IDS, countSplitItems, readTextProcessPreset } from './textProcessPresets'

const item = (text: string) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const list = (...texts: string[]) => ({ type: 'orderedList', content: texts.map(item) })

describe('加工预设', () => {
  it('四个预设都有对模型说的话；只有看图写描述要图', () => {
    for (const id of TEXT_PROCESS_PRESET_IDS) expect(TEXT_PROCESS_PRESETS[id].instruction.length).toBeGreaterThan(10)
    expect(TEXT_PROCESS_PRESET_IDS.filter((id) => TEXT_PROCESS_PRESETS[id].needsImage)).toEqual(['describe'])
  })

  it('meta 里认不得的预设名当没点过', () => {
    expect(readTextProcessPreset({ textGenPreset: 'split' })?.id).toBe('split')
    expect(readTextProcessPreset({ textGenPreset: 'toString' })).toBeNull()
    expect(readTextProcessPreset({ textGenPreset: 3 })).toBeNull()
    expect(readTextProcessPreset(undefined)).toBeNull()
  })
})

describe('拆成多条：节点底部「拆成 N 条」', () => {
  it('正好一个有序列表 → 条数；编辑器末尾补的空段落不算内容', () => {
    expect(countSplitItems({ content: [list('a', 'b', 'c')] })).toBe(3)
    expect(countSplitItems({ content: [list('a', 'b'), { type: 'paragraph' }] })).toBe(2)
  })

  it('用户改成别的样子（多了一段字、只剩一条、没有列表）→ 不再说拆成几条', () => {
    expect(countSplitItems({ content: [list('a', 'b'), { type: 'paragraph', content: [{ type: 'text', text: '补一句' }] }] })).toBeNull()
    expect(countSplitItems({ content: [list('a')] })).toBeNull()
    expect(countSplitItems({ content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] })).toBeNull()
    expect(countSplitItems(undefined)).toBeNull()
  })
})
