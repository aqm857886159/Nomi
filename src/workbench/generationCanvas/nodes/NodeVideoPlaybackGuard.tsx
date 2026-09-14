import React from 'react'
import { cn } from '../../../utils/cn'
import { useVideoPlaybackHeal } from '../../../media/useVideoPlaybackHeal'
import { VideoPlaybackStatusOverlay } from '../../../media/VideoPlaybackStatusOverlay'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { DeferredNodeImage, DeferredNodeVideo, type DeferredNodeVideoProps } from './DeferredNodeMedia'
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
  /** 有静态封面时，首屏只显示封面；用户进入节点后才创建 video。 */
  deferUntilInteraction?: boolean
  /** 封面加载完成（交互前没有 video 元素，节点尺寸由它派生）。 */
  onPosterLoad?: React.ReactEventHandler<HTMLImageElement>
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
  deferUntilInteraction = false,
  onPosterLoad,
  ...rest
}: Props): JSX.Element {
  const [pointerInside, setPointerInside] = React.useState(false)
  const [focusInside, setFocusInside] = React.useState(false)
  const [activated, setActivated] = React.useState(!deferUntilInteraction)
  const persistHealedUrl = React.useCallback(
    (healedUrl: string, sourceUrl: string) => {
      const state = useGenerationCanvasStore.getState()
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      // 自愈期间节点重新生成（result.url 已不是发起自愈的那个）→ 不许旧 healedUrl 覆盖新结果。
      if (node?.result && node.result.url === sourceUrl) {
        state.updateNode(nodeId, { result: { ...node.result, url: healedUrl } })
      }
    },
    [nodeId],
  )
  const heal = useVideoPlaybackHeal({ rawUrl, onHealed: persistHealedUrl })

  return (
    <div
      className={cn('relative h-full w-full min-h-0')}
      onPointerEnter={() => { setPointerInside(true); setActivated(true) }}
      onPointerLeave={() => setPointerInside(false)}
      onFocus={() => { setFocusInside(true); setActivated(true) }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusInside(false) }}
    >
      {!activated && rest.poster ? (
        // 交互前只有封面：走与图片节点同一条视口延迟队列，300 张视频卡首屏不建任何 <video>。
        <DeferredNodeImage
          src={rest.poster}
          priority={rest.priority}
          alt=""
          className={cn(rest.className, 'h-full w-full object-contain')}
          draggable={false}
          data-node-video-poster="true"
          onLoad={onPosterLoad}
          onPointerDown={() => setActivated(true)}
          onClick={() => setActivated(true)}
        />
      ) : null}
      {activated ? <DeferredNodeVideo
        {...rest}
        tabIndex={rest.controls ? 0 : rest.tabIndex}
        controls={Boolean(rest.controls && (pointerInside || focusInside))}
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
      /> : null}
      <VideoPlaybackStatusOverlay healingText={heal.healingText} failureText={heal.failureText} />
    </div>
  )
}
