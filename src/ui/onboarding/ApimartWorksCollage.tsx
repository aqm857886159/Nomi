import React, { type JSX } from 'react'
import { IconPlayerPause, IconPlayerPlay } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, WorkbenchIconButton } from '../../design'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'
import { cn } from '../../utils/cn'
import { ONBOARDING_DEMO_RUNTIME_URLS, ONBOARDING_DEMO_WORKS } from './apimartConnectRoute'

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => setReduced(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return reduced
}

/**
 * 大页 `Seedance 2.0` 视频格（`big.motion` 方案 1）：
 * - 进页先出 1.4s 海报帧，`preload="metadata"`；
 * - 播一遍 → 240ms 淡回海报帧停 2 秒 → 再播；
 * - 窗口失焦、页面隐藏、滚出可视区即停在海报帧；
 * - `prefers-reduced-motion: reduce` 只显示海报帧、不挂载 `<video>`；
 * - 1 秒内未解出首帧或加载失败则停在海报帧；
 * - 悬停右上角暂停/播放钮，点击视频格任意处或聚焦按空格切换。
 */
function SeedanceMotionTile(): JSX.Element {
  const { t } = useTranslation()
  const reducedMotion = usePrefersReducedMotion()
  const tileRef = React.useRef<HTMLDivElement | null>(null)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const holdTimerRef = React.useRef<number | null>(null)
  const decodeTimerRef = React.useRef<number | null>(null)

  const [videoFailed, setVideoFailed] = React.useState(false)
  const [videoReady, setVideoReady] = React.useState(false)
  const [showingVideo, setShowingVideo] = React.useState(false)
  const [userPaused, setUserPaused] = React.useState(false)
  const [inView, setInView] = React.useState(true)
  const [windowActive, setWindowActive] = React.useState<boolean>(() => {
    if (typeof document === 'undefined') return true
    return document.visibilityState !== 'hidden'
  })

  const clearTimers = React.useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (decodeTimerRef.current !== null) {
      window.clearTimeout(decodeTimerRef.current)
      decodeTimerRef.current = null
    }
  }, [])

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined
    const syncVisibility = (): void => {
      setWindowActive(document.visibilityState !== 'hidden' && document.hasFocus())
    }
    const onBlur = (): void => setWindowActive(false)
    const onFocus = (): void => setWindowActive(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', syncVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  React.useEffect(() => {
    const node = tileRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry) setInView(entry.isIntersecting)
      },
      { threshold: 0.2 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const shouldPlay = !reducedMotion && !videoFailed && !userPaused && inView && windowActive

  const startPlaybackCycle = React.useCallback(() => {
    const video = videoRef.current
    if (!video) return
    clearTimers()
    if (!videoReady) {
      decodeTimerRef.current = window.setTimeout(() => {
        setVideoFailed(true)
        setShowingVideo(false)
      }, 1000)
    }
    video.currentTime = 0
    const attempt = video.play()
    if (attempt && typeof attempt.then === 'function') {
      attempt
        .then(() => {
          setShowingVideo(true)
        })
        .catch(() => {
          setShowingVideo(false)
        })
    } else {
      setShowingVideo(true)
    }
  }, [clearTimers, videoReady])

  React.useEffect(() => {
    const video = videoRef.current
    if (!shouldPlay) {
      clearTimers()
      setShowingVideo(false)
      if (video) video.pause()
      return undefined
    }
    startPlaybackCycle()
    return () => {
      clearTimers()
      if (video) video.pause()
    }
  }, [clearTimers, shouldPlay, startPlaybackCycle])

  const handleEnded = React.useCallback(() => {
    setShowingVideo(false)
    if (!shouldPlay) return
    holdTimerRef.current = window.setTimeout(() => {
      startPlaybackCycle()
    }, 2000)
  }, [shouldPlay, startPlaybackCycle])

  const togglePause = React.useCallback(() => {
    if (reducedMotion || videoFailed) return
    setUserPaused((prev) => !prev)
  }, [reducedMotion, videoFailed])

  const canToggleVideo = !reducedMotion && !videoFailed && videoReady
  const seedanceLabel = translateModelDisplayText(ONBOARDING_DEMO_WORKS[0].modelLabel)
  const toggleLabel = userPaused
    ? t('onboardingProviders.apimartConnect.motion.play')
    : t('onboardingProviders.apimartConnect.motion.pause')

  return (
    <div
      ref={tileRef}
      tabIndex={canToggleVideo ? 0 : undefined}
      role={canToggleVideo ? 'button' : undefined}
      aria-label={
        canToggleVideo
          ? t('onboardingProviders.apimartConnect.motion.tileAria', { model: seedanceLabel, action: toggleLabel })
          : undefined
      }
      onClick={canToggleVideo ? togglePause : undefined}
      onKeyDown={
        canToggleVideo
          ? (event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault()
                togglePause()
              }
            }
          : undefined
      }
      data-apimart-video-tile
      data-video-playing={showingVideo ? 'true' : 'false'}
      data-video-reduced-motion={reducedMotion ? 'true' : 'false'}
      className={cn(
        'group relative h-[440px] w-full overflow-hidden rounded-panel bg-nomi-ink-05',
        canToggleVideo && 'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink',
      )}
    >
      <img
        src={ONBOARDING_DEMO_RUNTIME_URLS.seedancePoster}
        alt=""
        className="block h-full w-full object-cover"
        data-apimart-poster="seedance-2.0"
      />
      {!reducedMotion && !videoFailed ? (
        <video
          ref={videoRef}
          src={ONBOARDING_DEMO_RUNTIME_URLS.seedanceVideo}
          poster={ONBOARDING_DEMO_RUNTIME_URLS.seedancePoster}
          muted
          playsInline
          preload="metadata"
          onLoadedData={() => {
            if (decodeTimerRef.current !== null) {
              window.clearTimeout(decodeTimerRef.current)
              decodeTimerRef.current = null
            }
            setVideoReady(true)
          }}
          onError={() => {
            clearTimers()
            setVideoFailed(true)
            setShowingVideo(false)
          }}
          onEnded={handleEnded}
          className={cn(
            'pointer-events-none absolute inset-0 block h-full w-full object-cover transition-opacity duration-nomi-fast ease-nomi-fast',
            showingVideo && videoReady ? 'opacity-100' : 'opacity-0',
          )}
          data-apimart-motion-video
        />
      ) : null}
      <span className="pointer-events-none absolute bottom-3 left-3 inline-flex h-5 items-center whitespace-nowrap rounded-pill bg-nomi-overlay-chip px-2 text-caption font-normal text-nomi-media-ink">
        {seedanceLabel}
      </span>
      {canToggleVideo ? (
        <TooltipProvider delayDuration={200} disableHoverableContent>
          <Tooltip>
            <TooltipTrigger asChild>
              <WorkbenchIconButton
                size="sm"
                icon={userPaused ? <IconPlayerPlay aria-hidden="true" /> : <IconPlayerPause aria-hidden="true" />}
                label={toggleLabel}
                onClick={(event) => {
                  event.stopPropagation()
                  togglePause()
                }}
                data-apimart-video-toggle
                className={cn(
                  'absolute right-3 top-3 rounded-pill bg-nomi-overlay-chip text-nomi-media-ink hover:bg-nomi-overlay-chip-strong hover:text-nomi-media-ink',
                  userPaused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                )}
              />
            </TooltipTrigger>
            <TooltipContent side="left">{toggleLabel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  )
}

export function ApimartWorksCollage({ compact }: { compact: boolean }): JSX.Element {
  const { t } = useTranslation()
  const seedanceLabel = translateModelDisplayText(ONBOARDING_DEMO_WORKS[0].modelLabel)
  const nanoBanana2Label = translateModelDisplayText(ONBOARDING_DEMO_WORKS[1].modelLabel)
  const nanoBananaLabel = translateModelDisplayText(ONBOARDING_DEMO_WORKS[2].modelLabel)

  if (compact) {
    return (
      <div className="flex items-end gap-3" data-apimart-works="narrow">
        <div className="relative h-20 w-[134px] shrink-0 overflow-hidden rounded-panel bg-nomi-ink-05">
          <img src={ONBOARDING_DEMO_RUNTIME_URLS.seedancePoster} alt="" className="block h-full w-full object-cover" />
          <span className="pointer-events-none absolute bottom-1 left-1 inline-flex h-5 items-center whitespace-nowrap rounded-pill bg-nomi-overlay-chip px-1.5 text-caption font-normal text-nomi-media-ink">
            {seedanceLabel}
          </span>
        </div>
        <div className="relative h-20 w-[100px] shrink-0 overflow-hidden rounded-panel bg-nomi-ink-05">
          <img src={ONBOARDING_DEMO_RUNTIME_URLS.nanoBanana2} alt="" className="block h-full w-full object-cover" />
          <span className="pointer-events-none absolute bottom-1 left-1 inline-flex h-5 items-center whitespace-nowrap rounded-pill bg-nomi-overlay-chip px-1.5 text-caption font-normal text-nomi-media-ink">
            {nanoBanana2Label}
          </span>
        </div>
        <div className="relative h-20 w-[100px] shrink-0 overflow-hidden rounded-panel bg-nomi-ink-05">
          <img src={ONBOARDING_DEMO_RUNTIME_URLS.nanoBanana} alt="" className="block h-full w-full object-cover" />
          <span className="pointer-events-none absolute bottom-1 left-1 inline-flex h-5 items-center whitespace-nowrap rounded-pill bg-nomi-overlay-chip px-1.5 text-caption font-normal text-nomi-media-ink">
            {nanoBananaLabel}
          </span>
        </div>
        <span className="min-w-0 truncate text-caption font-normal text-nomi-ink-60" data-apimart-works-caption>
          {t('onboardingProviders.apimartConnect.worksCaption')}
        </span>
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-[680px] flex-col gap-3" data-apimart-works="wide">
      <SeedanceMotionTile />
      <div className="grid grid-cols-2 gap-3">
        <div className="relative h-[302px] overflow-hidden rounded-panel bg-nomi-ink-05">
          <img src={ONBOARDING_DEMO_RUNTIME_URLS.nanoBanana2} alt="" className="block h-full w-full object-cover" />
          <span className="pointer-events-none absolute bottom-3 left-3 inline-flex h-5 items-center whitespace-nowrap rounded-pill bg-nomi-overlay-chip px-2 text-caption font-normal text-nomi-media-ink">
            {nanoBanana2Label}
          </span>
        </div>
        <div className="relative h-[302px] overflow-hidden rounded-panel bg-nomi-ink-05">
          <img src={ONBOARDING_DEMO_RUNTIME_URLS.nanoBanana} alt="" className="block h-full w-full object-cover" />
          <span className="pointer-events-none absolute bottom-3 left-3 inline-flex h-5 items-center whitespace-nowrap rounded-pill bg-nomi-overlay-chip px-2 text-caption font-normal text-nomi-media-ink">
            {nanoBananaLabel}
          </span>
        </div>
      </div>
      <span className="text-caption font-normal text-nomi-ink-60" data-apimart-works-caption>
        {t('onboardingProviders.apimartConnect.worksCaption')}
      </span>
    </div>
  )
}
