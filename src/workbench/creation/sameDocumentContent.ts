/** 空文稿的两种等价写法：`content: []` 和「一段空段落」（TipTap 挂载时把前者补成后者）。 */
function isEmptyDocument(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const content = (value as { type?: unknown; content?: unknown }).content
  if ((value as { type?: unknown }).type !== 'doc' || !Array.isArray(content)) return false
  if (content.length === 0) return true
  if (content.length !== 1) return false
  const only = content[0] as { type?: unknown; content?: unknown } | null
  return Boolean(only) && only?.type === 'paragraph' && (!Array.isArray(only.content) || only.content.length === 0)
}

/**
 * 编辑器发来的内容和文稿里存的算不算同一份。挂载时的初始化不算编辑（2026-11-13 打开不写复盘）：
 * 空文稿两种写法相等，否则「打开看一眼」就改了文稿和 updatedAt、让整个项目落盘。
 */
export function sameDocumentContent(stored: unknown, emitted: unknown): boolean {
  if (JSON.stringify(stored) === JSON.stringify(emitted)) return true
  return isEmptyDocument(stored) && isEmptyDocument(emitted)
}
