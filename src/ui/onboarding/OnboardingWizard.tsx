import React from 'react'
import { MODEL_ACCESS_ENTRY_ONBOARDING } from '../../../electron/shared/contracts/modelAccessCapabilities'
import { useTranslation } from 'react-i18next'
import { Stack, Group, Text, PasswordInput, Anchor } from '@mantine/core'
import { IconCheck, IconX, IconChevronDown } from '@tabler/icons-react'
import { DesignButton, DesignModal, DesignTextInput, DesignSwitch } from '../../design'
import { ModelPickerScreen } from './ModelPickerScreen'
import { getDesktopBridge } from '../../desktop/bridge'
import type { CustomCallDraftIdentity } from '../../desktop/modelCatalogBridgeTypes'
import type {
  DesktopExistingConnectionSummary,
  DesktopHttpCertificationRun,
  DesktopProviderRegistration,
} from '../../desktop/onboardingBridgeTypes'
import type { ProviderKind } from '../../desktop/providerKind'
import { PROVIDER_PRESETS } from './providerPresets'
import { Field } from './onboardingWizardSupport'
import { isOnboardingApiKeyReady, resolveOnboardingAuth } from './onboardingAuth'
import { ModelSettingsPageSurface } from './ModelSettingsPageSurface'
import { ExistingConnectionModelPicker } from './ExistingConnectionModelPicker'
import { OnboardingWizardResult } from './OnboardingWizardResult'
import { DirectScriptDraftForm } from './DirectScriptDraftForm'
import { OnboardingWizardAdvancedFields, ProviderPresetGroups } from './OnboardingWizardAdvancedFields'
import { modelDiscoveryMessage } from './modelDiscovery'
import { useModelDiscovery } from './useModelDiscovery'
import { useOnboardingConnectionTest } from './useOnboardingConnectionTest'
import { CertificationIntentKey } from './certificationIntentKey'
import { certificationFailureMessage } from './certificationFailureMessage'

type Phase = 'input' | 'running' | 'success' | 'error'
// Keep model3d in the UI union so non-text models are never sent to chat endpoints.
type ModelKind = 'text' | 'image' | 'video' | 'audio' | 'model3d'
const MODEL_KINDS: ModelKind[] = ['text', 'image', 'video', 'audio', 'model3d']

function asModelKind(value: unknown): ModelKind {
  return (MODEL_KINDS as string[]).includes(String(value)) ? (value as ModelKind) : 'text'
}

