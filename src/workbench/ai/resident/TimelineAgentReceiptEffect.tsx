import React from 'react'
import i18n from '../../../i18n'
import { showUndoToast } from '../../../utils/showUndoToast'
import { useWorkbenchStore } from '../../workbenchStore'
import { timelineAgentUndoMetadata } from '../../timeline/timelineUndoHistory'
import { timelineRevision } from '../../timeline/kernel/timelineKernel'

/**
 * Turns an Agent timeline commit into the same reversible toast the adoption
 * ("AI 拼片") path already uses — same words, same undo affordance, same ⌘Z
 * stack (design contract §2.6). The trigger is the shared undo stack because
 * that is where the commit records its `undoToken`, which is what makes the
 * receipt honest: it can prove the entry it offers to revert is still the one
 * on top.
 *
 * The announced token lives at module scope, not in a ref, because this effect
 * is mounted by the resident shell and the shell remounts whenever the user
 * collapses or expands Nomi. A per-instance ref would treat the newest entry as
 * unseen on every remount and re-announce an edit the user already approved
 * minutes ago.
 */
let announcedUndoToken: string | null = null
let receiptPrimed = false

export function TimelineAgentReceiptEffect(): JSX.Element | null {
  const undoStack = useWorkbenchStore((state) => state.timelineUndoStack)

  React.useEffect(() => {
    const metadata = timelineAgentUndoMetadata(undoStack[undoStack.length - 1])
    const token = metadata?.undoToken ?? null
    // The first observation only records where the stack already was; a receipt
    // for an edit that happened before this surface existed would be a lie.
    if (!receiptPrimed) {
      receiptPrimed = true
      announcedUndoToken = token
      return
    }
    if (!metadata || !token || token === announcedUndoToken) return
    announcedUndoToken = token
    showUndoToast({
      message: i18n.t('agentResident.timelineAppliedReceipt'),
      onUndo: () => useWorkbenchStore.getState().undoTimeline(),
      // Undo only while this exact commit is still the top of the stack and the
      // timeline has not moved since; otherwise the button would revert someone
      // else's edit.
      isUndoable: () => {
        const current = useWorkbenchStore.getState()
        const top = timelineAgentUndoMetadata(current.timelineUndoStack[current.timelineUndoStack.length - 1])
        return top?.undoToken === token && timelineRevision(current.timeline) === metadata.afterRevision
      },
      watchUndoable: (recheck) => useWorkbenchStore.subscribe((state) => state.timeline, recheck),
    })
  }, [undoStack])

  return null
}
