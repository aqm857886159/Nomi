// @ 内联引用的「持久化格式 + 发送投影」单源(规范 §4 R6 / §6)。纯函数,与 Tiptap UI 解耦、可单测。
//
// 持久化格式:prompt 字符串里内联标记 `@[asset:<encodeURIComponent(url)>]`(encode 保证内部无 `]`,可安全正则解析)。
//   - 纯文字 prompt 不含标记 → 一切照旧(向后兼容,投影是 no-op)。
//   - 这一格式存进 node.prompt;Tiptap 加载时解析回 chip,编辑时序列化回标记。
//
// 最终投影(R6 单一真相源,最易漂移):**同一个有序数组**既产出 prompt 文本(chip→@imageN)、
//   又是 reference_image 的顺序。numbering = 该 url 在「有序图片参考数组」里的位置 → 句中编号与数组顺序天然一致。

const MENTION_RE = /@\[asset:([^\]]+)\]/g

export type PromptReferenceKind = 'image' | 'video' | 'audio'
export type PromptReference = { url: string; kind: PromptReferenceKind; index: number }

function safeDecode(enc: string): string {
  try { return decodeURIComponent(enc) } catch { return enc }
}

/** 把一个素材 url 编码成 prompt 里的内联标记。 */
export function encodeMention(url: string): string {
  return `@[asset:${encodeURIComponent(url)}]`
}

export type PromptSegment = { type: 'text'; value: string } | { type: 'mention'; url: string }

/** 按文本出现顺序取出引用 URL；重复引用只保留第一次，供绑定顺序使用。 */
export function mentionUrlsInOrder(prompt: string): string[] {
  const seen = new Set<string>()
  return parsePromptSegments(prompt).flatMap((segment) => {
    if (segment.type !== 'mention' || seen.has(segment.url)) return []
    seen.add(segment.url)
    return [segment.url]
  })
}

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
 * 最终投影(R6):把 prompt 里的 `@[asset:url]` 标记替换成 `@imageN`,
 * N = 该 url 在 orderedImageUrls(有序图片参考数组,= 发送的 reference_image 顺序)里的位置 +1。
 * 数组里找不到(对应 tile 已删)→ 标记移除(连带清理多余空格)。无标记时原样返回(no-op,向后兼容)。
 */
export function normalizePromptReferences(
  references: readonly string[] | readonly PromptReference[],
): PromptReference[] {
  if (!references.length) return []
  if (typeof references[0] === 'string') {
    return (references as readonly string[]).map((url, index) => ({ url, kind: 'image' as const, index: index + 1 }))
  }
  return [...references as readonly PromptReference[]]
}

/**
 * **编号规则的唯一 owner**：一串「按实际发送顺序排好的参考」→ `@imageN / @videoN / @audioN` 的编号。
 * N 是该 url 在**同类**参考里的位置（图第几张、视频第几条），与线缆上那几个数组的下标一一对应。
 *
 * 为什么必须共享：手动画布那条路按档案的槽顺序走一遍就得到这串有序参考
 * （`archetypeMeta.orderedSentMediaReferenceUrls` 末尾那两行做的就是本函数），Run 路径按
 * `candidate.references` 的数组顺序走。**顺序怎么来的两路可以不同（槽 vs 数组），但「排好之后怎么编号」
 * 只能有一个答案**——否则同一张参考图在两条路上会被写成 @image1 和 @image2，模型照着句子找图就找错了。
 */
export function numberPromptReferences(
  references: readonly Readonly<{ url: string; kind?: PromptReferenceKind }>[],
): PromptReference[] {
  const counts: Record<PromptReferenceKind, number> = { image: 0, video: 0, audio: 0 }
  return references.map((reference) => {
    const kind = reference.kind ?? 'image'
    counts[kind] += 1
    return { url: reference.url, kind, index: counts[kind] }
  })
}

export function promptReferenceForUrl(
  url: string,
  references: readonly string[] | readonly PromptReference[],
): PromptReference | null {
  return normalizePromptReferences(references).find((reference) => reference.url === url) ?? null
}

function projectPromptMentions(
  prompt: string,
  references: readonly string[] | readonly PromptReference[],
): string {
  if (!prompt) return prompt
  const byUrl = new Map(normalizePromptReferences(references).map((reference) => [reference.url, reference]))
  const replaced = prompt.replace(MENTION_RE, (_full, enc: string) => {
    const reference = byUrl.get(safeDecode(enc))
    return reference ? `@${reference.kind}${reference.index}` : ''
  })
  return collapsePromptWhitespace(replaced)
}

/** 发给模型前的最终 Prompt：严格按实际参考图数组顺序转成 @imageN。 */
export const projectPromptForSend = projectPromptMentions

