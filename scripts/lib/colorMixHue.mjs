// color-mix 色相漂移分析 —— 根治「有色相的色 × 被钉了色相的中性色，用 in oklch 混」整类 bug。
//
// 背景（2026-08-02 实锤，Chromium 126 / Electron 31）：
//   --nomi-accent-soft: color-mix(in oklch, var(--nomi-accent) 12%, var(--nomi-paper))
//   期望淡蓝，实际浅色算出 oklch(0.946 0.0156 346.8) = 粉、暗色算出 oklch(0.356 0.039 124.2) = 橄榄绿。
//   根因：oklch 是极坐标空间，插值时**色相分量走最短弧**；而 --nomi-paper 显式写了色相
//   （浅 oklch(1 0 0) → h=0 / 暗 oklch(0.235 0.007 80) → h=80）。白/近中性色的色相在感知上无意义
//   （powerless），但只要在 oklch() 里写成数字，color-mix 就当真拿它插值 —— accent 的 h250 被一路
//   拽向 paper 的色相，落在两者之间某个跟谁都不像的色相上。全 App 80+ 个 accent-soft 消费点跟着跑色。
//
// 本模块把 Chromium 的行为**精确建模**（下方 mixInOklch 的最短弧公式已用真机实测值对齐，见同目录
// ../colorMixHue.test.mjs），供两处共用，避免两份实现漂移：
//   1. scripts/check-design-tokens.mjs 的门岗规则 —— 静态拦住新写的同类混合；
//   2. scripts/colorMixHue.test.mjs 的回归断言 —— 盯死 accent-soft 实际算出来还是不是蓝的。
//
// 修法结论：改用 `in srgb`（无色相分量，不存在弧插值）。这也是仓库既有做法 —— --nomi-focus
// 与滚动条色早就写的 in srgb。`oklch(1 0 none)` 让色相 powerless 的路子已实测否决：暗色 paper
// 的 chroma 非 0（0.007 @ h80，是刻意的暖灰），改成 none 会把整个暗色纸面从暖灰(h≈85)变成粉灰(h≈0.6)。

// ── 颜色数学（oklch ↔ sRGB）────────────────────────────────────────────────
// 参考 Björn Ottosson 的 Oklab 矩阵。只用于算色相/校验，不追求 gamut mapping 精度。

const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)
const clamp01 = (v) => Math.min(1, Math.max(0, v))

/** 线性 sRGB → OKLab */
function linearSrgbToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** OKLab → 线性 sRGB */
function oklabToLinearSrgb([L, a, bb]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** oklch {l,c,h} → sRGB 0..1（超 gamut 直接 clamp，够用） */
export function oklchToSrgb({ l, c, h }) {
  const rad = ((h ?? 0) * Math.PI) / 180
  const lin = oklabToLinearSrgb([l, c * Math.cos(rad), c * Math.sin(rad)])
  return lin.map((v) => clamp01(linearToSrgb(v)))
}

/** sRGB 0..1 → oklch {l,c,h}（h 归一化到 [0,360)） */
export function srgbToOklch([r, g, b]) {
  const [L, a, bb] = linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)])
  let h = (Math.atan2(bb, a) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: L, c: Math.hypot(a, bb), h }
}

// ── 色相弧 ────────────────────────────────────────────────────────────────

/** 两个色相之间的最短弧夹角（0..180） */
export function hueDelta(h1, h2) {
  const d = Math.abs(((h1 - h2) % 360) + 360) % 360
  return d > 180 ? 360 - d : d
}

/**
 * 按 CSS Color 5 在 oklch 里混色：L/C 线性插值，H **走最短弧**插值。
 * `ratioA` = 第一个操作数的权重（0..1）。
 * 已对齐 Chromium 126 实测：accent(h250) 12% + paper(h0) → h=346.8；26% + paper(h80) → h=124.2。
 */
export function mixInOklch(a, b, ratioA) {
  const t = 1 - ratioA // 从 a 走向 b 的进度
  let dh = ((b.h - a.h) % 360 + 360) % 360
  if (dh > 180) dh -= 360 // 最短弧：必要时走负向
  let h = a.h + dh * t
  h = ((h % 360) + 360) % 360
  return { l: a.l + (b.l - a.l) * t, c: a.c + (b.c - a.c) * t, h }
}

