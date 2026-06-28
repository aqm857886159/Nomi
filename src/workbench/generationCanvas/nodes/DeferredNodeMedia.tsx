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
      {media.loading ? <DeferredNodeMediaPlaceholder ref={media.placeholderRef} className={placeholderClassName} /> : null}
      {media.deferredSrc ? (
        <NomiImage
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
  className,
  onLoadedMetadata,
  onError,
  ...props
}: DeferredNodeVideoProps): JSX.Element {
  const media = useDeferredNodeMediaSrc({ src, kind: 'video', priority })
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const setVideoRef = React.useCallback((element: HTMLVideoElement | null) => {
    if (videoRef.current && videoRef.current !== element) {
      releaseVideoElement(videoRef.current)
    }
    videoRef.current = element
  }, [])

  React.useEffect(() => {
    return () => releaseVideoElement(videoRef.current)
  }, [])

  return (
    <>
      {media.loading ? <DeferredNodeMediaPlaceholder ref={media.placeholderRef} className={placeholderClassName} /> : null}
      {media.deferredSrc ? (
        <video
          {...props}
          ref={setVideoRef}
          src={media.deferredSrc}
          className={cn(className, media.loading && 'opacity-0')}
          onLoadedMetadata={(event) => {
            media.markLoaded()
            onLoadedMetadata?.(event)
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
