export const GROUP_COLOR_IDS = ['ocean', 'teal', 'amber', 'coral', 'violet', 'rose'] as const

export type GroupColorId = (typeof GROUP_COLOR_IDS)[number]

export const DEFAULT_GROUP_COLOR: GroupColorId = 'ocean'

const LEGACY_COLOR_ALIASES: Record<string, GroupColorId> = {
  '#3b82f6': 'ocean',
  '#14b8a6': 'teal',
  '#f59e0b': 'amber',
  '#ef4444': 'coral',
  '#8b5cf6': 'violet',
  '#ec4899': 'rose',
}

export function normalizeGroupColor(value: string | undefined): GroupColorId {
  const candidate = String(value ?? '').trim().toLowerCase()
  if ((GROUP_COLOR_IDS as readonly string[]).includes(candidate)) return candidate as GroupColorId
  return LEGACY_COLOR_ALIASES[candidate] ?? DEFAULT_GROUP_COLOR
}

export type GroupColorStyle = {
  borderColor: string
  surfaceColor: string
  markerColor: string
  inkColor: string
}

export function groupColorStyle(value: string | undefined): GroupColorStyle {
  const color = normalizeGroupColor(value)
  return {
    borderColor: `var(--nomi-group-${color})`,
    surfaceColor: `color-mix(in oklch, var(--nomi-group-${color}) 9%, var(--nomi-paper))`,
    markerColor: `var(--nomi-group-${color})`,
    inkColor: `color-mix(in oklch, var(--nomi-group-${color}) 74%, var(--nomi-ink))`,
  }
}
