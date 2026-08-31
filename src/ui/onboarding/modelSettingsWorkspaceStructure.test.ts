import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')

describe('model settings workspace structure', () => {
  it('keeps model discovery and connection management inside Settings', () => {
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')
    expect(drawer).toContain("page.type === 'connection'")
    expect(drawer).toContain("page.type === 'model'")
    expect(drawer).toContain("page.type === 'capability'")
    expect(drawer).toContain("page.type === 'add'")
    expect(drawer).toContain("page.type === 'verification'")
    expect(drawer).toContain("page.type === 'script'")
    expect(drawer).toContain('presentation="page"')
    expect(drawer).not.toContain('opened={wizardOpen}')
  })

  it('opens a concrete model and its child routes in an independent third-level dialog', () => {
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')
    const dialog = read('src/ui/onboarding/ModelSettingsDetailDialog.tsx')
    const navigation = read('src/ui/onboarding/modelSettingsNavigation.ts')
    const settings = read('src/workbench/settings/SettingsDialog.tsx')
    expect(drawer).toContain("if (page.type === 'model')")
    expect(drawer).toContain("if (page.type === 'capability')")
    expect(drawer).toContain("if (page.type === 'script')")
    expect(drawer).toContain("if (page.type === 'verification')")
    expect(drawer).toContain('<ModelSettingsDetailDialog')
    expect(drawer).toContain('renderInModelDialog')
    expect(drawer).toContain('modelSettingsDialogOwner(navigation)')
    expect(drawer).toContain('closeModelSettingsDialog(current)')
    expect(dialog).toContain('<DesignModal')
    expect(dialog).toContain('data-model-settings-dialog')
    expect(dialog).toContain('size={880}')
    expect(dialog).toContain('sm:h-[min(640px,calc(100svh-48px))]')
    expect(navigation).toContain('modelSettingsDialogOwner')
    expect(navigation).toContain('closeModelSettingsDialog')
    expect(settings).toContain('data-settings-content')
    expect(settings).toContain('data-settings-model-workspace')
    // 2026-08-25 起带 pageRequest：设置里的「去配置 KIE」要能直达那家的 Key 输入页，
    // 而模型工作区首访后常驻挂载，只能靠这个请求值把它推到目标页（详见 useModelPageRequest）。
    expect(settings).toContain('<OnboardingDrawer pageRequest={modelPageRequest} />')
    expect(drawer).not.toContain('data-model-settings-detail-panel')
    expect(drawer).not.toContain('data-model-settings-detail-context')
    expect(drawer).not.toContain('INERT_HTML_ATTRIBUTE')
    expect(fs.existsSync(path.join(process.cwd(), 'src/ui/onboarding/ModelSettingsDetailDialog.tsx'))).toBe(true)
  })

  it('contains stale or malformed model rendering inside a recoverable detail boundary', () => {
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')
    const workspace = read('src/ui/onboarding/ModelSettingsWorkspacePages.tsx')
    expect(drawer).toContain('<ModelSettingsDetailBoundary')
    expect(drawer).toContain('fallback={recovery}')
    expect(workspace).toContain('static getDerivedStateFromError()')
    expect(workspace).toContain('data-model-settings-recovery')
    expect(workspace).toContain('autoFocus={backAutoFocus}')
    expect(workspace).toContain('backAutoFocus')
    expect(workspace).toContain('if (!model)')
    expect(workspace).toContain('<ModelWorkspaceRecovery')
  })

  it('keeps long capability and verification pages scrollable inside the model dialog', () => {
    const capability = read('src/ui/onboarding/ModelCapabilityEditor.tsx')
    const verification = read('src/ui/onboarding/AdapterTaskWorkspace.tsx')
    expect(capability).toContain('className="flex h-full min-h-0 flex-col"')
    expect(capability).toContain('max-w-[800px] flex-1 overflow-y-auto')
    expect(verification).toContain('className="flex h-full min-h-0 flex-col"')
    expect(verification).toContain('max-w-[760px] flex-1 overflow-y-auto')
  })

  it('shows projected model capabilities and edits them through the catalog meta contract', () => {
    const workspace = read('src/ui/onboarding/ModelSettingsWorkspacePages.tsx')
    const editor = read('src/ui/onboarding/ModelCapabilityEditor.tsx')
    expect(workspace).toContain('<ModelCapabilitySummary')
    expect(workspace).not.toContain('JSON.stringify((model.meta')
    expect(editor).toContain('validateCapabilityContractDraft')
    expect(editor).toContain('replaceCustomCapabilityContractMeta')
    expect(editor).toContain('bridge.modelCatalog.upsertModel')
    expect(editor).toContain('data-capability-mode-list')
    expect(editor).toContain('activeMode && activeModeIndex !== null')
    expect(editor).not.toMatch(/draft\.modes\.map[\s\S]{0,500}<CapabilityModeEditor/)
  })

  it('restores persisted background work and exposes a real main-process cancel action', () => {
    const tasks = read('src/ui/onboarding/useProviderAdapterTasks.ts')
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')
    expect(tasks).toContain('adapterList')
    expect(tasks).toContain('adapterCancel')
    expect(tasks).toContain('adapterRetry({ runId: run.id, ...(modelKey ? { modelKey } : {}) })')
    expect(tasks).toContain('recordRun(result.run)')
    expect(tasks).toContain('setInterval')
    expect(drawer).toContain('<AdapterTaskList')
    expect(drawer).toContain('<AdapterTaskWorkspace')
    expect(drawer).toContain('const closeWizard = React.useCallback')
    expect(drawer).toContain('onClose={closeWizard}')
    expect(drawer).toContain('replaceModelSettingsPage(current, { type: \'verification\', runId: nextRun.id })')
    expect(drawer).not.toContain('wizardRunId')
    expect(drawer).not.toContain('handleWizardRunChange')
    expect(drawer).toContain("alertDialog({ title: t('onboardingProviders.drawer.operationFailed')")
    expect(read('src/ui/onboarding/AdapterTaskWorkspace.tsx')).toContain('onRetry={onRetry}')
    expect(read('src/ui/onboarding/AdapterVerificationScreen.tsx')).toContain('onRetry(model.modelKey)')
  })

  it('refreshes the model catalog when a background adapter run reaches a terminal state', () => {
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')
    expect(drawer).toContain('adapterRunsRequiringCatalogRefresh(previousAdapterRunsRef.current, adapterRuns)')
    expect(drawer).toContain('if (terminalRuns.length > 0) refresh()')
  })

  it('starts automatic adaptation only from an explicit model-detail action', () => {
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')
    const workspace = read('src/ui/onboarding/ModelSettingsWorkspacePages.tsx')
    const status = read('src/ui/onboarding/ModelAdapterStatusSection.tsx')

    expect(workspace).toContain('<ModelAdapterStatusSection')
    expect(drawer).toContain('adapterAdaptExisting')
    expect(drawer).toContain("t('onboardingProviders.workspace.adapter.consentMessage')")
    expect(drawer).toContain('selectedModelKeys.includes(model.modelKey)')
    expect(status).toContain("primaryAction === 'openTask'")
    expect(status).toContain("primaryAction === 'editCapability'")
    expect(status).toContain("primaryAction === 'writeScript'")
    expect(status).toContain("secondaryAction === 'autoConfigure'")
    expect(status).not.toContain("primaryAction === 'test'")
    expect(status).not.toContain('hasAutomaticAction || canUseScript')
    expect(status).not.toContain('hasAutomaticAction ?')
  })

  it('keeps input and request setup available without forcing automatic adaptation first', () => {
    const workspace = read('src/ui/onboarding/ModelSettingsWorkspacePages.tsx')
    expect(workspace).toContain('onEdit={onOpenCapability}')
    expect(workspace).toContain('onEditRequest={canUseScript ? onOpenScript : undefined}')
    expect(workspace).not.toContain('onEdit={capabilityKnown ? onOpenCapability : undefined}')
    expect(workspace).not.toContain('onEditRequest={transportAvailable ? onOpenScript : undefined}')
  })

  it('keeps model detail task-first and hides advanced operations by default', () => {
    const workspace = read('src/ui/onboarding/ModelSettingsWorkspacePages.tsx')
    const capability = read('src/ui/onboarding/ModelCapabilitySummary.tsx')
    expect(workspace).toContain('workspace.basicSettings')
    expect(workspace).toContain('workspace.moreActions')
    expect(workspace).toContain('<details')
    expect(workspace).not.toContain("t('onboardingProviders.workspace.modelStatus')")
    expect(capability).toContain('capability.inputSummaryTitle')
    expect(capability).toContain('capability.requestSummaryTitle')
    expect(capability).not.toContain('function ModeSummary')
    expect(capability).not.toContain('function InputList')
  })

  it('requires a successful script test and routes unknown media inputs into capability setup', () => {
    const editor = read('src/ui/onboarding/CustomCallEditor.tsx')
    const hook = read('src/ui/onboarding/useCustomCallTestRun.ts')
    expect(editor).toContain("test.phase === 'done' && test.ok")
    expect(editor).toContain('customCall.saveDraft')
    expect(editor).toContain('onClick={saveTestedScript}')
    expect(editor).toContain('customCall.saveAndContinueCapability')
    expect(editor).toContain('requiresCapabilitySetup && onContinueCapability')
    expect(editor).toContain('customCall.testRun')
    expect(hook).toContain("setTest({ phase: 'idle' })")
  })

  it('keeps script controls in DOM reading order and guards unsaved scope switches', () => {
    const editor = read('src/ui/onboarding/CustomCallEditor.tsx')
    const contentStart = editor.indexOf('const content = target ?')
    const contentEnd = editor.indexOf("if (presentation === 'page')", contentStart)
    const scope = editor.indexOf('<CustomCallScopeSelector', contentStart)
    const script = editor.indexOf("t('onboardingProviders.customCall.scriptLabel')", scope)
    const result = editor.indexOf("test.phase === 'done' ?", script)
    const ai = editor.indexOf("t('onboardingProviders.customCall.aiHelpTitle')", result)
    const config = editor.indexOf('onboardingProviders.customCall.configLabelFilled', ai)
    const safety = editor.indexOf("t('onboardingProviders.customCall.safetyTitle')", config)
    const pageStart = editor.indexOf("if (presentation === 'page')", contentEnd)
    const contract = editor.indexOf('<CustomCallContractSidebar', pageStart)
    const editorMain = editor.indexOf('data-custom-call-editor-main', contract)

    expect(contentStart).toBeGreaterThanOrEqual(0)
    expect(scope).toBeLessThan(script)
    expect(script).toBeLessThan(result)
    expect(result).toBeLessThan(ai)
    expect(ai).toBeLessThan(config)
    expect(config).toBeLessThan(safety)
    expect(safety).toBeLessThan(contentEnd)
    expect(contract).toBeLessThan(editorMain)
    expect(editor).toContain('scopeDiscardMessage')
    expect(editor).toContain('setScriptForMode(selectedModeId, savedScriptForSelectedScope)')
  })

  it('turns terminal models without an automatic contract into a manual-script exit', () => {
    const verification = read('src/ui/onboarding/AdapterVerificationScreen.tsx')
    const viewModel = read('src/ui/onboarding/adapterVerificationViewModel.ts')
    expect(viewModel).toContain("return runTerminal ? 'needs_attention' : 'working'")
    expect(verification).toContain("adapterVerification.noContract")
    expect(verification).toContain('onSelfConnect(model.modelKey, model.labelZh)')
    expect(verification).toContain('adapterVerification.action.manualSetup')
  })

  it('routes URL and key failures to the exact editable connection field', () => {
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')
    const verification = read('src/ui/onboarding/AdapterVerificationScreen.tsx')
    const known = read('src/ui/onboarding/VendorOnboardCard.tsx')
    const custom = read('src/ui/onboarding/CustomVendorManage.tsx')
    const urlField = read('src/ui/onboarding/VendorBaseUrlField.tsx')

    expect(verification).toContain("onRecoverConnection(advice.action === 'fixUrl' ? 'baseUrl' : 'apiKey')")
    expect(drawer).toContain('openModelSettingsConnectionPage(current, run.vendorKey')
    // key 那一路仍归各自的卡（内置家支持多段凭证，自定义家恒单段——是真实差异，不是重复）。
    expect(known).toContain('data-model-connection-field="apiKey"')
    expect(custom).toContain('data-model-connection-field="apiKey"')
    // 地址那一路两张卡共用同一份实现，且都把 focus 透传下去，否则 fixUrl 的恢复流程会落空。
    for (const [name, source] of [['known', known], ['custom', custom]] as const) {
      expect(source, `${name} 卡要用共用的地址字段`).toContain('<VendorBaseUrlField')
      expect(source, `${name} 卡要把 focus 透传给地址字段`).toContain('focus={focus}')
    }
    expect(urlField).toContain('data-model-connection-field="baseUrl"')
    expect(urlField).toContain("focus.target !== 'baseUrl'")
  })

  // 2026-08-18：群里「要改 api url 翻了半天没找到」的实测根因是——地址/凭证排在 24 行模型列表
  // 之后，落地连接详情页那一屏整块被弹窗 overflow 裁在窗外（铅笔 y=817 / 弹窗底边 y=706）。
  // 见 docs/plan/2026-08-18-vendor-connection-discoverability.md。
  it('puts the connection block before the model list on the custom vendor card', () => {
    const card = read('src/ui/onboarding/CustomVendorCard.tsx')
    const connectionAt = card.indexOf('<CustomVendorManage')
    const modelsAt = card.indexOf('<ModelEnableEditor')
    expect(connectionAt, 'CustomVendorManage 要在卡里').toBeGreaterThan(-1)
    expect(modelsAt, 'ModelEnableEditor 要在卡里').toBeGreaterThan(-1)
    expect(connectionAt, '「连接」必须排在「模型」之前——这一页的主语是连接').toBeLessThan(modelsAt)
  })

  // 首页那一行此前只算 summarizeModelHomeConnection（模型能力，不看网络），于是 401 的家
  // 在用户扫视的那一屏上写着灰色「24 个可使用」——他根本不知道该点哪一行去改地址。
  it('surfaces connection health on the model home rows without a second probe', () => {
    const home = read('src/ui/onboarding/ModelSettingsHome.tsx')
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')
    // 复用卡片侧那个现成 hook，不另写一套探测（P1 无并行实现）。
    expect(home).toContain("import { useVendorHealth } from './useVendorHealth'")
    expect(home).not.toContain('useVendorHealthMap')
    expect(home).toContain('data-model-home-unreachable')
    // 探测要的入参得真的从 drawer 传下来，否则 hook 拿到空 baseUrl 永远探不出结果。
    expect(drawer).toContain('hasApiKey: meta?.hasApiKey ?? true')
    expect(drawer).toContain('baseUrl: card.meta.baseUrl')
    // 区块标题不许在有家连不上时还写「N 个可使用」（与行内红字打架）。
    expect(home).toContain('unreachableAside ?? (hasAttention')
  })

  // §1.5.2 一功能一个家：删除整家此前有两个入口（卡头垃圾桶 + 连接组按钮）。
  it('keeps exactly one entry point for deleting a whole vendor', () => {
    const card = read('src/ui/onboarding/CustomVendorCard.tsx')
    const manage = read('src/ui/onboarding/CustomVendorManage.tsx')
    expect(card).not.toContain('headerAction')
    expect(card).not.toContain('onDeleteVendor')
    expect(manage).toContain('confirmAndDeleteVendor')
    expect(manage.match(/confirmAndDeleteVendor\(/g) ?? []).toHaveLength(1)
  })

  it('uses progressive disclosure for wire-level capability fields', () => {
    const editor = read('src/ui/onboarding/CapabilityModeEditor.tsx')
    expect(editor).toContain('interfaceOpen')
    expect(editor).toContain('hasInterfaceError')
    expect(editor).toContain('interfaceFields')
    expect(editor).toContain('open={interfaceOpen || hasInterfaceError}')
  })

  it('lets the third-level dialog own Escape while Settings stays mounted underneath', () => {
    const settings = read('src/workbench/settings/SettingsDialog.tsx')
    const dialog = read('src/ui/onboarding/ModelSettingsDetailDialog.tsx')
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')
    expect(settings).toContain('getSettingsEscapeOwnership')
    expect(settings).toContain('if (externalEscapes.has(event)) return')
    expect(drawer).toContain('escapeAction={modelSettingsDialogEscapeAction(navigation)}')
    expect(dialog).toContain("closeOnEscape={escapeAction === 'close'}")
    expect(dialog).toContain("if (escapeAction !== 'back') return")
    expect(dialog).toContain('getSettingsEscapeOwnership')
    expect(dialog).toContain('settingsEscapeTargetWasRemoved')
    expect(dialog).toContain("window.dispatchEvent(new CustomEvent('nomi-model-settings-back'))")
    expect(dialog).toContain('returnFocus')
  })
})
