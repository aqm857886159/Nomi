import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { repositoryBaselinePath, repositoryRoot } from './check-vocabularies-test-helpers.mjs'

const VAGUE_REASON_REFERENCE = /(?:参见|见)\s*(?:设计文档|文档|方案)/
const GENERIC_AUTHORITY_REASON = /is the intentional authoritative vocabulary for this local contract/i
const VAGUE_DEBT_REASON = /(?:待收敛|说不清|疑似|ProjectAgentHost|Owner：)/i

test('known projection vocabularies stay in debt with explicit canonical owners', () => {
  const baseline = JSON.parse(fs.readFileSync(repositoryBaselinePath, 'utf8'))
  const registeredSites = new Set(baseline.registered.map((entry) => entry.site))
  const debtBySite = new Map(baseline.debt.map((entry) => [entry.site, entry]))
  const panoramaSite =
    'src/workbench/generationCanvas/nodes/PanoramaViewer.tsx::type:PanoramaCaptureFeedback/property:tone/type-union'
  const previewSite = 'src/workbench/preview/TimelinePreview.tsx::type:PreviewExportStatus/type-union'

  assert.equal(registeredSites.has(panoramaSite), false)
  assert.equal(registeredSites.has(previewSite), false)
  assert.match(debtBySite.get(panoramaSite)?.reason ?? '', /src\/ui\/toast\.tsx::type:ToastType\/type-union/)
  assert.match(
    debtBySite.get(previewSite)?.reason ?? '',
    /src\/workbench\/export\/exportApi\.ts::type:ExportTimelineToMp4Options/,
  )
  assert.equal(baseline.debtCap, baseline.debt.length)
})

test('cross-process exact copies stay debt until a neutral runtime contract exists', () => {
  const baseline = JSON.parse(fs.readFileSync(repositoryBaselinePath, 'utf8'))
  const registeredSites = new Set(baseline.registered.map((entry) => entry.site))
  const debtBySite = new Map(baseline.debt.map((entry) => [entry.site, entry]))
  const crossProcessGroups = [
    [
      'electron/capabilityCore/mcpConfig.ts::type:McpConfigState/type-union',
      'src/desktop/mcpBridgeTypes.ts::type:McpConfigState/type-union',
    ],
    [
      'electron/capabilityCore/mcpVerify.ts::type:McpVerifyReason/type-union',
      'src/desktop/mcpBridgeTypes.ts::type:McpVerifyReason/type-union',
    ],
    [
      'electron/ai/onboarding/vendorHealth.ts::type:VendorHealthState/type-union',
      'electron/preload.ts::property:onboarding/property:vendorHealth/property:state/type-union',
      'src/desktop/onboardingBridgeTypes.ts::type:VendorHealthState/type-union',
    ],
    [
      'electron/browser/core/browserViewTypes.ts::type:BrowserPromptScreenshotSelectionResult/property:reason/type-union',
      'src/desktop/bridge.ts::type:DesktopBrowserPromptScreenshotSelection/property:reason/type-union',
    ],
    [
      'electron/catalog/customCallRunner.ts::type:CustomCallTranscriptEntry/property:status/type-union',
      'src/desktop/modelCatalogBridgeTypes.ts::type:CustomCallTranscriptEntry/property:status/type-union',
    ],
    [
      'electron/catalog/customCallTestRuns.ts::type:CustomCallTestRunState/type-union',
      'src/desktop/modelCatalogBridgeTypes.ts::type:CustomCallTestRunSnapshot/property:state/type-union',
    ],
    [
      'electron/catalog/dreaminaLoginIpc.ts::type:DreaminaLoginPoll/property:status/type-union',
      'src/desktop/bridge.ts::type:DesktopBridge/property:dreamina/property:loginPoll/property:status/type-union',
    ],
    [
      'electron/providerAdapter/types.ts::type:AdapterModeState/type-union',
      'src/desktop/onboardingBridgeTypes.ts::type:DesktopAdapterModeResult/property:state/type-union',
    ],
    [
      'electron/providerAdapter/types.ts::type:AdapterModelMeta/property:state/type-union',
      'src/ui/onboarding/ModelChipGroups.tsx::type:ChipModel/property:adapterState/type-union',
      'src/ui/onboarding/modelSettingsCatalogProjection.ts::variable:ADAPTER_STATES/set',
    ],
    [
      'electron/workspace/workspaceRepository.ts::type:WorkspaceProjectDiagnosticStatus/type-union',
      'src/desktop/bridge.ts::type:DesktopBridge/property:projects/property:diagnose/property:status/type-union',
    ],
    [
      'electron/catalog/codexCli.ts::type:CodexImageJobStatus/type-union',
      'electron/runtime.ts::type:TaskResult/property:status/type-union',
      'electron/tasks/responseParsing.ts::function:resolveTaskStatus/as-const',
      'electron/tasks/responseParsing.ts::type:TaskStatus/type-union',
      'src/workbench/api/taskApi.ts::type:TaskStatus/type-union',
    ],
  ]

  for (const group of crossProcessGroups) {
    for (const site of group) {
      const reason = debtBySite.get(site)?.reason ?? ''
      assert.equal(registeredSites.has(site), false, site)
      assert.match(reason, /neutral shared contract/i, site)
      assert.match(reason, /as const tuple/i, site)
      assert.match(reason, /runtime schema/i, site)
      assert.match(reason, /main.*preload.*renderer/i, site)
    }
  }
  assert.equal(
    registeredSites.has('electron/shared/providerAdapterContract.ts::variable:ADAPTER_RUN_STAGES/as-const'),
    true,
    'Provider Adapter run stages have converged on the neutral shared contract',
  )
})

