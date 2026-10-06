/**
 * 组颜色（方案 B，用户 2026-10-06 拍板）：默认中性灰；可选色只上边框和标题前的小圆点，不填底色。
 *
 * 存档字段是 `NodeGroup.colorToken`（存 token 名）。旧字段 `NodeGroup.color`（历史上存过 `#3b82f6`
 * 这类自定义色）读盘后一律忽略、不进渲染层——老项目打开，组仍是灰的；只有用户在新选色器里亲手选过的才上色。
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
const GROUP_COLOR_CLASS: Record<GroupColorId, { border: string; dot: string }> = {
  neutral: { border: 'border-nomi-group-neutral', dot: 'bg-nomi-group-neutral' },
  ocean: { border: 'border-nomi-group-ocean', dot: 'bg-nomi-group-ocean' },
  teal: { border: 'border-nomi-group-teal', dot: 'bg-nomi-group-teal' },
  amber: { border: 'border-nomi-group-amber', dot: 'bg-nomi-group-amber' },
  coral: { border: 'border-nomi-group-coral', dot: 'bg-nomi-group-coral' },
  violet: { border: 'border-nomi-group-violet', dot: 'bg-nomi-group-violet' },
  rose: { border: 'border-nomi-group-rose', dot: 'bg-nomi-group-rose' },
}

export function groupColorClass(token: string | undefined): { border: string; dot: string } {
  return GROUP_COLOR_CLASS[resolveGroupColor(token)]
}
