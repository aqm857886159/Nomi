import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

function hasObjectFlag(value: unknown): boolean {
  return Boolean(value && typeof value === 'object')
}

export function hasPendingScene3DStagingCapture(nodes: readonly GenerationCanvasNode[]): boolean {
  return nodes.some((node) => node.kind === 'scene3d' && hasObjectFlag(node.meta?.stagingAutoCapture))
}

export function hasPendingScene3DCameraMoveCapture(nodes: readonly GenerationCanvasNode[]): boolean {
  return nodes.some((node) => node.kind === 'scene3d' && hasObjectFlag(node.meta?.cameraMoveAutoCapture))
}