/** 按 CSS Color 5 在 sRGB 里混色（分量线性插值，无色相分量）。返回 oklch 以便读色相。 */
export function mixInSrgb(a, b, ratioA) {
  const t = 1 - ratioA
  const ca = oklchToSrgb(a)
  const cb = oklchToSrgb(b)
  return srgbToOklch(ca.map((v, i) => v + (cb[i] - v) * t))
}

// ── CSS 解析 ──────────────────────────────────────────────────────────────

const OKLCH_LITERAL = /^oklch\(\s*([0-9.]+%?)\s+([0-9.]+%?)\s+([0-9.]+)(?:deg)?\s*(?:\/.*)?\)$/i

/** 解析 `oklch(L C H)` / `oklch(L C H / A)` 字面量；色相缺失或写 none 则返回 h=null。 */
export function parseOklchLiteral(raw) {
  const text = String(raw).trim()
  const m = OKLCH_LITERAL.exec(text)
  if (!m) {
    // 显式 none 色相：感知无意义且不参与弧插值，视为「无色相」
    if (/^oklch\([^)]*\bnone\b[^)]*\)$/i.test(text)) {
      const parts = text.slice(6, -1).split('/')[0].trim().split(/\s+/)
      const num = (v) => (v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v))
      return { l: num(parts[0]) || 0, c: num(parts[1]) || 0, h: null }
    }
    return null
  }
  const num = (v, scale) => (v.endsWith('%') ? (parseFloat(v) / 100) * scale : parseFloat(v))
  return { l: num(m[1], 1), c: num(m[2], 0.4), h: parseFloat(m[3]) }
}

/**
 * 从若干文件内容里收集 token 定义：`--x: <value>` （CSS）与 `'--x': '<value>'`（addBase 对象）。
 * 同名 token 在明/暗两套主题各有一份定义 → 值为**数组**，全部保留。
 */
