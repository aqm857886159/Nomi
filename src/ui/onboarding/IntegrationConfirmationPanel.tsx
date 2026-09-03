import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconCheck, IconLock } from '../../vendor/tablerIcons'
import { DesignButton } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'

export type IntegrationVerificationHandoff = {
  requestId: string
  target: 'verification'
  sessionId: string
  revision: number
  ownerClientId: string
  display?: { name?: string; origin?: string; authType?: string; runId?: string; challengeId?: string }
}

type Props = {
  handoff: IntegrationVerificationHandoff
  onDone: () => void
}

/** Trusted Nomi UI for the integration spend/verification contract. The
 * signed challenge stays in main; this surface only receives a safe summary
 * and returns an opaque receipt id after a real gesture. */
export function IntegrationConfirmationPanel({ handoff, onDone }: Props): JSX.Element {
  const { t } = useTranslation()
  const [session, setSession] = React.useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const bridge = getDesktopBridge()

  React.useEffect(() => {
    let alive = true
    const get = bridge?.onboarding?.integrationSessionGet
    if (!get) {
      setError(t('modelSetup.integrationUnavailable'))
      return () => {
        alive = false
      }
    }
    void get(handoff.sessionId)
      .then((value) => {
        if (alive && value && typeof value === 'object') setSession(value as Record<string, unknown>)
      })
      .catch(() => {
        if (alive) setError(t('modelSetup.integrationUnavailable'))
      })
    return () => {
      alive = false
    }
  }, [bridge, handoff.sessionId, t])

  const confirm = React.useCallback(async () => {
    const confirmUi = bridge?.onboarding?.integrationSessionConfirm
    if (!confirmUi || !session) return
    setBusy(true)
    setError('')
    try {
      const revision = Number(session.revision)
      const challengeId = handoff.display?.challengeId || String(session.pendingChallengeId || '')
      if (!Number.isSafeInteger(revision) || !challengeId) throw new Error(t('modelSetup.integrationUnavailable'))
      await confirmUi({ sessionId: handoff.sessionId, expectedRevision: revision, challengeId })
      await bridge.onboarding.integrationHandoffAck?.(handoff.requestId)
      onDone()
    } catch (value) {
      setError(value instanceof Error ? value.message : t('modelSetup.integrationConfirmFailed'))
    } finally {
      setBusy(false)
    }
  }, [bridge, handoff, onDone, session, t])

  const config =
    session?.config && typeof session.config === 'object' ? (session.config as Record<string, unknown>) : {}
  const selections = Array.isArray(session?.selections) ? (session.selections as Array<Record<string, unknown>>) : []
  const displayName = String(config.name || handoff.display?.name || '')
  const origin = String(config.baseUrl || handoff.display?.origin || '')
  return (
    <div
      className="flex flex-col gap-4 rounded-nomi-sm border border-nomi-line bg-nomi-paper p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-nomi-sm bg-nomi-accent-soft text-nomi-accent">
          <IconLock size={17} stroke={1.8} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-body font-semibold text-nomi-ink">{t('modelSetup.integrationConfirmTitle')}</h2>
          <p className="mt-1 text-caption leading-relaxed text-nomi-ink-60">{t('modelSetup.integrationConfirmHint')}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-y border-nomi-line-soft py-3 text-caption text-nomi-ink-60">
        {displayName ? (
          <div>
            <span className="font-medium text-nomi-ink">{t('modelSetup.vendorName')}：</span>
            {displayName}
          </div>
        ) : null}
        {origin ? (
          <div className="break-all">
            <span className="font-medium text-nomi-ink">{t('modelSetup.baseUrl')}：</span>
            {origin}
          </div>
        ) : null}
        <div>
          <span className="font-medium text-nomi-ink">{t('modelSetup.models')}：</span>
          {selections
            .map((item) => String(item.modelKey || ''))
            .filter(Boolean)
            .join('、') || t('modelSetup.integrationPending')}
        </div>
      </div>
      <div className="flex items-start gap-2 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2 text-caption leading-relaxed text-nomi-ink-60">
        <IconAlertTriangle size={15} className="mt-0.5 shrink-0 text-nomi-warning" aria-hidden="true" />
        <p className="text-caption leading-relaxed text-nomi-ink-60">{t('modelSetup.integrationSpendWarning')}</p>
      </div>
      {error ? (
        <div className="text-caption leading-relaxed text-workbench-danger" role="alert">
          {error}
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <DesignButton variant="filled" onClick={() => void confirm()} loading={busy} disabled={!session || busy}>
          <IconCheck size={15} aria-hidden="true" />
          {t('modelSetup.integrationConfirmAction')}
        </DesignButton>
      </div>
    </div>
  )
}
