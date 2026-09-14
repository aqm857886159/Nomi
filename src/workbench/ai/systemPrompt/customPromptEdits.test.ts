import { describe, expect, it } from 'vitest'

import {
  CUSTOM_PROMPT_MAX_COUNT,
  CUSTOM_PROMPT_NAME_MAX_LENGTH,
  type CustomSystemPrompt,
} from '../../../../electron/settings/systemPromptsContract'
import {
  appendCustomPrompt,
  canAddCustomPrompt,
  clampCustomPromptName,
  FALLBACK_MODE_ID,
  removeCustomPrompt,
  selectionAfterDelete,
  updateCustomPrompt,
} from './customPromptEdits'

const entry = (id: string, name = `名字 ${id}`, prompt = `正文 ${id}`): CustomSystemPrompt => ({ id, name, prompt })

const fill = (count: number): CustomSystemPrompt[] =>
  Array.from({ length: count }, (_unused, index) => entry(`custom:${index}`))

describe('canAddCustomPrompt — 条数上限', () => {
  it('没到上限时可以再建', () => {
    expect(canAddCustomPrompt([])).toBe(true)
    expect(canAddCustomPrompt(fill(CUSTOM_PROMPT_MAX_COUNT - 1))).toBe(true)
  })

  it('到上限就不能再建（「＋ 新建」据此 disabled）', () => {
    expect(canAddCustomPrompt(fill(CUSTOM_PROMPT_MAX_COUNT))).toBe(false)
  })
})

describe('clampCustomPromptName — 名字长度', () => {
  it('没超长的原样返回', () => {
    expect(clampCustomPromptName('口播带货体')).toBe('口播带货体')
  })

  it('超长的截到上限', () => {
    expect(clampCustomPromptName('名'.repeat(CUSTOM_PROMPT_NAME_MAX_LENGTH + 10))).toHaveLength(
      CUSTOM_PROMPT_NAME_MAX_LENGTH,
    )
  })

  it('不 trim：边打边 trim 会把用户还没打完的空格吞掉', () => {
    expect(clampCustomPromptName('口播 带货体 ')).toBe('口播 带货体 ')
  })
})

describe('appendCustomPrompt — 新建', () => {
  it('追加到末尾（新建的排在最后，顺序即用户看到的顺序）', () => {
    const before = [entry('custom:a')]
    expect(appendCustomPrompt(before, entry('custom:b')).map((item) => item.id)).toEqual([
      'custom:a',
      'custom:b',
    ])
  })

  it('不改动原数组（纯函数）', () => {
    const before = [entry('custom:a')]
    appendCustomPrompt(before, entry('custom:b'))
    expect(before).toHaveLength(1)
  })

  it('到上限后原样返回，不越界追加', () => {
    const full = fill(CUSTOM_PROMPT_MAX_COUNT)
    expect(appendCustomPrompt(full, entry('custom:extra'))).toHaveLength(CUSTOM_PROMPT_MAX_COUNT)
  })
})

describe('updateCustomPrompt — 改名 / 改正文', () => {
  const before = [entry('custom:a', '旧名字', '旧正文'), entry('custom:b', 'B 名字', 'B 正文')]

  it('只改中招的那一条', () => {
    const after = updateCustomPrompt(before, 'custom:a', { name: '新名字' })
    expect(after[0]).toEqual({ id: 'custom:a', name: '新名字', prompt: '旧正文' })
    expect(after[1]).toEqual(before[1])
  })

  it('改正文不动名字', () => {
    const after = updateCustomPrompt(before, 'custom:a', { prompt: '新正文' })
    expect(after[0]).toEqual({ id: 'custom:a', name: '旧名字', prompt: '新正文' })
  })

  it('改名不动 id —— 改一次名就把当前选择打飞是回归重灾区', () => {
    const after = updateCustomPrompt(before, 'custom:a', { name: '完全不同的名字' })
    expect(after[0]?.id).toBe('custom:a')
  })

  it('认不出的 id 原样返回，不凭空造条目', () => {
    expect(updateCustomPrompt(before, 'custom:nope', { name: 'x' })).toEqual(before)
  })
})

describe('removeCustomPrompt — 删除', () => {
  it('删掉指定的那条，其余保持顺序', () => {
    const before = [entry('custom:a'), entry('custom:b'), entry('custom:c')]
    expect(removeCustomPrompt(before, 'custom:b').map((item) => item.id)).toEqual([
      'custom:a',
      'custom:c',
    ])
  })

  it('认不出的 id 什么都不删', () => {
    const before = [entry('custom:a')]
    expect(removeCustomPrompt(before, 'custom:nope')).toEqual(before)
  })
})

describe('selectionAfterDelete — 删完选择落在哪', () => {
  // 回归锁：删掉当前选中的那条却不回退，`creationAiModeId` 会指向一个死 id
  // —— 设置页没有一个 chip 是选中态，创作面板的 chip 标签也认不出它。
  it('删的是当前选中的那条 → 回退到内置第一个模式', () => {
    expect(selectionAfterDelete('custom:a', 'custom:a')).toBe(FALLBACK_MODE_ID)
    expect(FALLBACK_MODE_ID).toBe('general')
  })

  it('删的是别的条目 → 不许动用户当前的选择', () => {
    expect(selectionAfterDelete('custom:a', 'custom:b')).toBe('custom:a')
  })

  it('当前选的是内置模式 → 删任何自定义都不影响它', () => {
    expect(selectionAfterDelete('assets', 'custom:b')).toBe('assets')
  })
})
