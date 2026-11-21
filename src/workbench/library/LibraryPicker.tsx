import React, { type JSX } from 'react'
import { cn } from '../../utils/cn'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../../design'
import { SkillMedia } from '../skillLibrary/SkillMedia'
import { LibraryGroup } from './LibraryGroup'
import { groupLibraryItems, type LibraryCategory } from './libraryGroups'

export type LibraryPickerRow = Readonly<{
  group?: LibraryCategory
  id: string
  name: string
  command: string
  desc: string
  section: string
  cover?: string
  preview?: { url: string; type: 'image' | 'video' }
  selected?: boolean
}>

/** Skill and node presets share the same chooser; hosts own data, filtering and application. */
export function LibraryPicker({ rows, categories, activeCategory, query, onQueryChange, onSelectCategory,
  onSelect, searchLabel, autoFocus, mediaFallback, status, empty, footer, rowAttributes, previewAttributes,
}: {
  rows: readonly LibraryPickerRow[]
  categories: readonly string[]
  activeCategory?: string
  query?: string
  onQueryChange?: (value: string) => void
  onSelectCategory?: (category: string) => void
  onSelect?: (row: LibraryPickerRow) => void
  searchLabel: string
  autoFocus?: boolean
  mediaFallback?: React.ReactNode
  status?: React.ReactNode
  empty?: React.ReactNode
  footer?: React.ReactNode
  rowAttributes?: (row: LibraryPickerRow) => Record<string, string>
  previewAttributes?: (row: LibraryPickerRow) => Record<string, string>
}): JSX.Element {
  const [localCategory, setLocalCategory] = React.useState(categories[0])
  const selectedCategory = activeCategory ?? localCategory
  const visibleRows = rows.filter(row => selectedCategory === categories[0] || row.section === selectedCategory)
  return <aside data-library-picker className="w-[330px] max-w-[calc(100vw-24px)] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-md">
    <input value={query ?? ''} readOnly={!onQueryChange} autoFocus={autoFocus}
      onChange={event => onQueryChange?.(event.target.value)}
      placeholder={searchLabel} aria-label={searchLabel} data-library-search data-v4-control="skill-search"
      className="mx-2.5 mb-1.5 mt-2 flex h-7 w-[calc(100%-20px)] items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-transparent px-2 text-caption text-nomi-ink outline-none placeholder:text-nomi-ink-40" />
    <div className="flex gap-1 overflow-x-auto px-2.5 pb-1.5">
      {categories.map(category => <button type="button" key={category} aria-pressed={selectedCategory === category}
        onClick={() => { setLocalCategory(category); onSelectCategory?.(category) }}
        className={cn('flex min-w-0 h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2 text-micro',
          selectedCategory === category ? 'bg-nomi-ink text-nomi-paper' : 'bg-nomi-ink-05 text-nomi-ink-60')}>
        {category}
      </button>)}
    </div>
    {status}
    <div className="max-h-[260px] overflow-y-auto overscroll-contain">
      {visibleRows.length === 0 ? empty : null}
      {groupLibraryItems(visibleRows, row => row.group ? { ...row.group, id: `${row.section}:${row.group.id}` } : undefined).map(group => (
        <LibraryGroup key={`${group.id}:${Boolean(query?.trim())}`} group={query?.trim() ? { ...group, collapsed: false } : group}>
          {group.items.map(row => <HoverCard key={row.id}>
            <HoverCardTrigger asChild><button type="button" onClick={() => onSelect?.(row)}
              data-library-option={row.id} {...rowAttributes?.(row)}
              className={cn('flex w-full items-start gap-2.5 px-2.5 py-2 text-left hover:bg-nomi-ink-05 focus-visible:bg-nomi-ink-05', row.selected && 'bg-nomi-ink-05')}>
              <SkillMedia cover={row.cover} preview={row.preview} fallback={mediaFallback} className="h-9 w-14 shrink-0 rounded-nomi-sm object-cover" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-caption font-medium text-nomi-ink">{row.name}
                  {row.command ? <code className="ml-1 font-nomi-mono text-micro font-normal text-nomi-ink-40">{row.command}</code> : null}
                </span>
                <span className="block truncate text-micro text-nomi-ink-60">{row.desc}</span>
              </span>
            </button></HoverCardTrigger>
            <HoverCardContent side="right">
              <div {...previewAttributes?.(row)} className="max-h-[60vh] overflow-y-auto">
                <SkillMedia cover={row.cover} preview={row.preview} fallback={mediaFallback} play className="mb-3 max-h-60 w-full rounded-nomi-sm object-contain" />
                <strong className="text-title">{row.name}</strong>
                <p className="mt-2 whitespace-pre-wrap text-caption leading-relaxed text-nomi-ink-60">{row.desc}</p>
              </div>
            </HoverCardContent>
          </HoverCard>)}
        </LibraryGroup>
      ))}
    </div>
    {footer}
  </aside>
}
