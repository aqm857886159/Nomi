import type { GenerationNodeKind } from '../model/generationCanvasTypes'

export const CANVAS_TOOLBAR_NODE_GROUPS = [
  ['text', 'image', 'video', 'clip', 'audio'],
  ['model3d', 'whiteboard', 'panorama', 'scene3d'],
] as const satisfies readonly (readonly GenerationNodeKind[])[]

export function canvasToolbarNodeKinds(): GenerationNodeKind[] {
  return CANVAS_TOOLBAR_NODE_GROUPS.flat()
}
