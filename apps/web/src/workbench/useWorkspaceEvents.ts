import React from 'react'

type WorkspaceEventType = 'canvas.updated' | 'timeline.updated' | 'creation.updated' | 'heartbeat'

export function useWorkspaceEvents(
  projectId: string | null | undefined,
  onEvent: (type: WorkspaceEventType) => void,
): void {
  const onEventRef = React.useRef(onEvent)
  onEventRef.current = onEvent

  React.useEffect(() => {
    if (!projectId) return
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
