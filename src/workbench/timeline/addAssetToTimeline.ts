import { isProjectExecutionContextCurrent, withProjectAction, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import { readAudioDurationSeconds } from '../../media/audioDurationProbe'
import { readVideoDurationSeconds } from '../../media/videoDurationProbe'
import { parseAssetLibraryDrag, type AssetLibraryDragPayload } from '../assets/assetLibraryDrag'
import { assetBelongsToProject } from '../assets/assetLibraryUsage'
import type { AssetKind, AssetRef } from '../assets/assetTypes'
import { useWorkbenchStore } from '../workbenchStore'
import { buildClipFromAssetRef } from './buildClipFromAssetRef'
import { findAppendFrame } from './timelineMath'
import type { TimelineClip, TimelineState, TimelineTrackType } from './timelineTypes'
import { logRendererWarn } from '../../desktop/rendererLog'

export type AssetDropResolution =
  | { status: 'accept'; asset: TimelineAssetRef }
  | { status: 'reject'; expectedTrack: TimelineTrackType }
  | { status: 'reject-external' }

type TimelineAssetRef = AssetRef & { kind: TimelineTrackType }

type DurationProbes = {
  readVideoDuration: (url: string) => Promise<number | null>
  readAudioDuration: (url: string) => Promise<number | null>
}

const DEFAULT_PROBES: DurationProbes = {
  readVideoDuration: readVideoDurationSeconds,
  readAudioDuration: readAudioDurationSeconds,
}

/** Normalize the drag contract back to the shared AssetRef contract. */
export function assetRefFromDragPayload(payload: AssetLibraryDragPayload): TimelineAssetRef | null {
  const renderUrl = typeof payload.renderUrl === 'string' ? payload.renderUrl.trim() : ''
  if (!renderUrl) return null
  if (payload.kind !== 'image' && payload.kind !== 'video' && payload.kind !== 'audio') return null
  const id = payload.origin.source === 'project' ? payload.origin.relativePath : payload.origin.nodeId
  if (!id) return null
  return {
    id,
    kind: payload.kind,
    name: payload.name,
    renderUrl,
    source: payload.origin.source === 'project' ? 'project' : 'canvas',
    origin: payload.origin,
  }
}

export function resolveAssetDrop(
  payload: AssetLibraryDragPayload,
  trackType: TimelineTrackType,
  activeProjectId: string | null = null,
): AssetDropResolution | null {
  const asset = assetRefFromDragPayload(payload)
  if (!asset) return null
  if (!assetBelongsToProject(asset, activeProjectId)) return { status: 'reject-external' }
  return asset.kind === trackType
    ? { status: 'accept', asset }
    : { status: 'reject', expectedTrack: asset.kind }
}

export function findAssetAppendFrame(timeline: TimelineState, kind: TimelineTrackType): number {
  const track = timeline.tracks.find((candidate) => candidate.type === kind)
  return track ? findAppendFrame(track) : 0
}

export async function buildAssetTimelineClip(
  asset: AssetRef,
  options: { fps: number; startFrame: number },
  probes: DurationProbes = DEFAULT_PROBES,
): Promise<TimelineClip | null> {
  if (asset.kind === 'model3d') return null
  const durationSeconds = asset.kind === 'video'
    ? await probes.readVideoDuration(asset.renderUrl)
    : asset.kind === 'audio'
      ? await probes.readAudioDuration(asset.renderUrl)
      : null
  return buildClipFromAssetRef(asset, { ...options, durationSeconds })
}

/**
 * Add one asset at an explicit timeline position. Drag and picker paths share this.
 * project: issued at the drop / pick; a probe that outlives it never writes the next project's timeline.
 */
export async function addAssetToTimeline(
  asset: AssetRef,
  options: { fps: number; startFrame: number },
  project: ProjectExecutionContext,
): Promise<TimelineClip | null> {
  const clip = await buildAssetTimelineClip(asset, options)
  if (!clip || !isProjectExecutionContextCurrent(project)) return null
  useWorkbenchStore.getState().addTimelineClipAtFrame(clip, clip.type, options.startFrame)
  return clip
}

/** Preview-source click action: probe, append to the matching track, then reveal the result. */
export async function addAssetToTimelineEnd(asset: AssetRef, project: ProjectExecutionContext): Promise<boolean> {
  const initialTimeline = useWorkbenchStore.getState().timeline
  let clip: TimelineClip | null
  try {
    clip = await buildAssetTimelineClip(asset, { fps: initialTimeline.fps, startFrame: 0 })
  } catch (error) {
    // A failed media probe is a failed primary action, not a recent use. Keep
    // the picker responsive and let callers decide how to surface the error.
    logRendererWarn('timeline-append-probe-failed', undefined, error)
    return false
  }
  if (!clip || !isProjectExecutionContextCurrent(project)) return false
  const store = useWorkbenchStore.getState()
  const startFrame = findAssetAppendFrame(store.timeline, clip.type)
  store.addTimelineClipAtFrame(clip, clip.type, startFrame)
  store.setTimelinePanelCollapsed(false)
  return true
}

/** Parse and route an asset-library drop without duplicating media-kind logic in track components. */
export function tryAddAssetFromDragData(
  raw: string | null | undefined,
  options: { fps: number; startFrame: number; targetTrackType: TimelineTrackType; onFailure: (error: unknown) => void },
): ({ status: 'accept'; kind: AssetKind } | { status: 'reject'; expectedTrack: TimelineTrackType } | { status: 'reject-external' }) | null {
  const payload = parseAssetLibraryDrag(raw)
  if (!payload) return null
  // 拖放即动作起点：签发此刻打开的项目，「属不属于本项目」与之后写时间轴都只认它。
  const project = withProjectAction((issued) => issued)
  const resolution = resolveAssetDrop(payload, options.targetTrackType, project?.binding.projectId ?? null)
  if (!resolution) return null
  if (resolution.status === 'reject') return resolution
  if (resolution.status === 'reject-external' || !project) return { status: 'reject-external' }
  void addAssetToTimeline(resolution.asset, options, project)
    .then((clip) => { if (!clip && isProjectExecutionContextCurrent(project)) options.onFailure(null) })
    .catch((error: unknown) => { if (isProjectExecutionContextCurrent(project)) options.onFailure(error) })
  return { status: 'accept', kind: resolution.asset.kind }
}
