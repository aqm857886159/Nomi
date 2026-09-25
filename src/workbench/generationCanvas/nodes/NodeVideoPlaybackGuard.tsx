import React from 'react'
import { cn } from '../../../utils/cn'
import { useVideoPlaybackHeal } from '../../../media/useVideoPlaybackHeal'
import { VideoPlaybackStatusOverlay } from '../../../media/VideoPlaybackStatusOverlay'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { CANVAS_DRAGGING_ATTRIBUTE } from '../components/canvasDraggingFlag'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { DeferredNodeImage, DeferredNodeVideo, type DeferredNodeVideoProps } from './DeferredNodeMedia'
import {
  claimNodeVideoPlayback,
  clearNodeVideoUserPlayback,
  consumeNodeVideoHoverPreviewPlay,
  isNodeVideoVolumeTakeover,
  markNodeVideoUserPlayback,
  releaseNodeVideoPlayback,
  startNodeVideoHoverPreview,
  stopNodeVideoHoverPreview,
} from './nodeVideoPlayback'

// 画布节点的播放守卫：行为内核在 useVideoPlaybackHeal（各播放面共用的单一真相源），
// 这里只补节点独有的两件事：
// ① 自愈成功后把新 URL 写回节点，让修复结果跟着项目存盘；
// ② **什么时候才挂 <video>**（2026-09-25 画布跟手方案第 1 步，用户拍板）：平时只画落盘边界派生的封面，
//    悬停 / 唯一主选中 / 键盘聚焦 / 用户正在播时才挂播放器；都不成立就卸载，解码器随之释放。
//    实测 32 个 1080p 视频全挂 `preload="auto"` 时 GPU 进程占 1.3–2.0 GB。
//    指针扫过一排卡时不为每张都建解码器：停留 PLAYER_ENTER_DWELL_MS 才挂，离开后宽限 PLAYER_LEAVE_GRACE_MS 才卸；
//    画布正在拖动时不挂（按下即选中，不能让拖动起手先建一个 1080p 解码器）。
//    还没量过视频尺寸的卡临时挂一个只读元数据的 <video>（不建解码器），量完即卸——尺寸 owner 仍是 useNodeMediaMeasurement。
// src 由 rawUrl 派生（自愈后要能换地址），调用方不再自己传——否则两处真相源会在自愈那一刻打架。
// 地址、封面、「尺寸量过没有」都由守卫自己从节点读：卡片只传意图，不替守卫做判断。
type Props = Omit<DeferredNodeVideoProps, 'src' | 'poster' | 'preload'> & {
  /** 用到三样：result.url 原值（诊断与自愈要原始 URL）、result.thumbnailUrl（静态封面，没有时只能让 <video> 自己出首帧）、meta.videoWidth/Height（量过尺寸没有）。 */
  node: GenerationCanvasNode
  /** 指针在卡片上：挂播放器并静音试播。 */
  previewRequested: boolean
  /** 卡片是唯一主选中：挂播放器（控件可用），不自动播。 */
  engaged: boolean
}

const PLAYER_ENTER_DWELL_MS = 120
const PLAYER_LEAVE_GRACE_MS = 800
const DRAG_RECHECK_MS = 250

