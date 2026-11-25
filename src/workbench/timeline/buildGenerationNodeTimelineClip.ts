import { readImageAspectRatio, readVideoMetadata } from '../../media/videoDurationProbe'
import { buildClipFromGenerationNode } from '../generationCanvas/model/buildClipFromGenerationNode'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { TimelineClip } from './timelineTypes'

type BuildOptions = {
  fps?: number
  startFrame?: number
  resultId?: string
}

function withVideoDuration(clip: TimelineClip, durationSeconds: number, fps: number): TimelineClip {
  const frameCount = Math.max(1, Math.round(durationSeconds * Math.max(1, fps)))
  return {
    ...clip,
    frameCount,
    endFrame: clip.startFrame + frameCount,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
  }
}

export async function buildGenerationNodeTimelineClip(
  node: GenerationCanvasNode,
  options: BuildOptions = {},
): Promise<TimelineClip | null> {
  const clip = buildClipFromGenerationNode(node, options)
  if (!clip?.url || clip.type === 'audio') return clip
  if (clip.type === 'image') {
    const sourceAspectRatio = await readImageAspectRatio(clip.url)
    return sourceAspectRatio ? { ...clip, sourceAspectRatio } : clip
  }

  const metadata = await readVideoMetadata(clip.url)
  const timed = metadata?.durationSeconds ? withVideoDuration(clip, metadata.durationSeconds, options.fps || 30) : clip
  return metadata?.aspectRatio ? { ...timed, sourceAspectRatio: metadata.aspectRatio } : timed
}
