import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconX } from '@tabler/icons-react'
import { BodyPortal } from '../../../design'
import { NomiImage } from '../../../design/media'
import { cn } from '../../../utils/cn'

type Props = {
  open: boolean
  src: string
  title?: string
  onClose: () => void
}

/**
 * 画布图片结果的单一大图预览层。
 *
 * 只接收节点原始 result.url；缩略图策略仍留在卡片渲染层。用 body portal 脱离画布 transform，
 * 否则 modal 会跟着节点缩放/裁切。Esc、背景点击、关闭按钮统一走 onClose。
 */
export function NodeImageLightbox({ open, src, title, onClose }: Props): JSX.Element | null {
  const { t } = useTranslation()
  const closeButtonRef = React.useRef<HTMLButtonElement>(null)
  const label = (title || '').trim() || t('generationCommon.imagePreview.result')

  React.useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', handleKeyDown, true)
      document.body.style.overflow = previousOverflow
      window.setTimeout(() => previousFocus?.focus(), 0)
    }
  }, [onClose, open])

  if (!open || !src) return null

  return (
    <BodyPortal>
      <div
        className="fixed inset-0 z-[4200] grid place-items-center bg-nomi-scrim p-6 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label={t('generationCommon.imagePreview.lightboxAria', { label })}
        data-node-image-lightbox="true"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute left-6 top-5 right-20 flex min-w-0 items-center gap-2 text-nomi-paper">
          <span className="truncate text-body font-semibold">{label}</span>
          <span className="shrink-0 text-caption text-nomi-paper/60">
            {t('generationCommon.imagePreview.original')}
          </span>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          className={cn(
            'absolute right-6 top-4 grid size-10 place-items-center rounded-full border border-nomi-paper/20',
            'bg-nomi-ink/80 text-nomi-paper shadow-nomi-md backdrop-blur-md cursor-pointer',
            'hover:bg-nomi-ink focus-visible:outline-2 focus-visible:outline-nomi-accent focus-visible:outline-offset-2',
          )}
          aria-label={t('generationCommon.imagePreview.close')}
          title={t('generationCommon.imagePreview.closeEsc')}
          onClick={onClose}
        >
          <IconX size={18} stroke={1.8} aria-hidden="true" />
        </button>
        <NomiImage
          src={src}
          eager
          alt={label}
          fallbackLabel={t('generationCommon.imagePreview.loadFailed')}
          fallbackTitle={t('generationCommon.imagePreview.expired')}
          className={cn(
            'min-h-[240px] min-w-[320px] max-h-[82vh] max-w-[92vw] object-contain',
            'rounded-nomi bg-nomi-ink-05 shadow-nomi-lg',
          )}
          onMouseDown={(event) => event.stopPropagation()}
        />
        <span className="pointer-events-none absolute bottom-5 text-caption text-nomi-paper/60">
          {t('generationCommon.imagePreview.closeHint')}
        </span>
      </div>
    </BodyPortal>
  )
}
