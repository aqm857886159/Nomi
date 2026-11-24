import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton } from '../../design'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'
import { ONBOARDING_DEMO_WORKS } from '../../ui/onboarding/apimartConnectRoute'

export function LibraryOnboardingHeroCard({
  modelCount,
  onConnect,
  onOpenOtherProviderSettings,
}: {
  modelCount: number
  onConnect?: () => void
  onOpenOtherProviderSettings?: () => void
}): JSX.Element {
  const { t } = useTranslation()

  return (
    <section
      aria-label={t('onboardingProviders.apimartConnect.pageTitle')}
      data-library-hero-card
      className="mb-3 flex w-full max-w-[872px] flex-wrap items-center gap-6 rounded-panel bg-nomi-paper p-5 shadow-nomi-md ring-1 ring-inset ring-nomi-line"
    >
      <div className="flex shrink-0 items-center gap-3" data-library-hero-works>
        {ONBOARDING_DEMO_WORKS.map((work) => (
          <div
            key={work.id}
            className="relative size-[108px] shrink-0 overflow-hidden rounded-panel bg-nomi-ink-05"
            data-library-hero-tile={work.id}
          >
            <img src={work.imageUrl} alt="" className="block h-full w-full object-cover" />
            <span className="pointer-events-none absolute bottom-1.5 left-1.5 inline-flex h-5 items-center whitespace-nowrap rounded-pill bg-nomi-overlay-chip px-2 text-caption font-normal text-nomi-media-ink">
              {translateModelDisplayText(work.modelLabel)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex min-w-[260px] flex-1 flex-col gap-1">
        <span className="text-title font-semibold text-nomi-ink" data-library-hero-title>
          {t('onboardingProviders.apimartConnect.hero.title', { count: modelCount })}
        </span>
        <span className="text-caption font-normal text-nomi-ink-60" data-library-hero-cost>
          {t('onboardingProviders.apimartConnect.hero.cost')}
        </span>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {onConnect ? (
            <WorkbenchButton
              variant="primary"
              className="rounded-pill px-4 font-semibold"
              onClick={onConnect}
              data-library-hero-connect
            >
              {t('onboardingProviders.apimartConnect.hero.connect')}
            </WorkbenchButton>
          ) : null}
          {onOpenOtherProviderSettings ? (
            <span className="inline-flex items-center whitespace-nowrap text-caption font-normal text-nomi-ink-60">
              <span>{t('onboardingProviders.apimartConnect.hero.otherProviderPrompt')}</span>
              <button
                type="button"
                onClick={onOpenOtherProviderSettings}
                data-library-hero-other-provider
                className="ml-1 cursor-pointer border-0 bg-transparent p-0 font-inherit text-caption font-normal text-nomi-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nomi-ink"
              >
                {t('onboardingProviders.apimartConnect.hero.otherProviderAction')}
              </button>
            </span>
          ) : null}
        </div>
      </div>
    </section>
  )
}
