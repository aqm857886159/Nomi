import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconFileZip } from '@tabler/icons-react'
import { DesignButton } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { DiagnosticsExportResult } from '../../../electron/shared/contracts/diagnostics'

/**
 * 「隐私与诊断」区块的下半格：出事时怎么把证据交出来。
 *
 * 上半格（TelemetrySection）管的是「要不要往外发匿名计数」；这一格反过来——**什么都不自动发**，
 * 只把本机已有的日志与状态打成一个 zip，保存到用户自己选的位置，由他决定发不发给我们。
 * 所以它不该是另起一个设置项，而是同一个隐私块里的第二行（§1.5 一功能一个家）。
 *
 * 界面上把「包里有什么」写全，其中一条明着标出「Agent 记录含创作内容」——
 * 诚实交付（D4）：用户要在点按钮之前就知道自己在交出什么，不能靠事后打开 zip 才发现。
 */
export function DiagnosticsBundleSection(): JSX.Element {
  const { t } = useTranslation()
  const api = getDesktopBridge()?.settings?.diagnostics
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<DiagnosticsExportResult | null>(null)

  if (!api) return <></>

  const exportBundle = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await api.exportBundle())
    } catch {
      setResult({ ok: false, reason: 'failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-4" data-settings-section="diagnostics" data-diagnostics-state={busy ? 'exporting' : result?.ok ? 'saved' : result ? result.reason : 'idle'}>
      <div className="mb-1.5 text-body-sm text-nomi-ink">{t('settings.general.diagnostics.title')}</div>
      <p className="mb-2 text-caption leading-relaxed text-nomi-ink-40">{t('settings.general.diagnostics.description')}</p>
      <p className="mb-3 text-micro leading-relaxed text-nomi-ink-40">{t('settings.general.diagnostics.contentNotice')}</p>
      <DesignButton
        type="button"
        variant="default"
        disabled={busy}
        leftSection={<IconFileZip size={14} aria-hidden="true" />}
        onClick={() => { void exportBundle() }}
      >
        {busy ? t('settings.general.diagnostics.exporting') : t('settings.general.diagnostics.export')}
      </DesignButton>
      {result ? (
        <div className="mt-2 text-micro text-nomi-ink-40" data-diagnostics-result>
          {result.ok
            ? t('settings.general.diagnostics.saved', {
                count: result.entryCount,
                size: (result.totalBytes / (1024 * 1024)).toFixed(1),
              })
            : t(result.reason === 'canceled' ? 'settings.general.diagnostics.canceled' : 'settings.general.diagnostics.failed')}
        </div>
      ) : null}
    </section>
  )
}