test('repository exact-set owners are upstream and every local projection stays in debt', () => {
  const baseline = JSON.parse(fs.readFileSync(repositoryBaselinePath, 'utf8'))
  const registeredBySite = new Map(baseline.registered.map((entry) => [entry.site, entry]))
  const debtBySite = new Map(baseline.debt.map((entry) => [entry.site, entry]))
  const contextStore =
    'electron/harness/context/contextStore.ts::interface:StoredAgentContext/property:state/type-union'
  const contextService =
    'electron/harness/context/contextService.ts::interface:AgentContextInfo/property:state/type-union'
  const cardCanonical =
    'src/ui/onboarding/FoldableModelCard.tsx::type:FoldableModelCardProps/property:status/type-union'
  const cardProjections = [
    'src/ui/onboarding/assistantActivationState.ts::function:resolveAssistantActivationState/property:headerStatus/type-union',
    'src/ui/onboarding/ComfyuiLocalCard.tsx::function:ComfyuiLocalCard/variable:cardStatus/type-union',
    'src/ui/onboarding/DreaminaMemberCard.tsx::function:DreaminaMemberCard/variable:cardStatus/type-union',
  ]
  const reconcileProjections = [
    'electron/capabilityCore/mcpGenerationTools.ts::type:GenerationPlanningHandlerDependencies/property:reconcile/parameter:outcome/type-union',
    'src/workbench/production/useProductionStatus.ts::function:useProductionStatus/variable:onPrimaryAction/variable:outcome/type-union',
  ]
  const generationSchema =
    'src/workbench/generationCanvas/model/generationCanvasSchema.ts::variable:generationNodeStatusSchema/z.enum'
  const generationType =
    'src/workbench/generationCanvas/model/generationCanvasTypes.ts::type:GenerationNodeStatus/type-union'

  assert.match(registeredBySite.get(contextStore)?.reason ?? '', /contextService.*(?:导入|import).*contextStore/i)
  assert.match(debtBySite.get(contextService)?.reason ?? '', /StoredAgentContext.*(?:投影|projection)/i)
  assert.match(registeredBySite.get(cardCanonical)?.reason ?? '', /Assistant.*ComfyUI.*Dreamina/i)
  for (const site of cardProjections) {
    assert.equal(registeredBySite.has(site), false, site)
    assert.match(
      debtBySite.get(site)?.reason ?? '',
      /Exclude<Parameters<typeof FoldableModelCard>\[0\]\['status'\], 'error'>/,
      site,
    )
  }
  for (const site of reconcileProjections) {
    assert.equal(registeredBySite.has(site), false, site)
    const reason = debtBySite.get(site)?.reason ?? ''
    assert.match(reason, /ProductionRun\/shared.*GenerationReconcileOutcome/i, site)
    assert.match(reason, /as const tuple.*runtime schema.*JSON Schema.*callback.*IPC validation.*UI/i, site)
  }
  assert.match(registeredBySite.get(generationSchema)?.reason ?? '', /运行时校验.*z\.infer/i)
  assert.match(debtBySite.get(generationType)?.reason ?? '', /generationNodeStatusSchema.*z\.infer/i)
})

