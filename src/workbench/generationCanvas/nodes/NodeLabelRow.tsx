import React from 'react'
import { useWorkbenchStore } from '../../workbenchStore'
import { NODE_LABEL_ROW_MIN_ZOOM } from '../components/canvasNodeLevelOfDetail'

/** Persistent metadata has one bounded home outside the media, below the action toolbar. */
export function NodeLabelRow({ children }: { children: React.ReactNode }): JSX.Element {
  const zoom = useWorkbenchStore((state) => state.categoryViewports[state.activeCategoryId]?.zoom ?? 1)
  return <header
    data-node-label-row="true"
    className="generation-canvas-v2-node__header absolute bottom-[calc(100%+6px)] left-0 right-0 z-[4] flex h-7 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-caption text-nomi-ink-60"
    style={{ visibility: zoom < NODE_LABEL_ROW_MIN_ZOOM ? 'hidden' : undefined }}
  >{children}</header>
}
