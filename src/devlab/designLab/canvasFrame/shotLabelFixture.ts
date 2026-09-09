import type { GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'

export type ShotLabelFixture = {
  kind: 'empty' | 'image' | 'video' | 'scene'
  zoom: number
  selected: boolean
  details?: boolean
  nodePatch?: Partial<Pick<GenerationCanvasNode, 'status' | 'progress' | 'error'>>
}

/** Drives the mounted laboratory host, keeping its store instance authoritative. */
export function setShotLabelFixture(detail: ShotLabelFixture): void {
  window.dispatchEvent(new CustomEvent('nomi-label-fixture', { detail }))
}