/** 非编辑态 Prompt 预览：与最终发送口径相同，绝不显示内部 @[asset:URL] 标记。 */
export const projectPromptForDisplay = projectPromptMentions

// 删标记后清理多余空格/标点前空白(「 @image1  走」→「@image1 走」)。最终投影与
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

/**
 * 删掉的 @：上一版提示词里有、这一版没有的引用 url（「删 @ 同步删参考」那条路的判据）。
 * 只比 url 集合：同一张图在提示词里出现几次都算一张；还剩一枚就不算删。
 */
export function droppedMentionUrls(previous: string, next: string): string[] {
  const kept = new Set(mentionUrlsInOrder(next))
  return mentionUrlsInOrder(previous).filter((url) => !kept.has(url))
}

/** 一张可被自动引用的图：`key` 是它的稳定身份（分镜 = 锚 id，画布 = 来源节点 id），不是 url。 */
export type AutoMentionCandidate = { key: string; name: string; url: string }

export type AutoMentionResult = {
  prompt: string
  /** 这一轮之后「补过」的身份全集（含之前补过的）。用户删掉的 @ 不会再补回来，判据就是它。 */
  applied: string[]
  /** 这一轮真的插进去的那几张（调用方据此把参考框也绑上）。 */
  inserted: AutoMentionCandidate[]
}

function isWordChar(char: string | undefined): boolean {
  return Boolean(char) && /[A-Za-z0-9_]/.test(char as string)
}

/** 在一段**纯文字**里找 name 第一次完整出现的位置（拉丁字母要整词，中文按字面）。 */
function firstNameEnd(text: string, name: string): number {
  let from = 0
  while (from <= text.length) {
    const at = text.indexOf(name, from)
    if (at < 0) return -1
    const end = at + name.length
    const latinEdges = isWordChar(name[0]) || isWordChar(name[name.length - 1])
    if (!latinEdges || (!isWordChar(text[at - 1]) && !isWordChar(text[end]))) return end
    from = at + 1
  }
  return -1
}

/**
 * **自动引用的唯一 owner**（分镜与画布共用，2026-10-06 用户拍板方向：「小张@」）。
 *
 * 一张图出来了 → 在引用它的提示词里，**紧跟在它名字第一次出现的地方**插一枚现有的 @ 引用标记
 * （`@[asset:url]`，与手动 @ 同一种持久化格式），不插末尾、不加任何说明文字。
 *
 * 三条不插：
 *   ① 这个身份之前补过（`applied` 里有）——用户手动删掉的 @ 不许被补回来；
 *   ② 提示词里已经有这张图的 @（用户自己 @ 过）——记成补过，不重复；
 *   ③ 名字没出现在提示词的文字里（只搜文字段，不搜已有标记内部）——不往末尾塞。
 * 名字出现几次只补一次，补在第一次；名字互相包含（「林薇」与「林」）时长名字优先占位。
 * 纯函数：调用方负责把 `inserted` 那几张绑进参考框（分镜 = referenceBindings，画布 = 连边 / 上传槽）。
 */
export function insertAutoMentions(
  prompt: string,
  candidates: readonly AutoMentionCandidate[],
  applied: readonly string[] = [],
): AutoMentionResult {
  const done = new Set(applied)
  const present = new Set(mentionUrlsInOrder(prompt))
  const inserted: AutoMentionCandidate[] = []
  let segments = parsePromptSegments(prompt)
  const ordered = [...candidates]
    .filter((candidate) => candidate.name.trim() && candidate.url)
    .sort((a, b) => b.name.trim().length - a.name.trim().length)
  for (const candidate of ordered) {
    if (done.has(candidate.key)) continue
    if (present.has(candidate.url)) { done.add(candidate.key); continue }
    const name = candidate.name.trim()
    const index = segments.findIndex((segment) => segment.type === 'text' && firstNameEnd(segment.value, name) >= 0)
    if (index < 0) continue
    const segment = segments[index] as { type: 'text'; value: string }
    const end = firstNameEnd(segment.value, name)
    segments = [
      ...segments.slice(0, index),
      { type: 'text', value: segment.value.slice(0, end) },
      { type: 'mention', url: candidate.url },
      { type: 'text', value: segment.value.slice(end) },
      ...segments.slice(index + 1),
    ]
    present.add(candidate.url)
    done.add(candidate.key)
    inserted.push(candidate)
  }
  if (!inserted.length) return { prompt, applied: [...done], inserted }
  const next = segments.map((segment) => (segment.type === 'text' ? segment.value : encodeMention(segment.url))).join('')
  return { prompt: next, applied: [...done], inserted }
}
