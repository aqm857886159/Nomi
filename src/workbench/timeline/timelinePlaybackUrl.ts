import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'
import { resultUrl } from '../generationCanvas/runner/referenceUrl'
import type { TimelineClip, TimelineState } from './timelineTypes'

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resultUrlCandidates(result: GenerationNodeResult | null | undefined): string[] {
  return [readString(result?.url), readString(result?.providerUrl), readString(result?.thumbnailUrl)].filter(Boolean)
}

function findSourceNode(nodes: readonly GenerationCanvasNode[], clip: TimelineClip | null | undefined): GenerationCanvasNode | null {
  if (!clip?.sourceNodeId) return null
  return nodes.find((node) => node.id === clip.sourceNodeId) || null
}

export function resolveTimelineClipPlaybackUrl(
  clip: TimelineClip | null | undefined,
  nodes: readonly GenerationCanvasNode[],
): string {
  const clipUrl = readString(clip?.url)
  if (!clip) return ''

  const sourceNode = findSourceNode(nodes, clip)
  if (!sourceNode) return clipUrl

  const matchingHistory = (sourceNode.history || []).find((result) => resultUrlCandidates(result).includes(clipUrl))
  const historicalUrl = resultUrl(matchingHistory)
  if (historicalUrl) return historicalUrl

  const currentUrl = resultUrl(sourceNode.result)
  if (currentUrl && (!clipUrl || resultUrlCandidates(sourceNode.result).includes(clipUrl))) return currentUrl

  return clipUrl
}

export function resolveTimelinePlaybackUrls(timeline: TimelineState, nodes: readonly GenerationCanvasNode[]): TimelineState {
  let changed = false
  const tracks = timeline.tracks.map((track) => {
    let trackChanged = false
    const clips = track.clips.map((clip) => {
      const nextUrl = resolveTimelineClipPlaybackUrl(clip, nodes)
      if (!nextUrl || nextUrl === clip.url) return clip
      trackChanged = true
      changed = true
      return { ...clip, url: nextUrl }
    })
    return trackChanged ? { ...track, clips } : track
  })
  return changed ? { ...timeline, tracks } : timeline
}
