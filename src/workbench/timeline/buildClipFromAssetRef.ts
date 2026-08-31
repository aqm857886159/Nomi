import type { AssetRef } from '../assets/assetTypes'
import type { TimelineClip, TimelineTrackType } from './timelineTypes'
import i18n from '../../i18n'

const DEFAULT_DURATION_SECONDS: Record<TimelineTrackType, number> = {
  image: 3,
  video: 5,
  audio: 10,
}

function fallbackLabel(kind: TimelineTrackType): string {
  if (kind === 'image') return i18n.t('assetLibrary.image')
  if (kind === 'video') return i18n.t('assetLibrary.video')
  return i18n.t('assetLibrary.audio')
}

/**
 * Asset-library media → timeline clip.
 *
 * This is the single builder for image, video, and audio assets. Callers probe
 * video/audio duration before invoking it; a failed probe falls back to a
 * usable kind-specific duration so a readable local asset never becomes a
 * dead click.
 */
export function buildClipFromAssetRef(
  asset: AssetRef,
  options: { fps: number; startFrame: number; durationSeconds?: number | null },
): TimelineClip | null {
  if (asset.kind !== 'image' && asset.kind !== 'video' && asset.kind !== 'audio') return null
  const url = String(asset.renderUrl || '').trim()
  if (!url) return null

  const fps = options.fps > 0 ? options.fps : 30
  const startFrame = Math.max(0, Math.floor(options.startFrame))
  const probedSeconds = options.durationSeconds && options.durationSeconds > 0
    ? options.durationSeconds
    : null
  const seconds = asset.kind === 'image'
    ? DEFAULT_DURATION_SECONDS.image
    : probedSeconds ?? DEFAULT_DURATION_SECONDS[asset.kind]
  const frameCount = Math.max(1, Math.round(seconds * fps))
  const sourceNodeId = `asset:${asset.id}`
  const thumbnailUrl = asset.kind === 'image' ? String(asset.thumbUrl || '').trim() : ''

  return {
    id: `clip-${sourceNodeId}-${asset.kind}-${startFrame}`,
    type: asset.kind,
    sourceNodeId,
    label: asset.name || fallbackLabel(asset.kind),
    startFrame,
    endFrame: startFrame + frameCount,
    frameCount,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
    url,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  }
}
