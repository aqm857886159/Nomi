import {
  isImageLikeGenerationNodeKind,
  isVideoLikeGenerationNodeKind,
  type GenerationNodeKind,
} from './generationNodeKinds'

/** The only node kinds offered after a source is dropped on blank canvas. */
export const CONNECTION_CREATE_NODE_KINDS: GenerationNodeKind[] = ['image', 'video']

/**
 * Source capability for the blank-canvas connection flow. Text and visual
 * source nodes can feed a newly created media node; audio/model nodes cannot.
 * The registry-derived image/video predicates keep multi-result and ordinary
 * cards on the same path.
 */
export function canCreateConnectedMedia(node: Pick<{ kind: GenerationNodeKind }, 'kind'>): boolean {
  return node.kind === 'text' || isImageLikeGenerationNodeKind(node.kind) || isVideoLikeGenerationNodeKind(node.kind)
}