/** 意图持续 enter 毫秒且画布不在拖动才成立；意图消失后再保持 leave 毫秒。 */
function useSettledIntent(intent: boolean, hostRef: React.RefObject<HTMLElement>): boolean {
  const [settled, setSettled] = React.useState(false)
  React.useEffect(() => {
    let timer = 0
    const settle = () => {
      if (hostRef.current?.closest(`[${CANVAS_DRAGGING_ATTRIBUTE}="true"]`)) timer = window.setTimeout(settle, DRAG_RECHECK_MS)
      else setSettled(true)
    }
    timer = window.setTimeout(intent ? settle : () => setSettled(false), intent ? PLAYER_ENTER_DWELL_MS : PLAYER_LEAVE_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [intent, hostRef])
  return settled
}

export function NodeVideoPlaybackGuard({
  node,
  previewRequested,
  engaged,
  onError,
  onLoadedMetadata,
  onLoadedData,
  onPointerDown,
  onPlay,
  onPause,
  onEnded,
  onVolumeChange,
  onClick,
  ...rest
}: Props): JSX.Element {
  const [pointerInside, setPointerInside] = React.useState(false)
  const [focusInside, setFocusInside] = React.useState(false)
  const [userPlaying, setUserPlaying] = React.useState(false)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const previewRequestedRef = React.useRef(previewRequested)
  previewRequestedRef.current = previewRequested
  const nodeId = node.id
  const persistHealedUrl = React.useCallback(
    (healedUrl: string, sourceUrl: string) => {
      const state = useGenerationCanvasStore.getState()
      const latest = state.nodes.find((candidate) => candidate.id === nodeId)
      // 自愈期间节点重新生成（result.url 已不是发起自愈的那个）→ 不许旧 healedUrl 覆盖新结果。
      if (latest?.result && latest.result.url === sourceUrl) {
        state.updateNode(nodeId, { result: { ...latest.result, url: healedUrl } })
      }
    },
    [nodeId],
  )
  const heal = useVideoPlaybackHeal({ rawUrl: node.result?.url ?? '', onHealed: persistHealedUrl })
  const posterUrl = node.result?.thumbnailUrl?.trim() || ''
  // 没量过尺寸就先挂一次只读元数据的播放器（尺寸 owner 仍是 useNodeMediaMeasurement）。
  const measured = Boolean(node.meta?.videoWidth && node.meta?.videoHeight)
  const interacting = useSettledIntent(previewRequested || engaged, hostRef)
  const wantsPlayer = !posterUrl || !measured || interacting || focusInside || userPlaying

  // 悬停意图变了：离开 → 停掉试播并复位（用户主动播放的不停），播放器是否卸载由 wantsPlayer 决定；
  // 回来 → 播放器还在宽限期里、已有画面就直接试播（没画面的由 onLoadedData 起播），否则再悬停不会播。
  React.useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!previewRequested) stopNodeVideoHoverPreview(video)
    else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) startNodeVideoHoverPreview(video)
  }, [previewRequested])

  // 卸载（或换了元素）时让出「唯一在播者」。
  React.useEffect(() => {
    if (wantsPlayer) return undefined
    const video = videoRef.current
    videoRef.current = null
    if (video) releaseNodeVideoPlayback(video)
    return undefined
  }, [wantsPlayer])
  React.useEffect(() => () => {
    if (videoRef.current) releaseNodeVideoPlayback(videoRef.current)
  }, [])

  const markUserPlayback = (video: HTMLVideoElement) => {
    markNodeVideoUserPlayback(video)
    setUserPlaying(true)
  }
  const endPlayback = (video: HTMLVideoElement) => {
    clearNodeVideoUserPlayback(video)
    releaseNodeVideoPlayback(video)
    setUserPlaying(false)
  }

  return (
    <div
      ref={hostRef}
      className={cn('relative h-full w-full min-h-0')}
      onPointerEnter={() => setPointerInside(true)}
      onPointerLeave={() => setPointerInside(false)}
      onFocus={() => setFocusInside(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusInside(false) }}
    >
      {posterUrl ? (
        // 封面走与图片节点同一条视口延迟队列；播放器挂上后仍垫在下面，直到视频第一帧出来（不闪黑）。
        <DeferredNodeImage
          src={posterUrl}
          priority={rest.priority}
          alt=""
          className={cn(rest.className, 'h-full w-full object-contain pointer-events-none')}
          draggable={false}
          data-node-video-poster="true"
        />
      ) : null}
      {wantsPlayer ? (
        <div className={cn(posterUrl && 'absolute inset-0')}>
          <DeferredNodeVideo
            {...rest}
            // 只要元数据：整段视频由用户主动播放时再拉。原片可能是 4K/10-bit HEVC，auto 会让每个挂上的播放器争抢解码与 IO。
            preload="metadata"
            priority={Boolean(rest.priority || previewRequested || engaged)}
            placeholderClassName={cn(rest.placeholderClassName, posterUrl && 'opacity-0')}
            tabIndex={rest.controls ? 0 : rest.tabIndex}
            controls={Boolean(rest.controls && (pointerInside || focusInside))}
            src={heal.playbackUrl}
            onError={(event) => {
              onError?.(event)
              heal.onError(event)
            }}
            onLoadedMetadata={(event) => {
              videoRef.current = event.currentTarget
              heal.onLoadedMetadata(event)
              onLoadedMetadata?.(event)
            }}
            onLoadedData={(event) => {
              videoRef.current = event.currentTarget
              if (previewRequestedRef.current) startNodeVideoHoverPreview(event.currentTarget)
              onLoadedData?.(event)
            }}
            onPointerDown={(event) => {
              if (event.currentTarget.paused || event.currentTarget.muted) markUserPlayback(event.currentTarget)
              onPointerDown?.(event)
            }}
            onPlay={(event) => {
              videoRef.current = event.currentTarget
              if (!consumeNodeVideoHoverPreviewPlay(event.currentTarget)) markUserPlayback(event.currentTarget)
              claimNodeVideoPlayback(event.currentTarget)
              onPlay?.(event)
            }}
            onPause={(event) => {
              endPlayback(event.currentTarget)
              onPause?.(event)
            }}
            onEnded={(event) => {
              endPlayback(event.currentTarget)
              onEnded?.(event)
            }}
            onVolumeChange={(event) => {
              if (isNodeVideoVolumeTakeover(event.currentTarget)) markUserPlayback(event.currentTarget)
              onVolumeChange?.(event)
            }}
            onClick={(event) => {
              if (event.currentTarget.paused || event.currentTarget.muted) markUserPlayback(event.currentTarget)
              onClick?.(event)
            }}
          />
        </div>
      ) : null}
      <VideoPlaybackStatusOverlay healingText={heal.healingText} failureText={heal.failureText} />
    </div>
  )
}
