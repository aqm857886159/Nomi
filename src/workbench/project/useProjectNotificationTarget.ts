import React from 'react'
import { getDesktopBridge } from '../../desktop/bridge'
import type { NotificationTarget } from '../../ui/notificationPolicy'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { FOCUS_GENERATION_NODE_EVENT } from '../generationCanvas/nodes/nodeSizing'
import { focusCanvasNodeWhenReady } from '../deepLinkFocus'
import { useProductionRunStore } from '../production/productionRunStore'
import { ProjectHydrationSupersededError } from './projectCanvasReadSurface'
import { logRendererError } from '../../desktop/rendererLog'

type Target = NotificationTarget & { runId?: string; artifactId?: string }
type Navigation = {
  activeProjectId: React.MutableRefObject<string | null>
  isHydrating: React.MutableRefObject<boolean>
  hydrateProject: (projectId: string, options: { replaceUrl: boolean }) => Promise<boolean>
}

/** Both external deep links and explicit notification actions use the same guarded project opening. */
export async function revealProjectTarget(target: Target, navigation: Navigation): Promise<boolean> {
  const projectId = target.projectId.trim()
  if (!projectId) return false
  if (navigation.activeProjectId.current !== projectId || navigation.isHydrating.current) {
    if (!await navigation.hydrateProject(projectId, { replaceUrl: true })) return false
  }
  if (navigation.activeProjectId.current !== projectId || navigation.isHydrating.current) return false
  useWorkbenchStore.getState().setWorkspaceMode(target.workspaceMode ?? 'generation')
  if (target.taskCenter || target.runId) window.dispatchEvent(new CustomEvent('nomi-open-task-center'))
  if (target.runId) {
    await useProductionRunStore.getState().navigateTo(projectId, target.runId, target.artifactId)
    return navigation.activeProjectId.current === projectId && !navigation.isHydrating.current
  }
  const nodeId = target.nodeIds?.[0]
  if (nodeId) {
    await focusCanvasNodeWhenReady({
      nodeId,
      hasNode: () => navigation.activeProjectId.current === projectId && !navigation.isHydrating.current && useGenerationCanvasStore.getState().nodes.some((node) => node.id === nodeId),
      dispatch: (id) => {
        if (navigation.activeProjectId.current === projectId && !navigation.isHydrating.current) window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: id } }))
      },
      waitFrame: () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())),
    })
  }
  return navigation.activeProjectId.current === projectId && !navigation.isHydrating.current
}

export function useProjectNotificationTarget(navigation: Navigation): void {
  const { activeProjectId, isHydrating, hydrateProject } = navigation
  React.useEffect(() => {
    const reveal = async (target: Target): Promise<boolean> => {
      try { return await revealProjectTarget(target, { activeProjectId, isHydrating, hydrateProject }) } catch (error) {
        if (!(error instanceof ProjectHydrationSupersededError)) logRendererError('project-notification-navigation-failed', error)
        return false
      }
    }
    const onNotification = (event: Event) => {
      const detail = (event as CustomEvent<NotificationTarget & { resolve: (opened: boolean) => void }>).detail
      if (!detail || typeof detail.projectId !== 'string' || typeof detail.resolve !== 'function') return
      event.preventDefault()
      void reveal(detail).then(detail.resolve)
    }
    window.addEventListener('nomi-reveal-notification', onNotification)
    const unbind = getDesktopBridge()?.app?.onProductionDeepLink?.((payload) => {
      if (typeof payload?.projectId !== 'string') return
      void reveal({ projectId: payload.projectId, runId: typeof payload.runId === 'string' ? payload.runId.trim() : undefined, artifactId: payload.artifactId, nodeIds: typeof payload.nodeId === 'string' && payload.nodeId.trim() ? [payload.nodeId.trim()] : undefined })
    })
    return () => { window.removeEventListener('nomi-reveal-notification', onNotification); unbind?.() }
  }, [activeProjectId, isHydrating, hydrateProject])
}
