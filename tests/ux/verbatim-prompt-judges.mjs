// 「提示词原文逐字落 / 该扩写时扩写」的判据（设计卡 docs/plan/2026-11-07-agent-verbatim-prompt.md ★9 检查 5、6）。
//
// 一把尺子只有一个家：真模型走查和离线阳性 / 阴性对照用的是同一份函数。
// 判据只看机器可判的东西——落进工具参数里的提示词文字——不信 Agent 的自述。

/** 收一次工具调用参数里所有叫 `prompt` 的字符串（起草的 shots / nodes / keyframe 等任意深度）。 */
export function collectPrompts(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectPrompts(item, found)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'prompt' && typeof child === 'string' && child.trim()) found.push(child)
      else collectPrompts(child, found)
    }
  }
  return found
}

const WRAPPING_QUOTES = /^[「『“"'‘《](.*)[」』”"'’》]$/s
const TRAILING_PUNCT = /[。.!！？?]+$/u

/** 逐字比较前的归一：去首尾空白、一层成对引号、末尾的句号。只放过这三样，别的一个字都不放过。 */
export function normalizeForVerbatim(text) {
  let out = String(text).trim().replace(TRAILING_PUNCT, '').trim()
  const quoted = WRAPPING_QUOTES.exec(out)
  if (quoted) out = quoted[1].trim()
  return out.replace(TRAILING_PUNCT, '').trim()
}

/**
 * 逐字：最后一轮写进工具参数的提示词里，有一条（归一后）与原文相同。
 * `expanded` = 没有逐字相同的，但有一条包含原文且更长（典型的「原文 + 氛围词 / 风格词」）。
 */
export function judgeVerbatim(expected, prompts) {
  const want = normalizeForVerbatim(expected)
  const got = prompts.map(normalizeForVerbatim)
  const exact = got.some((item) => item === want)
  const expanded = !exact && got.some((item) => item.includes(want) && item.length > want.length)
  return { wrotePrompt: prompts.length > 0, exact, expanded, prompts }
}

/**
 * 该扩写时扩写：落下的提示词不是原样那句想法，而且明显更具体——长度至少是想法的 1.5 倍、且比想法多出 8 个字符以上。
 * 这是代理指标（不判画面好坏），只防「让它写却只落一句原话」这种矫枉过正。
 */
export function judgeExpansion(seed, prompts) {
  const base = normalizeForVerbatim(seed)
  const longest = prompts.map(normalizeForVerbatim).sort((a, b) => b.length - a.length)[0] ?? ''
  const expanded = longest !== base && longest.length >= base.length * 1.5 && longest.length - base.length >= 8
  return { wrotePrompt: prompts.length > 0, expanded, longest }
}

/** 汇总：分母只数写了提示词的轮次之外，还要把「没写提示词」单列——没写出来的轮次不能冒充「逐字」。 */
export function summarize(rows) {
  const verbatimRows = rows.filter((row) => row.kind === 'verbatim')
  const expandRows = rows.filter((row) => row.kind === 'expand')
  const ratio = (list, predicate) => `${list.filter(predicate).length}/${list.length}`
  return {
    verbatimRate: ratio(verbatimRows, (row) => row.verdict?.exact === true),
    verbatimExpandedRate: ratio(verbatimRows, (row) => row.verdict?.expanded === true),
    verbatimNoPrompt: ratio(verbatimRows, (row) => row.verdict?.wrotePrompt === false),
    expandWhenAskedRate: ratio(expandRows, (row) => row.verdict?.expanded === true),
    expandNoPrompt: ratio(expandRows, (row) => row.verdict?.wrotePrompt === false),
  }
}
