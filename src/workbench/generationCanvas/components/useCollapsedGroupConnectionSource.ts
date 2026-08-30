import React from 'react'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'

/** Keep the collapsed-group gesture state out of the canvas shell. */
export function useCollapsedGroupConnectionSource(readOnly: boolean): {
  pendingConnectionSourceId: string
  pendingConnectionSourceSide: ConnectionAnchorSide
  projectionProps: {
    pendingConnection: boolean
    pendingConnectionSourceId: string
    pendingConnectionSourceKind: 'node' | 'group'
    pendingConnectionSide: ConnectionAnchorSide
    onStartGroupConnection: (event: React.PointerEvent<HTMLElement>, groupId: string, side: ConnectionAnchorSide) => void
  }
} {
  const startGroupConnection = useGenerationCanvasStore((state) => state.startGroupConnection)
  const pendingConnectionSourceId = useGenerationCanvasStore((state) => state.pendingConnectionSourceId)
  const pendingConnectionSourceSide = useGenerationCanvasStore((state) => state.pendingConnectionSourceSide)
  const pendingConnectionSourceKind = useGenerationCanvasStore((state) => state.pendingConnectionSourceKind)
  const onStartGroupConnection = React.useCallback((event: React.PointerEvent<HTMLElement>, groupId: string, side: ConnectionAnchorSide) => {
    event.preventDefault()
    event.stopPropagation()
    startGroupConnection(groupId, side)
  }, [startGroupConnection])
  return {
    pendingConnectionSourceId,
    pendingConnectionSourceSide,
    projectionProps: {
      pendingConnection: !readOnly && Boolean(pendingConnectionSourceId),
      pendingConnectionSourceId,
      pendingConnectionSourceKind,
      pendingConnectionSide: pendingConnectionSourceSide,
      onStartGroupConnection,
    },
  }
}
