import { describe, expect, it } from 'vitest'
import { normalizeGeneratedText } from './gen-archetype-wire-defaults'

// 主模式收口的回归用例已随默认值现算搬到 electron/shared/modelArchetypes/catalogFacts.test.ts。
describe('archetype defaults generation', () => {
  it('treats Windows and POSIX line endings as the same generated content', () => {
    expect(normalizeGeneratedText('first\r\nsecond\r\n')).toBe('first\nsecond\n')
  })
})
