import { describe, expect, it } from 'vitest'
import { promptToContent, shouldApplyExternalPromptSync, shouldEmitPromptUpdate } from './promptEditorContent'
import { encodeMention } from './promptMentions'

const A = 'nomi-local://asset/a.png'
const B = 'nomi-local://asset/b.png'
const V = 'nomi-local://asset/reference.mp4'

describe('promptToContent mention numbering', () => {
  it('按有序参考图列表给 chip 标注 图片N，而不是按 prompt 出现顺序', () => {
    const content = promptToContent(`${encodeMention(A)} 和 ${encodeMention(B)}`, [B, A])
    expect(content.content?.[0]?.content).toEqual([
      { type: 'assetMention', attrs: { url: A, index: 2 } },
      { type: 'text', text: ' 和 ' },
      { type: 'assetMention', attrs: { url: B, index: 1 } },
    ])
  })

  it('已不在参考图列表里的旧引用不伪造编号', () => {
    const content = promptToContent(encodeMention(A), [B])
    expect(content.content?.[0]?.content).toEqual([
      { type: 'assetMention', attrs: { url: A, index: null } },
    ])
  })

  it('URL-only 视频引用按当前结构化参考恢复 kind 和 1-based 编号', () => {
    const content = promptToContent(encodeMention(V), [
      { url: V, kind: 'video', index: 1 },
    ])
    expect(content.content?.[0]?.content).toEqual([
      { type: 'assetMention', attrs: { url: V, index: 1, kind: 'video' } },
    ])
  })
})

describe('external prompt synchronization', () => {
  it('只让文档内容事务回写 owner，展示编号事务不覆盖外部 plan 编辑', () => {
    expect(shouldEmitPromptUpdate(true, 'next', 'old')).toBe(true)
    expect(shouldEmitPromptUpdate(false, 'next', 'old')).toBe(false)
    expect(shouldEmitPromptUpdate(true, 'same', 'same')).toBe(false)
  })

  it('drops a stale effect after a local edit has advanced the latest value', () => {
    expect(shouldApplyExternalPromptSync('', 'new local prompt', 'new local prompt')).toBe(false)
  })

  it('applies a current external change exactly when it differs from the editor', () => {
    expect(shouldApplyExternalPromptSync('AI rewrite', 'AI rewrite', 'old prompt')).toBe(true)
    expect(shouldApplyExternalPromptSync('AI rewrite', 'AI rewrite', 'AI rewrite')).toBe(false)
  })
})
