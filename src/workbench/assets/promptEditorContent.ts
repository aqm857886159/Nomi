import type { JSONContent } from '@tiptap/react'
import { parsePromptSegments } from './promptMentions'

export function promptToContent(prompt: string): JSONContent {
  const segments = parsePromptSegments(prompt)
  const paragraphs: JSONContent[] = [{ type: 'paragraph', content: [] }]
  const pushInline = (node: JSONContent) => { (paragraphs[paragraphs.length - 1].content as JSONContent[]).push(node) }
  for (const seg of segments) {
    if (seg.type === 'mention') { pushInline({ type: 'assetMention', attrs: { url: seg.url } }); continue }
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
