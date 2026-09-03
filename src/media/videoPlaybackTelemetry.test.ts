import { describe, expect, it } from 'vitest'
import { buildVideoPlaybackTelemetry } from './videoPlaybackTelemetry'

describe('video playback telemetry', () => {
  it('keeps media state and a safe local route without persisting secrets', () => {
    expect(buildVideoPlaybackTelemetry({
      phase: 'error', rawUrl: 'nomi-local://asset/project-a/assets/clip.mp4?secret=no',
      readyState: 0, networkState: 3, mediaErrorCode: 4,
    })).toEqual({ phase: 'error', host: 'nomi-local', readyState: 0, networkState: 3, mediaErrorCode: 4 })
  })
})
