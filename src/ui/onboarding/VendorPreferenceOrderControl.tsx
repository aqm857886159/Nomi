import React from 'react'
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { IconActionButton } from '../../design'
import { useVendorPreferenceOrder, saveVendorPreferenceOrder } from '../../workbench/common/useVendorPreference'
import { orderConfiguredVendors, type VendorPreferenceEntry } from './vendorPreferenceOrder'

export function VendorPreferenceOrderControl({ entries }: { entries: readonly VendorPreferenceEntry[] }): JSX.Element | null {
  const { t } = useTranslation()
  const savedOrder = useVendorPreferenceOrder()
  const configuredEntries = React.useMemo(() => orderConfiguredVendors(entries, savedOrder), [entries, savedOrder])
  const move = React.useCallback(async (index: number, delta: -1 | 1) => {
    const next = configuredEntries.map((entry) => entry.vendorKey)
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    await saveVendorPreferenceOrder(next)
  }, [configuredEntries])

  if (configuredEntries.length < 2) return null
  return (
    <section className="mt-5" data-vendor-preference-order>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-caption font-semibold text-nomi-ink-60">{t('onboardingProviders.drawer.home.vendorPreferenceTitle')}</h3>
          <p className="mt-0.5 text-micro leading-relaxed text-nomi-ink-40">{t('onboardingProviders.drawer.home.vendorPreferenceHint')}</p>
        </div>
      </div>
      <div className="overflow-hidden rounded-nomi-sm bg-nomi-ink-05 [&>*+*]:border-t [&>*+*]:border-nomi-line-soft">
        {configuredEntries.map((entry, index) => (
          <div key={entry.vendorKey} className="flex min-h-11 items-center gap-3 px-3 py-2" data-vendor-preference-row={entry.vendorKey}>
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-nomi-accent-soft text-caption font-semibold text-nomi-accent">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-caption text-nomi-ink">{entry.name}</span>
            <div className="flex shrink-0 gap-1">
              <IconActionButton
                aria-label={t('onboardingProviders.drawer.home.vendorPreferenceMoveUp')}
                title={t('onboardingProviders.drawer.home.vendorPreferenceMoveUp')}
                disabled={index === 0}
                onClick={() => { void move(index, -1) }}
                className="size-7 text-nomi-ink-40 hover:text-nomi-accent"
                icon={<IconChevronUp size={15} stroke={1.8} aria-hidden="true" />}
              />
              <IconActionButton
                aria-label={t('onboardingProviders.drawer.home.vendorPreferenceMoveDown')}
                title={t('onboardingProviders.drawer.home.vendorPreferenceMoveDown')}
                disabled={index === configuredEntries.length - 1}
                onClick={() => { void move(index, 1) }}
                className="size-7 text-nomi-ink-40 hover:text-nomi-accent"
                icon={<IconChevronDown size={15} stroke={1.8} aria-hidden="true" />}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
