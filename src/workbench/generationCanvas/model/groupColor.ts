/**
 * 组颜色（用户 2026-10-10 拍板，取代 10-06 的方案 B）：底色上色，不上边框。
 *
 * 默认：框内很淡的中性灰底（`soft` token）。选了颜色：底色换成该颜色的淡色（同名 `-soft` token，亮 / 暗各一套）。
 * 边框不上色（已经靠底色区分）。选中分组不加任何描边——选中态靠工具条出现来表示。
 * 工具条颜色按钮上的小圆点是当前色（`dot`），框头里不再有圆点。
 *
 * 存档字段是 `NodeGroup.colorToken`（存 token 名）。旧字段 `NodeGroup.color`（历史上存过 `#3b82f6`
 * 这类自定义色）读盘后一律忽略、不进渲染层——老项目打开，组仍是灰的。
 * 所有颜色都是类名里的静态 token，不写行内 style（设计系统 §4.4）。
 */
export const GROUP_COLOR_IDS = ['neutral', 'ocean', 'teal', 'amber', 'coral', 'violet', 'rose'] as const

export type GroupColorId = (typeof GROUP_COLOR_IDS)[number]

export const DEFAULT_GROUP_COLOR: GroupColorId = 'neutral'

/** 读盘归一化：只认合法的非灰 token 名；空、灰、未知值（含旧版十六进制）都回到 undefined = 灰。 */
export function normalizeGroupColorToken(value: unknown): Exclude<GroupColorId, 'neutral'> | undefined {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (candidate === DEFAULT_GROUP_COLOR) return undefined
  return (GROUP_COLOR_IDS as readonly string[]).includes(candidate)
    ? (candidate as Exclude<GroupColorId, 'neutral'>)
    : undefined
}

/** 渲染用：没选过色 = 灰。 */
export function resolveGroupColor(token: string | undefined): GroupColorId {
  return normalizeGroupColorToken(token) ?? DEFAULT_GROUP_COLOR
}

/** Tailwind 只扫字面量类名，所以这里必须是静态表，不能拼字符串。 */
const GROUP_COLOR_CLASS: Record<GroupColorId, { soft: string; dot: string }> = {
  neutral: { soft: 'bg-nomi-group-neutral-soft', dot: 'bg-nomi-group-neutral' },
  ocean: { soft: 'bg-nomi-group-ocean-soft', dot: 'bg-nomi-group-ocean' },
  teal: { soft: 'bg-nomi-group-teal-soft', dot: 'bg-nomi-group-teal' },
  amber: { soft: 'bg-nomi-group-amber-soft', dot: 'bg-nomi-group-amber' },
  coral: { soft: 'bg-nomi-group-coral-soft', dot: 'bg-nomi-group-coral' },
  violet: { soft: 'bg-nomi-group-violet-soft', dot: 'bg-nomi-group-violet' },
  rose: { soft: 'bg-nomi-group-rose-soft', dot: 'bg-nomi-group-rose' },
}

export function groupColorClass(token: string | undefined): { soft: string; dot: string } {
  return GROUP_COLOR_CLASS[resolveGroupColor(token)]
}
