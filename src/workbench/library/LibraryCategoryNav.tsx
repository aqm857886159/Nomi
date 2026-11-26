import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { WorkbenchMenu, type WorkbenchMenuNode } from '../../design'
import type { WorkbenchMenuAnchorRect } from '../../design/menu'
import { LIBRARY_CATEGORY_ALL, type LibraryNavGroup } from './libraryLayout'

/**
 * 两个库共用的分类列（设计卡 ★9 第 3 条：左侧分类常驻，三段有名字——我的 / 内置 / 公开库）。
 * 宽页常驻左侧（`LibraryCategoryNav`）；抽屉里收进一颗「分类 ▾」（`LibraryCategoryMenu`），提示词抽屉同一颗里还管图片 / 视频。
 * 来源标签那一长排（横向滚动）删了，并进这里（P-03）。
 */
function segmentLabel(t: (key: string) => string, segment: LibraryNavGroup['segment']): string | undefined {
  if (segment === 'builtin') return t('libraries.layout.segment.builtin')
  if (segment === 'public') return t('libraries.layout.segment.public')
  return undefined
}

export function LibraryCategoryNav({ groups, value, onChange, ariaLabel }: {
  groups: readonly LibraryNavGroup[]
  value: string
  onChange: (id: string) => void
  ariaLabel: string
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <nav aria-label={ariaLabel} className="flex w-[176px] shrink-0 flex-col gap-0.5 overflow-y-auto pb-8 [scrollbar-width:none]" data-library-category-nav>
      {groups.map((group) => (
        <React.Fragment key={group.segment}>
          {segmentLabel(t, group.segment) ? (
            <div className="mb-1 ml-2.5 mt-3.5 text-micro text-nomi-ink-40" data-library-category-segment={group.segment}>{segmentLabel(t, group.segment)}</div>
          ) : null}
          {group.entries.map((entry) => {
            const active = entry.id === value
            return (
              <button
                key={entry.id}
                type="button"
                aria-current={active ? 'true' : undefined}
                title={entry.label}
                onClick={() => onChange(entry.id)}
                data-library-category={entry.id}
                className={cn(
                  'flex h-7 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-nomi-sm border-0 px-2.5 text-left text-body-sm',
                  'transition-colors duration-nomi-fast ease-nomi-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink',
                  active ? 'bg-nomi-ink-05 font-semibold text-nomi-ink' : 'bg-transparent text-nomi-ink-80 hover:bg-nomi-ink-05',
                )}
              >
                <span className="min-w-0 truncate">{entry.label}</span>
                <span className="shrink-0 text-caption font-normal tabular-nums text-nomi-ink-40">{entry.count}</span>
              </button>
            )
          })}
        </React.Fragment>
      ))}
    </nav>
  )
}

/** 一组额外的单选（提示词抽屉的「全部 / 图片 / 视频」），和分类同一颗菜单里。 */
export type LibraryMenuChoice = Readonly<{ label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (value: string) => void }>

export function LibraryCategoryMenu({ groups, value, onChange, ariaLabel, extra }: {
  groups: readonly LibraryNavGroup[]
  value: string
  onChange: (id: string) => void
  ariaLabel: string
  extra?: LibraryMenuChoice
}): JSX.Element {
  const { t } = useTranslation()
  const [anchor, setAnchor] = React.useState<WorkbenchMenuAnchorRect | null>(null)
  const entries = groups.flatMap((group) => group.entries)
  const current = entries.find((entry) => entry.id === value) ?? entries[0]
  const extraLabel = extra && extra.value !== extra.options[0]?.value ? extra.options.find((option) => option.value === extra.value)?.label : undefined
  const buttonLabel = [value === LIBRARY_CATEGORY_ALL && extraLabel ? null : current?.label, extraLabel].filter(Boolean).join(' · ')
  const items: WorkbenchMenuNode[] = [
    ...(extra ? [{
      kind: 'radio' as const,
      id: 'library-menu-extra',
      label: extra.label,
      value: extra.value,
      onValueChange: extra.onChange,
      options: extra.options.map((option) => ({ id: `extra:${option.value}`, value: option.value, label: option.label })),
    }, { kind: 'separator' as const, id: 'library-menu-extra-separator' }] : []),
    ...groups.map((group) => ({
      kind: 'radio' as const,
      id: `library-menu-${group.segment}`,
      label: segmentLabel(t, group.segment),
      value,
      onValueChange: onChange,
      options: group.entries.map((entry) => ({ id: `category:${entry.id}`, value: entry.id, label: entry.label, description: undefined, trailing: String(entry.count) })),
    })),
  ]
  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={ariaLabel}
        title={buttonLabel}
        data-library-category-menu
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setAnchor((open) => (open ? null : { left: rect.left, top: rect.top, width: rect.width, height: rect.height }))
        }}
        className={cn(
          'inline-flex h-[30px] max-w-[112px] shrink-0 cursor-pointer items-center gap-1 rounded-pill border border-nomi-line bg-nomi-paper pl-2.5 pr-2 text-caption text-nomi-ink-80',
          'transition-colors duration-nomi-fast ease-nomi-fast hover:bg-nomi-ink-05 focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink',
        )}
      >
        <span className="min-w-0 truncate">{buttonLabel}</span>
        <IconChevronDown size={13} stroke={1.8} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />
      </button>
      {anchor ? (
        <WorkbenchMenu
          open
          onOpenChange={(open) => { if (!open) setAnchor(null) }}
          anchorRect={anchor}
          items={items}
          ariaLabel={ariaLabel}
          className="max-w-[260px]"
          data-testid="library-category-menu"
        />
      ) : null}
    </>
  )
}
