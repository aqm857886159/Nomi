/**
 * React Flow is the production renderer. The legacy canvas remains available
 * as an explicit emergency fallback while downstream projects migrate.
 */
export function isReactFlowCanvasEnabled(): boolean {
  const meta = import.meta as unknown as { env?: Record<string, string | undefined> }
  if (meta.env?.VITE_GENERATION_CANVAS_ENGINE === 'legacy') return false
  if (meta.env?.VITE_GENERATION_CANVAS_ENGINE === 'react-flow') return true

  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem('nomi:canvas-engine') !== 'legacy'
  } catch {
    return true
  }
}
