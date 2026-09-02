import { describe, expect, it } from 'vitest'
import { isAgentActionIntent } from './agentIntent'

describe('isAgentActionIntent', () => {
  it.each([
    ['帮我生成一个小猫头像', true],
    ['做一个 16:9 的雨夜镜头', true],
    ['请把这张图排进时间轴', true],
    ['Generate a cat avatar', true],
    ['please inspect the current draft', false],
  ])('classifies a natural request: %s', (text, expected) => {
    expect(isAgentActionIntent(text)).toBe(expected)
  })

  it.each(['我不要生成，只想知道怎么做', "don't generate anything yet"])('keeps a negated request in answer mode: %s', (text) => {
    expect(isAgentActionIntent(text)).toBe(false)
  })

  it('does not classify an empty message as an action', () => {
    expect(isAgentActionIntent('   ')).toBe(false)
  })
})
