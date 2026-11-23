import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { LibraryGroup as Group } from './libraryGroups'

/** Shared disclosure: native summary provides focus, Enter and Space behavior. */
export function LibraryGroup<T>({
  group,
  open,
  onToggle,
  children,
  className,
}: {
  group: Group<T>
  open?: boolean
  onToggle?: (nextOpen: boolean) => void
  children: React.ReactNode
  className?: string
}): JSX.Element {
  const { t } = useTranslation()
  if (!group.label) return <>{children}</>
  const label = t('libraries.gallery.groupCount', { name: group.label, count: group.items.length })
  if (!group.collapsed) {
    return (
      <section className={className} data-library-group={group.id}>
        <h3 className="m-0 px-2.5 pb-1 pt-2 text-micro font-normal text-nomi-ink-40">{label}</h3>
        {children}
      </section>
    )
  }
  return (
    <details
      className={className}
      data-library-group={group.id}
      open={open}
      onToggle={(event) => onToggle?.(event.currentTarget.open)}
    >
      <summary className="cursor-pointer rounded-nomi-sm px-2.5 py-1.5 text-micro font-medium text-nomi-ink-60 hover:bg-nomi-ink-05">
        {label}
      </summary>
      {children}
    </details>
  )
}
