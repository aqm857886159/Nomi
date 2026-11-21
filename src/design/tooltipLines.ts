/**
 * 悬停提示按句分行（D-1121-tooltip-multiline-shared）：句子切分交给浏览器自带的 Intl.Segmenter
 * （ICU 断句规则，「e.g. 」这类缩写后面不断；桌面端 Chromium、Node 都有）。
 */

// tsconfig 的 lib 还没带 Intl.Segmenter，这里只声明用到的那一小块（同 creation/aiRewrite/rewriteDiff.ts）。
type SentenceSegmenter = { segment: (text: string) => Iterable<{ segment: string }> }
type SentenceSegmenterConstructor = new (locale: string | undefined, options: { granularity: 'sentence' }) => SentenceSegmenter

const SENTENCES = new (Intl as unknown as { Segmenter: SentenceSegmenterConstructor }).Segmenter(undefined, { granularity: 'sentence' })

// 只认句子真的说完的地方：句末标点后跟着空白或换行，或中文句末标点（可带右括号、引号）。
// ICU 会把「take3.Final.mp4」这类紧贴字母的点也当句末，这种不在那里换行。
const SENTENCE_DONE = /\s$|[。！？][」』）”’"']*$/

/** 每一行是一整句；句尾空白留在行里，拼起来和原文一字不差（读屏读到的也是原文）。 */
export function tooltipLines(text: string): string[] {
  const lines: string[] = []
  let pending = ''
  for (const { segment } of SENTENCES.segment(text)) {
    pending += segment
    if (SENTENCE_DONE.test(segment)) {
      lines.push(pending)
      pending = ''
    }
  }
  if (pending) lines.push(pending)
  return lines
}
