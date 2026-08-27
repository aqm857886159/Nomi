import * as React from 'react'
import { getDesktopBridge } from '../../desktop/bridge'
import type { AgentChatHistory } from '../../../electron/harness/agentChatContracts'

/** Probe once for this explicit project/area/thread; message growth never moves the boundary. */
export function useStaleConversationBoundary(messageIds: readonly string[], history: Extract<AgentChatHistory, { kind: 'persistent' }>): string | null {
  const [boundary, setBoundary] = React.useState<string | null>(null)
  const { sessionKey, threadId } = history.binding
  const lastIdAtMount = messageIds.length > 0 ? messageIds[messageIds.length - 1] : null
  React.useEffect(() => {
    let cancelled = false
    setBoundary(null)
    if (!lastIdAtMount) return undefined
    const probe = getDesktopBridge()?.agents?.chatV2SessionAlive
    if (!probe) return undefined
    void probe({ history: { kind: 'persistent', binding: { sessionKey, threadId } } })
      .then(({ alive }) => {
        if (!cancelled && !alive) setBoundary(lastIdAtMount)
      })
      .catch(() => {})
    return () => { cancelled = true }
    // Only a binding change starts a probe; new bubbles do not move its boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, threadId])
  return boundary
}
