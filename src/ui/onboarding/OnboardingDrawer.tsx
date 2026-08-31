import React from 'react'
import { useTranslation } from 'react-i18next'
import { OnboardingWizard } from './OnboardingWizard'
import { VendorOnboardCard } from './VendorOnboardCard'
import { type ChipModel } from './ModelChipGroups'
import { CustomVendorCard } from './CustomVendorCard'
import { CustomCallEditor, type CustomCallTarget } from './CustomCallEditor'
import { consumePendingCustomCallIntent } from './customCallIntent'
import { confirmAndDeleteVendor } from './vendorDeleteAction'
import { DreaminaMemberCard } from './DreaminaMemberCard'
import { ComfyuiLocalCard, COMFYUI_VENDOR_KEY } from './ComfyuiLocalCard'
import { AddComfyuiInstanceButton } from './AddComfyuiInstanceButton'
import { isComfyuiVendorKey } from '../../workbench/generationCanvas/model/comfyuiVendor'
import { NetworkSection } from './NetworkSection'
import { CODEX_LOCAL_VENDOR_KEY } from './codexLocalProvider'
import { CodexLocalImageCard } from './CodexLocalImageCard'
import { KNOWN_VENDORS, isKnownVendor } from '../../config/knownVendors'
import { getDesktopBridge } from '../../desktop/bridge'
import type { DesktopProviderRegistration } from '../../desktop/onboardingBridgeTypes'
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
import { ModelSettingsHome, type ModelSettingsHomeConnection } from './ModelSettingsHome'
import { KnownVendorKeyConnectPage } from './KnownVendorKeyConnectPage'
import {
  buildExistingConnectionSummary,
  canAddModelsToConnection,
  groupOtherVendorModels,
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

export function OnboardingDrawer({ pageRequest = null }: { pageRequest?: ModelPageRequest } = {}): JSX.Element {
  const { t } = useTranslation()
  const [navigation, setNavigation] = React.useState(createModelSettingsNavigation)
  const page = currentModelSettingsPage(navigation)
  const detailDialogOwner = modelSettingsDialogOwner(navigation)
  const openPage = React.useCallback((next: Exclude<ModelSettingsPage, { type: 'home' }>) => {
    setNavigation((current) => openModelSettingsPage(current, next))
  }, [])
  useModelPageRequest(pageRequest, openPage)
  const goBack = React.useCallback(() => setNavigation((current) => backModelSettingsPage(current)), [])
  useModelSettingsPageFocus(page, goBack)
  const openWizard = React.useCallback((preset?: string, existingVendorKey?: string, initialScreen?: 'form' | 'scriptDraft') => {
    openPage({
      type: 'add',
      ...(preset ? { preset } : {}),
      ...(existingVendorKey ? { existingVendorKey } : {}),
      ...(initialScreen ? { initialScreen } : {}),
    })
  }, [openPage])
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
  const [customCallTarget, setCustomCallTarget] = React.useState<CustomCallTarget | null>(null)
  const [enableAfterCapability, setEnableAfterCapability] = React.useState<string | null>(null)
  const [registrationHandoff, setRegistrationHandoff] = React.useState<{
    vendorKey: string
    modelKeys: string[]
    initiallyReadyModelKeys: string[]
  } | null>(null)
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
      setNavigation((current) => openModelSettingsDialogPage(
        current,
        { vendorKey, modelKey },
        { type: 'script', vendorKey, modelKey },
      ))
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

  const startModelAdaptation = React.useCallback(async (model: ChipModel): Promise<void> => {
    const alreadyRunning = adapterRuns.find((run) =>
      run.vendorKey === model.vendorKey &&
      run.selectedModelKeys.includes(model.modelKey) &&
      !isAdapterRunTerminal(run.stage),
    )
    if (alreadyRunning) {
      openPage({ type: 'verification', runId: alreadyRunning.id })
      return
    }
    const adapt = getDesktopBridge()?.onboarding?.adapterAdaptExisting
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
        vendorKey: model.vendorKey,
        models: [{
          modelKey: model.modelKey,
          labelZh: model.labelZh,
          kind: model.kind,
        }],
      })
      if (!result.ok) throw new Error(result.error || t('onboardingProviders.workspace.adapter.startFailedBody'))
      recordAdapterRun(result.run)
      refresh()
      openPage({ type: 'verification', runId: result.run.id })
    } catch (error) {
      void alertDialog({
        title: t('onboardingProviders.workspace.adapter.startFailedTitle'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setAdaptStartingModel((current) => current === identity ? null : current)
    }
  }, [adapterRuns, openPage, recordAdapterRun, refresh, t])

  const handleDelete = React.useCallback(async (rows: ChipModel[]) => {
    const bridge = getDesktopBridge()
    if (!bridge || rows.length === 0) return
    const single = rows.length === 1
    const ok = await confirmDialog({
      title: single ? t('onboardingProviders.drawer.deleteModel') : t('onboardingProviders.drawer.deleteModels', { count: rows.length }),
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
      void alertDialog({ title: t('onboardingProviders.drawer.deleteFailed'), message: e instanceof Error ? e.message : String(e) })
    }
  }, [refresh, t])

  const handleSetEnabled = React.useCallback((rows: ChipModel[], enabled: boolean) => {
    const bridge = getDesktopBridge()
    if (!bridge || rows.length === 0) return
    try {
      for (const row of rows) {
        bridge.modelCatalog.upsertModel({ vendorKey: row.vendorKey, modelKey: row.modelKey, enabled })
      }
      refresh()
    } catch (e) {
      void alertDialog({ title: t('onboardingProviders.drawer.operationFailed'), message: e instanceof Error ? e.message : String(e) })
    }
  }, [refresh, t])

  const handleRetype = React.useCallback((row: ChipModel, kind: string) => {
    const bridge = getDesktopBridge()
    const retype = bridge?.modelCatalog.retypeModel
    if (!retype) return
    try {
      retype({ vendorKey: row.vendorKey, modelKey: row.modelKey, kind })
      refresh()
    } catch (e) {
      void alertDialog({ title: t('onboardingProviders.drawer.operationFailed'), message: e instanceof Error ? e.message : String(e) })
    }
  }, [refresh, t])

  const knownCards = KNOWN_VENDORS
    .map((directory) => {
      const meta = vendorMeta.get(directory.vendorKey)
      if (!meta) return null
      const vendorModels = models.filter((m) => m.vendorKey === directory.vendorKey)
      return { directory, meta, vendorModels }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  const connectedKnown = knownCards.filter((c) => c.meta.hasApiKey)
  const availableKnown = knownCards.filter((c) => !c.meta.hasApiKey)
  const otherModels = models.filter((m) =>
    !isKnownVendor(m.vendorKey) &&
    m.vendorKey !== 'dreamina' &&
    m.vendorKey !== COMFYUI_VENDOR_KEY &&
    m.vendorKey !== CODEX_LOCAL_VENDOR_KEY,
  )
  const otherVendorKeys = [...vendorMeta.keys()].filter((vendorKey) => (
    !isKnownVendor(vendorKey) &&
    vendorKey !== 'dreamina' &&
    vendorKey !== DREAMINA_CONNECTION_KEY &&
    !isComfyuiVendorKey(vendorKey) &&
    vendorKey !== CODEX_LOCAL_VENDOR_KEY
  ))

  const comfyuiInstances = React.useMemo(
    () =>
      [...vendorMeta.entries()]
        .filter(([key]) => isComfyuiVendorKey(key))
        .sort(([a], [b]) => (a === COMFYUI_VENDOR_KEY ? -1 : b === COMFYUI_VENDOR_KEY ? 1 : a.localeCompare(b)))
        .map(([key, meta]) => ({ key, meta, models: models.filter((m) => m.vendorKey === key) })),
    [vendorMeta, models],
  )
  const comfyuiConnected = comfyuiInstances.filter((i) => i.meta.enabled)
  const comfyuiAvailableList = comfyuiInstances.filter((i) => !i.meta.enabled)

  const dreaminaAvailable = dreaminaStatus !== null
  const dreaminaConnected = !!(dreaminaStatus?.installed && dreaminaStatus?.loggedIn)
  const codexImageMeta = vendorMeta.get(CODEX_LOCAL_VENDOR_KEY)
  const codexImageAvailable = codexImageMeta !== undefined
  const codexImageEnabled = codexImageMeta?.enabled === true

  const kindGuessGap = resolveKindGuessGap(models, vendorMeta)
  const otherVendorGroups = groupOtherVendorModels(otherModels, vendorMeta, otherVendorKeys)
  const renderVendorCard = (
    card: typeof knownCards[number],
    detailMode = false,
    focus?: Extract<ModelSettingsPage, { type: 'connection' }>['focus'],
  ) => (
    <VendorOnboardCard
      key={card.directory.vendorKey}
      directory={card.directory}
      vendorName={card.meta.name}
      baseUrl={card.meta.baseUrl}
      hasApiKey={card.meta.hasApiKey}
      models={card.vendorModels}
      onToggleModel={(model, enabled) => handleSetEnabled([model], enabled)}
      onChanged={refresh}
      detailMode={detailMode}
      focus={focus}
      {...(detailMode
        ? { onOpenModel: (model: ChipModel) => openPage({ type: 'model', vendorKey: model.vendorKey, modelKey: model.modelKey }) }
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
          ? { onOpenModel: (model: ChipModel) => openPage({ type: 'model', vendorKey: model.vendorKey, modelKey: model.modelKey }) }
          : {})}
        {...(!detailMode
          ? { onOpenDetails: () => openPage({ type: 'connection', vendorKey: group.vendorKey }) }
          : {})}
      />
    )
  }
  const connectionTitle = (vendorKey: string): string => {
    const known = knownCards.find((card) => card.directory.vendorKey === vendorKey)
    if (known) return known.meta.name
    const custom = otherVendorGroups.find((group) => group.vendorKey === vendorKey)
    if (custom) return custom.name
    const comfy = comfyuiInstances.find((instance) => instance.key === vendorKey)
    if (comfy) return comfy.meta.name
    if (vendorKey === DREAMINA_CONNECTION_KEY) return t('onboardingProviders.dreamina.name')
    if (vendorKey === CODEX_LOCAL_VENDOR_KEY) return t('onboardingProviders.codexImage.name')
    return vendorKey
  }

  const homeConnection = (
    value: Omit<ModelSettingsHomeConnection, 'onOpen'>,
    onOpen?: () => void,
  ): ModelSettingsHomeConnection => ({
    ...value,
    onOpen: onOpen ?? (() => openPage({ type: 'connection', vendorKey: value.vendorKey })),
  })

  const homeConnections: ModelSettingsHomeConnection[] = [
    ...connectedKnown.map((card) => homeConnection({
      vendorKey: card.directory.vendorKey,
      name: card.meta.name,
      kind: 'api',
      models: card.vendorModels,
      logo: card.directory.logo,
      glyph: card.directory.glyph,
      baseUrl: card.meta.baseUrl,
      hasApiKey: card.meta.hasApiKey,
    })),
    ...otherVendorGroups.map((group) => {
      const meta = vendorMeta.get(group.vendorKey)
      return homeConnection({
        vendorKey: group.vendorKey,
        name: group.name,
        kind: 'api',
        models: group.models,
        baseUrl: meta?.baseUrl ?? '',
        hasApiKey: meta?.hasApiKey ?? true,
        // 与 renderCustomVendorCard 同一判据：direct-script 那类没有可预检的通用接口。
        skipHealthProbe: Boolean(meta?.customCallOnly)
          && group.models.every((model) => model.hasCustomCall || model.customCallDraft),
      })
    }),
    ...comfyuiConnected.map((instance) => homeConnection({
      vendorKey: instance.key,
      name: instance.meta.name,
      kind: 'local',
      models: instance.models,
      glyph: 'C',
    })),
    ...(dreaminaConnected ? [homeConnection({
      vendorKey: DREAMINA_CONNECTION_KEY,
      name: connectionTitle(DREAMINA_CONNECTION_KEY),
      kind: 'account',
      models: [],
      glyph: 'D',
    })] : []),
    ...(codexImageEnabled ? [homeConnection({
      vendorKey: CODEX_LOCAL_VENDOR_KEY,
      name: connectionTitle(CODEX_LOCAL_VENDOR_KEY),
      kind: 'local',
      models: models.filter((model) => model.vendorKey === CODEX_LOCAL_VENDOR_KEY),
      glyph: 'C',
    })] : []),
  ]

  const availableHomeConnections: ModelSettingsHomeConnection[] = [
    ...availableKnown.map((card) => homeConnection({
      vendorKey: card.directory.vendorKey,
      name: card.meta.name,
      kind: 'api',
      models: [],
      logo: card.directory.logo,
      glyph: card.directory.glyph,
    }, ['apimart', 'kie'].includes(card.directory.vendorKey)
      ? () => openPage({ type: 'platformConnect', vendorKey: card.directory.vendorKey })
      : undefined)),
    ...comfyuiAvailableList.map((instance) => homeConnection({
      vendorKey: instance.key,
      name: instance.meta.name,
      kind: 'local',
      models: [],
      glyph: 'C',
    })),
    ...(dreaminaAvailable && !dreaminaConnected ? [homeConnection({
      vendorKey: DREAMINA_CONNECTION_KEY,
      name: connectionTitle(DREAMINA_CONNECTION_KEY),
      kind: 'account',
      models: [],
      glyph: 'D',
    })] : []),
    ...(codexImageAvailable && !codexImageEnabled ? [homeConnection({
      vendorKey: CODEX_LOCAL_VENDOR_KEY,
      name: connectionTitle(CODEX_LOCAL_VENDOR_KEY),
      kind: 'local',
      models: [],
      glyph: 'C',
    })] : []),
  ]

  const handleRegistrationCommitted = React.useCallback((registration: DesktopProviderRegistration): void => {
    refresh()
    setCustomCallTarget(null)
    if (registration.selectedModelKeys.length === 1) {
      setRegistrationHandoff(null)
      setNavigation((current) => openModelSettingsDialog(current, {
        vendorKey: registration.vendorKey,
        modelKey: registration.selectedModelKeys[0],
      }))
      return
    }
    setRegistrationHandoff({
      vendorKey: registration.vendorKey,
      modelKeys: registration.selectedModelKeys,
      initiallyReadyModelKeys: registration.models
        .filter((model) => model.kind === 'text')
        .map((model) => model.modelKey),
    })
    setNavigation((current) => replaceModelSettingsPage(current, {
      type: 'connection',
      vendorKey: registration.vendorKey,
    }))
  }, [refresh])

  if (page.type === 'platformConnect') {
    const card = knownCards.find((candidate) => candidate.directory.vendorKey === page.vendorKey)
    if (!card) {
      return (
        <ModelWorkspaceRecovery
          vendorName={page.vendorKey}
          modelKey=""
          onBack={goBack}
        />
      )
    }
    return (
      <KnownVendorKeyConnectPage
        directory={card.directory}
        vendorName={card.meta.name}
        modelCount={card.vendorModels.length}
        onBack={goBack}
        onSaved={refresh}
        onFinished={goBack}
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
          instanceName={comfy.meta.name}
          enabled={comfy.meta.enabled}
          baseUrl={comfy.meta.baseUrl}
          models={comfy.models}
          mappings={mappings}
          onChanged={refresh}
          detailMode
        />
      )
    }
    if (vendorKey === DREAMINA_CONNECTION_KEY) {
      return <DreaminaMemberCard status={dreaminaStatus} onChanged={refresh} detailMode />
    }
    if (vendorKey === CODEX_LOCAL_VENDOR_KEY) {
      return <CodexLocalImageCard enabled={codexImageEnabled} onChanged={refresh} detailMode />
    }
    return null
  }

  const existingConnectionSummary = (vendorKey?: string) => buildExistingConnectionSummary(
    vendorKey,
    vendorKey ? connectionTitle(vendorKey) : '',
    models,
    vendorMeta,
  )

  const renderConnectionWorkspace = (
    vendorKey: string,
    focus?: Extract<ModelSettingsPage, { type: 'connection' }>['focus'],
  ): JSX.Element => {
    const activeHandoff = registrationHandoff?.vendorKey === vendorKey ? registrationHandoff : null
    const initiallyReady = new Set(activeHandoff?.initiallyReadyModelKeys ?? [])
    const pendingModelKeys = activeHandoff?.modelKeys.filter((modelKey) => {
      const model = models.find((item) => item.vendorKey === vendorKey && item.modelKey === modelKey)
      return !(model?.enabled ?? initiallyReady.has(modelKey))
    }) ?? []
    const handoff = activeHandoff ? {
      total: activeHandoff.modelKeys.length,
      ready: activeHandoff.modelKeys.length - pendingModelKeys.length,
      pending: pendingModelKeys.length,
      ...(pendingModelKeys[0] ? {
        onContinue: () => setNavigation((current) => openModelSettingsDialog(current, {
          vendorKey,
          modelKey: pendingModelKeys[0],
        })),
      } : {}),
    } : undefined
    return (
      <ConnectionWorkspacePage
      vendorKey={vendorKey}
      title={connectionTitle(vendorKey)}
      details={renderConnectionDetails(vendorKey, focus)}
      canAddModels={canAddModelsToConnection(vendorKey, vendorMeta)}
      onAddModels={() => openWizard(undefined, vendorKey)}
      onBack={() => {
        if (registrationHandoff?.vendorKey === vendorKey) setRegistrationHandoff(null)
        goBack()
      }}
      handoff={handoff}
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
        onCommitted={handleRegistrationCommitted}
        onConnectionSaved={() => refresh()}
        initialPreset={page.preset}
        initialScreen={page.initialScreen}
        existingVendorKey={page.existingVendorKey}
        existingConnection={existingConnectionSummary(page.existingVendorKey)}
        onDirectScriptDraftCreated={(identity) => {
          setCustomCallTarget({ ...identity, script: '', draft: true })
          setNavigation((current) => openModelSettingsDialogPage(
            current,
            identity,
            { type: 'script', vendorKey: identity.vendorKey, modelKey: identity.modelKey },
          ))
          refresh()
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
        onCancel={() => { if (run) void cancelAdapterRun(run) }}
        onRetry={(modelKey) => {
          if (!run) return
          void retryAdapterRun(run, modelKey).then((nextRun) => {
            setNavigation((current) => replaceModelSettingsPage(current, { type: 'verification', runId: nextRun.id }))
          }).catch((error) => void alertDialog({ title: t('onboardingProviders.drawer.operationFailed'), message: error instanceof Error ? error.message : String(error) }))
        }}
        onSelfConnect={(modelKey) => {
          if (!run) return
          setCustomCallTarget(null)
          setNavigation((current) => openModelSettingsDialog(current, {
            vendorKey: run.vendorKey,
            modelKey,
          }))
        }}
        onRecoverConnection={(target) => {
          if (!run) return
          connectionRecoveryRequestRef.current += 1
          setNavigation((current) => openModelSettingsConnectionPage(current, run.vendorKey, {
            target,
            requestId: connectionRecoveryRequestRef.current,
          }))
        }}
      />,
    )
  }

  if (page.type === 'script') {
    const target = customCallTarget ?? {
      vendorKey: page.vendorKey,
      modelKey: page.modelKey,
      label: models.find((model) => model.vendorKey === page.vendorKey && model.modelKey === page.modelKey)?.labelZh || page.modelKey,
      script: customCallScripts.get(`${page.vendorKey}/${page.modelKey}`) || '',
      draft: models.find((model) => model.vendorKey === page.vendorKey && model.modelKey === page.modelKey)?.customCallDraft,
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
          setNavigation((current) => replaceModelSettingsPage(current, {
            type: 'capability',
            vendorKey: page.vendorKey,
            modelKey: page.modelKey,
          }))
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
      ? adapterRuns.find((run) =>
          run.vendorKey === model.vendorKey &&
          run.selectedModelKeys.includes(model.modelKey) &&
          !isAdapterRunTerminal(run.stage),
        )
      : undefined
    const modelRun = model
      ? activeRun ?? adapterRuns.find((run) => run.id === model.adapterRunId) ?? adapterRuns.find((run) =>
          run.vendorKey === model.vendorKey && run.selectedModelKeys.includes(model.modelKey),
        )
      : undefined
    const vendor = vendorMeta.get(page.vendorKey)
    const canAutoAdapt = Boolean(
      model &&
      vendor?.baseUrl &&
      (vendor.hasApiKey || vendor.authType === 'none') &&
      !vendor.customCallOnly &&
      !isComfyuiVendorKey(page.vendorKey) &&
      page.vendorKey !== CODEX_LOCAL_VENDOR_KEY,
    )
    const vendorName = connectionTitle(page.vendorKey)
    const recovery = (
      <ModelWorkspaceRecovery
        vendorName={vendorName}
        modelKey={page.modelKey}
        onBack={goBack}
      />
    )
    return renderInModelDialog(
      <ModelSettingsDetailBoundary
        key={`${page.vendorKey}/${page.modelKey}`}
        fallback={recovery}
      >
        <ModelWorkspacePage
          model={model}
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
          onStartAdapt={() => { if (model) void startModelAdaptation(model) }}
          onOpenTask={() => {
            if (!modelRun) return
            openPage({ type: 'verification', runId: modelRun.id })
          }}
          onOpenCapability={() => openPage({ type: 'capability', vendorKey: page.vendorKey, modelKey: page.modelKey })}
          onSetEnabled={(enabled) => { if (model && !model.customCallDraft) handleSetEnabled([model], enabled) }}
          onRetype={(kind) => { if (model) handleRetype(model, kind) }}
          onDelete={() => { if (model) void handleDelete([model]) }}
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
      taskContent={(
        <AdapterTaskList
          runs={visibleAdapterTaskRuns}
          onOpen={(run) => openPage({ type: 'verification', runId: run.id })}
          onCancel={(run) => { void cancelAdapterRun(run) }}
        />
      )}
      diagnostic={kindGuessGap ? (
        <div data-drawer-kind-gap className="border-l-2 border-nomi-warning bg-nomi-ink-05 px-3 py-2">
          <div className="text-caption font-medium text-nomi-ink">
            {t('onboardingProviders.drawer.kindGapTitle', {
              kinds: kindGuessGap.missing.map((key) => t(key)).join(' / '),
            })}
          </div>
          <div className="mt-0.5 text-micro leading-relaxed text-nomi-ink-60">
            {t('onboardingProviders.drawer.kindGapBody', {
              count: kindGuessGap.count,
              kind: t(`onboardingProviders.modelControls.kind.${kindGuessGap.dominantKind}` as 'onboardingProviders.modelControls.kind.text'),
            })}
          </div>
        </div>
      ) : undefined}
      networkContent={<NetworkSection />}
      availableFooter={comfyuiConnected.length > 0 ? <AddComfyuiInstanceButton onAdded={refresh} /> : undefined}
      onReload={reloadFromError}
      onCustomApi={() => openWizard('newapi')}
      onDirectScript={() => openWizard(undefined, undefined, 'scriptDraft')}
    />
  )
}
