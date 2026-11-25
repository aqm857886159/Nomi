// 「语义状态色直接加透明度当淡底」扫描器（2026-11-24，源自 #1660 O5「就差充值」卡走灰复盘）。
//
// 为什么不能写 `bg-nomi-warning/10`、`bg-workbench-danger/15`：
//   tailwind.config.ts 的 tokenColor() 把 `/10` 展开为 `color-mix(in oklab, var(--nomi-warning) 10%, transparent)`。
//   而四语义主色（warning / danger / success / info）在浅色下是深描边色（L=0.55，c≈0.085–0.13）：
//   拿 10%–20% 向透明混合叠在白底上，明度被拉暗而彩度塌缩到 c≈0.008–0.015，奶油黄变灰泥色、淡粉变脏灰
//   （tailwind.config.ts 第 ③ 条约束早在 2026-09-07 就写明「soft/edge 是色阶上独立的一档，不是 base 的 alpha」，
//   但此前 check:tokens 未拦组件侧 className 的 `/数字` 写法，导致 #1660 O5 充值卡再次写成 bg-nomi-warning/10 变灰）。
//
// 正确做法：
//   一律用四档语义状态色里的独立浅底档 `-soft`（如 `bg-nomi-warning-soft`、`bg-nomi-danger-soft`、
//   `bg-nomi-success-soft`、`bg-nomi-info-soft` 及对应 `workbench-*`），配 `-edge` 描边与 `-ink` 字色。
//   中性色半透明（`bg-nomi-paper/80`、`bg-nomi-ink-05/60`）无色相塌缩问题，不在本规则范围内；
//   对 `-soft` 本身做悬停微调（如 `hover:bg-workbench-danger-soft/80`）也不拦。

const STATUS_BASE = '(?:nomi|workbench)-(?:warning|danger|success|info)'

/** Tailwind 透明度修饰符写法：bg-nomi-warning/10、hover:bg-workbench-danger/15、bg-nomi-info/[0.12] */
const NAMED = new RegExp(String.raw`(?<![\w-])bg-${STATUS_BASE}\/(?:[0-9]+|\[[^\]]+\])`, 'g')

/** Tailwind 任意值向 transparent 混合：bg-[color-mix(in_oklab,var(--nomi-warning)_12%,transparent)] */
const ARBITRARY = new RegExp(
  String.raw`(?<![\w-])bg-\[[^\]\s]*color-mix\([^\]]*var\(--${STATUS_BASE}(?![\w-])[^\]]*transparent`,
  'g',
)

/** CSS / 行内样式向 transparent 混合：background: color-mix(in oklab, var(--nomi-warning) 12%, transparent) */
const DECLARATION = new RegExp(
  String.raw`(?:^|[\s{;,'"])(?:background(?:-color|Color)?)['"]?\s*:[^;]*color-mix\([^;]*var\(--${STATUS_BASE}(?![\w-])[^;]*transparent`,
  'g',
)

export const SEMANTIC_SOFT_TINT_FIX_HINT =
  '改用四档语义浅底 token（bg-nomi-warning-soft / bg-nomi-danger-soft / bg-nomi-success-soft / bg-nomi-info-soft 或 workbench-*-soft），配 -edge 描边与 -ink 字色；禁止拿深色 base 加 /透明度 向 transparent 摊薄（彩度塌成灰泥色）'

/** 单行命中数；注释行（//、*、/* 开头）不计。 */
export function countSemanticSoftTintInLine(line) {
  const trimmed = line.trim()
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return 0
  let count = 0
  for (const re of [NAMED, ARBITRARY, DECLARATION]) {
    re.lastIndex = 0
    count += (line.match(re) ?? []).length
  }
  return count
}

export function countSemanticSoftTintInText(text) {
  let count = 0
  for (const line of text.split('\n')) count += countSemanticSoftTintInLine(line)
  return count
}
