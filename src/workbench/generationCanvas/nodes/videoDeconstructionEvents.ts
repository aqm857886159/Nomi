import type { VideoDeconstructionView } from './VideoDeconstructionPanel'

export function openVideoDeconstruction(
  nodeId: string,
  view: VideoDeconstructionView = 'cuts',
  analysisId: string | null = null,
): void {
  window.dispatchEvent(new CustomEvent('nomi-open-video-deconstruction', {
    detail: { nodeId, view, analysisId },
  }))
}
