import type { JSONContent } from '@tiptap/react'
import { parsePromptSegments } from './promptMentions'
import type { PromptReference } from './promptMentions'

export function shouldApplyExternalPromptSync(
  effectValue: string,
  latestValue: string,
  lastEditorValue: string,
): boolean {
  return effectValue === latestValue && effectValue !== lastEditorValue
}

/** 仅真正改变 prompt 字符串的文档事务向 owner 回写；胶囊编号事务不能覆盖外部 plan 编辑。 */
export function shouldEmitPromptUpdate(docChanged: boolean, next: string, latest: string): boolean {
  return docChanged && next !== latest
}

export function promptToContent(
  prompt: string,
  references: readonly string[] | readonly PromptReference[] = [],
): JSONContent {
  const segments = parsePromptSegments(prompt)
  const paragraphs: JSONContent[] = [{ type: 'paragraph', content: [] }]
  const pushInline = (node: JSONContent) => { (paragraphs[paragraphs.length - 1].content as JSONContent[]).push(node) }
  for (const seg of segments) {
    if (seg.type === 'mention') {
      const index = references.length && typeof references[0] === 'string'
        ? (references as readonly string[]).indexOf(seg.url)
        : -1
      const reference = typeof references[0] === 'string'
        ? (index >= 0 ? { url: seg.url, kind: 'image' as const, index: index + 1 } : null)
        : (references as readonly PromptReference[]).find((candidate) => candidate.url === seg.url)
      pushInline({
        type: 'assetMention',
        attrs: {
          url: seg.url,
          index: reference ? reference.index : null,
          ...(reference?.kind && reference.kind !== 'image' ? { kind: reference.kind } : {}),
        },
      })
      continue
    }
    seg.value.split('\n').forEach((line, index) => {
      if (index > 0) paragraphs.push({ type: 'paragraph', content: [] })
      if (line) pushInline({ type: 'text', text: line })
    })
  }
  return {
    type: 'doc',
    content: paragraphs.map((p) => {
      const inline = p.content as JSONContent[]
      return inline.length ? { type: 'paragraph', content: inline } : { type: 'paragraph' }
    }),
  }
}
