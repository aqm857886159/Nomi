import React from 'react'
import { IconAdjustmentsHorizontal, IconExternalLink, IconRefresh } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { DesignButton, ICON_TIERS, StatusBadge, WorkbenchIconButton } from '../../design'
import type { ModelSettingsHomeConnection } from './ModelSettingsHome'
import { useVendorAccountFacts } from './useVendorAccountFacts'

import { accountBalanceUsd, apimartBillingUrl, formatCreditValue } from '../../workbench/common/apimartAccountDisplay'

export function ModelAccountCard({ connection, connected }: { connection: ModelSettingsHomeConnection; connected: boolean }) {
  const { t, i18n } = useTranslation()
  const { facts, loading, refresh } = useVendorAccountFacts(connected ? connection.vendorKey : undefined, connection.baseUrl)
  const locale = i18n.resolvedLanguage || i18n.language
  const unknown = loading ? t('onboardingProviders.drawer.loading') : t('onboardingProviders.account.unavailable')
  const credits = (n: number | null | undefined) => n == null ? unknown : t('onboardingProviders.account.credits', { value: formatCreditValue(n, locale) })
  const account = facts?.accountCredits
  return (
    <section data-model-account={connection.vendorKey} className="mt-3 rounded-nomi border border-nomi-line bg-nomi-paper px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-body-sm font-semibold text-nomi-ink">{connection.name}</span>
        {connected && <StatusBadge tone={facts?.keyState === 'valid' ? 'success' : facts?.keyState === 'invalid' ? 'warning' : 'neutral'}>{facts?.keyState === 'valid' ? t('onboardingProviders.account.connected') : facts?.keyState === 'invalid' ? t('onboardingProviders.account.invalid') : t('onboardingProviders.account.saved')}</StatusBadge>}
        <div className="flex shrink-0 items-center gap-1">
          {connected ? <>
            <WorkbenchIconButton icon={<IconRefresh />} size="sm" label={t('onboardingProviders.account.refresh')} onClick={refresh} />
            <WorkbenchIconButton icon={<IconAdjustmentsHorizontal />} size="sm" label={t('onboardingProviders.account.manage')} data-model-home-connection={connection.vendorKey} onClick={connection.onOpen} />
          </> : <DesignButton size="xs" variant="light" data-model-home-available={connection.vendorKey} onClick={connection.onOpen}>{t('onboardingProviders.account.connect')}</DesignButton>}
        </div>
      </div>
      {connected && <p className="mt-1 text-micro text-nomi-ink-60">{t('onboardingProviders.account.stored')}</p>}
      {connected ? (
        <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-nomi-line pt-2.5">
          <div className="min-w-0"><dt className="text-micro text-nomi-ink-60">{t('onboardingProviders.account.balance')}</dt>
            <dd className="mt-1 break-words text-body-sm font-semibold text-nomi-ink">{credits(account)}</dd>
            <dd className="mt-1 flex flex-wrap items-center gap-x-1 text-micro text-nomi-ink-60">
              {accountBalanceUsd(facts, locale)}
              {facts && <a href={apimartBillingUrl(locale)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-nomi-accent">{t('onboardingProviders.account.billing')}<IconExternalLink size={ICON_TIERS.corner.size} aria-hidden /></a>}
            </dd></div>
          <div className="min-w-0"><dt className="text-micro text-nomi-ink-60">{t('onboardingProviders.account.keyLimit')}</dt>
            <dd className="mt-1 break-words text-body-sm font-semibold text-nomi-ink">{facts?.keyUnlimited ? t('onboardingProviders.account.unlimited') : credits(facts?.keyCredits)}</dd>
            {facts?.keyUnlimited && <dd className="mt-1 text-micro text-nomi-ink-60">{t('onboardingProviders.account.limitedByBalance')}</dd>}</div>
          <div className="min-w-0"><dt className="text-micro text-nomi-ink-60">{t('onboardingProviders.account.sevenDays')}</dt>
            <dd className="mt-1 break-words text-body-sm font-semibold text-nomi-ink">{credits(facts?.usageCredits)}</dd>
            {facts?.usageRequests != null && <dd className="mt-1 text-micro text-nomi-ink-60">{t('onboardingProviders.account.requests', { count: facts.usageRequests })}</dd>}</div>
        </dl>
      ) : <p className="mt-1 text-caption text-nomi-ink-60">{t('onboardingProviders.account.connectHint')}</p>}
    </section>
  )
}
