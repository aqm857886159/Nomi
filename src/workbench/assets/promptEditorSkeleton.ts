import { encodeMention } from './promptMentions'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** 骨架段范围。`ariaLabel` 由调用方（持 i18n 上下文的那层）给——装饰段可点击，必须有可访问名。 */
export type PromptEditorSegment = { key: string; start: number; end: number; ariaLabel?: string }

export type PromptRun = { promptStart: number; promptEnd: number; docStart: number; docEnd: number; atom: boolean }

/** 用同一套 @[url] 序列化规则，把 prompt 字符范围映射到 ProseMirror 文档位置。 */
export function promptRunsFromDocument(doc: ProseMirrorNode): PromptRun[] {
  const runs: PromptRun[] = []
  let promptOffset = 0
  doc.forEach((paragraph, paragraphOffset, paragraphIndex) => {
    if (paragraphIndex > 0) promptOffset += 1
    paragraph.forEach((node, nodeOffset) => {
      const docStart = paragraphOffset + 1 + nodeOffset
      if (node.isText) {
        const length = node.text?.length ?? 0
        if (length > 0) runs.push({ promptStart: promptOffset, promptEnd: promptOffset + length, docStart, docEnd: docStart + length, atom: false })
        promptOffset += length
        return
      }
      if (node.type.name === 'assetMention') {
        const length = encodeMention(String(node.attrs.url || '')).length
        runs.push({ promptStart: promptOffset, promptEnd: promptOffset + length, docStart, docEnd: docStart + node.nodeSize, atom: true })
        promptOffset += length
      }
    })
  })
  return runs
}

export function promptRangeToDocRanges(segment: PromptEditorSegment, runs: PromptRun[]): Array<{ from: number; to: number }> {
  return runs.flatMap((run) => {
    const from = Math.max(segment.start, run.promptStart)
    const to = Math.min(segment.end, run.promptEnd)
    if (to <= from) return []
    if (run.atom) return [{ from: run.docStart, to: run.docEnd }]
    return [{ from: run.docStart + from - run.promptStart, to: run.docStart + to - run.promptStart }]
  })
}