export function OnboardingWizard({
  opened,
  onClose,
  onCertificationStarted,
  onConnectionConfigured,
  initialPreset,
  existingVendorKey,
  existingConnection,
  onDirectScriptDraftCreated,
  initialScreen,
  integrationSessionId,
  presentation = 'modal',
}: {
  opened: boolean
  onClose: () => void
  /** Model confirmation has started the canonical certification run. */
  onCertificationStarted?: (run: DesktopHttpCertificationRun) => void
  /** Connection-only credentials are securely configured but remain unverified. */
  onConnectionConfigured?: (registration: DesktopProviderRegistration) => void
  /** 打开时预选的预设（如面板「接入你的中转站」卡传 'newapi'，直接进中转拉取流，Issue #8）。 */
  initialPreset?: string
  /** 已有连接追加模型：主进程自取加密凭据，renderer 不再收集或读取 Key。 */
  existingVendorKey?: string
  /** 本地目录快照；已有连接页面先展示它，用户明确点击后才联网刷新。 */
  existingConnection?: DesktopExistingConnectionSummary
  onDirectScriptDraftCreated?: (identity: CustomCallDraftIdentity) => void
  initialScreen?: 'form' | 'scriptDraft'
  /** Durable MCP handoff: save the credential through the trusted session IPC. */
  integrationSessionId?: string
  presentation?: 'modal' | 'page'
}): JSX.Element {
  const { t } = useTranslation()
  const bridge = getDesktopBridge()
  const certificationIntentKey = React.useRef(new CertificationIntentKey())
  const [phase, setPhase] = React.useState<Phase>('input')
  const [inputMode] = React.useState<'manual'>('manual')
  const [userApiKey, setUserApiKey] = React.useState('')
  const [noApiKey, setNoApiKey] = React.useState(false)
  const [vendorName, setVendorName] = React.useState('')
  const [presetId, setPresetId] = React.useState('')
  // Named presets can hide BaseURL; this flag reveals custom gateways.
  const [editBaseUrl, setEditBaseUrl] = React.useState(false)
  // Protocol selection is local until the user tests the connection.
  const [providerKind, setProviderKind] = React.useState<ProviderKind>('openai-compatible')
  // A forced protocol disables auto-probe and hostname inference.
  const [kindForced, setKindForced] = React.useState(false)
  // 「接口协议」覆盖区是否展开。
  const [showKindOverride, setShowKindOverride] = React.useState(false)
  // 「高级设置」整段（接口协议 + 自定义请求头）是否展开。
  const [showAdvanced, setShowAdvanced] = React.useState(false)
  const [baseUrl, setBaseUrl] = React.useState('')
  // 低频高级字段：给这个连接单独指定代理（多在高级折叠区，见 §1.5 控件层级）。
  const [proxyUrl, setProxyUrl] = React.useState('')
  // Selected models are confirmed on the picker screen before certification.
  const [models, setModels] = React.useState<Array<{ id: string; kind: ModelKind }>>([])
  const [screen, setScreen] = React.useState<'form' | 'select' | 'scriptDraft'>(
    existingVendorKey ? 'select' : (initialScreen ?? 'form'),
  )
  // Optional custom request headers for relay gateways.
  const [headerRows, setHeaderRows] = React.useState<Array<{ key: string; value: string }>>([])
  const [saving, setSaving] = React.useState(false)
  const [savedConnection, setSavedConnection] = React.useState<DesktopProviderRegistration | null>(null)
  const [connectionSaveError, setConnectionSaveError] = React.useState('')
  const [resultLabel, setResultLabel] = React.useState('')
  const [errorReason, setErrorReason] = React.useState('')
  const [errorHint, setErrorHint] = React.useState('')
  const requestAuth = resolveOnboardingAuth(providerKind, userApiKey, noApiKey)
  const effectiveBaseUrl =
    providerKind === 'anthropic' && !baseUrl.trim() ? 'https://api.anthropic.com' : baseUrl.trim()

  // Collapse header rows into a clean map (also fed into the connection-test hook).
  const buildHeadersObject = React.useCallback((): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const h of headerRows) {
      const k = h.key.trim()
      const v = h.value.trim()
      if (k && v) out[k] = v
    }
    return out
  }, [headerRows])

  // 连接测试探测逻辑抽成 hook（P1：旧内联块同 commit 删除，无并行版）。proxyUrl 一并贯穿。
  const { testState, testMessage, handleTestConnection, resetTest } = useOnboardingConnectionTest({
    bridge,
    baseUrl: effectiveBaseUrl,
    apiKey: requestAuth.apiKey,
    models,
    providerKind,
    kindForced,
    noApiKey,
    proxyUrl,
    buildHeadersObject,
    onDetectedKind: setProviderKind,
    onProtocolFallback: () => {
      // 失败指路（设计/真实用户评审）：展开高级区+协议覆盖区当逃生口。
      setShowAdvanced(true)
      setShowKindOverride(true)
    },
  })

  React.useEffect(() => {
    if (!opened || !integrationSessionId || !bridge?.onboarding?.integrationSessionGet) return
    let alive = true
    void bridge.onboarding
      .integrationSessionGet(integrationSessionId)
      .then((value) => {
        if (!alive || !value || typeof value !== 'object') return
        const session = value as Record<string, unknown>
        const config =
          session.config && typeof session.config === 'object' ? (session.config as Record<string, unknown>) : {}
        if (typeof config.name === 'string') setVendorName(config.name)
        if (typeof config.baseUrl === 'string') setBaseUrl(config.baseUrl)
        if (typeof config.proxyUrl === 'string') setProxyUrl(config.proxyUrl)
        if (
          config.providerKind === 'anthropic' ||
          config.providerKind === 'openai-compatible' ||
          config.providerKind === 'openai-responses'
        ) {
          setProviderKind(config.providerKind)
        }
        setScreen('form')
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [opened, integrationSessionId, bridge])

  const resetToInput = React.useCallback(() => {
    setPhase('input')
    setResultLabel('')
    setErrorReason('')
    setErrorHint('')
    // Existing-connection retry keeps the candidate pool and selections.
    if (existingVendorKey) setScreen('select')
    else setScreen('form')
    resetTest()
  }, [existingVendorKey, resetTest])

  const updateHeader = React.useCallback((index: number, patch: Partial<{ key: string; value: string }>) => {
    setHeaderRows((prev) => prev.map((h, i) => (i === index ? { ...h, ...patch } : h)))
    resetTest()
  }, [resetTest])
  const addHeaderRow = React.useCallback(() => {
    setHeaderRows((prev) => [...prev, { key: '', value: '' }])
  }, [])
  const removeHeaderRow = React.useCallback((index: number) => {
    setHeaderRows((prev) => prev.filter((_, i) => i !== index))
    resetTest()
  }, [resetTest])

  const loadModels = React.useCallback(async () => {
    const savedVendorKey = existingVendorKey ?? savedConnection?.vendorKey
    if (savedVendorKey && bridge?.onboarding?.httpConnectionListModels) {
      return bridge.onboarding.httpConnectionListModels({ vendorKey: savedVendorKey })
    }
    if (!bridge?.onboarding?.listModels) return { ok: false, error: t('modelSetup.desktopUnavailable') }
    return bridge.onboarding.listModels({
      baseUrl: effectiveBaseUrl,
      apiKey: requestAuth.apiKey,
      providerKind,
      headers: buildHeadersObject(),
      ...(proxyUrl.trim() ? { proxyUrl: proxyUrl.trim() } : {}),
    })
  }, [
    bridge,
    existingVendorKey,
    savedConnection,
    effectiveBaseUrl,
    requestAuth.apiKey,
    providerKind,
    buildHeadersObject,
    proxyUrl,
    t,
  ])
  const discoveryScope = JSON.stringify([effectiveBaseUrl, requestAuth.apiKey, providerKind, headerRows, proxyUrl])
  const {
    candidates: candidateModels,
    fetching: fetchingModels,
    fetchAttempted,
    result: discoveryResult,
    fetchModels,
    cancelPending,
  } = useModelDiscovery({ scope: discoveryScope, opened, load: loadModels, guessKinds: bridge?.onboarding?.guessKinds })
  const discoveryNotice = discoveryResult ? modelDiscoveryMessage(discoveryResult, false) : null
  const fetchModelsMsg = discoveryNotice?.key ? t(discoveryNotice.key, discoveryNotice.values) : ''

  const handlePickPreset = React.useCallback((id: string) => {
    const preset = PROVIDER_PRESETS.find((p) => p.id === id)
    if (!preset) return
    setPresetId(id)
    setProviderKind(preset.providerKind)
    setBaseUrl(preset.baseUrl)
    setProxyUrl('')
    setVendorName(preset.custom ? '' : preset.label)
    setEditBaseUrl(false)
    // 切预设 = 重置协议判断：具名预设内置协议；自定义中转使用本地默认值，
    // 只有之后显式测试连接才可能更新它。
    setKindForced(!preset.custom)
    setShowKindOverride(false)
    setShowAdvanced(false)
    setNoApiKey(false)
    // Endpoint changed → previously fetched candidates / test result no longer apply.
    setScreen('form')
    resetTest()
  }, [resetTest])

  // Apply the preset when the panel opens.
  React.useEffect(() => {
    if (opened && initialPreset) handlePickPreset(initialPreset)
    // 仅在打开瞬间执行一次（initialPreset/handlePickPreset 稳定）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, initialPreset])

  // Ask main to classify a manually entered model id.
  const resolveKind = React.useCallback(
    async (id: string): Promise<string> => {
      if (!bridge?.onboarding?.guessKinds) return 'text'
      try {
        return (await bridge.onboarding.guessKinds({ ids: [id] })).kinds?.[id] ?? 'text'
      } catch {
        return 'text'
      }
    },
    [bridge],
  )

  const startCertification = React.useCallback(
    async (picked: Array<{ id: string; kind: string }>) => {
      const savedVendorKey = savedConnection?.vendorKey
      const targetVendorKey = existingVendorKey ?? savedVendorKey
      if (!targetVendorKey || !bridge?.onboarding?.httpCertificationStartExisting) {
        setErrorReason(t('modelSetup.desktopUnavailable'))
        setPhase('error')
        return
      }
      // Unknown values fall back to text; model3d stays distinct.
      const cleanModels = picked.map((m) => ({ id: m.id, kind: asModelKind(m.kind) })).filter((m) => m.id.trim())
      if (cleanModels.length === 0) return
      setModels(cleanModels)
      setSaving(true)
      try {
        const selected = cleanModels.map((model) => ({ modelKey: model.id, labelZh: model.id, kind: model.kind }))
        const res = await bridge.onboarding.httpCertificationStartExisting({
          entryPoint: 'manual-ui',
          idempotencyKey: certificationIntentKey.current.for({
            action: 'start',
            vendorKey: targetVendorKey,
            models: selected,
          }),
          vendorKey: targetVendorKey,
          models: selected,
        })
        if (!res.ok || !res.run) {
          certificationIntentKey.current.rotate()
          setErrorReason(t('modelSetup.saveFailed'))
          setErrorHint(certificationFailureMessage(t, 'code' in res ? res.code : undefined))
          setPhase('error')
          return
        }
        certificationIntentKey.current.rotate()
        if (onCertificationStarted) onCertificationStarted(res.run)
        else onClose()
      } catch {
        setErrorReason(t('modelSetup.saveFailed'))
        setErrorHint(t('modelSetup.saveFailedHint'))
        setPhase('error')
      } finally {
        setSaving(false)
      }
    },
    [bridge, existingVendorKey, savedConnection, t, onCertificationStarted, onClose],
  )

  const saveConnection = React.useCallback(async () => {
    if (integrationSessionId) {
      const saveCredential = bridge?.onboarding?.integrationSessionSaveCredential
      if (!saveCredential) {
        setConnectionSaveError(t('modelSetup.integrationUnavailable'))
        return
      }
      setSaving(true)
      setConnectionSaveError('')
      try {
        const current = await bridge.onboarding.integrationSessionGet?.(integrationSessionId)
        const currentRecord = current && typeof current === 'object' ? (current as Record<string, unknown>) : null
        const expectedRevision = Number(currentRecord?.revision || 0)
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
          throw new Error(t('modelSetup.integrationUnavailable'))
        await saveCredential({
          sessionId: integrationSessionId,
          expectedRevision,
          apiKey: requestAuth.apiKey,
        })
        onConnectionConfigured?.({
          vendorKey: '',
          vendorName: vendorName.trim(),
          state: 'configured',
          selectedModelKeys: [],
          models: [],
          savedAt: new Date().toISOString(),
        })
        onClose()
      } catch (error) {
        setConnectionSaveError(error instanceof Error ? error.message : t('modelSetup.saveFailedHint'))
      } finally {
        setSaving(false)
      }
      return
    }
    if (!bridge?.onboarding?.httpConnectionConfigure) {
      setConnectionSaveError(t('modelSetup.desktopUnavailable'))
      return
    }
    setSaving(true)
    setConnectionSaveError('')
    try {
      const res = await bridge.onboarding.httpConnectionConfigure({
        vendorName: vendorName.trim(),
        baseUrl: effectiveBaseUrl,
        apiKey: requestAuth.apiKey,
        authType: requestAuth.authType,
        providerKind,
        headers: buildHeadersObject(),
        ...(proxyUrl.trim() ? { proxyUrl: proxyUrl.trim() } : {}),
        models: [],
      })
      if (!res.ok || !res.registration) {
        setConnectionSaveError(res.error || t('modelSetup.saveFailedHint'))
        return
      }
      setSavedConnection(res.registration)
      onConnectionConfigured?.(res.registration)
    } catch (error) {
      setConnectionSaveError(error instanceof Error ? error.message : t('modelSetup.saveFailedHint'))
    } finally {
      setSaving(false)
    }
  }, [
    bridge,
    vendorName,
    effectiveBaseUrl,
    requestAuth.apiKey,
    requestAuth.authType,
    providerKind,
    buildHeadersObject,
    proxyUrl,
    onConnectionConfigured,
    integrationSessionId,
    onClose,
    t,
  ])

  // Confirming the picker starts the canonical certification run.
  const handleConfirmPicked = React.useCallback(
    (picked: Array<{ id: string; kind: string }>) => {
      void startCertification(picked)
    },
    [startCertification],
  )

  // Discovery is explicit; the loader preserves candidates on failure.
  const handleFetchModels = React.useCallback(async () => {
    const result = await fetchModels()
    if (result?.ok && result.models?.length) setScreen('select')
  }, [fetchModels])

  const baseUrlTrimmed = effectiveBaseUrl
  const proxyUrlTrimmed = proxyUrl.trim()
  const baseUrlValid =
    providerKind === 'anthropic'
      ? baseUrlTrimmed === '' || /^https?:\/\//i.test(baseUrlTrimmed)
      : /^https?:\/\//i.test(baseUrlTrimmed)
  // 渲染侧只做「像不像合法代理地址」的即时提示；权威校验在主进程 normalizeExplicitProxyUrl。
  const proxyUrlValid = !proxyUrlTrimmed || /^(?:https?|socks(?:4|5)?):\/\//i.test(proxyUrlTrimmed)
  const canTest = baseUrlValid && proxyUrlValid && (providerKind === 'anthropic' || baseUrlTrimmed.length > 0)
  const connectionFieldsReady = canTest && isOnboardingApiKeyReady(userApiKey, noApiKey)
  const selectedPreset = PROVIDER_PRESETS.find((p) => p.id === presetId)
  const isNamedPreset = Boolean(selectedPreset && !selectedPreset.custom)
  const isCustomGatewayEntry = initialPreset === 'newapi' || initialPreset === 'custom'
  // Named presets hide BaseURL until the user opts into customization.
  const showBaseUrlField = !isNamedPreset || editBaseUrl

  const content = (
    <Stack gap="md" data-model-access-entry={MODEL_ACCESS_ENTRY_ONBOARDING}>
      {phase === 'input' && screen === 'form' && !existingVendorKey && (
        <Stack gap={12}>
                  {!isCustomGatewayEntry ? (
            <Text size="xs" c="var(--nomi-ink-60)">
              {t('modelSetup.intro')}
            </Text>
          ) : null}

          {inputMode === 'manual' && (
            <>
              {savedConnection ? (
                <div data-model-connection-saved className="flex flex-col gap-4">
                  <div className="flex items-start gap-3 rounded-nomi-sm bg-nomi-ink-05 p-3" role="status">
                    <span className="grid size-7 shrink-0 place-items-center rounded-nomi-sm bg-nomi-accent-soft text-nomi-accent">
                      <IconCheck size={15} stroke={2} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-body-sm font-semibold text-nomi-ink">{t('modelSetup.connectionSaved')}</div>
                      <p className="mt-1 text-caption leading-relaxed text-nomi-ink-60">
                        {t('modelSetup.connectionSavedHint')}
                      </p>
                    </div>
                  </div>
                  {fetchModelsMsg ? (
                    <div className="border-l-2 border-nomi-warning bg-nomi-ink-05 px-3 py-2 text-caption leading-relaxed text-nomi-ink-60">
                      {fetchModelsMsg}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap justify-end gap-2">
                    <DesignButton variant="light" onClick={() => setScreen('select')}>
                      {t('modelSetup.manualEnter')}
                    </DesignButton>
                    <DesignButton variant="filled" onClick={handleFetchModels} loading={fetchingModels}>
                      {t('modelSetup.fetchModels')}
                    </DesignButton>
                  </div>
                </div>
              ) : (
                <>
                  {/* Issue #8 可发现性：中转站（含图片/视频）拎到最上、点名 new-api；官方厂商（文本）弱化为次组。 */}
                  {!isCustomGatewayEntry ? (
                    <ProviderPresetGroups presetId={presetId} onPickPreset={handlePickPreset} />
                  ) : null}
                  <Field label={t('modelSetup.vendorName')} hint={t('modelSetup.vendorNameHint')}>
                    <DesignTextInput
                      value={vendorName}
                      onChange={(e) => setVendorName(e.currentTarget.value)}
                      placeholder={t('modelSetup.vendorNamePlaceholder')}
                    />
                  </Field>
                  {showBaseUrlField ? (
                    <Field
                      label={t('modelSetup.baseUrl')}
                      hint={
                        providerKind === 'anthropic'
                          ? t('modelSetup.baseUrlAnthropicHint')
                          : t('modelSetup.baseUrlHint')
                      }
                    >
                      <DesignTextInput
                        value={baseUrl}
                        onChange={(e) => {
                          const v = e.currentTarget.value
                          setBaseUrl(v)
                          resetTest()
                          // hostname 仅作「初始猜测」：anthropic-native 网关 host 带 anthropic。
                          // 一旦专家手选过协议（kindForced），就不再覆盖——否则手选会被下次输入吞掉。
                          // chat vs responses 无法靠 hostname 区分；用户可显式测试或在高级设置手选。
                          if (selectedPreset?.custom && !kindForced) {
                            try {
                              setProviderKind(
                                /anthropic/i.test(new URL(v).hostname) ? 'anthropic' : 'openai-compatible',
                              )
                            } catch {
                              /* partial url while typing */
                            }
                          }
                        }}
                        placeholder={
                          providerKind === 'anthropic'
                            ? t('modelSetup.anthropicUrlPlaceholder')
                            : t('modelSetup.openAiUrlPlaceholder')
                        }
                        error={baseUrlTrimmed.length > 0 && !baseUrlValid ? t('modelSetup.invalidUrl') : undefined}
                      />
                    </Field>
                  ) : (
                    <Text size="xs" c="var(--nomi-ink-60)">
                      {t('modelSetup.autoFilledUrl')}{' '}
                      <Anchor
                        component="button"
                        type="button"
                        onClick={() => setEditBaseUrl(true)}
                        c="var(--nomi-accent)"
                        inherit
                      >
                        {t('modelSetup.customize')}
                      </Anchor>
                    </Text>
                  )}
                  {selectedPreset?.custom && (
                    <DesignSwitch
                      checked={noApiKey}
                      onChange={(event) => {
                        setNoApiKey(event.currentTarget.checked)
                        resetTest()
                      }}
                      label={t('modelSetup.noApiKey')}
                      description={t('modelSetup.noApiKeyHint')}
                    />
                  )}
                  {!noApiKey && (
                    <Field label={t('modelSetup.apiKey')} hint={t('modelSetup.apiKeyHint')}>
                      <PasswordInput
                        value={userApiKey}
                        onChange={(e) => {
                          setUserApiKey(e.currentTarget.value)
                          resetTest()
                        }}
                        placeholder={t('modelSetup.apiKeyPlaceholder')}
                        autoFocus
                      />
                      {selectedPreset?.keyUrl && (
                        <Anchor
                          href={selectedPreset.keyUrl}
                          target="_blank"
                          rel="noreferrer"
                          c="var(--nomi-accent)"
                          size="xs"
                        >
                          {t('modelSetup.getKey', { provider: selectedPreset.label })}
                        </Anchor>
                      )}
                    </Field>
                  )}

                  {selectedPreset?.custom && (
                    <OnboardingWizardAdvancedFields
                      providerKind={providerKind}
                      kindForced={kindForced}
                      showAdvanced={showAdvanced}
                      showKindOverride={showKindOverride}
                      headerRows={headerRows}
                      onToggleAdvanced={() => setShowAdvanced((value) => !value)}
                      onShowKindOverride={() => setShowKindOverride(true)}
                      onProviderKindChange={(value) => {
                        setProviderKind(value)
                        setKindForced(true)
                        resetTest()
                      }}
                      onRestoreAutoDetect={() => {
                        setKindForced(false)
                        setShowKindOverride(false)
                        resetTest()
                      }}
                      onUpdateHeader={updateHeader}
                      onRemoveHeaderRow={removeHeaderRow}
                      onAddHeaderRow={addHeaderRow}
                      proxyUrl={proxyUrl}
                      proxyUrlValid={proxyUrlValid}
                      onProxyUrlChange={(e) => {
                        setProxyUrl(e.currentTarget.value)
                        resetTest()
                      }}
                    />
                  )}

                  <details className="group border-t border-nomi-line pt-1" data-model-connection-diagnostics>
                    <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 text-caption font-semibold text-nomi-ink-60 hover:text-nomi-ink [&::-webkit-details-marker]:hidden">
                      {t('modelSetup.diagnostics')}
                      <IconChevronDown
                        size={15}
                        stroke={1.8}
                        className="transition-transform group-open:rotate-180"
                        aria-hidden="true"
                      />
                    </summary>
                    <div className="flex flex-col gap-2 border-t border-nomi-line-soft pt-3">
                      <Text size="xs" c="var(--nomi-ink-40)" className="leading-relaxed">
                        {t('modelSetup.testAndSaveHint')}
                      </Text>
                      <div className="flex flex-wrap items-center gap-2">
                        <DesignButton
                          variant="light"
                    onClick={handleTestConnection}
                          disabled={!connectionFieldsReady || testState === 'testing'}
                          loading={testState === 'testing'}
                        >
                          {t('modelSetup.testConnection')}
                        </DesignButton>
                        {testState === 'ok' && (
                          <Group gap={4} align="center" wrap="nowrap" c="var(--workbench-success)">
                            <Text size="xs" c="var(--workbench-success)">
                              {testMessage}
                            </Text>
                            <IconCheck size={14} stroke={1.5} />
                          </Group>
                        )}
                        {(testState === 'fail' || testState === 'unsupported') && (
                          <Group
                            gap={4}
                            align="center"
                            wrap="nowrap"
                            c={testState === 'fail' ? 'var(--workbench-danger)' : 'var(--nomi-ink-60)'}
                          >
                            <Text size="xs" c="inherit" className="break-words leading-relaxed">
                              {testMessage}
                            </Text>
                            {testState === 'fail' ? <IconX size={14} stroke={1.5} /> : null}
                          </Group>
                        )}
                      </div>
                    </div>
                  </details>
                  {connectionSaveError ? (
                    <div className="text-caption leading-relaxed text-workbench-danger" role="alert">
                      {connectionSaveError}
                    </div>
                  ) : null}
                  <div className="flex justify-end">
                    <DesignButton
                      variant="filled"
                      onClick={() => void saveConnection()}
                      disabled={!connectionFieldsReady || !vendorName.trim() || saving}
                      loading={saving}
                    >
                      {t('modelSetup.saveConnection')}
                    </DesignButton>
                  </div>
                </>
              )}
            </>
          )}
        </Stack>
      )}

      {phase === 'input' &&
        screen === 'select' &&
        (existingVendorKey ? (
          <ExistingConnectionModelPicker
            opened={opened}
            vendorKey={existingVendorKey}
            initialConnection={
              existingConnection ?? {
                vendorKey: existingVendorKey,
                vendorName: existingVendorKey,
                baseUrl: '',
                existingModels: [],
              }
            }
            confirming={saving}
            onBack={onClose}
            onConfirm={handleConfirmPicked}
          />
        ) : (
          <ModelPickerScreen
            key={JSON.stringify([effectiveBaseUrl, providerKind])}
            candidates={candidateModels}
            initialSelected={models}
            sourceName={vendorName.trim()}
            host={(() => {
              try {
                return new URL(effectiveBaseUrl).hostname
              } catch {
                return effectiveBaseUrl
              }
            })()}
            total={candidateModels.length}
            fetching={fetchingModels}
            hasFetched={fetchAttempted}
            statusHint={fetchModelsMsg || undefined}
            onRefetch={handleFetchModels}
            onBack={() => {
              cancelPending()
              setScreen('form')
            }}
            onConfirm={handleConfirmPicked}
            onResolveKind={resolveKind}
            confirming={saving}
            blocked={!connectionFieldsReady}
          />
        ))}

      {phase === 'input' && screen === 'scriptDraft' && onDirectScriptDraftCreated ? (
        <DirectScriptDraftForm onBack={() => setScreen('form')} onCreated={onDirectScriptDraftCreated} />
      ) : null}

      <OnboardingWizardResult
        phase={phase}
        resultLabel={resultLabel}
        errorReason={errorReason}
        errorHint={errorHint}
        onReset={resetToInput}
        onClose={onClose}
      />
    </Stack>
  )

  if (presentation === 'page') {
    if (!opened) return <></>
    return (
      <ModelSettingsPageSurface
        page="add"
        title={
          isCustomGatewayEntry ? (
            <div className="min-w-0">
              <h2 className="truncate text-body font-semibold text-nomi-ink">{t('modelSetup.customApiTitle')}</h2>
              <p className="mt-0.5 truncate text-micro text-nomi-ink-40">{t('modelSetup.customApiSubtitle')}</p>
            </div>
          ) : (
            <h2 className="text-body font-semibold text-nomi-ink">{t('modelSetup.addModel')}</h2>
          )
        }
        backLabel={t('common.back')}
        onBack={onClose}
      >
        {content}
      </ModelSettingsPageSurface>
    )
  }

  return (
    <DesignModal
      opened={opened}
      onClose={onClose}
      title={t('modelSetup.addModel')}
      size={480}
      centered
      closeOnClickOutside={phase !== 'running'}
      closeOnEscape={phase !== 'running'}
    >
      {content}
    </DesignModal>
  )
}
