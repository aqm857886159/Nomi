import type { GenerationCanvasNode, TiptapDocJson } from '../model/generationCanvasTypes'
import { docToPlainText } from '../../../../electron/shared/canvas/textNodeBody'
import { synchronousSha256 } from '../../../../electron/shared/synchronousSha256'

/**
 * C5 P2 · 文本节点生成模式：
 * - append  续写：把生成内容接在文档末尾（默认；数据层，不依赖 editor，离屏也安全）。
 * - replace 重写：用生成内容替换整篇文档（数据层）。
 * - rewrite 改写：改写**当前选区**——这一种必须在节点编辑器里 replaceSelection（数据层拿不到
 *   ProseMirror 选区位置），所以 textActions 只打个标记，TextDocumentNode 的 effect 执行替换。
 */
export type TextGenMode = 'append' | 'replace' | 'rewrite'

export function getTextGenMode(node: Pick<GenerationCanvasNode, 'meta'>): TextGenMode {
  const mode = node.meta?.textGenMode
  return mode === 'replace' || mode === 'rewrite' ? mode : 'append'
}

export { docToPlainText }

/** Hash the exact plain text consumed by generation, without persisting another document. */
export function textDocumentDigest(doc?: TiptapDocJson): string {
  return `sha256-${synchronousSha256(docToPlainText(doc))}`
}
