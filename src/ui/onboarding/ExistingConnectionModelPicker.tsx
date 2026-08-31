import React from 'react'
import { useTranslation } from 'react-i18next'
import { getDesktopBridge } from '../../desktop/bridge'
import type { DesktopExistingConnectionSummary } from '../../desktop/onboardingBridgeTypes'
import { ModelPickerScreen, type PickerModel } from './ModelPickerScreen'

type ModelKind = 'text' | 'image' | 'video' | 'audio' | 'model3d'

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
  const initialSignature = JSON.stringify(initialConnection)
  const stableInitialConnection = React.useMemo(
    () => JSON.parse(initialSignature) as DesktopExistingConnectionSummary,
    [initialSignature],
  )
  const [connection, setConnection] = React.useState<DesktopExistingConnectionSummary>(stableInitialConnection)
  const [candidates, setCandidates] = React.useState<PickerModel[]>(() =>
    stableInitialConnection.existingModels.map((model) => ({ id: model.modelKey, kind: model.kind })),
  )
  const [remoteTotal, setRemoteTotal] = React.useState(0)
  const [fetching, setFetching] = React.useState(false)
  const [fetchAttempted, setFetchAttempted] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [blocked, setBlocked] = React.useState(false)

  const fetchModels = React.useCallback(async () => {
    if (!onboarding?.existingConnectionListModels) {
      setBlocked(true)
      setMessage(t('modelSetup.desktopUnavailable'))
      return
    }
    setFetching(true)
    setMessage('')
    try {
      const result = await onboarding.existingConnectionListModels({ vendorKey })
      const nextConnection = result.connection ?? stableInitialConnection
      setConnection(nextConnection)
      const existing = nextConnection.existingModels
      const remoteIds = result.ok ? result.models.map(id => id.trim()).filter(Boolean) : []
      setRemoteTotal(remoteIds.length)
      const ids = Array.from(new Set([...existing.map(model => model.modelKey), ...remoteIds]))
      let guessed: Record<string, ModelKind> = {}
      if (remoteIds.length > 0 && onboarding.guessKinds) {
        try { guessed = (await onboarding.guessKinds({ ids: remoteIds })).kinds || {} } catch { /* text fallback */ }
      }
      const existingKinds = new Map(existing.map(model => [model.modelKey, model.kind] as const))
      setCandidates(ids.map(id => ({ id, kind: existingKinds.get(id) ?? guessed[id] ?? 'text' })))
      if (result.ok) {
        setBlocked(false)
        if (remoteIds.length === 0) setMessage(t('modelSetup.noModelsListedHint'))
      } else if (result.code === 'MODEL_LIST_UNAVAILABLE') {
        // Listing is an enhancement, not admission: manual model IDs remain usable.
        setBlocked(false)
        setMessage(t('modelSetup.noModelsFetchedWithReason', { error: result.error }))
      } else {
        setBlocked(true)
        setMessage(t(`modelSetup.existingConnectionError.${result.code}` as 'modelSetup.existingConnectionError.CREDENTIAL_MISSING', { error: result.error }))
      }
    } finally {
      setFetchAttempted(true)
      setFetching(false)
    }
  }, [onboarding, stableInitialConnection, t, vendorKey])

  React.useEffect(() => {
    if (!opened) return
    setConnection(stableInitialConnection)
    setCandidates(stableInitialConnection.existingModels.map((model) => ({ id: model.modelKey, kind: model.kind })))
    setRemoteTotal(0)
    setFetchAttempted(false)
    setMessage('')
    setBlocked(false)
  }, [opened, stableInitialConnection, vendorKey])

  const resolveKind = React.useCallback(async (id: string): Promise<string> => {
    if (!onboarding?.guessKinds) return 'text'
    try { return (await onboarding.guessKinds({ ids: [id] })).kinds?.[id] ?? 'text' } catch { return 'text' }
  }, [onboarding])

  const baseUrl = connection.baseUrl
  let host = baseUrl
  try { host = new URL(baseUrl).hostname } catch { /* keep the public saved address */ }

  return (
    <ModelPickerScreen
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
