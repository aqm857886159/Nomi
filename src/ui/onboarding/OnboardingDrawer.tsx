import React from 'react'
import { useTranslation } from 'react-i18next'
import { OnboardingWizard } from './OnboardingWizard'
import { VendorOnboardCard } from './VendorOnboardCard'
import { type ChipModel } from './ModelChipGroups'
import { CustomVendorCard } from './CustomVendorCard'
import { CustomCallEditor, type CustomCallTarget } from './CustomCallEditor'
import { consumePendingCustomCallIntent } from './customCallIntent'
import { DreaminaMemberCard } from './DreaminaMemberCard'
import { ComfyuiLocalCard } from './ComfyuiLocalCard'
import { AddComfyuiInstanceButton } from './AddComfyuiInstanceButton'
import { isComfyuiVendorKey } from '../../workbench/generationCanvas/model/comfyuiVendor'
import { NetworkSection } from './NetworkSection'
import { TikhubConnectorCard } from '../../workbench/settings/TikhubConnectorCard'
import { CODEX_LOCAL_VENDOR_KEY } from './codexLocalProvider'
import { CodexLocalImageCard } from './CodexLocalImageCard'
import { LOCAL_TEXT_VENDOR_KEY, LocalModelCard } from './LocalModelCard'
import { AntigravityConnectionCard } from './AntigravityConnectionCard'
import { useAntigravitySettings } from './useAntigravitySettings'
import { useAntigravityModelWorkspace } from './useAntigravityModelWorkspace'
import { getAntigravityModelVariant } from '../../../electron/shared/antigravityModelVariants'
import { ANTIGRAVITY_VENDOR_KEY } from '../../../electron/shared/antigravity'
import { projectOnboardingConnections } from './onboardingDrawerConnections'
import { getDesktopBridge } from '../../desktop/bridge'
import type { DesktopHttpCertificationRun, IntegrationHandoff } from '../../desktop/onboardingBridgeTypes'
import { alertDialog, confirmDialog } from '../../design'
import {
  ConnectionWorkspacePage,
  ModelSettingsDetailBoundary,
  ModelWorkspacePage,
  ModelWorkspaceRecovery,
} from './ModelSettingsWorkspacePages'
import { ModelCapabilityEditor } from './ModelCapabilityEditor'
import { ModelSettingsDetailDialog } from './ModelSettingsDetailDialog'
import { AdapterTaskList, AdapterTaskWorkspace } from './AdapterTaskWorkspace'
import { useProviderAdapterTasks } from './useProviderAdapterTasks'
import { adapterRunsRequiringCatalogRefresh } from './adapterTaskVisibility'
import { isAdapterRunTerminal } from './adapterVerificationViewModel'
import { useModelSettingsPageFocus } from './useModelSettingsPageFocus'
import { useOnboardingDrawerCatalog } from './useOnboardingDrawerCatalog'
import { DREAMINA_CONNECTION_KEY } from './onboardingDrawerConstants'
import { canConfigureModelRequestScript } from './modelRequestScriptAvailability'
import { ModelSettingsHome } from './ModelSettingsHome'
import { KnownVendorKeyConnectPage } from './KnownVendorKeyConnectPage'
import {
  buildExistingConnectionSummary,
  canAddModelsToConnection,
  resolveKindGuessGap,
} from './onboardingDrawerDerivations'
import {
  backModelSettingsPage,
  closeModelSettingsDialog,
  createModelSettingsNavigation,
  currentModelSettingsPage,
  modelSettingsDialogEscapeAction,
  modelSettingsDialogOwner,
  openModelSettingsDialog,
  openModelSettingsDialogPage,
  openModelSettingsConnectionPage,
  openModelSettingsPage,
  replaceModelSettingsPage,
  type ModelSettingsPage,
} from './modelSettingsNavigation'
import { useModelPageRequest, type ModelPageRequest } from './useModelPageRequest'
import { CertificationIntentKey } from './certificationIntentKey'
import { CertificationUiError, certificationFailureMessage } from './certificationFailureMessage'
import { IntegrationConfirmationPanel, type IntegrationVerificationHandoff } from './IntegrationConfirmationPanel'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'

