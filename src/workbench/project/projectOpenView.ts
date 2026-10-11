import { logRendererError } from '../../desktop/rendererLog'
import { useWorkbenchStore } from '../workbenchStore'

export const loadWorkbenchShell = () => import('../WorkbenchShell')
export const loadGenerationCanvas = () => import('../generationCanvas/components/GenerationCanvas')
export const preloadGenerationWorkspace = () => import('../generation/GenerationWorkspace')
export const preloadGenerationCanvas = () => import('../generationCanvas/reactFlow/GenerationCanvasReactFlow')

// Loading code does not mount components or own project state. Keep the normal
// lazy factories/retries authoritative; do not retain rejected preload promises.
export function preloadProjectView(): void {
  const generation = useWorkbenchStore.getState().workspaceMode === 'generation'
  void Promise.all([
    loadWorkbenchShell().then(() => generation ? preloadGenerationWorkspace() : undefined),
    ...(generation ? [loadGenerationCanvas().then(() => preloadGenerationCanvas())] : []),
  ]).catch((error: unknown) => logRendererError('project-view-preload-failed', error))
}
