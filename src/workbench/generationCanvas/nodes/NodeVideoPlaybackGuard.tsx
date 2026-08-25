import React from 'react'
import { cn } from '../../../utils/cn'
import { useVideoPlaybackHeal } from '../../../media/useVideoPlaybackHeal'
import { VideoPlaybackStatusOverlay } from '../../../media/VideoPlaybackStatusOverlay'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { DeferredNodeVideo, type DeferredNodeVideoProps } from './DeferredNodeMedia'
import {
  clearNodeVideoUserPlayback,
  consumeNodeVideoHoverPreviewPlay,
  markNodeVideoUserPlayback,
} from './useNodeVideoHoverPreview'

// 画布节点的播放守卫：行为内核在 useVideoPlaybackHeal（各播放面共用的单一真相源），
// 这里只补节点独有的一件事——自愈成功后把新 URL 写回节点，让修复结果跟着项目存盘。
// src 由 rawUrl 派生（自愈后要能换地址），调用方不再自己传——否则两处真相源会在自愈那一刻打架。
type Props = Omit<DeferredNodeVideoProps, 'src'> & {
  nodeId: string
  /** 节点 result.url 原值（诊断探针与自愈都要原始 URL，不要 buildVideoPlaybackUrl 之后的）。 */
  rawUrl: string
}

export function NodeVideoPlaybackGuard({
  nodeId,
  rawUrl,
  onError,
  onLoadedMetadata,
  onPointerDown,
  onPlay,
  onPause,
  onEnded,
  onVolumeChange,
  onClick,
  ...rest
}: Props): JSX.Element {
  const persistHealedUrl = React.useCallback(
    (healedUrl: string) => {
      const state = useGenerationCanvasStore.getState()
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (node?.result) state.updateNode(nodeId, { result: { ...node.result, url: healedUrl } })
    },
    [nodeId],
  )
  const heal = useVideoPlaybackHeal({ rawUrl, onHealed: persistHealedUrl })

  return (
    <div className={cn('relative h-full w-full min-h-0')}>
      <DeferredNodeVideo
        {...rest}
        src={heal.playbackUrl}
        onError={(event) => {
          onError?.(event)
          heal.onError(event)
        }}
        onLoadedMetadata={(event) => {
          heal.onLoadedMetadata(event)
          onLoadedMetadata?.(event)
        }}
        onPointerDown={(event) => {
          if (event.currentTarget.paused || event.currentTarget.muted) markNodeVideoUserPlayback(event.currentTarget)
          onPointerDown?.(event)
        }}
        onPlay={(event) => {
          if (!consumeNodeVideoHoverPreviewPlay(event.currentTarget)) markNodeVideoUserPlayback(event.currentTarget)
          onPlay?.(event)
        }}
        onPause={(event) => {
          clearNodeVideoUserPlayback(event.currentTarget)
          onPause?.(event)
        }}
        onEnded={(event) => {
          clearNodeVideoUserPlayback(event.currentTarget)
          onEnded?.(event)
        }}
        onVolumeChange={(event) => {
          if (!event.currentTarget.muted) markNodeVideoUserPlayback(event.currentTarget)
          onVolumeChange?.(event)
        }}
        onClick={(event) => {
          if (event.currentTarget.paused || event.currentTarget.muted) markNodeVideoUserPlayback(event.currentTarget)
          onClick?.(event)
        }}
      />
      <VideoPlaybackStatusOverlay healingText={heal.healingText} failureText={heal.failureText} />
    </div>
  )
}
