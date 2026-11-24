import { diffWordsWithSpace } from 'diff'

/**
 * 「改前 / 改后」怎么画：删掉的划线、新加的标出来。
 *
 * 比较交给成熟库 `diff`（jsdiff，通用文本比较不是我们独有的）；中文没有空格，
 * 靠 `Intl.Segmenter` 按词切（桌面端 Chromium 自带），切不了才退回按空白切。
 */
type RewriteDiffPart = { kind: 'keep' | 'del' | 'add'; text: string }

// tsconfig 的 lib 还没带 Intl.Segmenter（运行时 Chromium / Node 都有），这里只声明用到的那一小块。
type WordSegmenterConstructor = new (locale: string | undefined, options: { granularity: 'word' }) => unknown

let segmenter: unknown | null | undefined

function wordSegmenter(): unknown | undefined {
  if (segmenter === undefined) {
    try {
      const Segmenter = (Intl as unknown as { Segmenter?: WordSegmenterConstructor }).Segmenter
      segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'word' }) : null
    } catch {
      segmenter = null
    }
  }
  return segmenter ?? undefined
}

let lastDiff: { original: string; rewritten: string; parts: RewriteDiffPart[] } | null = null

/** 单次词比较的时间上限：超了就退回「整段删 + 整段加」，界面不会因为一次比较卡住。 */
const DIFF_TIMEOUT_MS = 60

function wordDiff(original: string, rewritten: string): RewriteDiffPart[] {
  if (original === rewritten) return original ? [{ kind: 'keep', text: original }] : []
  const parts = diffWordsWithSpace(original, rewritten, { intlSegmenter: wordSegmenter(), timeout: DIFF_TIMEOUT_MS })
  if (!parts) {
    return [
      ...(original ? [{ kind: 'del' as const, text: original }] : []),
      ...(rewritten ? [{ kind: 'add' as const, text: rewritten }] : []),
    ]
  }
  return parts
    .filter((part) => part.value.length > 0)
    .map((part): RewriteDiffPart => ({ kind: part.added ? 'add' : part.removed ? 'del' : 'keep', text: part.value }))
}

/**
 * 词比较的代价随长度平方长：8000 字一次比下来要两百多毫秒。改写几乎总是「段数不变、段内换词」，
 * 所以段数一样就一段一段比（每段几十字，总共几十毫秒）；段数变了才整块比（有时间上限兜底）。
 * 两种走法拼回去都是原文和新文，只是对不齐的粒度不同。
 * 编辑器每次状态更新都会重画装饰；同一对原文 / 新文只比一次。
 */
export function diffRewrite(original: string, rewritten: string): RewriteDiffPart[] {
  if (lastDiff && lastDiff.original === original && lastDiff.rewritten === rewritten) return lastDiff.parts
  const before = original.split('\n')
  const after = rewritten.split('\n')
  let result: RewriteDiffPart[]
  if (before.length > 1 && before.length === after.length) {
    result = []
    before.forEach((line, index) => {
      if (index > 0) result.push({ kind: 'keep', text: '\n' })
      result.push(...wordDiff(line, after[index]!))
    })
  } else {
    result = wordDiff(original, rewritten)
  }
  lastDiff = { original, rewritten, parts: result }
  return result
}
