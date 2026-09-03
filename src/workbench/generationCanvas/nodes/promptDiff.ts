// 提示词 diff 的纯函数实现。Intl.Segmenter 负责中英文混排的自然分词，
// 连续替换先聚合成一段，再交给编辑器 Decoration.inline 渲染，避免中文逐词碎片化。
export type DiffSegment = { text: string; added: boolean }
export type PromptDiffKind = 'keep' | 'added' | 'removed'
export type PromptDiffSegment = { text: string; kind: PromptDiffKind }

function fallbackTokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9]+|[一-鿿]|\s+|[^\sA-Za-z0-9]/g) || []
}

function segmentText(text: string): string[] {
  type Segmenter = { segment: (value: string) => Iterable<{ segment: string }> }
  type IntlWithSegmenter = typeof Intl & { Segmenter?: new (locale: string, options: { granularity: 'word' }) => Segmenter }
  const SegmenterConstructor = (Intl as IntlWithSegmenter).Segmenter
  if (typeof SegmenterConstructor === 'function') {
    const segmenter = new SegmenterConstructor('zh-CN', { granularity: 'word' })
    return Array.from(segmenter.segment(text), ({ segment }) => segment)
  }
  return fallbackTokenize(text)
}

function pushSegment(segments: PromptDiffSegment[], text: string, kind: PromptDiffKind): void {
  if (!text) return
  const last = segments[segments.length - 1]
  if (last?.kind === kind) last.text += text
  else segments.push({ text, kind })
}

/**
 * Return a three-state diff. Replacement runs intentionally emit one removed
 * block and one added block, even when the segmenter returns many CJK words.
 */
export function diffPromptSegments(
  original: string,
  optimized: string,
  options: Readonly<{ mergeChanges?: boolean }> = {},
): PromptDiffSegment[] {
  const originalTokens = segmentText(original)
  const optimizedTokens = segmentText(optimized)
  const m = originalTokens.length
  const n = optimizedTokens.length
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = originalTokens[i] === optimizedTokens[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const segments: PromptDiffSegment[] = []
  let i = 0
  let j = 0
  while (i < m || j < n) {
    if (i < m && j < n && originalTokens[i] === optimizedTokens[j]) {
      pushSegment(segments, optimizedTokens[j], 'keep')
      i++
      j++
      continue
    }

    const oldStart = i
    const newStart = j
    while (i < m || j < n) {
      if (i < m && j < n && originalTokens[i] === optimizedTokens[j]) break
      if (i < m && j < n && lcs[i + 1][j] > lcs[i][j + 1]) i++
      else if (j < n) j++
      else i++
    }
    pushSegment(segments, originalTokens.slice(oldStart, i).join(''), 'removed')
    pushSegment(segments, optimizedTokens.slice(newStart, j).join(''), 'added')
  }
  if (options.mergeChanges === false) return segments
  const changed = segments.flatMap((segment, index) => segment.kind === 'keep' ? [] : [index])
  if (changed.length < 2) return segments
  const first = changed[0]
  const last = changed[changed.length - 1]
  const between = segments.slice(first, last + 1).filter((segment) => segment.kind === 'keep').map((segment) => segment.text).join('')
  if (/[，。！？；：,.!?;:]/u.test(between)) return segments
  const removed = segments.slice(first, last + 1).filter((segment) => segment.kind === 'removed').map((segment) => segment.text).join('')
  const added = segments.slice(first, last + 1).filter((segment) => segment.kind !== 'removed').map((segment) => segment.text).join('')
  return [...segments.slice(0, first), ...(removed ? [{ text: removed, kind: 'removed' as const }] : []), ...(added ? [{ text: added, kind: 'added' as const }] : []), ...segments.slice(last + 1)]
}

/** Backward-compatible added/keep projection used by the canvas optimizer. */
export function diffPromptWords(original: string, optimized: string): DiffSegment[] {
  return diffPromptSegments(original, optimized, { mergeChanges: false })
    .filter((segment) => segment.kind !== 'removed')
    .map((segment) => ({ text: segment.text, added: segment.kind === 'added' }))
}
