// 悬停提示的换行点判卷（G7 用）：每个换行点前，上一行必须以句末标点结尾。
// 中文 。！？ 英文 ! ? 和跟在字母或右括号后的句号（「1.95」这种数字里的点不算句末）。
const SENTENCE_END = /[。！？!?]$|[A-Za-z)）]\.$/

/** lines：屏上逐行读到的字（行尾空格已并进上一行）。返回落在句子中间的换行点。 */
export function badBreaks(lines) {
  const bad = []
  for (let i = 0; i + 1 < lines.length; i++) {
    const end = lines[i].trimEnd()
    if (!SENTENCE_END.test(end)) bad.push({ line: i + 1, endsWith: end.slice(-14), nextStarts: lines[i + 1].trimStart().slice(0, 14) })
  }
  return bad
}