export function OnboardingDrawer({ pageRequest = null }: { pageRequest?: ModelPageRequest } = {}): JSX.Element {
  const { t } = useTranslation()
  const adaptationIntentKey = React.useRef(new CertificationIntentKey())
  const [navigation, setNavigation] = React.useState(createModelSettingsNavigation)
  const [integrationHandoffs, setIntegrationHandoffs] = React.useState<IntegrationHandoff[]>([])
  const openedIntegrationHandoff = React.useRef<string | null>(null)
  const verificationRefreshTimer = React.useRef<number | null>(null)
  const page = currentModelSettingsPage(navigation)
  const detailDialogOwner = modelSettingsDialogOwner(navigation)
  const openPage = React.useCallback((next: Exclude<ModelSettingsPage, { type: 'home' }>) => {
    setNavigation((current) => openModelSettingsPage(current, next))
  }, [])
  useModelPageRequest(pageRequest, openPage)
  const goBack = React.useCallback(() => setNavigation((current) => backModelSettingsPage(current)), [])
  useModelSettingsPageFocus(page, goBack)
  const openWizard = React.useCallback(
    (preset?: string, existingVendorKey?: string, initialScreen?: 'form' | 'scriptDraft') => {
      openPage({
        type: 'add',
        ...(preset ? { preset } : {}),
        ...(existingVendorKey ? { existingVendorKey } : {}),
        ...(initialScreen ? { initialScreen } : {}),
      })
    },
    [openPage],
  )
  const {
    models,
    mappings,
    vendorMeta,
    customCallScripts,
    dreaminaStatus,
    loaded,
    bridgeMissing,
    reloadFromError,
    refresh,
  } = useOnboardingDrawerCatalog()
  const reloadIntegrationHandoffs = React.useCallback(async () => {
    const list = getDesktopBridge()?.onboarding?.integrationHandoffList
    if (!list) return
    try {
      setIntegrationHandoffs((await list()) as IntegrationHandoff[])
    } catch { /* bridge retry state handles unavailable main */ }
  }, [])
  const openVerificationHandoff = React.useCallback(() => {
    // The workflow importer has already persisted the handoff before invoking
    // this callback. Move to the stable home surface so the durable request is
    // visible even when the user started from a connection detail page.
    setNavigation({ stack: [{ type: 'home' }] })
    void reloadIntegrationHandoffs()
  }, [reloadIntegrationHandoffs])
  const refreshAfterIntegrationVerification = React.useCallback(() => {
    if (verificationRefreshTimer.current !== null) {
      window.clearTimeout(verificationRefreshTimer.current)
      verificationRefreshTimer.current = null
    }
    refresh()
    let attempts = 0
    const tick = () => {
      refresh()
      attempts += 1
      if (attempts < 60) verificationRefreshTimer.current = window.setTimeout(tick, 500)
      else verificationRefreshTimer.current = null
    }
    verificationRefreshTimer.current = window.setTimeout(tick, 500)
  }, [refresh])
  React.useEffect(() => () => {
    if (verificationRefreshTimer.current !== null) window.clearTimeout(verificationRefreshTimer.current)
  }, [])
  React.useEffect(() => {
    if (!loaded) return
    void reloadIntegrationHandoffs()
    const subscribe = getDesktopBridge()?.onboarding?.integrationHandoffSubscribe
    const unsubscribe = subscribe?.(() => { void reloadIntegrationHandoffs() })
    const timer = window.setInterval(() => void reloadIntegrationHandoffs(), 1000)
    return () => { unsubscribe?.(); window.clearInterval(timer) }
  }, [loaded, reloadIntegrationHandoffs])
  React.useEffect(() => {
    if (!loaded || currentModelSettingsPage(navigation).type !== 'home') return
    const credential = integrationHandoffs.find((item) => item.target === 'credential')
    if (!credential || openedIntegrationHandoff.current === credential.requestId) return
    openedIntegrationHandoff.current = credential.requestId
    setNavigation((current) =>
      openModelSettingsPage(current, {
        type: 'add',
        integrationSessionId: credential.sessionId,
      }),
    )
  }, [loaded, integrationHandoffs, navigation])
  const [selectedVariants, setSelectedVariants] = React.useState<Record<string, string>>({})
  const antigravitySession = useAntigravitySettings(
    'vendorKey' in page && page.vendorKey === ANTIGRAVITY_VENDOR_KEY,
    refresh,
    page.type === 'model' && page.vendorKey === ANTIGRAVITY_VENDOR_KEY ? page.modelKey : undefined,
  )
  const antigravityWorkspace = useAntigravityModelWorkspace(
    page.type === 'model'
      ? models.find((model) => model.vendorKey === page.vendorKey && model.modelKey === page.modelKey)
      : undefined,
    models,
    antigravitySession,
    (modelKey) => {
      const familyKey = getAntigravityModelVariant(modelKey)?.familyKey ?? modelKey
      setSelectedVariants((current) => ({ ...current, [familyKey]: modelKey }))
      setNavigation((current) =>
        replaceModelSettingsPage(current, { type: 'model', vendorKey: ANTIGRAVITY_VENDOR_KEY, modelKey }),
      )
    },
  )
  const [customCallTarget, setCustomCallTarget] = React.useState<CustomCallTarget | null>(null)
  const [enableAfterCapability, setEnableAfterCapability] = React.useState<string | null>(null)
  const closeModelDialog = React.useCallback(() => {
    setCustomCallTarget(null)
    setEnableAfterCapability(null)
    setNavigation((current) => closeModelSettingsDialog(current))
  }, [])
  const {
    runs: adapterRuns,
    visibleRuns: visibleAdapterTaskRuns,
    recordRun: recordAdapterRun,
    cancelRun: cancelAdapterRun,
    retryRun: retryAdapterRun,
  } = useProviderAdapterTasks()
  const previousAdapterRunsRef = React.useRef(adapterRuns)
  const [adaptStartingModel, setAdaptStartingModel] = React.useState<string | null>(null)
  const connectionRecoveryRequestRef = React.useRef(0)
  const closeWizard = React.useCallback(() => goBack(), [goBack])
  const openCustomCall = React.useCallback(
    (vendorKey: string, modelKey: string) => {
      const model = models.find((item) => item.vendorKey === vendorKey && item.modelKey === modelKey)
      setCustomCallTarget({
        vendorKey,
        modelKey,
        label: model?.labelZh || modelKey,
        script: customCallScripts.get(`${vendorKey}/${modelKey}`) || '',
        draft: model?.customCallDraft,
      })
      setNavigation((current) =>
        openModelSettingsDialogPage(current, { vendorKey, modelKey }, { type: 'script', vendorKey, modelKey }),
      )
    },
    [models, customCallScripts],
  )

  // 报错卡跳转意图：挂载后（数据就绪）消费一次；抽屉已开着时再点报错卡 → 事件再消费。
  React.useEffect(() => {
    if (!loaded) return
    const consume = () => {
      const intent = consumePendingCustomCallIntent()
      if (intent) openCustomCall(intent.vendorKey, intent.modelKey)
    }
    consume()
    window.addEventListener('nomi-open-model-catalog', consume)
    return () => window.removeEventListener('nomi-open-model-catalog', consume)
  }, [loaded, openCustomCall])

  React.useEffect(() => {
    const terminalRuns = adapterRunsRequiringCatalogRefresh(previousAdapterRunsRef.current, adapterRuns)
    previousAdapterRunsRef.current = adapterRuns
    if (terminalRuns.length > 0) refresh()
  }, [adapterRuns, refresh])

  const startModelAdaptation = React.useCallback(
    async (model: ChipModel): Promise<void> => {
      const alreadyRunning = adapterRuns.find(
        (run) =>
          run.vendorKey === model.vendorKey &&
          run.selectedModelKeys.includes(model.modelKey) &&
          !isAdapterRunTerminal(run.stage),
      )
      if (alreadyRunning) {
        openPage({ type: 'verification', runId: alreadyRunning.id })
        return
      }
      const adapt = getDesktopBridge()?.onboarding?.httpCertificationStartExisting
      if (!adapt) {
        void alertDialog({
          title: t('onboardingProviders.workspace.adapter.startFailedTitle'),
          message: t('onboardingProviders.workspace.adapter.unavailable'),
        })
        return
      }
      const confirmed = await confirmDialog({
        title: t('onboardingProviders.workspace.adapter.consentTitle'),
        message: t('onboardingProviders.workspace.adapter.consentMessage'),
        confirmLabel: t('onboardingProviders.workspace.adapter.consentConfirm'),
      })
      if (!confirmed) return
      const identity = `${model.vendorKey}/${model.modelKey}`
      setAdaptStartingModel(identity)
      try {
        const result = await adapt({
          entryPoint: 'manual-ui',
          idempotencyKey: adaptationIntentKey.current.for({
            action: 'start',
            vendorKey: model.vendorKey,
            models: [{ modelKey: model.modelKey, kind: model.kind }],
          }),
          vendorKey: model.vendorKey,
          models: [
            {
              modelKey: model.modelKey,
              labelZh: model.labelZh,
              kind: model.kind,
            },
          ],
        })
        if (!result.ok) {
          adaptationIntentKey.current.rotate()
          throw new CertificationUiError(result.code)
        }
        adaptationIntentKey.current.rotate()
        recordAdapterRun(result.run)
        refresh()
        openPage({ type: 'verification', runId: result.run.id })
      } catch (error) {
        void alertDialog({
          title: t('onboardingProviders.workspace.adapter.startFailedTitle'),
          message:
            error instanceof CertificationUiError
              ? certificationFailureMessage(t, error.code)
              : t('modelSetup.saveFailedHint'),
        })
      } finally {
        setAdaptStartingModel((current) => (current === identity ? null : current))
      }
    },
    [adapterRuns, openPage, recordAdapterRun, refresh, t],
  )

  const handleDelete = React.useCallback(
    async (rows: ChipModel[]) => {
      const bridge = getDesktopBridge()
      if (!bridge || rows.length === 0) return
      const single = rows.length === 1
      const ok = await confirmDialog({
        title: single
          ? t('onboardingProviders.drawer.deleteModel')
          : t('onboardingProviders.drawer.deleteModels', { count: rows.length }),
        message: single
          ? t('onboardingProviders.drawer.deleteSingleMessage', { name: rows[0].labelZh })
          : t('onboardingProviders.drawer.deleteMultipleMessage', { count: rows.length }),
        confirmLabel: t('common.delete'),
        danger: true,
      })
      if (!ok) return
      try {
        bridge.modelCatalog.deleteModels(rows.map((r) => ({ vendorKey: r.vendorKey, modelKey: r.modelKey })))
        refresh()
      } catch (e) {
        void alertDialog({
          title: t('onboardingProviders.drawer.deleteFailed'),
          message: e instanceof Error ? e.message : String(e),
        })
      }
    },
    [refresh, t],
  )

  const handleSetEnabled = React.useCallback(
    (rows: ChipModel[], enabled: boolean) => {
      const bridge = getDesktopBridge()
      if (!bridge || rows.length === 0) return
      try {
        for (const row of rows) {
          bridge.modelCatalog.upsertModel({ vendorKey: row.vendorKey, modelKey: row.modelKey, enabled })
        }
        refresh()
      } catch (e) {
        void alertDialog({
          title: t('onboardingProviders.drawer.operationFailed'),
          message: e instanceof Error ? e.message : String(e),
        })
      }
    },
    [refresh, t],
  )

  const handleRetype = React.useCallback(
    (row: ChipModel, kind: string) => {
      const bridge = getDesktopBridge()
      const retype = bridge?.modelCatalog.retypeModel
      if (!retype) return
      try {
        retype({ vendorKey: row.vendorKey, modelKey: row.modelKey, kind })
        refresh()
      } catch (e) {
        void alertDialog({
          title: t('onboardingProviders.drawer.operationFailed'),
          message: e instanceof Error ? e.message : String(e),
        })
      }
    },
    [refresh, t],
  )

  const {
    knownCards,
    otherVendorGroups,
    comfyuiInstances,
    comfyuiConnected,
    codexImageEnabled,
    antigravityEnabled,
    connectionTitle,
    homeConnections,
    availableHomeConnections,
  } = projectOnboardingConnections({
    models,
    vendorMeta,
    dreaminaStatus,
    openPage,
    localNames: {
      dreamina: t('onboardingProviders.dreamina.name'),
      codex: t('onboardingProviders.codexImage.name'),
      antigravity: t('antigravity.name'),
    },
  })
  const kindGuessGap = resolveKindGuessGap(models, vendorMeta)
  const renderVendorCard = (
    card: (typeof knownCards)[number],
    detailMode = false,
    focus?: Extract<ModelSettingsPage, { type: 'connection' }>['focus'],
  ) => (
    <VendorOnboardCard
      key={card.directory.vendorKey}
      directory={card.directory}
      vendorName={translateModelDisplayText(card.meta.name)}
      baseUrl={card.meta.baseUrl}
      hasApiKey={card.meta.hasApiKey}
      models={card.vendorModels}
      onToggleModel={(model, enabled) => handleSetEnabled([model], enabled)}
      onChanged={refresh}
      detailMode={detailMode}
      focus={focus}
      {...(detailMode
        ? {
            onOpenModel: (model: ChipModel) =>
              openPage({ type: 'model', vendorKey: model.vendorKey, modelKey: model.modelKey }),
          }
        : {})}
      {...(!detailMode
        ? { onOpenDetails: () => openPage({ type: 'connection', vendorKey: card.directory.vendorKey }) }
        : {})}
    />
  )

  const renderCustomVendorCard = (
    group: (typeof otherVendorGroups)[number],
    detailMode = false,
    focus?: Extract<ModelSettingsPage, { type: 'connection' }>['focus'],
  ): JSX.Element => {
    const meta = vendorMeta.get(group.vendorKey)
    return (
      <CustomVendorCard
        key={group.vendorKey}
        vendorKey={group.vendorKey}
        name={group.name}
        models={group.models}
        baseUrl={meta?.baseUrl ?? ''}
        hasApiKey={meta?.hasApiKey ?? true}
        skipHealthProbe={Boolean(meta?.customCallOnly) && group.models.every((model) => model.hasCustomCall || model.customCallDraft)}
        onToggle={handleSetEnabled}
        onDelete={handleDelete}
        onCustomCall={(row) => openCustomCall(row.vendorKey, row.modelKey)}
        onRetype={handleRetype}
        onChanged={refresh}
        detailMode={detailMode}
        focus={focus}
        {...(detailMode
          ? {
              onOpenModel: (model: ChipModel) =>
                openPage({ type: 'model', vendorKey: model.vendorKey, modelKey: model.modelKey }),
            }
          : {})}
        {...(!detailMode ? { onOpenDetails: () => openPage({ type: 'connection', vendorKey: group.vendorKey }) } : {})}
      />
    )
  }
  const handleCertificationStarted = React.useCallback(
    (run: DesktopHttpCertificationRun): void => {
      refresh()
      setCustomCallTarget(null)
      recordAdapterRun(run)
      setNavigation((current) => openModelSettingsPage(current, { type: 'verification', runId: run.id }))
    },
    [recordAdapterRun, refresh],
  )

  if (page.type === 'platformConnect') {
    const card = knownCards.find((candidate) => candidate.directory.vendorKey === page.vendorKey)
    if (!card) {
      return <ModelWorkspaceRecovery vendorName={page.vendorKey} modelKey="" onBack={goBack} />
    }
    return (
      <KnownVendorKeyConnectPage
        directory={card.directory}
        vendorName={translateModelDisplayText(card.meta.name)}
        modelCount={card.vendorModels.length} hasApiKey={card.meta.hasApiKey}
        onBack={goBack}
        onSaved={refresh}
        onContinueVerification={() => openWizard(undefined, card.directory.vendorKey)}
      />
    )
  }

  const renderConnectionDetails = (
    vendorKey: string,
    focus?: Extract<ModelSettingsPage, { type: 'connection' }>['focus'],
  ): JSX.Element | null => {
    const known = knownCards.find((card) => card.directory.vendorKey === vendorKey)
    if (known) return renderVendorCard(known, true, focus)
    const custom = otherVendorGroups.find((group) => group.vendorKey === vendorKey)
    if (custom) return renderCustomVendorCard(custom, true, focus)
    const comfy = comfyuiInstances.find((instance) => instance.key === vendorKey)
    if (comfy) {
      return (
        <ComfyuiLocalCard
          vendorKey={comfy.key}
          instanceName={translateModelDisplayText(comfy.meta.name)}
          enabled={comfy.meta.enabled}
          baseUrl={comfy.meta.baseUrl}
          models={comfy.models}
          mappings={mappings}
          onChanged={refresh}
          onVerificationRequested={openVerificationHandoff}
          detailMode
        />
      )
    }
    if (vendorKey === DREAMINA_CONNECTION_KEY) return <DreaminaMemberCard status={dreaminaStatus} onChanged={refresh} detailMode />
    if (vendorKey === CODEX_LOCAL_VENDOR_KEY) return <CodexLocalImageCard enabled={codexImageEnabled} onChanged={refresh} detailMode />
    if (vendorKey === LOCAL_TEXT_VENDOR_KEY) return <LocalModelCard enabled={vendorMeta.get(LOCAL_TEXT_VENDOR_KEY)?.enabled ?? false} models={models.filter((m) => m.vendorKey === LOCAL_TEXT_VENDOR_KEY)} onChanged={refresh} detailMode />
    if (vendorKey === ANTIGRAVITY_VENDOR_KEY) {
      return (
        <AntigravityConnectionCard
          enabled={antigravityEnabled}
          models={models.filter((model) => model.vendorKey === ANTIGRAVITY_VENDOR_KEY)}
          selectedVariants={selectedVariants}
          session={antigravitySession}
          onChanged={refresh}
          onOpenModel={(model) => openPage({ type: 'model', vendorKey: model.vendorKey, modelKey: model.modelKey })}
        />
      )
    }
    return null
  }

  const existingConnectionSummary = (vendorKey?: string) =>
    buildExistingConnectionSummary(vendorKey, vendorKey ? connectionTitle(vendorKey) : '', models, vendorMeta)

  const renderConnectionWorkspace = (
    vendorKey: string,
    focus?: Extract<ModelSettingsPage, { type: 'connection' }>['focus'],
  ): JSX.Element => {
    return (
      <ConnectionWorkspacePage
        vendorKey={vendorKey}
        title={connectionTitle(vendorKey)}
        details={renderConnectionDetails(vendorKey, focus)}
        canAddModels={canAddModelsToConnection(vendorKey, vendorMeta)}
        onAddModels={() => openWizard(undefined, vendorKey)}
        onBack={goBack}
      />
    )
  }

  const renderInModelDialog = (content: JSX.Element): JSX.Element => {
    if (!detailDialogOwner) return content
    return (
      <>
        {renderConnectionWorkspace(detailDialogOwner.vendorKey)}
        <ModelSettingsDetailDialog
          label={detailDialogOwner.modelKey}
          onClose={closeModelDialog}
          escapeAction={modelSettingsDialogEscapeAction(navigation)}
        >
          {content}
        </ModelSettingsDetailDialog>
      </>
    )
  }

  if (page.type === 'add') {
    return (
      <OnboardingWizard
        opened
        presentation="page"
        onClose={closeWizard}
        onCertificationStarted={handleCertificationStarted}
        onConnectionConfigured={() => refresh()}
        initialPreset={page.preset}
        initialScreen={page.initialScreen}
        existingVendorKey={page.existingVendorKey}
        integrationSessionId={page.integrationSessionId}
        integrationHandoffRequestId={
          integrationHandoffs.find(
            (item) => item.sessionId === page.integrationSessionId && item.target === 'credential',
          )?.requestId
        }
        existingConnection={existingConnectionSummary(page.existingVendorKey)}
        onDirectScriptDraftCreated={(identity) => {
          setCustomCallTarget({ ...identity, script: '', draft: true })
          setNavigation((current) =>
            openModelSettingsDialogPage(current, identity, { type: 'script', vendorKey: identity.vendorKey, modelKey: identity.modelKey }),
          )
          refresh()
        }}
      />
    )
  }

  const verificationHandoff = integrationHandoffs.find((item) => item.target === 'verification')
  if (page.type === 'home' && verificationHandoff) {
    return (
      <IntegrationConfirmationPanel
        handoff={verificationHandoff as IntegrationVerificationHandoff}
        onDone={() => {
          void reloadIntegrationHandoffs()
          refreshAfterIntegrationVerification()
        }}
      />
    )
  }

  if (page.type === 'verification') {
    const run = adapterRuns.find((item) => item.id === page.runId)
    return renderInModelDialog(
      <AdapterTaskWorkspace
        run={run}
        onBack={goBack}
        onCancel={() => {
          if (run) void cancelAdapterRun(run)
        }}
        onRetry={(modelKey) => {
          if (!run) return
          void retryAdapterRun(run, modelKey)
            .then((nextRun) => {
              setNavigation((current) => replaceModelSettingsPage(current, { type: 'verification', runId: nextRun.id }))
            })
            .catch(
              (error) =>
                void alertDialog({ title: t('onboardingProviders.drawer.operationFailed'),
                  message:
                    error instanceof CertificationUiError
                      ? certificationFailureMessage(t, error.code)
                      : t('modelSetup.saveFailedHint'),
                }),
            )
        }}
        onSelfConnect={(modelKey) => {
          if (!run) return
          setCustomCallTarget(null)
          setNavigation((current) =>
            openModelSettingsDialog(current, {
              vendorKey: run.vendorKey,
              modelKey,
            }),
          )
        }}
        onRecoverConnection={(target) => {
          if (!run) return
          connectionRecoveryRequestRef.current += 1
          setNavigation((current) =>
            openModelSettingsConnectionPage(current, run.vendorKey, {
              target,
              requestId: connectionRecoveryRequestRef.current,
            }),
          )
        }}
      />,
    )
  }

  if (page.type === 'script') {
    const target = customCallTarget ?? {
      vendorKey: page.vendorKey,
      modelKey: page.modelKey,
      label:
        models.find((model) => model.vendorKey === page.vendorKey && model.modelKey === page.modelKey)?.labelZh ||
        page.modelKey,
      script: customCallScripts.get(`${page.vendorKey}/${page.modelKey}`) || '',
      draft: models.find((model) => model.vendorKey === page.vendorKey && model.modelKey === page.modelKey)
        ?.customCallDraft,
    }
    return renderInModelDialog(
      <CustomCallEditor
        target={target}
        presentation="page"
        onClose={() => {
          setCustomCallTarget(null)
          goBack()
        }}
        onSaved={refresh}
        onContinueCapability={() => {
          setCustomCallTarget(null)
          setEnableAfterCapability(`${page.vendorKey}/${page.modelKey}`)
          setNavigation((current) =>
            replaceModelSettingsPage(current, {
              type: 'capability',
              vendorKey: page.vendorKey,
              modelKey: page.modelKey,
            }),
          )
        }}
      />,
    )
  }

  if (page.type === 'capability') {
    const model = models.find((item) => item.vendorKey === page.vendorKey && item.modelKey === page.modelKey)
    return renderInModelDialog(
      <ModelCapabilityEditor
        model={model}
        vendorName={connectionTitle(page.vendorKey)}
        onBack={() => {
          setEnableAfterCapability(null)
          goBack()
        }}
        onSaved={() => {
          setEnableAfterCapability(null)
          refresh()
        }}
        enableAfterSave={enableAfterCapability === `${page.vendorKey}/${page.modelKey}`}
      />,
    )
  }

  if (page.type === 'connection') {
    return renderConnectionWorkspace(page.vendorKey, page.focus)
  }

  if (page.type === 'model') {
    const model = models.find((item) => item.vendorKey === page.vendorKey && item.modelKey === page.modelKey)
    const canUseScript = canConfigureModelRequestScript(model)
    const activeRun = model
      ? adapterRuns.find(
          (run) =>
            run.vendorKey === model.vendorKey &&
            run.selectedModelKeys.includes(model.modelKey) &&
            !isAdapterRunTerminal(run.stage),
        )
      : undefined
    const modelRun = model
      ? (activeRun ??
        adapterRuns.find((run) => run.id === model.adapterRunId) ??
        adapterRuns.find((run) => run.vendorKey === model.vendorKey && run.selectedModelKeys.includes(model.modelKey)))
      : undefined
    const vendor = vendorMeta.get(page.vendorKey)
    const canAutoAdapt = Boolean(
      model &&
      vendor?.baseUrl &&
      (vendor.hasApiKey || vendor.authType === 'none') &&
      !vendor.customCallOnly &&
      !isComfyuiVendorKey(page.vendorKey) &&
      page.vendorKey !== CODEX_LOCAL_VENDOR_KEY &&
      page.vendorKey !== ANTIGRAVITY_VENDOR_KEY,
    )
    const vendorName = connectionTitle(page.vendorKey)
    const recovery = <ModelWorkspaceRecovery vendorName={vendorName} modelKey={page.modelKey} onBack={goBack} />
    return renderInModelDialog(
      <ModelSettingsDetailBoundary key={`${page.vendorKey}/${page.modelKey}`} fallback={recovery}>
        <ModelWorkspacePage
          model={model}
          connection={antigravityWorkspace}
          vendorName={vendorName}
          modelKey={page.modelKey}
          canUseScript={canUseScript}
          canAutoAdapt={canAutoAdapt}
          hasActiveRun={Boolean(activeRun)}
          hasTask={Boolean(modelRun)}
          adaptStarting={adaptStartingModel === `${page.vendorKey}/${page.modelKey}`}
          enabledLocked={Boolean(model?.customCallDraft || activeRun)}
          mappings={mappings}
          onOpenScript={() => openCustomCall(page.vendorKey, page.modelKey)}
          onStartAdapt={() => {
            if (model) void startModelAdaptation(model)
          }}
          onOpenTask={() => {
            if (!modelRun) return
            openPage({ type: 'verification', runId: modelRun.id })
          }}
          onOpenCapability={() => openPage({ type: 'capability', vendorKey: page.vendorKey, modelKey: page.modelKey })}
          onSetEnabled={(enabled) => {
            if (model && !model.customCallDraft) handleSetEnabled([model], enabled)
          }}
          onRetype={(kind) => {
            if (model) handleRetype(model, kind)
          }}
          onDelete={() => {
            if (model) void handleDelete([model])
          }}
          onBack={goBack}
        />
      </ModelSettingsDetailBoundary>,
    )
  }

  return (
    <ModelSettingsHome
      connections={homeConnections}
      availableConnections={availableHomeConnections}
      mappings={mappings}
      loaded={loaded}
      bridgeMissing={bridgeMissing}
      taskCount={visibleAdapterTaskRuns.length}
      taskContent={
        <AdapterTaskList
          runs={visibleAdapterTaskRuns}
          onOpen={(run) => openPage({ type: 'verification', runId: run.id })}
          onCancel={(run) => {
            void cancelAdapterRun(run)
          }}
        />
      }
      diagnostic={
        kindGuessGap ? (
          <div data-drawer-kind-gap className="border-l-2 border-nomi-warning bg-nomi-ink-05 px-3 py-2">
            <div className="text-caption font-medium text-nomi-ink">
              {t('onboardingProviders.drawer.kindGapTitle', {
                kinds: kindGuessGap.missing.map((key) => t(key)).join(' / '),
              })}
            </div>
            <div className="mt-0.5 text-micro leading-relaxed text-nomi-ink-60">
              {t('onboardingProviders.drawer.kindGapBody', {
                count: kindGuessGap.count,
                kind: t(
                  `onboardingProviders.modelControls.kind.${kindGuessGap.dominantKind}` as 'onboardingProviders.modelControls.kind.text',
                ),
              })}
            </div>
          </div>
        ) : undefined
      }
      networkContent={<NetworkSection />}
      dataSourceContent={<TikhubConnectorCard />}
      availableFooter={comfyuiConnected.length > 0 ? <AddComfyuiInstanceButton onAdded={refresh} /> : undefined}
      onReload={reloadFromError}
      onCustomApi={() => openWizard('newapi')}
      onDirectScript={() => openWizard(undefined, undefined, 'scriptDraft')}
    />
  )
}
