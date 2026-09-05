import type { GenerationNodeKind } from '../model/generationCanvasTypes'

export const CANVAS_TOOLBAR_NODE_GROUPS = [
  ['text', 'image', 'video', 'clip', 'audio'],
  ['model3d', 'whiteboard', 'panorama', 'scene3d'],
] as const satisfies readonly (readonly GenerationNodeKind[])[]

/** 左侧竖排工具栏能直接创建的节点种类——「用户点得出来的节点」的单一定义。 */
export type CanvasToolbarNodeKind = (typeof CANVAS_TOOLBAR_NODE_GROUPS)[number][number]

export function canvasToolbarNodeKinds(): GenerationNodeKind[] {
  return CANVAS_TOOLBAR_NODE_GROUPS.flat()
}
