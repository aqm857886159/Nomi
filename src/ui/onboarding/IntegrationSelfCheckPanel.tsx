import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconCheck, IconLock } from '../../vendor/tablerIcons'
import { DesignButton } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { integrationSelfCheckOutcome } from './integrationSelfCheckOutcome'

export type IntegrationVerificationHandoff = {
  requestId: string
  target: 'verification'
  sessionId: string
  revision: number
  ownerClientId: string
  display?: { name?: string; origin?: string; authType?: string; runId?: string }
}

type Props = {
  handoff: IntegrationVerificationHandoff
  onDone: () => void
}

/** 模型页的「开始自检」那一屏。自检是一次**不花钱**的检查（密钥能不能用、模型清单拉不拉得到、
 * 调用方式全不全），所以这里没有报价、没有挑战、没有收据——只是让用户知道要检查什么，
 * 并亲手按下开始。钱的闸只有一处：画布每次提交时的报价卡。 */
export function IntegrationSelfCheckPanel({ handoff, onDone }: Props): JSX.Element {
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

  const startSelfCheck = React.useCallback(async () => {
    const run = bridge?.onboarding?.integrationSessionStartSelfCheck
    if (!run || !session) return
    setBusy(true)
    setError('')
    try {
      const revision = Number(session.revision)
      if (!Number.isSafeInteger(revision)) throw new Error(t('modelSetup.integrationUnavailable'))
      const projection = await run({ sessionId: handoff.sessionId, expectedRevision: revision })
      // 主进程已经把失败原因如实写回来了；不看返回值就 onDone = 弹层默默关掉、
      // 用户回到「还没有接入生成模型」而毫不知情（真机矩阵 §BUG-2 的后半段）。
      const outcome = integrationSelfCheckOutcome(projection)
      if (!outcome.done) {
        setError(
          outcome.reasonCode
            ? t('modelSetup.integrationFailedWithReason', { code: outcome.reasonCode })
            : t('modelSetup.integrationFailed'),
        )
        return
      }
      await bridge.onboarding.integrationHandoffAck?.(handoff.requestId)
      onDone()
    } catch (value) {
      setError(value instanceof Error ? value.message : t('modelSetup.integrationSelfCheckFailed'))
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
          <h2 className="text-body font-semibold text-nomi-ink">{t('modelSetup.integrationSelfCheckTitle')}</h2>
          <p className="mt-1 text-caption leading-relaxed text-nomi-ink-60">{t('modelSetup.integrationSelfCheckHint')}</p>
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
        <p className="text-caption leading-relaxed text-nomi-ink-60">{t('modelSetup.integrationSelfCheckScope')}</p>
      </div>
      {error ? (
        <div className="text-caption leading-relaxed text-workbench-danger" role="alert">
          {error}
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <DesignButton variant="filled" onClick={() => void startSelfCheck()} loading={busy} disabled={!session || busy}>
          <IconCheck size={15} aria-hidden="true" />
          {t('modelSetup.integrationSelfCheckAction')}
        </DesignButton>
      </div>
    </div>
  )
}