export function collectTokenDefinitions(contents) {
  const defs = new Map()
  const add = (name, value) => {
    const v = value.trim().replace(/[,;]$/, '').trim()
    if (!v) return
    if (!defs.has(name)) defs.set(name, [])
    if (!defs.get(name).includes(v)) defs.get(name).push(v)
  }
  for (const content of contents) {
    // addBase 对象字面量：'--x': 'value'
    for (const m of content.matchAll(/['"](--[A-Za-z0-9-]+)['"]\s*:\s*['"]([^'"]+)['"]/g)) add(m[1], m[2])
    // CSS 声明：--x: value;（排除上面已处理的带引号形式）
    for (const m of content.matchAll(/(?:^|[;{\s])(--[A-Za-z0-9-]+)\s*:\s*([^;{}'"]+)[;}]/gm)) add(m[1], m[2])
  }
  return defs
}

/**
 * 把一个操作数解析成可能的 oklch 值列表。
 * - `transparent` → 返回 'transparent'（这条**只管两个操作数之间的弧插值**：transparent 没有色相，
 *   不会把对方往哪边拽。它**不代表** `color-mix(in oklch, X, transparent)` 整体安全——见下方
 *   analyzeHueDrift 里那条 continue 的长注：低彩度的 X 会在转进 oklch 时被判 powerless、色相写成 `none`）
 * - `var(--x)` → 查表，最多跟一层别名（--nomi-track-text: var(--nomi-accent)）
 * - `oklch(...)` 字面量 → 直接解析
 * 解析不出（如该 token 本身就是 color-mix / 非 oklch 写法）→ 返回空数组 = 不下判断。
 */
export function resolveOperand(raw, defs, depth = 0) {
  const text = String(raw).trim()
  if (/^transparent$/i.test(text)) return 'transparent'
  const varMatch = /^var\(\s*(--[A-Za-z0-9-]+)\s*\)$/.exec(text)
  if (varMatch) {
    if (depth > 2) return []
    const values = defs.get(varMatch[1]) ?? []
    const out = []
    for (const v of values) {
      const r = resolveOperand(v, defs, depth + 1)
      if (r === 'transparent') return 'transparent'
      out.push(...r)
    }
    return out
  }
  const lit = parseOklchLiteral(text)
  return lit ? [lit] : []
}

/** 找出内容里所有 `color-mix(in oklch, A p%, B)`，返回 {line, a, percent, b, text}。 */
export function findOklchMixes(content) {
  const found = []
  const lines = content.split('\n')
  lines.forEach((line, idx) => {
    for (const m of line.matchAll(
      /color-mix\(\s*in\s+oklch\s*,\s*([^,]+?)\s+([0-9.]+%|calc\([^)]*\))\s*,\s*([a-zA-Z0-9_-]+|var\(\s*--[A-Za-z0-9-]+\s*\)|oklch\([^)]*\))\s*\)/g,
    )) {
      found.push({ line: idx + 1, a: m[1].trim(), percent: m[2].trim(), b: m[3].trim(), text: line.trim() })
    }
  })
  return found
}

/**
 * 求值一条 `color-mix(in <space>, A p%, B)` 表达式，返回结果的 oklch。
 * **刻意按写着的混合空间求值**（不假设是哪个）—— 谁把 in srgb 改回 in oklch，算出来的色相就会变，
 * 回归断言随之变红并报出真实色相值，而不是去比字符串。
 */
export function evaluateColorMixExpression(expr, defs) {
  const m = /^color-mix\(\s*in\s+(oklch|srgb)\s*,\s*(.+?)\s+([0-9.]+)%\s*,\s*(.+?)\s*\)$/i.exec(String(expr).trim())
  if (!m) return null
  const [, space, rawA, percent, rawB] = m
  const a = resolveOperand(rawA, defs)
  const b = resolveOperand(rawB, defs)
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 1 || b.length !== 1) return null
  const ratio = parseFloat(percent) / 100
  return space.toLowerCase() === 'oklch' ? mixInOklch(a[0], b[0], ratio) : mixInSrgb(a[0], b[0], ratio)
}

/** 色相漂移判定阈值（度）。低于它人眼看不出色相变化。 */
export const HUE_DRIFT_THRESHOLD = 15

/**
 * 分析一批文件，返回所有「会发生可见色相漂移」的 in oklch 混合。
 * 判据：两个操作数都能解析出带色相的颜色，且**所有可能配对**的色相夹角都 > 阈值
 * （取最小值 —— 明/暗两套定义交叉配对可能不成立，只有全都漂移才算实锤，避免误报）。
 */
export function analyzeHueDrift(files, defs) {
  const findings = []
  for (const { path: filePath, content } of files) {
    for (const mix of findOklchMixes(content)) {
      const a = resolveOperand(mix.a, defs)
      const b = resolveOperand(mix.b, defs)
      // 与 transparent 混不构成**两操作数间**的弧插值（transparent 无色相，拽不动谁），本判据管不着，放行。
      // ⚠️ 但这不等于「混 transparent 安全」——原注写的「实测色相恒等」只在**高彩度**操作数上成立。
      // 2026-09-06 实锤（Chromium 140）：低彩度色转进 oklch 时色相被判 powerless 写成 `none`、彩度却留着，
      // `none` 落地当 h=0 → 淡蓝渲染成淡粉。tailwind.config.ts 的 tokenColor() 曾用 in oklch 包住每一个
      // token 色，--nomi-accent-soft（c≈0.015）因此全 App 显粉；改成 in oklab（直角坐标、没有色相分量）根治。
      // 本判据靠不到那一层：出事的 token 自己就是 color-mix 写的，resolveOperand 解析不出彩度、只能返回 []。
      // 要把这一族也机器化，得先让 resolveOperand 能递归求值嵌套 color-mix，再按彩度阈值判。
      if (a === 'transparent' || b === 'transparent') continue
      if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) continue
      const pairs = []
      for (const ca of a) for (const cb of b) if (ca.h != null && cb.h != null) pairs.push([ca, cb])
      if (pairs.length === 0) continue
      const minDelta = Math.min(...pairs.map(([ca, cb]) => hueDelta(ca.h, cb.h)))
      if (minDelta <= HUE_DRIFT_THRESHOLD) continue
      // 报告列出**每一种**取值组合，不挑「最差的一对」——一个 token 在明/暗两套主题各有定义，
      // 挑最差会报出跨主题的假配对（浅色 accent × 暗色 paper），算出个现实中不存在的色相误导人。
      const ratio = /^([0-9.]+)%$/.exec(mix.percent)
      const seen = new Set()
      const detail = []
      for (const [ca, cb] of pairs) {
        const key = `${ca.h}/${cb.h}`
        if (seen.has(key)) continue
        seen.add(key)
        detail.push({
          hueA: ca.h,
          hueB: cb.h,
          delta: hueDelta(ca.h, cb.h),
          resultHue: ratio ? mixInOklch(ca, cb, parseFloat(ratio[1]) / 100).h : null,
        })
      }
      findings.push({
        file: filePath,
        line: mix.line,
        text: mix.text,
        operandA: mix.a,
        operandB: mix.b,
        delta: minDelta,
        pairs: detail,
      })
    }
  }
  return findings
}
