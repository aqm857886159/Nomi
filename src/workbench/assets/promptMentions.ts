// @ 内联引用的「持久化格式 + 发送投影」单源(规范 §4 R6 / §6)。纯函数,与 Tiptap UI 解耦、可单测。
//
// 持久化格式:prompt 字符串里内联标记 `@[asset:<encodeURIComponent(url)>]`(encode 保证内部无 `]`,可安全正则解析)。
//   - 纯文字 prompt 不含标记 → 一切照旧(向后兼容,投影是 no-op)。
//   - 这一格式存进 node.prompt;Tiptap 加载时解析回 chip,编辑时序列化回标记。
//
// 发送投影(R6 单一真相源,最易漂移):**同一个有序数组**既产出 prompt 文本(chip→character{N})、
//   又是 reference_image 的顺序。numbering = 该 url 在「有序图片参考数组」里的位置 → 句中编号与数组顺序天然一致。

const MENTION_RE = /@\[asset:([^\]]+)\]/g

function safeDecode(enc: string): string {
  try { return decodeURIComponent(enc) } catch { return enc }
}

/** 把一个素材 url 编码成 prompt 里的内联标记。 */
export function encodeMention(url: string): string {
  return `@[asset:${encodeURIComponent(url)}]`
}

export type PromptSegment = { type: 'text'; value: string } | { type: 'mention'; url: string }

/** 把含标记的 prompt 解析成「文字 / 引用」段(供 Tiptap 渲染成 文本 + chip)。 */
export function parsePromptSegments(prompt: string): PromptSegment[] {
  const segments: PromptSegment[] = []
  let lastIndex = 0
  const re = new RegExp(MENTION_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(prompt)) !== null) {
    if (match.index > lastIndex) segments.push({ type: 'text', value: prompt.slice(lastIndex, match.index) })
    segments.push({ type: 'mention', url: safeDecode(match[1]) })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < prompt.length) segments.push({ type: 'text', value: prompt.slice(lastIndex) })
  return segments
}

/** prompt 里是否含 @ 引用标记。 */
export function hasMentions(prompt: string): boolean {
  return new RegExp(MENTION_RE.source).test(prompt)
}

/**
 * 发送投影(R6):把 prompt 里的 `@[asset:url]` 标记替换成 `character{N}`,
 * N = 该 url 在 orderedImageUrls(有序图片参考数组,= 发送的 reference_image 顺序)里的位置 +1。
 * 数组里找不到(对应 tile 已删)→ 标记移除(连带清理多余空格)。无标记时原样返回(no-op,向后兼容)。
 */
export function projectPromptForSend(prompt: string, orderedImageUrls: string[]): string {
  if (!prompt) return prompt
  const replaced = prompt.replace(MENTION_RE, (_full, enc: string) => {
    const index = orderedImageUrls.indexOf(safeDecode(enc))
    return index >= 0 ? `character${index + 1}` : ''
  })
  return collapsePromptWhitespace(replaced)
}

// 删标记后清理多余空格/标点前空白(「 character1  走」→「character1 走」)。projectPromptForSend 与
// removeMention 同源调用(对抗评审 must-fix:别两处各清各的导致行为漂移)。
export function collapsePromptWhitespace(text: string): string {
  return text.replace(/[ \t]{2,}/g, ' ').replace(/\s+([，。、,.!?])/g, '$1').trim()
}

/**
 * 删 tile 时同步抹掉描述框里指向该 url 的所有 @ chip(对抗评审 must-fix:UX 清理孤儿 chip)。
 * 按持久化整串 `@[asset:encodeURIComponent(url)]` 精确匹配(含 %/中文/空格的 url 也对得上)、删**全部**重复、
 * 复用 collapsePromptWhitespace;url 不在 prompt 里 → 原样返回(no-op,避免无谓 setContent 抢光标)。
 */
export function removeMention(prompt: string, url: string): string {
  if (!prompt) return prompt
  const marker = encodeMention(url)
  if (!prompt.includes(marker)) return prompt
  return collapsePromptWhitespace(prompt.split(marker).join(''))
}
