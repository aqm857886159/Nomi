import React from 'react'
import type { TimelineClip } from '../timeline/timelineTypes'
import { resolveVideoClipMediaTimeSeconds } from '../player/timelinePlayback'

type BgmPlaybackState = {
  playing: boolean
  playheadFrame: number
  fps: number
  volume: number
  muted: boolean
}

/**
 * 预览区配乐（BGM）<audio> 播放。与画面 <video> 平行：playhead → currentTime 同步（同一套播放感知
 * 阈值 + offset 公式）、跟随 playing 播放/暂停、共享音量/静音控件。play() 失败不致命（BGM 缺位不应
 * 打断画面）。从 TimelinePreview 抽出（R9 防巨壳：媒体播放是独立关切，与组件渲染/导出解耦）。
 */
export function usePreviewBgmPlayback(
  audioClip: TimelineClip | null,
  state: BgmPlaybackState,
): { audioRef: React.MutableRefObject<HTMLAudioElement | null>; audioUrl: string } {
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const audioUrl = audioClip?.url || ''
  const { playing, playheadFrame, fps, volume, muted } = state

  // playhead → currentTime 同步。
  React.useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioClip?.url) return
    const nextTime = resolveVideoClipMediaTimeSeconds({ clip: audioClip, playheadFrame, fps })
    if (!Number.isFinite(nextTime)) return
    const threshold = playing ? 0.3 : 0.04
    if (Math.abs(audio.currentTime - nextTime) < threshold) return
    audio.currentTime = nextTime
  }, [fps, playheadFrame, audioClip, playing])

  // 音量/静音（与画面音轨共享控件）。
  React.useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.muted = muted
  }, [audioUrl, volume, muted])

  // 播放/暂停跟随时间轴 playing。
  React.useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioClip?.url) return
    if (playing) {
      void audio.play().catch(() => { /* autoplay/解码失败：静默，不阻断画面 */ })
      return
    }
    if (!audio.paused) {
      try {
        audio.pause()
      } catch {
        // jsdom 无媒体控制
      }
    }
  }, [playing, audioClip?.url])

  return { audioRef, audioUrl }
}
