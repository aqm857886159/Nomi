import React, { type JSX } from 'react'
import { IconChevronRight, IconDots, IconExternalLink, IconRefresh } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { WorkbenchIconButton, WorkbenchMenu } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { ModelAccountBalance } from '../../../electron/shared/contracts/modelSettingsAccount'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'
import { formatCreditValue } from '../../workbench/generationCanvas/spend/sendCostFormat'

import { useModelUsage, usageTotal } from './useModelUsage'

export function ModelAccountCard({ vendor, name, onAddress, onManage, onDisconnect, onUsage, readOnly }: {
  vendor: string; name: string; onAddress: () => void; onManage: () => void; onDisconnect: () => void; onUsage: () => void; readOnly: boolean
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const [balance, setBalance] = React.useState<ModelAccountBalance | null>()
  const [loading, setLoading] = React.useState(true)
  const [revision, refresh] = React.useReducer(n => n + 1, 0)
  const { periods, refresh: refreshUsage } = useModelUsage(vendor)
  React.useEffect(() => {
    let active = true
    const read = (force: boolean) => {
      setLoading(true)
      void Promise.resolve(getDesktopBridge()?.onboarding?.modelAccount?.(vendor, force)).then(
        result => { if (active) setBalance(result ?? null) },
        () => { if (active) setBalance(null) },
      ).finally(() => { if (active) setLoading(false) })
    }
    read(revision > 0)
    const focus = () => read(false)
    window.addEventListener('focus', focus)
    return () => { active = false; window.removeEventListener('focus', focus) }
  }, [vendor, revision])
  const total = periods && usageTotal(periods[7])
  const credits = (amount: number) => t('settings.modelsHome.credits', { amount: formatCreditValue(amount, i18n.language) })
  const unknown = loading ? '…' : t('settings.modelsHome.unavailable')
  const stale = (at: number) => <small className="block text-nomi-ink-60">{t('settings.modelsHome.stale', {
    time: new Date(at).toLocaleString(i18n.language, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  })}</small>
  const link = 'inline-flex items-center gap-0.5 whitespace-nowrap font-medium text-nomi-accent hover:underline'
  const reload = () => { refresh(); refreshUsage() }
  const retry = <button type="button" className={link} onClick={reload}>{t('settings.modelsHome.retry')}</button>
  return <section data-model-account={vendor} className="rounded-nomi ring-1 ring-inset ring-nomi-line">
    <header className="flex items-center gap-2 py-3 pl-3.5 pr-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><strong className="truncate text-body font-semibold">{translateModelDisplayText(name)}</strong>
          <span className="inline-flex h-5 items-center rounded-pill bg-workbench-success-soft px-1.5 text-micro text-workbench-success-ink">{t('settings.modelsHome.connected')}</span></div>
        {/* The card only renders for a key the OS secure storage decrypted (onboardingDrawerConnections), so the storage line is always true here. */}
        <div data-model-key-storage className="font-mono text-caption text-nomi-ink-60">{balance?.keySuffix && <>••••{balance.keySuffix} · </>}{t('settings.modelsHome.keychain')}</div>
      </div>
      <WorkbenchIconButton size="sm" className="rounded-nomi-sm" icon={<IconRefresh />} label={t('settings.modelsHome.refresh')} disabled={loading} onClick={reload} />
      <WorkbenchMenu align="end" escapeLayer="menu" trigger={<WorkbenchIconButton size="sm" icon={<IconDots />} label={t('settings.modelsHome.more')} />}
        items={[
          { id: 'address', label: t('settings.modelsHome.address'), onSelect: onAddress },
          { id: 'models', label: t('settings.modelsHome.manage'), onSelect: onManage },
          { id: 'disconnect', label: t('settings.modelsHome.disconnect'), onSelect: onDisconnect, danger: true, disabled: readOnly },
        ]} />
    </header>
    <dl className="grid grid-cols-[auto_auto_auto] divide-x divide-nomi-line-soft border-t border-nomi-line-soft [&>div]:px-3.5 [&>div]:py-2.5 text-caption text-nomi-ink-60 [&_dd]:whitespace-nowrap [&_strong]:block [&_strong]:text-title [&_strong]:font-semibold [&_strong]:text-nomi-ink">
      <div><dt>{t('settings.modelsHome.balance')}</dt><dd><strong className="tabular-nums">{balance?.accountCredits != null ? credits(balance.accountCredits) : unknown}</strong>
        {balance?.accountStaleSince && stale(balance.accountStaleSince)}
        {!loading && (balance?.accountCredits == null || balance.accountStaleSince) ? retry : <a className={link} href="https://apimart.ai/billing" target="_blank" rel="noopener noreferrer">{t('settings.modelsHome.topup')} <IconExternalLink size={12} /></a>}</dd></div>
      <div><dt>{t('settings.modelsHome.quota')}</dt><dd><strong className="tabular-nums">{balance?.unlimited ? t('settings.modelsHome.unlimited') : balance?.keyCredits != null ? credits(balance.keyCredits) : unknown}</strong>
        {balance?.quotaStaleSince && stale(balance.quotaStaleSince)}
        {balance?.quotaStaleSince ? retry : balance?.unlimited ? t('settings.modelsHome.bound') : !loading && balance?.keyCredits == null ? retry : null}</dd></div>
      <div><dt>{t('settings.modelsHome.week')}</dt><dd><strong className="tabular-nums">{total ? total.credits === null ? t('settings.modelsHome.pending') : credits(total.credits) : periods === undefined ? '…' : t('settings.modelsHome.unavailable')}</strong>
        <span className="flex items-center gap-2">
          {total && <span>{t('settings.modelsHome.runs', { count: total.runs })}</span>}
          <button type="button" className={link} onClick={onUsage}>{t('settings.modelsHome.usageTitle')} <IconChevronRight size={12} /></button>
        </span></dd></div>
    </dl>
  </section>
}
