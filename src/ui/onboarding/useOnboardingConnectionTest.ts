import React from 'react'
import { useTranslation } from 'react-i18next'
import type { getDesktopBridge } from '../../desktop/bridge'
import type { ProviderKind } from '../../desktop/providerKind'
import { PROVIDER_KIND_LABEL } from './onboardingProviderKindLabels'

type TestModel = { id: string; kind: string }
type ConnectionTestState = 'idle' | 'testing' | 'ok' | 'fail' | 'unsupported'

export function useOnboardingConnectionTest({
  bridge,
  baseUrl,
  apiKey,
  models,
  providerKind,
  kindForced,
  noApiKey,
  proxyUrl,
  buildHeadersObject,
  onDetectedKind,
  onProtocolFallback,
}: {
  bridge: ReturnType<typeof getDesktopBridge>
  baseUrl: string
  apiKey: string
  models: TestModel[]
  providerKind: ProviderKind
  kindForced: boolean
  noApiKey: boolean
  proxyUrl: string
  buildHeadersObject: () => Record<string, string>
  onDetectedKind: (kind: ProviderKind) => void
  onProtocolFallback: () => void
}): {
  testState: ConnectionTestState
  testMessage: string
  handleTestConnection: () => Promise<void>
  resetTest: () => void
} {
  const { t } = useTranslation()
  const [testState, setTestState] = React.useState<ConnectionTestState>('idle')
  const [testMessage, setTestMessage] = React.useState('')

  const handleTestConnection = React.useCallback(async () => {
    if (!bridge?.onboarding?.testConnection) return
    setTestState('testing')
    setTestMessage('')
    const firstTextModelId = models.filter((m) => m.kind === 'text').map((m) => m.id.trim()).find(Boolean)
    const reachabilityOnly = !firstTextModelId
    try {
      const res = await bridge.onboarding.testConnection({
        baseUrl,
        apiKey,
        modelId: firstTextModelId,
        ...(reachabilityOnly ? { probe: 'reachability' as const } : {}),
        ...(kindForced ? { providerKind } : { autoProbe: true }),
        headers: buildHeadersObject(),
        ...(proxyUrl.trim() ? { proxyUrl: proxyUrl.trim() } : {}),
      })
      if (res.ok) {
        if (res.detectedKind) onDetectedKind(res.detectedKind)
        setTestState('ok')
        // reachability-only 有两种真相，措辞必须分开（J04 探针 2026-09-02）：零模型时不存在「你选的模型」，
        // 老文案「你选的都是图片 / 视频模型」在此状态下失真——探通≠读到过任何模型列表。
        const mediaModelCount = models.filter((m) => m.id.trim()).length
        setTestMessage(
          res.reachabilityOnly
            ? mediaModelCount === 0
              ? t(noApiKey ? 'modelSetup.connectedReachabilityOnlyNoModelsNoApiKey' : 'modelSetup.connectedReachabilityOnlyNoModels')
              : t(noApiKey ? 'modelSetup.connectedReachabilityOnlyNoApiKey' : 'modelSetup.connectedReachabilityOnly', { count: mediaModelCount })
            : res.detectedKind
              ? t('modelSetup.connectedProtocol', { protocol: PROVIDER_KIND_LABEL[res.detectedKind] })
              : t('modelSetup.connected'),
        )
        return
      }
      setTestState('fail')
      if (reachabilityOnly) {
        if (res.failureKind === 'unsupported' || res.failureKind === 'invalid_response') {
          setTestState('unsupported')
          setTestMessage(t('modelSetup.discoveryCannotVerifyConnection'))
          return
        }
        setTestMessage(
          res.error
            ? t(noApiKey ? 'modelSetup.connectionFailedCheckUrl' : 'modelSetup.connectionFailedCheckUrlKey', { error: res.error })
            : t(noApiKey ? 'modelSetup.connectionFailedCheckUrlPlain' : 'modelSetup.connectionFailedCheckUrlKeyPlain'),
        )
        return
      }
      onProtocolFallback()
      setTestMessage(
        res.error
          ? t('modelSetup.connectionFailedWithReason', { error: res.error })
          : t(noApiKey ? 'modelSetup.connectionFailedNoApiKey' : 'modelSetup.connectionFailed'),
      )
    } catch (error) {
      setTestState('fail')
      setTestMessage(
        t(noApiKey ? 'modelSetup.connectionFailedCheckUrl' : 'modelSetup.connectionFailedCheckUrlKey', {
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }, [apiKey, baseUrl, bridge, buildHeadersObject, kindForced, models, noApiKey, onDetectedKind, onProtocolFallback, providerKind, proxyUrl, t])

  const resetTest = React.useCallback(() => {
    setTestState('idle')
    setTestMessage('')
  }, [])

  return { testState, testMessage, handleTestConnection, resetTest }
}
