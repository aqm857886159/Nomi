import type { SkillCuration } from '../../../electron/shared/skillCuration'

export type LibraryCategory = { id: string; label: string }
export type LibraryGroup<T> = { id: string; label?: string; items: T[]; collapsed: boolean }

const LOCALIZED_SOURCE_LABELS: Readonly<Record<string, { readonly 'zh-CN': string; readonly en: string }>> = {
  'builtin-expressions': { 'zh-CN': '表情预设', en: 'Expressions' },
  'imgedify-gpt4o': { 'zh-CN': 'GPT-4o 图像', en: 'GPT-4o Image' },
  'sora-official': { 'zh-CN': 'Sora 官方', en: 'Sora Official' },
}

/** C20: category identity comes from declared metadata, never title heuristics. */
export function libraryGroup(item: { curation?: SkillCuration; sourceId?: string; source?: string; origin?: string }, language: string): LibraryCategory | undefined {
  const locale = language.startsWith('zh') ? 'zh-CN' : 'en'
  if (item.curation) return { id: `category:${item.curation.group.en}`, label: item.curation.group[locale] }
  if (item.origin === 'public' && item.sourceId && item.source) {
    const localized = LOCALIZED_SOURCE_LABELS[item.sourceId]
    return { id: `source:${item.sourceId}`, label: localized ? localized[locale] : item.source }
  }
  return undefined
}

export function groupLibraryItems<T extends { id: string }>(items: readonly T[], category: (item: T) => LibraryCategory | undefined): LibraryGroup<T>[] {
  const groups = new Map<string, LibraryGroup<T>>()
  let previous: LibraryGroup<T> | undefined
  for (const item of items) {
    const group = category(item)
    if (!group && previous && !previous.label) { previous.items.push(item); continue }
    const id = group ? `group:${group.id}` : `item:${item.id}`
    const entry = groups.get(id) ?? { id, label: group?.label, items: [], collapsed: false }
    entry.items.push(item)
    entry.collapsed = Boolean(group) && entry.items.length > 4
    groups.set(id, entry)
    previous = entry
  }
  return [...groups.values()]
}