test('repository text-brain reasons preserve metadata readiness without keychain probing', () => {
  const baseline = JSON.parse(fs.readFileSync(repositoryBaselinePath, 'utf8'))
  const registeredBySite = new Map(baseline.registered.map((entry) => [entry.site, entry]))
  const debtBySite = new Map(baseline.debt.map((entry) => [entry.site, entry]))
  const readiness =
    'src/desktop/bridge.ts::type:DesktopBridge/property:promptLibrary/property:textBrain/property:status/type-union'
  const stalePreload = 'electron/preload.ts::property:promptLibrary/property:textBrain/property:status/type-union'

  assert.match(registeredBySite.get(readiness)?.reason ?? '', /metadata readiness.*(?:零解密|不解密)/i)
  assert.match(debtBySite.get(stalePreload)?.reason ?? '', /旧投影.*execution.*locked/i)
  assert.doesNotMatch(debtBySite.get(stalePreload)?.reason ?? '', /应.*复用.*ApiKeyDecryptStatus/i)
})

test('repository credential and catalog health vocabularies preserve fail-closed migration states', () => {
  const baseline = JSON.parse(fs.readFileSync(repositoryBaselinePath, 'utf8'))
  const registeredBySite = new Map(baseline.registered.map((entry) => [entry.site, entry]))
  const credential = registeredBySite.get(
    'electron/shared/contracts/apiKeyStatus.ts::variable:API_KEY_DECRYPT_STATUSES/as-const',
  )
  const health = registeredBySite.get(
    'src/workbench/api/modelCatalogApi.ts::type:ModelCatalogHealthIssueCode/type-union',
  )

  assert.deepEqual(credential?.members, ['locked', 'missing', 'needs_resave', 'ok'])
  assert.match(credential?.reason ?? '', /needs_resave.*legacy plaintext.*不可执行/i)
  assert.deepEqual(health?.members, [
    'catalog_empty',
    'model_mapping_missing',
    'vendor_api_key_locked',
    'vendor_api_key_missing',
    'vendor_api_key_needs_resave',
    'vendor_disabled',
  ])
  assert.match(health?.reason ?? '', /safeStorage.*锁定.*legacy plaintext.*重存/i)
})

test('repository helper subsets and incomplete projections remain debt', () => {
  const baseline = JSON.parse(fs.readFileSync(repositoryBaselinePath, 'utf8'))
  const registeredSites = new Set(baseline.registered.map((entry) => entry.site))
  const debtBySite = new Map(baseline.debt.map((entry) => [entry.site, entry]))
  const adapterSubsets = [
    'electron/providerAdapter/service.ts::class:ProviderAdapterService/method:finishTerminal/parameter:stage/type-union',
    'electron/providerAdapter/service.ts::class:ProviderAdapterService/method:finishWithError/parameter:stage/type-union',
  ]
  const shotSubsets = [
    'src/workbench/production/shotPlaceholderState.ts::variable:DONE_STATUSES/set',
    'src/workbench/production/shotPlaceholderState.ts::variable:FAILED_STATUSES/set',
    'src/workbench/production/shotPlaceholderState.ts::variable:GENERATING_STATUSES/set',
  ]
  const vendorProjection = 'src/ui/onboarding/useVendorHealth.ts::type:VendorConnection/property:state/type-union'
  const incompleteAssetOutcome =
    'src/workbench/generationCanvas/nodes/nodeAssetWrite.ts::type:AddAssetOutcome/property:status/type-union'
  const shotPhase = 'src/workbench/production/shotPlaceholderState.ts::type:ShotPlaceholderPhase/type-union'

  for (const site of adapterSubsets) {
    assert.equal(registeredSites.has(site), false, site)
    assert.match(debtBySite.get(site)?.reason ?? '', /AdapterRunStage.*Extract/i, site)
  }
  for (const site of shotSubsets) {
    assert.equal(registeredSites.has(site), false, site)
    assert.match(debtBySite.get(site)?.reason ?? '', /ProductionJobStatus.*穷尽 mapper.*ShotPlaceholderPhase/i, site)
  }
  assert.equal(registeredSites.has(shotPhase), true)
  assert.equal(debtBySite.has(shotPhase), false)
  assert.match(
    baseline.registered.find((entry) => entry.site === shotPhase)?.reason ?? '',
    /合法.*view model.*ProductionJobStatus.*穷尽 mapper/i,
  )
  assert.equal(registeredSites.has(vendorProjection), false)
  assert.match(debtBySite.get(vendorProjection)?.reason ?? '', /VendorHealthState.*checking/i)
  assert.equal(registeredSites.has(incompleteAssetOutcome), false)
  assert.match(debtBySite.get(incompleteAssetOutcome)?.reason ?? '', /AddAssetStatus.*full/i)
  assert.equal(baseline.debtCap, baseline.debt.length)
})

