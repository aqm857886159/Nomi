import React, { type JSX } from 'react'
import { IconChevronRight, IconDots, IconExternalLink, IconRefresh } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { WorkbenchIconButton, WorkbenchMenu } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { ModelAccountBalance } from '../../../electron/shared/contracts/modelSettingsAccount'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'

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
  const credits = (amount: number) => t('settings.modelsHome.credits', { amount: amount.toLocaleString(i18n.language, { maximumFractionDigits: 5 }) })
  const unknown = loading ? '…' : t('settings.modelsHome.unavailable')
  const stale = (at: number) => <small className="block text-nomi-ink-60">{t('settings.modelsHome.stale', {
    time: new Date(at).toLocaleString(i18n.language, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  })}</small>
  const link = 'inline-flex items-center gap-0.5 whitespace-nowrap text-nomi-accent hover:underline'
  const reload = () => { refresh(); refreshUsage() }
  const retry = <button type="button" className={link} onClick={reload}>{t('settings.modelsHome.retry')}</button>
  return <section data-model-account={vendor} className="rounded-nomi-sm border border-nomi-line px-3 py-2.5">
    <header className="flex items-center gap-2 border-b border-nomi-line-soft pb-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><strong className="truncate text-body-sm">{translateModelDisplayText(name)}</strong>
          <span className="rounded-pill bg-workbench-success-soft px-1.5 text-micro text-workbench-success-ink">{t('settings.modelsHome.connected')}</span></div>
        {balance?.keySuffix && <div className="text-micro text-nomi-ink-40">••••{balance.keySuffix}</div>}
      </div>
      <WorkbenchIconButton size="sm" icon={<IconRefresh />} label={t('settings.modelsHome.refresh')} disabled={loading} onClick={reload} />
      <WorkbenchMenu align="end" escapeLayer="menu" trigger={<WorkbenchIconButton size="sm" icon={<IconDots />} label={t('settings.modelsHome.more')} />}
        items={[
          { id: 'address', label: t('settings.modelsHome.address'), onSelect: onAddress },
          { id: 'models', label: t('settings.modelsHome.manage'), onSelect: onManage },
          { id: 'disconnect', label: t('settings.modelsHome.disconnect'), onSelect: onDisconnect, danger: true, disabled: readOnly },
        ]} />
    </header>
    <dl className="mt-2 grid grid-cols-[auto_auto_auto] divide-x divide-nomi-line-soft [&>div:not(:first-child)]:pl-3 [&>div:not(:last-child)]:pr-3 max-sm:[&>div:not(:first-child)]:pl-2 max-sm:[&>div:not(:last-child)]:pr-2 text-micro text-nomi-ink-60 [&_dd]:whitespace-nowrap [&_strong]:block [&_strong]:text-body-sm [&_strong]:text-nomi-ink">
      <div><dt>{t('settings.modelsHome.balance')}</dt><dd><strong>{balance?.accountCredits != null ? credits(balance.accountCredits) : unknown}</strong>
        {balance?.accountStaleSince && stale(balance.accountStaleSince)}
        {!loading && (balance?.accountCredits == null || balance.accountStaleSince) ? retry : <a className={link} href="https://apimart.ai/billing" target="_blank" rel="noopener noreferrer">{t('settings.modelsHome.topup')} <IconExternalLink size={11} /></a>}</dd></div>
      <div><dt>{t('settings.modelsHome.quota')}</dt><dd><strong>{balance?.unlimited ? t('settings.modelsHome.unlimited') : balance?.keyCredits != null ? credits(balance.keyCredits) : unknown}</strong>
        {balance?.quotaStaleSince && stale(balance.quotaStaleSince)}
        {balance?.quotaStaleSince ? retry : balance?.unlimited ? t('settings.modelsHome.bound') : !loading && balance?.keyCredits == null ? retry : null}</dd></div>
      <div><dt>{t('settings.modelsHome.week')}</dt><dd><strong>{total ? total.credits === null ? t('settings.modelsHome.pending') : credits(total.credits) : periods === undefined ? '…' : t('settings.modelsHome.unavailable')}</strong>
        {total && <>{t('settings.modelsHome.runs', { count: total.runs })} · </>}<button type="button" className={link} onClick={onUsage}>{t('settings.modelsHome.usage')} <IconChevronRight size={11} /></button></dd></div>
    </dl>
  </section>
}
