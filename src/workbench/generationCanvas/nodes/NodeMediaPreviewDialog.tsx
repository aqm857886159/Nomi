import React from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { IconX } from '@tabler/icons-react'
import { NomiImage } from '../../../design/media'
import { cn } from '../../../utils/cn'
import { useVideoPlaybackHeal } from '../../../media/useVideoPlaybackHeal'
import { VideoPlaybackStatusOverlay } from '../../../media/VideoPlaybackStatusOverlay'

type Props = {
  mediaType: 'image' | 'video'
  url: string
  title: string
  onClose: () => void
}

// 图片 / 视频节点共用的画布内预览。Portal 到生成画布外层（而非 document.body），只覆盖红框区域，
// 同时能压住该区域内独立挂载的助手、时间轴把手和导航工具栏。
export default function NodeMediaPreviewDialog({ mediaType, url, title, onClose }: Props): JSX.Element {
  const { t } = useTranslation()
  // 此前这里的 <video> 连 onError 都没有：点开大图播不了 = 纯黑 + 零提示，用户无从判断也无从修。
  const heal = useVideoPlaybackHeal({ rawUrl: url })
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const canvasViewport =
    typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.workbench-generation__canvas')
  const generationWorkspace = canvasViewport?.closest<HTMLElement>('.workbench-generation') ?? null

  React.useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousPreviewState = generationWorkspace?.getAttribute('data-media-preview-open') ?? null
    generationWorkspace?.setAttribute('data-media-preview-open', 'true')
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (generationWorkspace) {
        if (previousPreviewState === null) generationWorkspace.removeAttribute('data-media-preview-open')
        else generationWorkspace.setAttribute('data-media-preview-open', previousPreviewState)
      }
      previousFocus?.focus()
    }
  }, [generationWorkspace, onClose])

  const mediaTypeLabel =
    mediaType === 'video' ? t('generationCommon.imagePreview.video') : t('generationCommon.imagePreview.image')
  const dialogTitle = title.trim() || mediaTypeLabel

  if (!canvasViewport) return <></>

  return createPortal(
    <div
      className={cn(
        'absolute inset-0 z-[9999] flex h-full w-full items-center justify-center overflow-hidden overscroll-contain p-6 pt-16',
        'bg-black/40',
      )}
      role="dialog"
      aria-modal="true"
      aria-label={t('generationCommon.imagePreview.mediaAria', { title: dialogTitle })}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <span
        className={cn(
          'pointer-events-none absolute left-4 top-4 z-[2] max-w-[calc(100%-80px)] truncate rounded-full px-3 py-1.5',
          'bg-nomi-overlay-chip-strong border border-nomi-paper/20 text-caption font-medium text-nomi-paper shadow-nomi-sm backdrop-blur-sm',
        )}
      >
        {t('generationCommon.imagePreview.mediaHeader', { type: mediaTypeLabel, title: dialogTitle })}
      </span>
      <button
        ref={closeButtonRef}
        type="button"
        className={cn(
          'absolute right-4 top-4 z-[3] grid size-9 place-items-center rounded-full cursor-pointer',
          'border border-nomi-paper/20 bg-nomi-overlay-chip-strong text-nomi-paper shadow-nomi-md hover:bg-nomi-overlay-chip',
          'focus-visible:outline-2 focus-visible:outline-nomi-paper focus-visible:outline-offset-2',
        )}
        aria-label={t('generationCommon.imagePreview.closeMedia')}
        title={t('generationCommon.imagePreview.closeMediaEsc')}
        onClick={onClose}
      >
        <IconX size={18} stroke={1.8} />
      </button>

      {mediaType === 'video' ? (
        <div className="relative flex max-h-full max-w-full" onPointerDown={(event) => event.stopPropagation()}>
          <video
            src={heal.playbackUrl}
            className="max-h-full max-w-full rounded-nomi bg-nomi-ink shadow-nomi-lg"
            aria-label={dialogTitle}
            crossOrigin="use-credentials"
            controls
            autoPlay
            playsInline
            preload="metadata"
            onError={heal.onError}
            onLoadedMetadata={heal.onLoadedMetadata}
          />
          <VideoPlaybackStatusOverlay
            healingText={heal.healingText}
            failureText={heal.failureText}
            className="rounded-nomi"
          />
        </div>
      ) : (
        <NomiImage
          src={url}
          eager
          alt={dialogTitle}
          className="max-h-full max-w-full rounded-nomi object-contain shadow-nomi-lg select-none"
          onPointerDown={(event) => event.stopPropagation()}
        />
      )}
    </div>,
    canvasViewport,
  )
}
