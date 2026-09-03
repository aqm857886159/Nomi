import { getDesktopBridge } from '../desktop/bridge'

export type VideoPlaybackTelemetryInput = {
  phase: 'metadata' | 'canplay' | 'error'
  rawUrl: string
  readyState: number
  networkState: number
  mediaErrorCode?: number | null
}

export type VideoPlaybackTelemetry = {
  phase: VideoPlaybackTelemetryInput['phase']
  host: string
  readyState: number
  networkState: number
  mediaErrorCode?: number | null
}

function safeHost(rawUrl: string): string {
  try { return new URL(rawUrl).protocol.replace(/:$/, '') } catch { return 'invalid' }
}

export function buildVideoPlaybackTelemetry(input: VideoPlaybackTelemetryInput): VideoPlaybackTelemetry {
  return {
    phase: input.phase,
    host: safeHost(input.rawUrl),
    readyState: Number.isFinite(input.readyState) ? Math.max(0, Math.floor(input.readyState)) : -1,
    networkState: Number.isFinite(input.networkState) ? Math.max(0, Math.floor(input.networkState)) : -1,
    ...(input.mediaErrorCode == null ? {} : { mediaErrorCode: input.mediaErrorCode }),
  }
}

export function recordVideoPlaybackState(projectId: string, input: VideoPlaybackTelemetryInput): void {
  const id = String(projectId || '').trim()
  const events = getDesktopBridge()?.events
  if (!id || !events) return
  const telemetry = buildVideoPlaybackTelemetry(input)
  void events.append(id, [{
    id: `preview-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: 'runtime',
    type: 'preview.video.state',
    payload: telemetry,
  }]).catch(() => undefined)
}
