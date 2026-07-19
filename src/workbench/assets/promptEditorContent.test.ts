import { describe, expect, it } from 'vitest'
import { promptToContent } from './promptEditorContent'
import { encodeMention } from './promptMentions'

const A = 'nomi-local://asset/a.png'
const B = 'nomi-local://asset/b.png'

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
})
