import { rememberActiveProjectForTasks } from '../tasks/activeProjectFallback'
import { registerMainCanvasReadExecutionRuntime, type CanvasReadExecutionRuntime } from './canvasReadExecutionRuntime'
import { registerCanvasReadSurfaceIpc, type CanvasReadSurfaceIpcCapture } from './canvasReadSurfaceIpc'
import { canvasReadSurfaceRuntime } from './canvasReadSurfaceRuntime'

export type { CanvasReadExecutionRuntime }

export type DesktopCanvasReadRuntime = CanvasReadExecutionRuntime & Readonly<{
  surfaceCapture: CanvasReadSurfaceIpcCapture
}>

/** Static GUI-main assembly; register before the first BrowserWindow exists. */
export function registerDesktopCanvasReadRuntime(): DesktopCanvasReadRuntime {
  const surfaceCapture = registerCanvasReadSurfaceIpc({
    registry: canvasReadSurfaceRuntime.registry,
    ownerAuthority: canvasReadSurfaceRuntime.ownerAuthority,
    capturedSnapshots: canvasReadSurfaceRuntime.capturedSnapshots,
  })
  const execution = registerMainCanvasReadExecutionRuntime({
    surfaceRegistry: canvasReadSurfaceRuntime.registry,
    capturedSnapshots: canvasReadSurfaceRuntime.capturedSnapshots,
  })
  canvasReadSurfaceRuntime.subscribeCommittedProject((selection) => {
    rememberActiveProjectForTasks(selection?.projectId ?? '')
  })
  return Object.freeze({ ...execution, surfaceCapture })
}
