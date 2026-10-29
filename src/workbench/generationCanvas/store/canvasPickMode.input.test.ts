import { afterEach, expect, it } from 'vitest'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationViewStore } from '../../generation/list/generationViewStore'
import { enterCanvasPickMode, useCanvasPickModeStore } from './canvasPickMode'

afterEach(() => { useCanvasPickModeStore.setState({ request: null }) })
it.each(['creation', 'preview', 'generation'] as const)('point picking from %s first activates the real generation canvas', (workspace) => {
  useWorkbenchStore.getState().setWorkspaceMode(workspace)
  useGenerationViewStore.getState().setView('list')
  const exit = enterCanvasPickMode({ eligible: () => true, onPick: () => {} })
  expect(useWorkbenchStore.getState().workspaceMode).toBe('generation')
  expect(useGenerationViewStore.getState().view).toBe('canvas')
  expect(useCanvasPickModeStore.getState().request).not.toBeNull()
  exit()
})
