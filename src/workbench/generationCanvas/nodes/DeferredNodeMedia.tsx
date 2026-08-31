import React from 'react'
import { NomiImage, type NomiImageProps } from '../../../design/media'
import { cn } from '../../../utils/cn'
import { useDeferredNodeMediaSrc } from './deferredNodeMediaQueue'

export const DeferredNodeMediaPlaceholder = React.forwardRef<HTMLDivElement, { className?: string }>(
  function DeferredNodeMediaPlaceholder({ className }, ref): JSX.Element {
  return (
    <div
      ref={ref}
      className={cn('generation-canvas-v2-node__media-loading', className)}
      aria-hidden="true"
    />
  )
  },
)

export type DeferredNodeImageProps = Omit<NomiImageProps, 'src'> & {
  src: string
  priority?: boolean
  placeholderClassName?: string
}

export function DeferredNodeImage({
  src,
  priority = false,
  placeholderClassName,
  className,
  onLoad,
  onError,
  ...props
}: DeferredNodeImageProps): JSX.Element {
  const media = useDeferredNodeMediaSrc({ src, kind: 'image', priority })
  return (
    <>
      {media.loading ? <DeferredNodeMediaPlaceholder key="placeholder" ref={media.placeholderRef} className={placeholderClassName} /> : null}
      {media.deferredSrc ? (
        <NomiImage
          key="media"
          {...props}
          src={media.deferredSrc}
          className={cn(className, media.loading && 'opacity-0')}
          onLoad={(event) => {
            media.markLoaded()
            onLoad?.(event)
          }}
          onError={(event) => {
            media.markFailed()
            onError?.(event)
          }}
        />
      ) : null}
    </>
  )
}

export type DeferredNodeVideoProps = React.VideoHTMLAttributes<HTMLVideoElement> & {
  src: string
  priority?: boolean
  placeholderClassName?: string
  displayReadyState?: 'metadata' | 'current-data'
}

function releaseVideoElement(video: HTMLVideoElement | null): void {
  if (!video) return
  video.pause()
  video.removeAttribute('src')
  try {
    video.load()
  } catch {
    /* Some test DOMs do not implement media loading. */
  }
}

export function DeferredNodeVideo({
  src,
  priority = false,
  placeholderClassName,
  displayReadyState = 'metadata',
  className,
  onLoadedMetadata,
  onLoadedData,
  onError,
  ...props
}: DeferredNodeVideoProps): JSX.Element {
  const media = useDeferredNodeMediaSrc({ src, kind: 'video', priority })
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const setVideoRef = React.useCallback((element: HTMLVideoElement | null) => {
    // React may deliver an old element's null callback after a replacement element
    // has already mounted. Clearing `videoRef.current` here would unload the new video.
    if (!element) return
    if (videoRef.current && videoRef.current !== element) releaseVideoElement(videoRef.current)
    videoRef.current = element
  }, [])

  React.useEffect(() => {
    return () => {
      releaseVideoElement(videoRef.current)
      videoRef.current = null
    }
  }, [])

  return (
    <>
      {media.loading ? <DeferredNodeMediaPlaceholder key="placeholder" ref={media.placeholderRef} className={placeholderClassName} /> : null}
      {media.deferredSrc ? (
        <video
          key="media"
          {...props}
          ref={setVideoRef}
          src={media.deferredSrc}
          className={cn(className, media.loading && 'opacity-0')}
          onLoadedMetadata={(event) => {
            if (displayReadyState === 'metadata') media.markLoaded()
            onLoadedMetadata?.(event)
          }}
          onLoadedData={(event) => {
            if (displayReadyState === 'current-data') media.markLoaded()
            onLoadedData?.(event)
          }}
          onError={(event) => {
            media.markFailed()
            onError?.(event)
          }}
        />
      ) : null}
    </>
  )
}
