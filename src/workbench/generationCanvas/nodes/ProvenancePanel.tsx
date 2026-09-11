import React from 'react'
import { useTranslation } from 'react-i18next'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { cn } from '../../../utils/cn'
import { useClipboardCopy, useOverlayEscape } from '../../../design'
import { NODE_SCROLL_REGION_CLASS_NAME } from './nodeScrollRegionClassName'

/** Trim trailing zeros from a credits amount (8.50 → "8.5", 8.00 → "8"). Local to the
 *  provenance viewer so it does not depend on the estimate module. */
function formatCredits(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return ''
  return amount.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

/**
 * Phase E Task E11 — Provenance viewer.
 *
 * Displays full generation provenance for a node's current result so the
 * user can: see why this looks the way it does, copy the exact prompt, or
 * "regenerate with the same params" (button delegated to caller via
 * onRegenerate). Falls back to a friendly "no provenance recorded" message
 * for legacy v0.4.0 nodes that predate E11.
 */

type Props = {
  node: GenerationCanvasNode
  open: boolean
  onClose: () => void
  /** Optional regenerate handler — if absent, button is hidden. */
}

export default function ProvenancePanel({ node, open, onClose }: Props): JSX.Element | null {
  const { t, i18n } = useTranslation()
  // Esc = 关闭（只读溯源面板，关掉不丢任何东西）。hook 必须在 early return 之前。
  const dialogRef = React.useRef<HTMLDivElement | null>(null)
  useOverlayEscape(dialogRef, open, onClose)
  // 「复制提示」曾是一条 `void navigator.clipboard?.writeText(...)`：写没写进去谁也不知道。
  const clipboard = useClipboardCopy()
  if (!open) return null
  const provenance = node.result?.provenance
  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[210] grid place-items-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('generationCommon.provenance.dialogAria')}
      onClick={onClose}
    >
      <div
        className={cn(
          NODE_SCROLL_REGION_CLASS_NAME,
          'w-full max-w-[560px] max-h-[80vh] overflow-y-auto',
          'bg-nomi-paper border border-nomi-line rounded-nomi-lg shadow-nomi-md p-5',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-title font-medium text-nomi-ink m-0">
            {t('generationCommon.provenance.title', { name: node.title || node.kind })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-nomi-ink-40 hover:text-nomi-ink text-h2 leading-none"
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>

        {!provenance ? (
          <div className="text-body-sm text-nomi-ink-40 leading-relaxed">
            {t('generationCommon.provenance.unavailable')}
            <div className="mt-2 text-caption">
              {t('generationCommon.provenance.possibleReasons')}
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                <li>{t('generationCommon.provenance.legacyReason')}</li>
                <li>{t('generationCommon.provenance.localReason')}</li>
                <li>{t('generationCommon.provenance.failedReason')}</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-caption">
            <ProvenanceRow label={t('generationCommon.provenance.provider')} value={provenance.provider || '—'} />
            <ProvenanceRow label={t('generationCommon.provenance.model')} value={provenance.modelKey || '—'} />
            {provenance.cost?.unit === 'actual' ? (
              <ProvenanceRow
                label={t('generationCommon.provenance.actualCost')}
                value={`${formatCredits(provenance.cost.amount)} ${provenance.cost.currency}`}
                mono
              />
            ) : null}
            <ProvenanceRow
              label={t('generationCommon.provenance.time')}
              value={new Date(provenance.timestamp).toLocaleString(i18n.resolvedLanguage || i18n.language)}
            />
            {typeof provenance.seed === 'number' ? (
              <ProvenanceRow label={t('generationCommon.provenance.seed')} value={String(provenance.seed)} mono />
            ) : null}
            <div>
              <div className="text-micro text-nomi-ink-40 uppercase tracking-wide mb-1">
                {t('generationCommon.provenance.prompt')}
              </div>
              <div className="bg-nomi-bg border border-nomi-line-soft rounded-nomi-sm p-2 text-caption font-mono leading-relaxed whitespace-pre-wrap break-words text-nomi-ink-80">
                {provenance.prompt || t('generationCommon.provenance.empty')}
              </div>
              {provenance.prompt ? (
                <button
                  type="button"
                  onClick={() => { void clipboard.copy(provenance.prompt || '') }}
                  data-provenance-copy-state={clipboard.state}
                  className={cn(
                    'mt-1 text-micro hover:underline',
                    clipboard.copied ? 'text-workbench-success' : clipboard.failed ? 'text-workbench-danger' : 'text-nomi-accent',
                  )}
                >
                  {clipboard.copied
                    ? t('common.copied')
                    : clipboard.failed
                      ? t('common.copyFailed')
                      : t('generationCommon.provenance.copyPrompt')}
                </button>
              ) : null}
            </div>
            {provenance.negativePrompt ? (
              <div>
                <div className="text-micro text-nomi-ink-40 uppercase tracking-wide mb-1">
                  {t('generationCommon.provenance.negativePrompt')}
                </div>
                <div className="bg-nomi-bg border border-nomi-line-soft rounded-nomi-sm p-2 text-caption font-mono">
                  {provenance.negativePrompt}
                </div>
              </div>
            ) : null}
            {provenance.params && Object.keys(provenance.params).length > 0 ? (
              <div>
                <div className="text-micro text-nomi-ink-40 uppercase tracking-wide mb-1">
                  {t('generationCommon.provenance.params')}
                </div>
                <pre className={cn(NODE_SCROLL_REGION_CLASS_NAME, 'bg-nomi-bg border border-nomi-line-soft rounded-nomi-sm p-2 text-micro font-mono overflow-x-auto text-nomi-ink-80')}>
                  {JSON.stringify(provenance.params, null, 2)}
                </pre>
              </div>
            ) : null}
            {provenance.vendorRequestId ? (
              <ProvenanceRow
                label={t('generationCommon.provenance.requestId')}
                value={provenance.vendorRequestId}
                mono
                small
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

function ProvenanceRow({
  label,
  value,
  mono,
  small,
}: {
  label: string
  value: string
  mono?: boolean
  small?: boolean
}): JSX.Element {
  return (
    <div className="flex items-baseline gap-3">
      <div className={cn('text-nomi-ink-40 shrink-0 w-[80px] text-micro')}>{label}</div>
      <div
        className={cn(
          'flex-1 text-nomi-ink-80',
          mono ? 'font-mono' : '',
          small ? 'text-micro' : 'text-caption',
          'break-words',
        )}
      >
        {value}
      </div>
    </div>
  )
}
