import { readAudioDurationSeconds } from '../../media/audioDurationProbe'
import { readVideoDurationSeconds } from '../../media/videoDurationProbe'
import i18n from '../../i18n'
import { toast } from '../../ui/toast'
import { parseAssetLibraryDrag, type AssetLibraryDragPayload } from '../assets/assetLibraryDrag'
import type { AssetKind, AssetRef } from '../assets/assetTypes'
import { useWorkbenchStore } from '../workbenchStore'
import { buildClipFromAssetRef } from './buildClipFromAssetRef'
import { findAppendFrame } from './timelineMath'
import type { TimelineClip, TimelineState, TimelineTrackType } from './timelineTypes'

export type AssetDropResolution =
  | { status: 'accept'; asset: TimelineAssetRef }
  | { status: 'reject'; expectedTrack: TimelineTrackType }

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
): AssetDropResolution | null {
  const asset = assetRefFromDragPayload(payload)
  if (!asset) return null
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

/** Add one asset at an explicit timeline position. Drag and picker paths share this. */
export async function addAssetToTimeline(
  asset: AssetRef,
  options: { fps: number; startFrame: number },
): Promise<TimelineClip | null> {
  const clip = await buildAssetTimelineClip(asset, options)
  if (!clip) return null
  useWorkbenchStore.getState().addTimelineClipAtFrame(clip, clip.type, options.startFrame)
  return clip
}

/** Preview-source click action: probe, append to the matching track, then reveal the result. */
export async function addAssetToTimelineEnd(asset: AssetRef): Promise<void> {
  const initialTimeline = useWorkbenchStore.getState().timeline
  const clip = await buildAssetTimelineClip(asset, { fps: initialTimeline.fps, startFrame: 0 })
  if (!clip) return
  const store = useWorkbenchStore.getState()
  const startFrame = findAssetAppendFrame(store.timeline, clip.type)
  store.addTimelineClipAtFrame(clip, clip.type, startFrame)
  store.setTimelinePanelCollapsed(false)
  toast(i18n.t('timelineEditor.addedToEnd'), 'success')
}

/** Parse and route an asset-library drop without duplicating media-kind logic in track components. */
export function tryAddAssetFromDragData(
  raw: string | null | undefined,
  options: { fps: number; startFrame: number; targetTrackType: TimelineTrackType },
): ({ status: 'accept'; kind: AssetKind } | { status: 'reject'; expectedTrack: TimelineTrackType }) | null {
  const payload = parseAssetLibraryDrag(raw)
  if (!payload) return null
  const resolution = resolveAssetDrop(payload, options.targetTrackType)
  if (!resolution) return null
  if (resolution.status === 'reject') return resolution
  void addAssetToTimeline(resolution.asset, options)
  return { status: 'accept', kind: resolution.asset.kind }
}
