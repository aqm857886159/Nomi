import { describe, expect, it } from 'vitest'
import {
  CREATION_AI_MODES,
  getCreationAiMode,
  modeAllowsWriteTools,
} from './creationAiModes'

describe('creationAiModes — chatOnly 能力声明驱动写工具门禁', () => {
  it('chatOnly 模式（通用问答）不允许写文档工具', () => {
    const general = getCreationAiMode('general')
    expect(general.chatOnly).toBe(true)
    expect(modeAllowsWriteTools(general)).toBe(false)
  })

  it('创作类模式（写故事/写剧本…）允许写文档工具', () => {
    const story = getCreationAiMode('story')
    expect(story.chatOnly).toBeFalsy()
    expect(modeAllowsWriteTools(story)).toBe(true)
  })

  it('全部模式的写工具门禁 = chatOnly 取反（单一真相源，不另立第二份判定）', () => {
    for (const mode of CREATION_AI_MODES) {
      expect(modeAllowsWriteTools(mode)).toBe(!mode.chatOnly)
    }
  })
})
