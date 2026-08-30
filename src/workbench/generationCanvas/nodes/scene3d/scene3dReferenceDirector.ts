import i18n from '../../../../i18n'

import type {
  GenerationCanvasEdge,
  GenerationCanvasEdgeMode,
  GenerationCanvasNode,
} from '../../model/generationCanvasTypes'
import { isVideoLikeGenerationNodeKind } from '../../model/generationNodeKinds'
import { archetypeForNode, findVideoRefMode } from '../../agent/referenceEdgeCapability'
import { currentArchetypeMode } from '../controls/archetypeMeta'

export type Scene3DReferenceFrameSupport = {
  firstFrame: boolean
  lastFrame: boolean
}

export type Scene3DReferenceTargetSummary =
  | {
      state: 'not-connected'
      targetNodeId?: undefined
      targetTitle?: undefined
      videoRefModeId?: undefined
      videoRefMetaKey?: undefined
      currentFrameSupport: Scene3DReferenceFrameSupport
      anyFrameSupport: Scene3DReferenceFrameSupport
    }
  | {
      state: 'video-ref'
      targetNodeId: string
      targetTitle: string
      videoRefModeId: string
      videoRefMetaKey: string
      currentFrameSupport: Scene3DReferenceFrameSupport
      anyFrameSupport: Scene3DReferenceFrameSupport
    }
  | {
      state: 'prompt-fallback'
      targetNodeId: string
      targetTitle: string
      videoRefModeId?: undefined
      videoRefMetaKey?: undefined
      currentFrameSupport: Scene3DReferenceFrameSupport
      anyFrameSupport: Scene3DReferenceFrameSupport
    }

function emptyFrameSupport(): Scene3DReferenceFrameSupport {
  return { firstFrame: false, lastFrame: false }
}

function frameSupportForNode(node: GenerationCanvasNode): {
  currentFrameSupport: Scene3DReferenceFrameSupport
  anyFrameSupport: Scene3DReferenceFrameSupport
} {
  const archetype = archetypeForNode(node)
  if (!archetype) {
    return {
      currentFrameSupport: emptyFrameSupport(),
      anyFrameSupport: emptyFrameSupport(),
    }
  }
  const currentMode = currentArchetypeMode(archetype, (node.meta || {}) as Record<string, unknown>)
  const support = (slots: typeof currentMode.slots): Scene3DReferenceFrameSupport => ({
    firstFrame: slots.some((slot) => slot.kind === 'first_frame' || slot.kind === 'image_ref'),
    lastFrame: slots.some((slot) => slot.kind === 'last_frame'),
  })
  return {
    currentFrameSupport: support(currentMode.slots),
    anyFrameSupport: support(archetype.modes.flatMap((mode) => mode.slots)),
  }
}

export function summarizeScene3DReferenceTarget(
  sourceNodeId: string,
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
): Scene3DReferenceTargetSummary {
  const target = edges
    .filter((edge) => edge.source === sourceNodeId)
    .map((edge) => nodes.find((node) => node.id === edge.target))
    .find((node): node is GenerationCanvasNode => Boolean(node && isVideoLikeGenerationNodeKind(node.kind)))

  if (!target) {
    return {
      state: 'not-connected',
      currentFrameSupport: emptyFrameSupport(),
      anyFrameSupport: emptyFrameSupport(),
    }
  }

  const frameSupport = frameSupportForNode(target)
  const videoRef = findVideoRefMode(archetypeForNode(target))
  if (videoRef) {
    return {
      state: 'video-ref',
      targetNodeId: target.id,
      targetTitle: target.title || '视频镜头',
      videoRefModeId: videoRef.modeId,
      videoRefMetaKey: videoRef.metaKey,
      ...frameSupport,
    }
  }

  return {
    state: 'prompt-fallback',
    targetNodeId: target.id,
    targetTitle: target.title || '视频镜头',
    ...frameSupport,
  }
}

export function referenceSlotForScene3DCaptureTitle(title: string): Extract<GenerationCanvasEdgeMode, 'first_frame' | 'last_frame'> | null {
  if (title.includes('运镜首帧')) return 'first_frame'
  if (title.includes('运镜尾帧')) return 'last_frame'
  return null
}

export function shouldAttachScene3DFrameReference(
  target: Scene3DReferenceTargetSummary,
  slot: Extract<GenerationCanvasEdgeMode, 'first_frame' | 'last_frame'>,
): boolean {
  if (target.state === 'not-connected') return false
  return slot === 'first_frame' ? target.anyFrameSupport.firstFrame : target.anyFrameSupport.lastFrame
}

export function scene3DReferenceTargetLabel(target: Scene3DReferenceTargetSummary): string {
  if (target.state === 'not-connected') return i18n.t('scene3d.referenceTargetNotConnected')
  if (target.state === 'video-ref') return `video_ref · ${target.targetTitle}`
  return `prompt · ${target.targetTitle}`
}
