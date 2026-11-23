import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredPopover } from '../../design'
import type { ApimartCatalogCounts } from './useOnboardingModelAvailability'

export function ApimartFineprintPopover({
  counts,
  open,
  onOpenChange,
}: {
  counts: ApimartCatalogCounts
  open: boolean
  onOpenChange: (next: boolean) => void
}): JSX.Element {
  const { t } = useTranslation()
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const closeTimerRef = React.useRef<number | null>(null)

  const clearCloseTimer = React.useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const scheduleClose = React.useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      onOpenChange(false)
    }, 140)
  }, [clearCloseTimer, onOpenChange])

  React.useEffect(() => () => clearCloseTimer(), [clearCloseTimer])

  const items: ReadonlyArray<{ id: string; heading: string; body: string }> = [
    {
      id: 'models',
      heading: t('onboardingProviders.apimartConnect.fineprint.modelsHeading', { total: counts.total }),
      body: t('onboardingProviders.apimartConnect.fineprint.modelsBody', {
        image: counts.image,
        video: counts.video,
        audio: counts.audio,
        text: counts.text,
      }),
    },
    {
      id: 'latest',
      heading: t('onboardingProviders.apimartConnect.fineprint.latestHeading'),
      body: t('onboardingProviders.apimartConnect.fineprint.latestBody'),
    },
    {
      id: 'savings',
      heading: t('onboardingProviders.apimartConnect.fineprint.savingsHeading'),
      body: t('onboardingProviders.apimartConnect.fineprint.savingsBody'),
    },
    {
      id: 'cost',
      heading: t('onboardingProviders.apimartConnect.fineprint.costHeading'),
      body: t('onboardingProviders.apimartConnect.fineprint.costBody'),
    },
    {
      id: 'refund',
      heading: t('onboardingProviders.apimartConnect.fineprint.refundHeading'),
      body: t('onboardingProviders.apimartConnect.fineprint.refundBody'),
    },
  ]

  return (
    <div
      className="inline-flex"
      onMouseEnter={() => {
        clearCloseTimer()
        onOpenChange(true)
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        data-apimart-fineprint-trigger
        className="cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 font-inherit text-caption font-normal text-nomi-ink-60 underline decoration-nomi-ink-30 underline-offset-[3px] transition-colors hover:text-nomi-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nomi-ink"
      >
        {t('onboardingProviders.apimartConnect.fineprintNote')}
      </button>
      {open ? (
        <AnchoredPopover
          anchorRef={triggerRef}
          align="end"
          side="bottom"
          gap={8}
          onClose={() => onOpenChange(false)}
        >
          <div
            role="region"
            aria-label={t('onboardingProviders.apimartConnect.fineprintAria')}
            data-apimart-fineprint-popover
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClose}
            className="flex w-[440px] max-w-[calc(100vw-32px)] flex-col gap-2 rounded-panel border border-nomi-line bg-nomi-paper p-3 text-left font-normal shadow-nomi-lg"
          >
            {items.map((item) => (
              <div key={item.id} className="text-caption leading-relaxed text-nomi-ink-60" data-apimart-fineprint-item={item.id}>
                <span className="font-semibold text-nomi-ink">{item.heading}</span>
                <span className="ml-1.5">{item.body}</span>
              </div>
            ))}
            <div className="border-t border-nomi-line-soft pt-2 text-caption font-normal text-nomi-ink-40">
              {t('onboardingProviders.apimartConnect.fineprint.footer')}
            </div>
          </div>
        </AnchoredPopover>
      ) : null}
    </div>
  )
}
