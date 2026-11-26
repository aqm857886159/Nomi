import React, { type JSX } from 'react'
import { useNodeOutsideRowsHidden } from './nodeOutsideRows'

/** Persistent metadata has one bounded home outside the media, below the action toolbar. */
export function NodeLabelRow({ children }: { children: React.ReactNode }): JSX.Element {
  const hidden = useNodeOutsideRowsHidden()
  return <header
    data-node-label-row="true"
    className="generation-canvas-v2-node__header absolute bottom-[calc(100%+6px)] left-0 right-0 z-[4] flex h-7 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-caption text-nomi-ink-60"
    style={{ visibility: hidden ? 'hidden' : undefined }}
  >{children}</header>
}
