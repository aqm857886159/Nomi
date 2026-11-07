// 「走查把 Agent 输入框当 <input>/<textarea> 读」的判定逻辑（check-walkthroughs.mjs 的 composer-input-read 规则）。
//
// 为什么（2026-10-12，#1183 CI 红）：Agent 输入框换成了共享 PromptEditor（富文本，能在句中插参考缩略图），
// `[data-v4-control="input"]` 不再是 input / textarea。走查里 toHaveValue / inputValue 读它报 "Not an input element"，
// 十几处各读各的。读写文字的唯一出口是 tests/ux/agent-runtime-walk-support.mjs 的 composerText / expectComposerText；
// 输入框再换一次形态，只改那一处。
//
// 占位提示是同一类（2026-10-28，短片走查自 10-12 起每晚红在 `toHaveAttribute('placeholder', …)`，收到 null）：TipTap 输入框没有
// `placeholder` 属性，占位是 Placeholder 扩展挂在空段落上的 `data-placeholder`，再由 CSS `::before` 画出来。按 `placeholder` 属性
// （断言 / getAttribute / DOM 属性 / 属性选择器 / getByPlaceholder）读它，读到 null，而且只在夜跑里红、没人在 PR 里看见。
// 读占位的唯一出口是 composerPlaceholder / expectComposerPlaceholder（读空段落 `::before` 画出来的字，也就是用户眼睛看到的那句）。
const BIND = /(?:const|let|var)\s+(\w+)\s*=\s*[^\n]*?(?:COMPOSER_INPUT|data-v4-control="input")/g
const READ = /\.(?:toHaveValue|inputValue)\s*\(/
const INPUT_REF = /COMPOSER_INPUT|data-v4-control="input"/
/** 按 `placeholder` 读：属性断言 / getAttribute / DOM 属性 / 属性选择器 / getByPlaceholder。`data-placeholder`、`face.placeholder` 这类别的名字不算。 */
const PLACEHOLDER_READ = /(?:toHaveAttribute|getAttribute)\s*\(\s*(['"`])placeholder\1|\.placeholder\b|\[placeholder\b|\bgetByPlaceholder\s*\(/
/** 读占位时，主语放宽到整个输入区块：区块里唯一带占位的就是输入框。`\b` 让 `NODE_COMPOSER`（生成节点自己的生成框）、`COMPOSER_SEND` 不算。 */
const COMPOSER_REF = /\bCOMPOSER_INPUT\b|\bCOMPOSER\b|data-v4-control="input"|data-v4-block="composer"/

/**
 * 把方法链换行写的语句并回一行：`await expect(x.locator(COMPOSER_INPUT))` 与 `.toHaveAttribute('placeholder', …)` 分在两行是本仓
 * 常见排版，只看单行会让主语和读法对不上。`...spread` 不是续行。
 */
function logicalLines(code) {
  const out = []
  code.split('\n').forEach((raw, index) => {
    if (out.length && /^\s*(?:\?\.|\.(?!\.))/.test(raw)) out[out.length - 1].text += ` ${raw.trim()}`
    else out.push({ line: index + 1, text: raw })
  })
  return out
}

/**
 * @param {string} code 走查源码（已剥注释）
 * @returns {{ line: number, text: string, use: string }[]}
 */
export function findComposerInputReads(code) {
  const lines = logicalLines(code)
  const names = new Set([...lines.map((l) => l.text).join('\n').matchAll(BIND)].map((m) => m[1]))
  const hits = []
  const useValue = '改用 composerText() / expectComposerText()（agent-runtime-walk-support.mjs）'
  const usePlaceholder = '改用 composerPlaceholder() / expectComposerPlaceholder()（agent-runtime-walk-support.mjs）：TipTap 输入框没有 placeholder 属性，占位是空段落 ::before 画出来的字'
  for (const { line, text } of lines) {
    const push = (use) => hits.push({ line, text: text.trim().slice(0, 120), use })
    if (/textarea\[data-v4-control="input"\]/.test(text)) { push(useValue); continue }
    if (READ.test(text)) {
      if (INPUT_REF.test(text)) { push(useValue); continue }
      if ([...names].some((name) => new RegExp(String.raw`(?:expect\(\s*${name}\b|\b${name}\s*\.\s*inputValue)`).test(text))) { push(useValue); continue }
    }
    if (PLACEHOLDER_READ.test(text)) {
      if (COMPOSER_REF.test(text)) { push(usePlaceholder); continue }
      if ([...names].some((name) => new RegExp(String.raw`(?:expect\(\s*${name}\b|\b${name}\s*\.\s*(?:getAttribute|evaluate|getByPlaceholder))`).test(text))) push(usePlaceholder)
    }
  }
  return hits
}
