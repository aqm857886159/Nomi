import { describe, expect, it } from 'vitest'
import type { ArchetypeMode } from '../../../config/modelArchetypes/types'
import { buildDialoguePromptSuffix, modeGeneratesDialogue } from './storyboardDialogue'

const mode: ArchetypeMode = {
  id: 'speaking',
  intent: 'text',
  vendorTerm: '',
  hint: '',
  slots: [],
  params: [{ key: 'audio', label: 'audio', type: 'boolean', options: [], defaultValue: true }],
  promptRequired: true,
}

describe('modeGeneratesDialogue', () => {
  it('只认当前 mode 声明的 speaking boolean，默认开启', () => {
    expect(modeGeneratesDialogue(mode)).toBe(true)
    expect(modeGeneratesDialogue(mode, { audio: false })).toBe(false)
  })

  it('没有出声声明或显式关闭时不注入对白', () => {
    expect(modeGeneratesDialogue({ ...mode, params: [] })).toBe(false)
    expect(modeGeneratesDialogue({ ...mode, params: [{ ...mode.params[0], defaultValue: false }] })).toBe(false)
  })
})

describe('buildDialoguePromptSuffix', () => {
  it('仅在出声模式提交时附加对白，不改持久化 prompt', () => {
    expect(buildDialoguePromptSuffix(mode, {}, '  你终于来了。 ')).toBe('对白：你终于来了。')
    expect(buildDialoguePromptSuffix(mode, { audio: false }, '你终于来了。')).toBeUndefined()
  })
})
