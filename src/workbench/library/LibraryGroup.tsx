import React from 'react'
import { useTranslation } from 'react-i18next'
import type { LibraryGroup as Group } from './libraryGroups'

/** Shared disclosure: native summary provides focus, Enter and Space behavior. */
export function LibraryGroup<T>({ group, children, className }: { group: Group<T>; children: React.ReactNode; className?: string }): JSX.Element {
  const { t } = useTranslation()
  if (!group.label) return <>{children}</>
  const label = t('libraries.gallery.groupCount', { name: group.label, count: group.items.length })
  if (!group.collapsed) return <section className={className} data-library-group={group.id}>
    <h3 className="m-0 px-2 py-2 text-caption font-medium text-nomi-ink-60">{label}</h3>{children}
  </section>
  return <details className={className} data-library-group={group.id}>
    <summary className="cursor-pointer rounded-nomi-sm px-2 py-2 text-caption font-medium text-nomi-ink hover:bg-nomi-ink-05">{label}</summary>
    {children}
  </details>
}
