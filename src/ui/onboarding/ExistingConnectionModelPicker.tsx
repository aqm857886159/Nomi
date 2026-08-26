import React from 'react'
import { useTranslation } from 'react-i18next'
import { getDesktopBridge } from '../../desktop/bridge'
import type { DesktopExistingConnectionSummary } from '../../desktop/onboardingBridgeTypes'
import { ModelPickerScreen, type PickerModel } from './ModelPickerScreen'
import { modelDiscoveryMessage } from './modelDiscovery'
import { useModelDiscovery } from './useModelDiscovery'

export function ExistingConnectionModelPicker({
  opened,
  vendorKey,
  initialConnection,
  confirming,
  onBack,
  onConfirm,
}: {
  opened: boolean
  vendorKey: string
  initialConnection: DesktopExistingConnectionSummary
  confirming: boolean
  onBack: () => void
  onConfirm: (models: PickerModel[]) => void
}): JSX.Element {
  const { t } = useTranslation()
  const onboarding = getDesktopBridge()?.onboarding
  const load = React.useCallback(async () => {
    if (!onboarding?.existingConnectionListModels) {
      return { ok: false, code: 'DESKTOP_UNAVAILABLE', error: t('modelSetup.desktopUnavailable') }
    }
    return onboarding.existingConnectionListModels({ vendorKey })
  }, [onboarding, t, vendorKey])
  const { candidates, remoteTotal, fetching, fetchAttempted, result, fetchModels } = useModelDiscovery({
    scope: JSON.stringify([vendorKey, initialConnection.baseUrl]), opened, load,
    initialModels: initialConnection.existingModels.map(model => ({ id: model.modelKey, kind: model.kind })),
    guessKinds: onboarding?.guessKinds,
  })
  const connection = result?.connection ?? initialConnection
  const notice = result ? modelDiscoveryMessage(result, connection.existingModels.length > 0) : null
  const message = notice?.key ? t(notice.key, notice.values) : ''
  // Listing is optional; only a missing saved connection/address/credential blocks local registration.
  const blocked = Boolean(result && !result.ok && result.code && result.code !== 'MODEL_LIST_UNAVAILABLE')

  const resolveKind = React.useCallback(async (id: string): Promise<string> => {
    if (!onboarding?.guessKinds) return 'text'
    try { return (await onboarding.guessKinds({ ids: [id] })).kinds?.[id] ?? 'text' } catch { return 'text' }
  }, [onboarding])

  const baseUrl = connection.baseUrl
  let host = baseUrl
  try { host = new URL(baseUrl).hostname } catch { /* keep the public saved address */ }

  return (
    <ModelPickerScreen
      key={vendorKey}
      candidates={candidates}
      initialSelected={[]}
      sourceName={connection.vendorName}
      host={host}
      total={remoteTotal}
      fetching={fetching}
      hasFetched={fetchAttempted}
      confirming={confirming}
      onRefetch={fetchModels}
      onBack={onBack}
      onConfirm={onConfirm}
      onResolveKind={resolveKind}
      alreadyAddedIds={connection.existingModels.map(model => model.modelKey)}
      statusHint={message || undefined}
      blocked={blocked}
    />
  )
}
