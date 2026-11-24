import { useWorkbenchStore } from '../workbenchStore'
import { normalizeTimeline } from '../timeline/timelineMath'
import type { TimelineState } from '../timeline/timelineTypes'
import type { AdoptionApplyPorts } from './adoptionTypes'

export const readWorkbenchTimeline = () => useWorkbenchStore.getState().timeline

// The checkpoint belongs to one apply attempt, including when a store
// subscriber synchronously starts another edit during post-write verification.
export function createWorkbenchAdoptionPorts(): AdoptionApplyPorts {
  const history = useWorkbenchStore.getState().timelineHistory
  let compensate: ((base: TimelineState) => boolean) | undefined
  return {
    readTimeline: readWorkbenchTimeline,
    commitTimeline(next, base, metadata) {
      const current = useWorkbenchStore.getState()
      if (current.timelineHistory !== history || current.timeline !== base) throw new Error('Timeline session changed')
      const timeline = normalizeTimeline(next)
      const rollback = history.checkpoint(base)
      history.record(base, timeline, { metadata, target: !metadata })
      const head = history.entries.pastStates.at(-1)
      compensate = expected => {
        const state = useWorkbenchStore.getState()
        if (base !== expected || state.timelineHistory !== history || history.entries.pastStates.at(-1) !== head) return false
        compensate = undefined
        rollback()
        useWorkbenchStore.setState({ timeline: base })
        return readWorkbenchTimeline() === base
      }
      useWorkbenchStore.setState(state => ({ timeline, persistRevision: state.persistRevision + 1 }))
    },
    restoreTimeline: base => compensate?.(base) ?? false,
  }
}
