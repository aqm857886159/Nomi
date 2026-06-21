// 词级 LCS diff:把优化后文本拆成段,标出相对原文「新增/改动」的部分,供「高亮=改动」展示。
// 纯函数(可单测)。中英混排:CJK 按单字、Latin/数字按词、其它按单字符切,空白单独成 token。
export type DiffSegment = { text: string; added: boolean }

function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9]+|[一-鿿]|\s+|[^\sA-Za-z0-9]/g) || []
}

/** 返回「优化后文本」的分段:added=true 的段是相对原文新增/改动的部分。 */
export function diffPromptWords(original: string, optimized: string): DiffSegment[] {
  const a = tokenize(original)
  const b = tokenize(optimized)
  const m = a.length
  const n = b.length
  // dp[i][j] = a[i:] 与 b[j:] 的最长公共子序列长度。
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const segments: DiffSegment[] = []
  const push = (text: string, added: boolean) => {
    const last = segments[segments.length - 1]
    if (last && last.added === added) last.text += text
    else segments.push({ text, added })
  }
  let i = 0
  let j = 0
  while (j < n) {
    if (i < m && a[i] === b[j]) {
      push(b[j], false)
      i++
      j++
    } else if (i < m && dp[i + 1][j] >= dp[i][j + 1]) {
      i++ // 原文删除的 token,不体现在优化后文本里
    } else {
      push(b[j], true) // 优化后新增/改动的 token
      j++
    }
  }
  return segments
}
