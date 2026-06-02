import React from 'react'
import { isDesktopRuntime } from '../desktop/bridge'

type WorkspaceEventType = 'canvas.updated' | 'timeline.updated' | 'creation.updated' | 'heartbeat'

function workspaceEventsEnabled(): boolean {
  const meta = import.meta as unknown as { env?: Record<string, string | undefined> }
  return meta.env?.VITE_WORKBENCH_EVENTS_ENABLED === 'true'
}

export function useWorkspaceEvents(
  projectId: string | null | undefined,
  onEvent: (type: WorkspaceEventType) => void,
): void {
  const onEventRef = React.useRef(onEvent)
  onEventRef.current = onEvent

  React.useEffect(() => {
    if (!projectId) return
    if (isDesktopRuntime()) return
    if (!workspaceEventsEnabled()) return
    const url = `/api/workbench/events?projectId=${encodeURIComponent(projectId)}`
    const es = new EventSource(url, { withCredentials: true })
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { type: WorkspaceEventType }
        onEventRef.current(data.type)
      } catch { /* ignore */ }
    }
    return () => es.close()
  }, [projectId])
}
