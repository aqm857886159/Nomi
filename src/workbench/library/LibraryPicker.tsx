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
  command?: string
  desc: string
  section: string
  cover?: string
  preview?: { url: string; type: 'image' | 'video' }
  illustration?: boolean
  selected?: boolean
}>

export type LibraryPickerKeyEvent = Pick<React.KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault' | 'stopPropagation'> & {
  nativeEvent?: { isComposing?: boolean }
}

export type LibraryPickerHandle = {
  handleKeyDown: (event: LibraryPickerKeyEvent) => boolean
}

/** Skill and node presets share the same chooser; hosts own data, filtering and application. */
export function LibraryPicker({
  rows,
  categories,
  activeCategory,
  query,
  onQueryChange,
  onSelectCategory,
  onSelect,
  onClose,
  searchLabel,
  panelLabel,
  autoFocus,
  mediaFallback,
  status,
  empty,
  footer,
  rowAttributes,
  previewAttributes,
  pickerRef,
}: {
  rows: readonly LibraryPickerRow[]
  categories: readonly string[]
  activeCategory?: string
  query?: string
  onQueryChange?: (value: string) => void
  onSelectCategory?: (category: string) => void
  onSelect?: (row: LibraryPickerRow) => void
  onClose?: () => void
  searchLabel: string
  panelLabel?: string
  autoFocus?: boolean
  mediaFallback?: React.ReactNode
  status?: React.ReactNode
  empty?: React.ReactNode
  footer?: React.ReactNode
  rowAttributes?: (row: LibraryPickerRow) => Record<string, string>
  previewAttributes?: (row: LibraryPickerRow) => Record<string, string>
  pickerRef?: React.Ref<LibraryPickerHandle>
}): JSX.Element {
  const [localCategoryIndex, setLocalCategoryIndex] = React.useState(0)
  const [expandedGroupIds, setExpandedGroupIds] = React.useState<ReadonlySet<string>>(() => new Set())
  const [activeRowId, setActiveRowId] = React.useState<string | null>(null)
  const optionButtonsRef = React.useRef(new Map<string, HTMLButtonElement>())

  const selectedCategory = activeCategory && categories.includes(activeCategory)
    ? activeCategory
    : (categories[localCategoryIndex] ?? categories[0])

  const visibleRows = React.useMemo(
    () => rows.filter((row) => selectedCategory === categories[0] || row.section === selectedCategory),
    [categories, rows, selectedCategory],
  )
  const isSearching = Boolean(query?.trim())
  const groups = React.useMemo(
    () => groupLibraryItems(visibleRows, (row) => (row.group ? { ...row.group, id: `${row.section}:${row.group.id}` } : undefined)),
    [visibleRows],
  )

  const navigableRows = React.useMemo(
    () => groups.flatMap((group) => (isSearching || !group.collapsed || expandedGroupIds.has(group.id) ? group.items : [])),
    [expandedGroupIds, groups, isSearching],
  )

  const effectiveActiveId = React.useMemo(() => {
    if (activeRowId && navigableRows.some((row) => row.id === activeRowId)) return activeRowId
    if (isSearching && navigableRows.length > 0) return navigableRows[0].id
    return null
  }, [activeRowId, isSearching, navigableRows])

  React.useEffect(() => {
    if (!effectiveActiveId) return
    optionButtonsRef.current.get(effectiveActiveId)?.scrollIntoView?.({ block: 'nearest' })
  }, [effectiveActiveId])

  const handleNavigationKey = React.useCallback((event: LibraryPickerKeyEvent): boolean => {
    if (event.nativeEvent?.isComposing) return false
    if (event.key === 'Escape') {
      if (!onClose) return false
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return true
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      if (navigableRows.length === 0) {
        const targetGroup = event.key === 'ArrowDown'
          ? groups.find((group) => group.collapsed && !expandedGroupIds.has(group.id))
          : [...groups].reverse().find((group) => group.collapsed && !expandedGroupIds.has(group.id))
        if (targetGroup && targetGroup.items.length > 0) {
          setExpandedGroupIds((prev) => new Set(prev).add(targetGroup.id))
          const nextRow = event.key === 'ArrowDown' ? targetGroup.items[0] : targetGroup.items[targetGroup.items.length - 1]
          setActiveRowId(nextRow.id)
        }
        return true
      }
      const currentIndex = effectiveActiveId ? navigableRows.findIndex((row) => row.id === effectiveActiveId) : -1
      const nextIndex = event.key === 'ArrowDown'
        ? (currentIndex < 0 ? 0 : (currentIndex + 1) % navigableRows.length)
        : (currentIndex <= 0 ? navigableRows.length - 1 : currentIndex - 1)
      setActiveRowId(navigableRows[nextIndex]?.id ?? null)
      return true
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      const targetRow = (effectiveActiveId ? navigableRows.find((row) => row.id === effectiveActiveId) : undefined)
        ?? (isSearching ? navigableRows[0] : undefined)
      if (targetRow) {
        event.preventDefault()
        event.stopPropagation()
        onSelect?.(targetRow)
        return true
      }
      if (isSearching) {
        event.preventDefault()
        event.stopPropagation()
        return true
      }
    }
    return false
  }, [effectiveActiveId, expandedGroupIds, groups, isSearching, navigableRows, onClose, onSelect])

  React.useImperativeHandle(pickerRef, () => ({ handleKeyDown: handleNavigationKey }), [handleNavigationKey])

  const optionId = (id: string) => `library-picker-option-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`

  return (
    <aside
      data-library-picker
      aria-label={panelLabel}
      className="w-[340px] max-w-[calc(100vw-24px)] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-md"
      onKeyDown={(event) => {
        const tag = (event.target as HTMLElement | null)?.tagName
        // 焦点落在分类钮、分组 summary 或底栏钮上时，Enter 留给原生按钮激活；搜索框与列表行走键盘导航。
        if (event.key === 'Enter' && tag !== 'INPUT' && !(event.target as HTMLElement | null)?.hasAttribute('data-library-option')) return
        handleNavigationKey(event)
      }}
    >
      <div className="px-2.5 pb-1.5 pt-2.5">
        <input
          value={query ?? ''}
          readOnly={!onQueryChange}
          autoFocus={autoFocus}
          onChange={(event) => onQueryChange?.(event.target.value)}
          placeholder={searchLabel}
          aria-label={searchLabel}
          aria-activedescendant={effectiveActiveId ? optionId(effectiveActiveId) : undefined}
          data-library-search
          data-v4-control="skill-search"
          className="flex h-[30px] w-full items-center rounded-nomi-sm border border-nomi-line bg-transparent px-2 text-caption text-nomi-ink outline-none placeholder:text-nomi-ink-40"
        />
      </div>
      <div className="flex gap-1 overflow-x-auto px-2.5 pb-2">
        {categories.map((category, index) => (
          <button
            type="button"
            key={category}
            aria-pressed={selectedCategory === category}
            onClick={() => {
              setLocalCategoryIndex(index)
              onSelectCategory?.(category)
            }}
            className={cn(
              'flex h-[22px] min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2 text-micro',
              selectedCategory === category ? 'bg-nomi-ink text-nomi-paper' : 'bg-nomi-ink-05 text-nomi-ink-60 hover:text-nomi-ink',
            )}
          >
            {category}
          </button>
        ))}
      </div>
      {status}
      <div role="listbox" aria-label={panelLabel ?? searchLabel} className="max-h-[260px] overflow-y-auto overscroll-contain pb-1.5">
        {visibleRows.length === 0 ? empty : null}
        {groups.map((group) => {
          const isOpen = isSearching || !group.collapsed || expandedGroupIds.has(group.id)
          return (
            <LibraryGroup
              key={`${group.id}:${isSearching}`}
              group={isSearching ? { ...group, collapsed: false } : group}
              open={group.collapsed && !isSearching ? (expandedGroupIds.has(group.id) ? true : undefined) : undefined}
              onToggle={(nextOpen) => {
                setExpandedGroupIds((prev) => {
                  const next = new Set(prev)
                  if (nextOpen) next.add(group.id)
                  else next.delete(group.id)
                  return next
                })
              }}
            >
              {group.items.map((row) => {
                const isActive = isOpen && effectiveActiveId === row.id
                return (
                  <HoverCard key={row.id}>
                    <HoverCardTrigger asChild>
                      <button
                        ref={(element) => {
                          if (element) optionButtonsRef.current.set(row.id, element)
                          else optionButtonsRef.current.delete(row.id)
                        }}
                        id={optionId(row.id)}
                        type="button"
                        role="option"
                        aria-selected={isActive || Boolean(row.selected)}
                        onMouseEnter={() => setActiveRowId(row.id)}
                        onClick={() => onSelect?.(row)}
                        data-library-option={row.id}
                        data-library-active={isActive ? 'true' : undefined}
                        {...rowAttributes?.(row)}
                        className={cn(
                          'flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-nomi-ink-05 focus-visible:bg-nomi-ink-05',
                          (row.selected || isActive) && 'bg-nomi-ink-05',
                        )}
                      >
                        <SkillMedia
                          cover={row.cover}
                          preview={row.preview}
                          illustration={row.illustration}
                          preferCover
                          fallback={mediaFallback}
                          iconSize={16}
                          className="h-[35px] w-14 shrink-0 rounded-nomi-sm object-cover"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-caption font-medium text-nomi-ink">{row.name}</span>
                          <span className="block truncate text-micro text-nomi-ink-60">{row.desc}</span>
                        </span>
                      </button>
                    </HoverCardTrigger>
                    <HoverCardContent side="right">
                      <div {...previewAttributes?.(row)} className="max-h-[60vh] overflow-y-auto">
                        <SkillMedia
                          cover={row.cover}
                          preview={row.preview}
                          illustration={row.illustration}
                          fallback={mediaFallback}
                          play
                          className="mb-3 max-h-60 w-full rounded-nomi-sm object-contain"
                        />
                        <strong className="text-title">{row.name}</strong>
                        <p className="mt-2 whitespace-pre-wrap text-caption leading-relaxed text-nomi-ink-60">{row.desc}</p>
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                )
              })}
            </LibraryGroup>
          )
        })}
      </div>
      {footer}
    </aside>
  )
}
