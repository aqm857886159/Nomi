import React from 'react'
import { IconCheck } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { APIMART_CONNECTED_EVENT } from './apimartConnectRoute'

export function ApimartConnectedHint() {
  const { t } = useTranslation()
  const [notice, setNotice] = React.useState<{ credits?: number; at: number } | null>(null)
  const [fading, setFading] = React.useState(false)
  React.useEffect(() => {
    const show = (event: Event) => {
      const credits = (event as CustomEvent).detail?.remainCredits
      setFading(false)
      setNotice({ credits: typeof credits === 'number' ? credits : undefined, at: Date.now() })
    }
    window.addEventListener(APIMART_CONNECTED_EVENT, show)
    return () => window.removeEventListener(APIMART_CONNECTED_EVENT, show)
  }, [])
  React.useEffect(() => {
    if (!notice) return
    const fade = window.setTimeout(() => setFading(true), 3800)
    const end = window.setTimeout(() => setNotice(null), 4000)
    return () => { window.clearTimeout(fade); window.clearTimeout(end) }
  }, [notice])
  return notice && <p role="status" data-apimart-connected className={`flex items-center gap-1 text-caption text-workbench-success transition-opacity duration-200 ${fading ? 'opacity-0' : 'opacity-100'}`}>
    <IconCheck size={14} aria-hidden />{t('modelSetup.apimartVerification.connected')}
    {notice.credits !== undefined && t('modelSetup.apimartVerification.connectedBalance', { value: notice.credits })}
  </p>
}
