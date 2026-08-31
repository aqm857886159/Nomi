import { isCanvasPluginFeatureEnabled } from './canvasPluginFeatureFlag'
import { BUNDLED_WORKFLOW_PLUGIN } from './bundledCanvasPlugins'
import { createCanvasPluginRegistry } from './canvasPluginRegistry'

export const canvasPluginRegistry = createCanvasPluginRegistry({
  enabled: isCanvasPluginFeatureEnabled(),
  nomiVersion: '0.21.0',
  builtInNodeTypes: ['text', 'character', 'scene', 'image', 'keyframe', 'video', 'shot', 'output', 'panorama', 'scene3d', 'model3d', 'whiteboard', 'audio', 'clip'],
})

if (canvasPluginRegistry.isEnabled()) canvasPluginRegistry.register(BUNDLED_WORKFLOW_PLUGIN)
