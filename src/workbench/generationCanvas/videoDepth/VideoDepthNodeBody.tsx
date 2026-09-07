import React from 'react'

/**
 * Depth video process node body — v1 placeholder body owned by Task 2 (kind
 * registration). Task 7 replaces this with the full parameter/processing UI
 * (all user-facing copy i18n'd per R15).
 *
 * Deliberately text-free: no hardcoded visible strings (would trip the i18n
 * gate), no local settings copy (the node snapshot meta is the single source
 * of truth, R23). Renders a neutral placeholder surface so a freshly added
 * node is never an empty card.
 */
export default function VideoDepthNodeBody({
  node: _node,
  readOnly: _readOnly,
}: {
  node: unknown
  readOnly?: boolean
}): JSX.Element {
  return (
    <div className="flex h-full w-full flex-col gap-2 px-3 py-3" data-testid="video-depth-node-body">
      <div className="h-6 w-2/3 rounded-nomi bg-nomi-paper" />
      <div className="h-4 w-full rounded-nomi bg-nomi-paper" />
      <div className="h-4 w-5/6 rounded-nomi bg-nomi-paper" />
      <div className="mt-1 h-8 w-1/2 rounded-nomi bg-nomi-paper" />
    </div>
  )
}
