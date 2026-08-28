import React from 'react'
import type { ProjectAgentHostState } from '../../../electron/shared/projectAgentContracts'
import { projectAgentProjectionStore } from './projectAgentProjectionStore'
import { projectAgentThreadMessages } from './projectAgentUiProjection'

export function useProjectAgentSnapshot(): ProjectAgentHostState | null {
  const projection = React.useSyncExternalStore(
    projectAgentProjectionStore.subscribe,
    projectAgentProjectionStore.getState,
    projectAgentProjectionStore.getState,
  )
  return projection.snapshot
}

export function useProjectAgentThreadMessages() {
  const snapshot = useProjectAgentSnapshot()
  return React.useMemo(() => (snapshot ? projectAgentThreadMessages(snapshot) : []), [snapshot])
}
