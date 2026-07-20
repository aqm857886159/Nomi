/* eslint-disable react-refresh/only-export-components */
import React from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconCopy, IconFileText, IconPhoto, IconX } from '../../../vendor/tablerIcons'
import { cn } from '../../../utils/cn'
import type { NomiBrowserAsset } from '../assets/browserAssetData'
import { isBrowserAssetDraggable } from '../popover/browserAssetPopoverUtils'
import type { BrowserPromptExtractionMode } from './browserPromptExtraction'
import { TOOL_BUTTON_CLASS } from '../popover/browserAssetPopoverConstants'
import i18n from '../../../i18n'

type BrowserPromptAssetTileProps = {
  asset: NomiBrowserAsset
  selected: boolean
  setNodeRef: (node: HTMLDivElement | null) => void
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void
  onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void
}

type BrowserPromptDetailModalProps = {
  asset: NomiBrowserAsset
  promptCategories: readonly { id: string; label: string }[]
  onClose: () => void
}

export function promptExtractionModeFromAsset(asset: NomiBrowserAsset): BrowserPromptExtractionMode {
  return asset.promptCard?.extractionMode === 'style' ? 'style' : 'replicate'
}

export function promptExtractionModeLabel(mode: BrowserPromptExtractionMode): string {
  return i18n.t(`browserAssets.extraction.${mode}` as 'browserAssets.extraction.replicate')
}

function promptPreviewUrl(asset: NomiBrowserAsset): string {
  return asset.promptCard?.referenceImages[0]?.url || asset.previewUrl || ''
}

function promptTypeLabel(asset: NomiBrowserAsset, categories: readonly { id: string; label: string }[]): string {
  const promptType = asset.promptCard?.promptType || 'image'
  const category = categories.find((item) => item.id === promptType)
  const typeLabel =
    category?.label ??
    i18n.t(promptType === 'video' ? 'browserAssets.extraction.videoPrompt' : 'browserAssets.extraction.imagePrompt')
  return `${promptExtractionModeLabel(promptExtractionModeFromAsset(asset))} · ${typeLabel}`
}

export function promptCardText(asset: NomiBrowserAsset): string {
  const prompt = asset.promptCard?.prompt.trim()
  if (prompt) return prompt
  if (asset.status === 'loading') return i18n.t('browserAssets.extraction.analyzing')
  if (asset.status === 'error') return i18n.t('browserAssets.extraction.failed')
  return i18n.t('browserAssets.extraction.empty')
}

export const BrowserPromptAssetTile = React.memo(function BrowserPromptAssetTile({
  asset,
  selected,
  setNodeRef,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
}: BrowserPromptAssetTileProps): JSX.Element {
  useTranslation()
  const previewUrl = promptPreviewUrl(asset)
  const loading = asset.status === 'loading'
  const failed = asset.status === 'error'
  const prompt = promptCardText(asset)

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      draggable={isBrowserAssetDraggable(asset, false)}
      data-browser-asset-tile="true"
      data-asset-id={asset.id}
      aria-label={asset.title}
      aria-selected={selected}
      aria-grabbed={selected}
      title={asset.title}
      className={cn(
        'group mb-2.5 min-w-0 break-inside-avoid overflow-hidden rounded-nomi border bg-nomi-paper text-left outline-none',
        'cursor-pointer select-none shadow-nomi-sm transition-[border-color,box-shadow,transform,background] duration-[var(--nomi-transition-fast)]',
        selected
          ? 'border-nomi-accent shadow-nomi-md ring-2 ring-nomi-accent ring-offset-1 ring-offset-nomi-paper'
          : 'border-nomi-line hover:border-nomi-ink-20 hover:bg-nomi-bg',
        failed && 'border-workbench-danger/45',
      )}
      style={{ breakInside: 'avoid' }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.currentTarget.click()
      }}
    >
      <div className={cn('relative overflow-hidden bg-nomi-ink-05', previewUrl ? 'aspect-[5/3]' : 'h-20')}>
        {previewUrl ? (
          <img src={previewUrl} alt="" draggable={false} className="block size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-nomi-ink-40">
            <IconPhoto size={26} stroke={1.5} aria-hidden="true" />
          </div>
        )}
        {loading ? (
          <div className="absolute inset-0 grid place-items-center bg-nomi-paper/75 text-nomi-ink-40 backdrop-blur-[1px]">
            <span className="size-5 animate-spin rounded-pill border-2 border-nomi-ink-20 border-t-nomi-accent" />
          </div>
        ) : null}
        {failed ? (
          <div className="absolute inset-0 grid place-items-center bg-workbench-danger-soft/85 text-workbench-danger">
            <IconFileText size={24} stroke={1.6} aria-hidden="true" />
          </div>
        ) : null}
        {selected ? (
          <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-pill bg-nomi-accent text-nomi-paper shadow-nomi-sm">
            <IconCheck size={13} stroke={2.2} aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <div className="grid gap-1.5 p-2">
        <div className="truncate text-micro font-semibold leading-[1.15] text-nomi-ink" title={asset.title}>
          {asset.title}
        </div>
        <div
          className={cn(
            'max-h-[58px] overflow-hidden rounded-nomi-sm border bg-nomi-bg px-2 py-1.5 text-micro leading-relaxed',
            failed ? 'border-workbench-danger/35 text-workbench-danger' : 'border-nomi-line-soft text-nomi-ink-65',
          )}
          style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3 }}
        >
          {prompt}
        </div>
      </div>
    </div>
  )
})