test('repository-specific runtime and view-model vocabularies are not mislabeled as duplicate debt', () => {
  const baseline = JSON.parse(fs.readFileSync(repositoryBaselinePath, 'utf8'))
  const registeredBySite = new Map(baseline.registered.map((entry) => [entry.site, entry]))
  const debtSites = new Set(baseline.debt.map((entry) => entry.site))
  const legitimateOwners = new Map([
    [
      'electron/capabilityCore/mcpAppWidget.ts::type:NomiDraftShot/property:status/type-union',
      /MCP widget.*view model/i,
    ],
    [
      'electron/capabilityCore/mcpAppWidget.ts::type:NomiDraftState/property:status/type-union',
      /MCP widget.*view model/i,
    ],
    [
      'electron/harness/runtime/runtimePort.ts::interface:RuntimeToolCallRecord/property:status/type-union',
      /runtime port.*tool/i,
    ],
    [
      'electron/harness/runtime/runtimePort.ts::interface:RuntimeTurnResult/property:status/type-union',
      /runtime port.*turn/i,
    ],
    [
      'src/api/desktopAgentsChatStream.ts::type:AgentsChatToolStreamPayload/property:stage/type-union',
      /stream event.*view model/i,
    ],
    [
      'src/workbench/ai/workbenchAiTypes.ts::type:WorkbenchAiMessage/property:status/type-union',
      /assistant message.*view model/i,
    ],
    [
      'src/workbench/generationCanvas/runner/generationQueueStore.ts::type:QueueEntryState/type-union',
      /generation queue.*state machine/i,
    ],
    [
      'src/workbench/taskCenter/taskCenterEntries.ts::function:resolveTaskButtonTone/type-union',
      /TaskCenter.*visual.*view model/i,
    ],
    ['src/workbench/taskCenter/taskCenterProjection.ts::type:TaskCenterGroup/type-union', /TaskCenter.*view model/i],
    ['src/workbench/taskCenter/taskCenterProjection.ts::type:TaskCenterOutcome/type-union', /TaskCenter.*view model/i],
  ])

  for (const [site, boundary] of legitimateOwners) {
    assert.equal(debtSites.has(site), false, site)
    assert.match(registeredBySite.get(site)?.reason ?? '', boundary, site)
  }
})

test('baseline reasons are self-contained and only reference repository documents that exist', () => {
  const baseline = JSON.parse(fs.readFileSync(repositoryBaselinePath, 'utf8'))
  for (const entry of [...baseline.registered, ...baseline.debt]) {
    assert.doesNotMatch(entry.reason, /同上/, entry.site)
    assert.doesNotMatch(entry.reason, VAGUE_REASON_REFERENCE, `${entry.site}: vague document reference`)
    assert.doesNotMatch(entry.reason, GENERIC_AUTHORITY_REASON, `${entry.site}: generic authority template`)
    for (const match of entry.reason.matchAll(/docs\/[A-Za-z0-9_./-]+\.md/g)) {
      assert.equal(fs.existsSync(path.join(repositoryRoot, match[0])), true, `${entry.site}: ${match[0]}`)
    }
  }
  for (const entry of baseline.debt) {
    assert.doesNotMatch(entry.reason, VAGUE_DEBT_REASON, `${entry.site}: vague convergence reason`)
  }
})

test('vague document references are rejected without depending on trailing punctuation', () => {
  const vagueReasons = ['见文档 §', '见设计文档 §2.2，后续删除 warn。', '见方案中的收敛说明']
  for (const reason of vagueReasons) assert.match(reason, VAGUE_REASON_REFERENCE)

  const concretePath = 'docs/engineering-rules.md'
  assert.equal(fs.existsSync(path.join(repositoryRoot, concretePath)), true)
  assert.doesNotMatch(`参见 ${concretePath} §R14.1`, VAGUE_REASON_REFERENCE)
})
