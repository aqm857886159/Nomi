import { notify, revealNotificationTarget } from '../../ui/notificationPolicy'
import { isProjectOpen } from '../project/projectCanvasReadSurface'
import { useWorkbenchStore } from '../workbenchStore'
import { getDesktopBridge } from '../../desktop/bridge'

export function reportPreviewExportSuccess(input: {
  projectId: string
  relativePath: string
  message: string
  actionLabel: string
}): void {
  const { projectId, relativePath, message, actionLabel } = input
  if (!relativePath) return
  notify({
    identity: `export:${projectId}:${relativePath}`,
    reason: 'export-complete',
    level: 'background',
    type: 'success',
    message,
    actionLabel,
    onAction: () => { void getDesktopBridge()?.exports.showInFolder({ projectId, relativePath }).catch(() => undefined) },
  })
}

/** An export keeps its starting project identity even if its preview unmounts. */
export function reportPreviewExportFailure(input: {
  projectId: string
  message: string
  actionLabel: string
  hostConnected: boolean
  present: (error: { projectId: string; message: string }) => void
}): void {
  const { projectId, message } = input
  const feedback = { identity: `export:${projectId}`, reason: 'export-failed', message, type: 'error' as const }
  if (input.hostConnected && isProjectOpen(projectId) && useWorkbenchStore.getState().workspaceMode === 'preview') {
    notify({ ...feedback, level: 'inline', present: (text) => input.present({ projectId, message: text }) })
  } else {
    notify({ ...feedback, level: 'background', actionLabel: input.actionLabel, onAction: () => {
      void revealNotificationTarget({ projectId, workspaceMode: 'preview', taskCenter: true })
    } })
  }
}
