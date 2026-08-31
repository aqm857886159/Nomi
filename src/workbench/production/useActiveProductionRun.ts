import React from 'react'

import {
  getDesktopActiveProjectId,
  subscribeDesktopActiveProjectIdChange,
} from '../../desktop/activeProject'
import { useProductionRunStore } from './productionRunStore'

const POLL_INTERVAL_MS = 1500

function subscribeActiveProject(onStoreChange: () => void): () => void {
  return subscribeDesktopActiveProjectIdChange(() => onStoreChange())
}

function readActiveProjectId(): string | null {
  return getDesktopActiveProjectId() || null
}

export function useActiveProductionRun(projectId?: string | null) {
  const state = useProductionRunStore()
  const desktopProjectId = React.useSyncExternalStore(subscribeActiveProject, readActiveProjectId, () => null)
  const resolvedProjectId = projectId ?? desktopProjectId

  React.useEffect(() => {
    if (!resolvedProjectId) {
      useProductionRunStore.getState().reset()
      return
    }
    void useProductionRunStore.getState().load(resolvedProjectId)
    const interval = window.setInterval(() => void useProductionRunStore.getState().poll(), POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [resolvedProjectId])

  return state
}
