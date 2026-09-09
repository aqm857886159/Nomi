import { useTranslation } from 'react-i18next'
import { DesignButton } from '../../design'
import { useAgentTraceDirectory } from '../../desktop/useAgentTraceDirectory'

export function AgentTraceSection(): JSX.Element | null {
  const { t } = useTranslation()
  const trace = useAgentTraceDirectory()
  if (!trace.available) return null
  return (
    <section className="mb-5 border-b border-nomi-line pb-4" data-settings-section="agent-trace">
      <div className="flex min-h-9 items-center gap-3">
        <div className="min-w-0">
          <div className="text-body-sm text-nomi-ink">{t('settings.general.trace.title')}</div>
          <div className="mt-0.5 text-micro text-nomi-ink-40">{t('settings.general.trace.description')}</div>
        </div>
        <DesignButton variant="default" disabled={trace.busy} data-agent-trace-open="project" onClick={() => { void trace.open() }}>
          {t(trace.busy ? 'settings.general.trace.opening' : 'settings.general.trace.open')}
        </DesignButton>
      </div>
      {trace.message ? <p role="alert" className="mt-2 text-caption text-nomi-ink-60">{trace.message}</p> : null}
    </section>
  )
}