export function BrowserPromptDetailModal({
  asset,
  promptCategories,
  onClose,
}: BrowserPromptDetailModalProps): JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)
  const references = asset.promptCard?.referenceImages ?? []
  const previewUrl = promptPreviewUrl(asset)
  const prompt = promptCardText(asset)
  const loading = asset.status === 'loading'
  const canUsePrompt = asset.status !== 'loading' && Boolean(asset.promptCard?.prompt.trim())

  const copyPrompt = React.useCallback(async (): Promise<void> => {
    if (!canUsePrompt) return
    try {
      await navigator.clipboard.writeText(asset.promptCard?.prompt.trim() || '')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }, [asset.promptCard?.prompt, canUsePrompt])

  return (
    <div
      className="absolute inset-0 z-[20] grid place-items-center bg-nomi-ink/38 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={t('browserAssets.extraction.detail')}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <motion.div
        className="flex max-h-full w-full max-w-[840px] flex-col overflow-hidden rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-lg"
        initial={{ opacity: 0, scale: 0.985, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
      >
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-nomi-line-soft px-4">
          <div className="min-w-0">
            <div className="truncate text-body-sm font-bold text-nomi-ink">{t('browserAssets.extraction.detail')}</div>
            <div className="mt-0.5 truncate text-micro text-nomi-ink-40">{asset.title}</div>
          </div>
          <button
            type="button"
            className={TOOL_BUTTON_CLASS}
            aria-label={t('browserAssets.extraction.closeDetail')}
            onClick={onClose}
          >
            <IconX size={17} stroke={1.8} aria-hidden="true" />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
          <section className="grid min-h-0 gap-2">
            <div className="text-caption font-semibold text-nomi-ink-80">
              {t('browserAssets.extraction.references')}
            </div>
            <div className="relative min-h-[260px] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-bg">
              {previewUrl ? (
                <img src={previewUrl} alt="" draggable={false} className="block size-full object-contain" />
              ) : (
                <div className="grid size-full min-h-[260px] place-items-center text-nomi-ink-40">
                  <IconPhoto size={34} stroke={1.45} aria-hidden="true" />
                </div>
              )}
              {loading ? (
                <div className="absolute inset-0 grid place-items-center bg-nomi-paper/70 backdrop-blur-[1px]">
                  <span className="size-6 animate-spin rounded-pill border-2 border-nomi-ink-20 border-t-nomi-accent" />
                </div>
              ) : null}
            </div>
            {references.length > 1 ? (
              <div className="grid grid-cols-4 gap-2">
                {references.slice(0, 8).map((reference, index) => (
                  <div
                    key={`${reference.url}-${index}`}
                    className="aspect-video overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-bg"
                  >
                    <img src={reference.url} alt="" draggable={false} className="block size-full object-cover" />
                  </div>
                ))}
              </div>
            ) : null}
          </section>
          <section className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-caption font-semibold text-nomi-ink-80">{t('browserAssets.extraction.prompt')}</div>
              <span className="inline-flex h-6 items-center rounded-pill bg-nomi-ink-05 px-2 text-micro font-semibold text-nomi-ink-55">
                {promptTypeLabel(asset, promptCategories)}
              </span>
            </div>
            <textarea
              readOnly
              value={prompt}
              className={cn(
                'min-h-[260px] flex-1 resize-none rounded-nomi border bg-nomi-bg p-3 text-body-sm leading-relaxed outline-none',
                asset.status === 'error'
                  ? 'border-workbench-danger/35 text-workbench-danger'
                  : 'border-nomi-line text-nomi-ink-80',
              )}
            />
            <div className="flex items-center gap-2 text-caption text-nomi-ink-40">
              <span className="font-semibold text-nomi-ink-60">{t('browserAssets.extraction.model')}</span>
              <span className="rounded-pill bg-nomi-accent-soft px-2 py-1 text-micro font-semibold text-nomi-accent">
                {t('browserAssets.extraction.currentTextModel')}
              </span>
            </div>
          </section>
        </div>
        <div className="flex min-h-14 shrink-0 items-center justify-end gap-2 border-t border-nomi-line-soft px-4">
          <button
            type="button"
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-nomi border border-nomi-line bg-nomi-paper px-3 text-caption font-semibold',
              'cursor-pointer text-nomi-ink-80 hover:bg-nomi-ink-05 hover:text-nomi-ink',
              !canUsePrompt && 'cursor-not-allowed opacity-50 hover:bg-nomi-paper',
            )}
            disabled={!canUsePrompt}
            onClick={() => void copyPrompt()}
          >
            <IconCopy size={15} stroke={1.8} aria-hidden="true" />
            {copied ? t('browserAssets.extraction.copied') : t('browserAssets.extraction.copy')}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
