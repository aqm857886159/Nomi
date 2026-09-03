import React from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { IconDownload, IconLoader2, IconX } from '@tabler/icons-react'
import { NomiImage } from '../../design/media'
import { cn } from '../../utils/cn'
import { useVideoPlaybackHeal } from '../../media/useVideoPlaybackHeal'
import { VideoPlaybackStatusOverlay } from '../../media/VideoPlaybackStatusOverlay'
import type { AssetRef } from './assetTypes'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../../ui/toast'

const Model3DViewer = React.lazy(() => import('../generationCanvas/nodes/model3d/Model3DViewer'))

// 素材库双击放大预览（#52 群反馈「加个双击放大预览」）。独立的 body-portal 全屏 lightbox：
// 不复用 NodeMediaPreviewDialog——它 portal 到画布区、且创作页画布 hidden 时预览会挂到隐藏画布上
// 看不到（强耦合 `.workbench-generation__canvas`）。素材库在侧边栏、跨创作/生成/预览页，必须 body
// 全屏。只复用其视频自愈核心 useVideoPlaybackHeal（点开大图播不了时探测+转码，不再纯黑无提示）。
export type AssetPreviewSequenceItem = { asset: AssetRef; durationSec?: number }

export function AssetPreviewDialog({ asset, onClose, sequence, initialIndex = 0 }: {
  asset: AssetRef
  onClose: () => void
  /** Optional ordered playback mode; it keeps this dialog's single body-portal owner. */
  sequence?: readonly AssetPreviewSequenceItem[]
  initialIndex?: number
}): JSX.Element {
  const { t } = useTranslation()
  const [sequenceIndex, setSequenceIndex] = React.useState(() => Math.max(0, Math.min(initialIndex, (sequence?.length ?? 1) - 1)))
  const current = sequence?.[sequenceIndex]?.asset ?? asset
  const currentDuration = sequence?.[sequenceIndex]?.durationSec ?? 0
  const heal = useVideoPlaybackHeal({ rawUrl: current.renderUrl })
  const title = current.name || ''
  const sourceName = current.sourceProjectName?.trim() || ''
  const mediaTypeLabel = current.kind === 'video' ? t('assetLibrary.video') : t('assetLibrary.image')
  const [downloading, setDownloading] = React.useState(false)
  const downloadModel = React.useCallback(() => {
    const bridge = getDesktopBridge()
    if (!bridge?.assets?.download || downloading) return
    const suggestedName = /\.glb$/i.test(title) ? title : `${title || 'model'}.glb`
    setDownloading(true)
    void bridge.assets.download({ url: current.renderUrl, suggestedName })
      .then((result) => {
        if (result.ok) toast(t('assetLibrary.downloadedModel3d'), 'success')
        else if (!result.canceled) toast(t('assetLibrary.downloadModel3dFailed'), 'error')
      })
      .catch(() => toast(t('assetLibrary.downloadModel3dFailed'), 'error'))
      .finally(() => setDownloading(false))
  }, [current.renderUrl, downloading, t, title])

  React.useEffect(() => {
    // capture 阶段拦 Esc：素材库/画布也监听 window keydown，先于它们关预览（不误删节点等）。
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  React.useEffect(() => {
    if (!sequence || sequence.length === 0 || current.kind !== 'image' || currentDuration <= 0) return
    const timer = window.setTimeout(() => {
      if (sequenceIndex + 1 < sequence.length) setSequenceIndex((index) => index + 1)
      else onClose()
    }, currentDuration * 1000)
    return () => window.clearTimeout(timer)
  }, [current.kind, currentDuration, onClose, sequence, sequenceIndex])

  const advance = (): void => {
    if (!sequence || sequenceIndex + 1 >= sequence.length) {
      onClose()
      return
    }
    setSequenceIndex((index) => index + 1)
  }

  return createPortal(
    <div
      className={cn('fixed inset-0 z-[10000] flex items-center justify-center overflow-hidden p-8', 'bg-black/60')}
      role="dialog"
      aria-modal="true"
      aria-label={t('assetLibrary.previewAria', { name: title })}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <button
        type="button"
        className={cn(
          'absolute right-4 top-4 z-[3] grid size-9 place-items-center rounded-full cursor-pointer',
          // 边框 + 强 scrim：预览背景是 bg-black/60，无边框的深色徽标钮会和暗背景融为一体（用户反馈
          // 「找不到关闭钮」）。给一圈 paper/25 描边把边缘钉出来、并用 chip-strong 提对比，光暗都读得清。
          'border border-nomi-paper/25 bg-nomi-overlay-chip-strong text-nomi-paper shadow-nomi-md backdrop-blur-sm',
          'hover:bg-nomi-paper hover:text-nomi-ink hover:border-transparent',
          'focus-visible:outline-2 focus-visible:outline-nomi-paper focus-visible:outline-offset-2',
        )}
        aria-label={t('assetLibrary.previewClose')}
        onClick={onClose}
      >
        <IconX size={18} stroke={1.8} />
      </button>

      {current.kind !== 'audio' ? (
        <span
          className={cn(
            'pointer-events-none absolute left-4 top-4 z-[2] flex max-w-[calc(100%-80px)] items-baseline gap-2 truncate rounded-full px-3 py-1.5',
            'border border-nomi-paper/20 bg-nomi-overlay-chip-strong text-caption font-medium text-nomi-paper shadow-nomi-sm backdrop-blur-sm',
          )}
          data-asset-preview-title="true"
        >
          <span className="min-w-0 truncate">{title || mediaTypeLabel}</span>
          {sourceName ? <span className="shrink-0 truncate text-micro font-normal text-nomi-paper/70">{t('assetLibrary.previewSource', { name: sourceName })}</span> : null}
        </span>
      ) : null}

      {current.kind === 'model3d' ? (
        <button
          type="button"
          className={cn(
            'absolute right-16 top-4 z-[3] grid size-9 place-items-center rounded-full cursor-pointer',
            'border border-nomi-paper/25 bg-nomi-overlay-chip-strong text-nomi-paper shadow-nomi-md backdrop-blur-sm',
            'hover:bg-nomi-paper hover:text-nomi-ink hover:border-transparent disabled:cursor-wait disabled:opacity-60',
            'focus-visible:outline-2 focus-visible:outline-nomi-paper focus-visible:outline-offset-2',
          )}
          aria-label={t('assetLibrary.downloadModel3d')}
          title={t('assetLibrary.downloadModel3d')}
          disabled={downloading}
          onClick={downloadModel}
        >
          {downloading ? <IconLoader2 size={18} stroke={1.8} className="animate-spin" /> : <IconDownload size={18} stroke={1.8} />}
        </button>
      ) : null}

      {current.kind === 'model3d' ? (
        <div
          className="h-[72vh] max-h-[720px] w-[84vw] max-w-[960px] overflow-hidden rounded-nomi bg-nomi-paper shadow-nomi-lg"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <React.Suspense
            fallback={
              <div className="grid h-full w-full place-items-center text-nomi-ink-40">
                <IconLoader2 size={24} stroke={1.6} className="animate-spin" aria-label={t('assetLibrary.loadingModel3d')} />
              </div>
            }
          >
            <Model3DViewer url={current.renderUrl} />
          </React.Suspense>
        </div>
      ) : current.kind === 'video' ? (
        <div className="relative flex max-h-full max-w-full" onPointerDown={(event) => event.stopPropagation()}>
          <video
            src={heal.playbackUrl}
            className="max-h-full max-w-full rounded-nomi bg-nomi-ink shadow-nomi-lg"
            aria-label={title}
            crossOrigin="use-credentials"
            controls
            autoPlay
            playsInline
            preload="metadata"
            onError={heal.onError}
            onLoadedMetadata={heal.onLoadedMetadata}
            onEnded={advance}
          />
          <VideoPlaybackStatusOverlay healingText={heal.healingText} failureText={heal.failureText} className="rounded-nomi" />
        </div>
      ) : current.kind === 'audio' ? (
        <div
          className="rounded-nomi bg-nomi-paper px-6 py-5 shadow-nomi-lg"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="mb-3 max-w-[60vw] truncate text-body-sm font-medium text-nomi-ink">{title}</div>
          {sourceName ? <div className="mb-3 max-w-[60vw] truncate text-micro text-nomi-ink-60">{t('assetLibrary.previewSource', { name: sourceName })}</div> : null}
          <audio src={current.renderUrl} controls autoPlay aria-label={title} style={{ width: 'min(60vw, 520px)' }} />
        </div>
      ) : (
        <NomiImage
          src={current.renderUrl}
          eager
          alt={title}
          className="max-h-full max-w-full rounded-nomi object-contain shadow-nomi-lg select-none"
          onPointerDown={(event) => event.stopPropagation()}
        />
      )}
      {sequence && sequence.length > 1 ? (
        <span className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-nomi-paper/20 bg-nomi-overlay-chip-strong px-3 py-1 text-micro text-nomi-paper shadow-nomi-sm" aria-live="polite">
          {sequenceIndex + 1} / {sequence.length}
        </span>
      ) : null}
    </div>,
    document.body,
  )
}
