/** 自定义调用编辑器：材料辅助生成，脚本与供应商配置才是持久化内容。 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconCheck, IconCopy, IconPlayerPlay, IconPlayerStop, IconPlus, IconSparkles, IconTrash } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import {
  DesignButton,
  DesignModal,
  DesignTextarea,
  DesignTextInput,
  IconActionButton,
  NomiSelect,
  confirmDialog,
} from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { resolveArchetypeForModel } from '../../config/modelArchetypes'
import { getTextBrain } from '../../workbench/api/promptLibraryApi'
import { runWorkbenchTextTaskStream } from '../../workbench/api/taskApi'
import { stripCodeFences } from './customCallIntent'
import { configPatchFromRows, configRowsFromMaskedEntries, hasCustomConfig, type CustomConfigRow } from './customCallConfig'
import {
  customCallScriptPatch,
  readCustomCallScriptDrafts,
  resolveCustomCallScriptModes,
  updateCustomCallScriptDraft,
  type CustomCallCatalogModel,
  type CustomCallScriptDrafts,
} from './customCallScriptModes'
import { CustomCallScopeSelector } from './CustomCallScopeSelector'
import { customCallPersistedStateSignature } from './customCallEditorDirty'
import { CustomCallContractSidebar } from './CustomCallContractSidebar'
import { ModelSettingsPageSurface } from './ModelSettingsPageSurface'
import { useCustomCallTestRun } from './useCustomCallTestRun'

export type CustomCallTarget = {
  vendorKey: string
  modelKey: string
  label: string
  /** 已存的脚本（无则空串）。 */
  script: string
  /** 直达脚本入口建立的禁用草稿；保存脚本后由 main 启用。 */
  draft?: boolean
}

const inputCls =
  'w-full rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 py-2 text-body-sm text-nomi-ink placeholder:text-nomi-ink-40 outline-none focus:border-nomi-accent'

export function CustomCallEditor({
  target,
  onClose,
  onSaved,
  onContinueCapability,
  presentation = 'modal',
}: {
  target: CustomCallTarget | null
  onClose: () => void
  onSaved: () => void
  onContinueCapability?: () => void
  presentation?: 'modal' | 'page'
}): JSX.Element {
  const { t } = useTranslation()
  const [material, setMaterial] = React.useState('')
  const [scriptDrafts, setScriptDrafts] = React.useState<CustomCallScriptDrafts>({ fallback: '', modes: {} })
  const [selectedModeId, setSelectedModeId] = React.useState<string | null>(null)
  const [aiRunning, setAiRunning] = React.useState(false)
  const [aiError, setAiError] = React.useState('')
  const [saveError, setSaveError] = React.useState('')
  const [configRows, setConfigRows] = React.useState<CustomConfigRow[]>([])
  const [configOpen, setConfigOpen] = React.useState(false)
  const [initialPersistedState, setInitialPersistedState] = React.useState({ targetKey: '', signature: '' })
  const [briefCopied, setBriefCopied] = React.useState(false)
  const abortRef = React.useRef<AbortController | null>(null)
  const testResultRef = React.useRef<HTMLDivElement>(null)

  const bridge = getDesktopBridge()
  const targetKey = target ? `${target.vendorKey}\0${target.modelKey}` : ''
  const [catalogModel, setCatalogModel] = React.useState<CustomCallCatalogModel | null>(null)
  React.useEffect(() => {
    let alive = true
    if (!target || !bridge) {
      setCatalogModel(null)
      return () => { alive = false }
    }
    void bridge.modelCatalog.listModels({ vendorKey: target.vendorKey })
      .then((models) => {
        if (!alive) return
        const rows = models as CustomCallCatalogModel[]
        setCatalogModel(rows.find((model) => model.vendorKey === target.vendorKey && model.modelKey === target.modelKey) ?? null)
      })
      .catch(() => { if (alive) setCatalogModel(null) })
    return () => { alive = false }
  }, [bridge, targetKey, target])
  const scriptModes = React.useMemo(
    () => resolveCustomCallScriptModes(catalogModel, !target?.draft),
    [catalogModel, target?.draft],
  )
  const selectedMode = selectedModeId
    ? scriptModes.find((mode) => mode.id === selectedModeId) ?? null
    : null
  const script = selectedModeId ? scriptDrafts.modes[selectedModeId] ?? '' : scriptDrafts.fallback
  const { test, runTest, cancelTest } = useCustomCallTestRun({ target, script, selectedMode })
  const selectedScopeLabel = selectedMode?.label ?? t('onboardingProviders.customCall.scopeFallback')
  const savedScripts = React.useMemo(
    () => readCustomCallScriptDrafts(catalogModel, target?.script ?? ''),
    [catalogModel, target?.script],
  )
  const hasSavedScript = Boolean(
    (selectedModeId ? savedScripts.modes[selectedModeId] : savedScripts.fallback)?.trim(),
  )
  const savedScriptForSelectedScope = selectedModeId
    ? savedScripts.modes[selectedModeId] ?? ''
    : savedScripts.fallback
  const testPassed = test.phase === 'done' && test.ok
  const testOutcome = test.phase === 'done' ? test.ok : null
  const requiresCapabilitySetup = Boolean(
    catalogModel &&
    catalogModel.kind !== 'text' &&
    !resolveArchetypeForModel(catalogModel),
  )

  const setScriptForMode = React.useCallback((modeId: string | null, value: string) => {
    setScriptDrafts((drafts) => updateCustomCallScriptDraft(drafts, modeId, value))
  }, [])

  const selectMode = React.useCallback(async (modeId: string | null) => {
    if (modeId === selectedModeId) return
    if (script !== savedScriptForSelectedScope) {
      const discard = await confirmDialog({
        title: t('onboardingProviders.customCall.scopeDiscardTitle'),
        message: t('onboardingProviders.customCall.scopeDiscardMessage', { scope: selectedScopeLabel }),
        confirmLabel: t('onboardingProviders.customCall.scopeDiscardConfirm'),
        danger: true,
      })
      if (!discard) return
      setScriptForMode(selectedModeId, savedScriptForSelectedScope)
    }
    abortRef.current?.abort()
    setSelectedModeId(modeId)
    setAiError('')
    setSaveError('')
    setBriefCopied(false)
  }, [savedScriptForSelectedScope, script, selectedModeId, selectedScopeLabel, setScriptForMode, t])

  // 打开时装载既有脚本 + 该供应商已存的自定义配置；关闭清态。
  React.useEffect(() => {
    let alive = true
    if (target) {
      const nextScripts = readCustomCallScriptDrafts(catalogModel, target.script)
      setScriptDrafts(nextScripts)
      setSelectedModeId(null)
      setMaterial('')
      setAiError('')
      setSaveError('')
      setBriefCopied(false)
      const request = getDesktopBridge()?.modelCatalog.customCallConfigGet?.(target.vendorKey)
      void Promise.resolve(request).then((maskedConfig) => {
        if (!alive) return
        const nextConfigRows = configRowsFromMaskedEntries(maskedConfig ?? [])
        setConfigRows(nextConfigRows)
        setConfigOpen(hasCustomConfig(nextConfigRows))
        setInitialPersistedState({ targetKey, signature: customCallPersistedStateSignature(nextScripts, nextConfigRows) })
      })
    }
    return () => { alive = false; abortRef.current?.abort() }
  // targetKey avoids resetting typed drafts when the page parent refreshes the same target object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey])

  const contract = React.useMemo(() => {
    try {
      return bridge?.modelCatalog.customCallContract?.() ?? null
    } catch {
      return null
    }
  }, [bridge])

  const runAi = React.useCallback(
    async (repair?: { lastError: string }) => {
      if (!target || !bridge) return
      if (aiRunning) {
        abortRef.current?.abort()
        return
      }
      setAiError('')
      setAiRunning(true)
      const ctrl = new AbortController()
      const editingModeId = selectedModeId
      abortRef.current = ctrl
      try {
        const brain = await getTextBrain()
        if (!brain) {
          setAiError(t('onboardingProviders.customCall.aiNeedTextModel'))
          return
        }
        const instruction = bridge.modelCatalog.customCallAiInstruction?.({
          vendorKey: target.vendorKey,
          modelKey: target.modelKey,
          material: material.trim(),
          ...(repair ? { currentScript: script, lastError: repair.lastError } : {}),
          ...(selectedMode ? { taskKind: selectedMode.taskKind, modeId: selectedMode.id } : {}),
        })
        if (!instruction) return
        let acc = ''
        await runWorkbenchTextTaskStream(
          brain.vendor,
          { kind: 'prompt_refine', prompt: instruction, extras: { modelKey: brain.modelKey } },
          {
            signal: ctrl.signal,
            onDelta: (delta) => {
              acc += delta
              setScriptForMode(editingModeId, stripCodeFences(acc))
            },
          },
        )
        const final = stripCodeFences(acc)
        if (final) setScriptForMode(editingModeId, final)
        else setAiError(t('onboardingProviders.customCall.aiEmpty'))
      } catch (e) {
        if (ctrl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
        setAiError(e instanceof Error ? e.message : String(e))
      } finally {
        setAiRunning(false)
        abortRef.current = null
      }
    },
    [target, bridge, aiRunning, material, script, selectedMode, selectedModeId, setScriptForMode, t],
  )

  const persistVendorConfig = React.useCallback(() => {
    if (!target || !bridge?.modelCatalog.customCallConfigSave) {
      throw new Error(t('onboardingProviders.customCall.directDraft.unavailable'))
    }
    const masked = bridge.modelCatalog.customCallConfigSave(target.vendorKey, {
      entries: configPatchFromRows(configRows),
    })
    setConfigRows(configRowsFromMaskedEntries(masked))
  }, [target, bridge, configRows, t])

  const saveTestedScript = React.useCallback(() => {
    if (!target || !bridge || !testPassed) return
    setSaveError('')
    try {
      const trimmed = script.trim()
      if (!trimmed) throw new Error(t('onboardingProviders.customCall.directDraft.scriptRequired'))
      persistVendorConfig()
      if (target.draft) {
        const result = bridge.modelCatalog.customCallDraftFinalize?.({
          vendorKey: target.vendorKey,
          modelKey: target.modelKey,
          script: trimmed,
        })
        if (!result) throw new Error(t('onboardingProviders.customCall.directDraft.unavailable'))
        if (!result.ok) throw new Error(result.error)
      } else {
        bridge.modelCatalog.upsertModel({
          vendorKey: target.vendorKey,
          modelKey: target.modelKey,
          ...(requiresCapabilitySetup ? { enabled: false } : {}),
          customCall: customCallScriptPatch(selectedModeId, trimmed),
        })
      }
      onSaved()
      if (requiresCapabilitySetup && onContinueCapability) onContinueCapability()
      else onClose()
    } catch (e) {
      setSaveError(
        t('onboardingProviders.customCall.saveFailed', { message: e instanceof Error ? e.message : String(e) }),
      )
    }
  }, [target, bridge, testPassed, script, persistVendorConfig, requiresCapabilitySetup, selectedModeId, onSaved, onContinueCapability, onClose, t])

  const saveDraft = React.useCallback(() => {
    if (!target?.draft || !bridge) return
    setSaveError('')
    try {
      const trimmed = script.trim()
      if (!trimmed) throw new Error(t('onboardingProviders.customCall.directDraft.scriptRequired'))
      persistVendorConfig()
      bridge.modelCatalog.upsertModel({
        vendorKey: target.vendorKey,
        modelKey: target.modelKey,
        enabled: false,
        customCall: customCallScriptPatch(selectedModeId, trimmed),
      })
      onSaved()
      onClose()
    } catch (e) {
      setSaveError(t('onboardingProviders.customCall.saveFailed', {
        message: e instanceof Error ? e.message : String(e),
      }))
    }
  }, [target, bridge, script, persistVendorConfig, selectedModeId, onSaved, onClose, t])

  const removeScript = React.useCallback(async () => {
    if (!target || !bridge) return
    const ok = await confirmDialog({
      title: t('onboardingProviders.customCall.removeConfirmTitle'),
      message: t('onboardingProviders.customCall.removeScopeConfirmMessage', {
        name: target.label,
        scope: selectedScopeLabel,
      }),
      confirmLabel: t('onboardingProviders.customCall.removeScope', { scope: selectedScopeLabel }),
      danger: true,
    })
    if (!ok) return
    try {
      bridge.modelCatalog.upsertModel({
        vendorKey: target.vendorKey,
        modelKey: target.modelKey,
        customCall: customCallScriptPatch(selectedModeId, ''),
      })
      onSaved()
      onClose()
    } catch (e) {
      setSaveError(
        t('onboardingProviders.customCall.saveFailed', { message: e instanceof Error ? e.message : String(e) }),
      )
    }
  }, [target, bridge, selectedModeId, selectedScopeLabel, onSaved, onClose, t])

  // 内建 AI 与复制给外部助手共用同一份题面，避免变量契约漂移。
  const copyBrief = React.useCallback(async () => {
    if (!target || !bridge) return
    const lastError = test.phase === 'done' && !test.ok
      ? [test.errorMessage, ...test.transcript.map((e) => e.errorMessage)].filter(Boolean).join('\n')
      : ''
    const instruction = bridge.modelCatalog.customCallAiInstruction?.({
      vendorKey: target.vendorKey,
      modelKey: target.modelKey,
      material: material.trim(),
      ...(script.trim() ? { currentScript: script } : {}),
      ...(lastError ? { lastError } : {}),
      ...(selectedMode ? { taskKind: selectedMode.taskKind, modeId: selectedMode.id } : {}),
    })
    if (!instruction) return
    try {
      await navigator.clipboard.writeText(String(instruction))
      setBriefCopied(true)
    } catch {
      setSaveError(t('onboardingProviders.customCall.saveFailed', { message: 'clipboard' }))
    }
  }, [target, bridge, material, script, selectedMode, test, t])

  const insertTemplate = React.useCallback(
    (id: string) => {
      const tpl = contract?.templates.find((item) => item.id === id)
      if (tpl) setScriptForMode(selectedModeId, tpl.script)
    },
    [contract, selectedModeId, setScriptForMode],
  )

  const variables = contract?.variables ?? []
  const varNames = variables.map((variable) => variable.name)
  const returnContract = t('onboardingProviders.customCall.returnContract', {
    defaultValue: contract?.returnContract ?? '',
  })
  const testBusy = test.phase === 'running' || test.phase === 'cancelling'
  const dirty = Boolean(target && initialPersistedState.targetKey === targetKey && customCallPersistedStateSignature(scriptDrafts, configRows) !== initialPersistedState.signature)
  const runOrCancelTest = React.useCallback(async () => {
    if (testBusy) {
      await cancelTest()
      return
    }
    try {
      persistVendorConfig()
      await runTest()
    } catch (error) {
      setSaveError(t('onboardingProviders.customCall.saveFailed', {
        message: error instanceof Error ? error.message : String(error),
      }))
    }
  }, [testBusy, cancelTest, persistVendorConfig, runTest, t])
  React.useEffect(() => {
    if (test.phase !== 'done') return
    window.requestAnimationFrame(() => testResultRef.current?.scrollIntoView({ block: 'nearest' }))
  }, [test.phase, testOutcome])

  const requestClose = React.useCallback(async (): Promise<void> => {
    if (!dirty) {
      onClose()
      return
    }
    const discard = await confirmDialog({
      title: t('settings.unsaved.title'),
      message: t('settings.unsaved.message'),
      confirmLabel: t('settings.unsaved.discard'),
      danger: true,
    })
    if (discard) onClose()
  }, [dirty, onClose, t])
  const title = (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 whitespace-nowrap text-body font-semibold text-nomi-ink">{t('onboardingProviders.customCall.title')}</span>
      <span className="min-w-0 truncate text-caption text-nomi-ink-60">{target?.label}</span>
    </span>
  )

  const actionBar = target ? (
    <div className="flex min-h-9 flex-wrap items-center gap-2">
      {!target.draft && hasSavedScript ? (
        <DesignButton
          variant="subtle"
          className="text-workbench-danger"
          onClick={() => void removeScript()}
          leftSection={<IconTrash size={14} stroke={1.8} aria-hidden="true" />}
        >
          {t('onboardingProviders.customCall.removeScope', { scope: selectedScopeLabel })}
        </DesignButton>
      ) : null}
      {target.draft && !testPassed && !testBusy ? (
        <DesignButton variant="light" onClick={saveDraft}>
          {t('onboardingProviders.customCall.saveDraft')}
        </DesignButton>
      ) : null}
      <DesignButton variant="subtle" onClick={() => { void requestClose() }}>
        {t('common.cancel')}
      </DesignButton>
      <span className="min-w-0 flex-1" />
      {saveError ? <span className="basis-full text-caption text-workbench-danger sm:basis-auto">{saveError}</span> : null}
      {test.phase === 'done' ? (
        <span
          role="status"
          className={cn('text-caption font-medium', test.ok ? 'text-workbench-success' : 'text-workbench-danger')}
        >
          {t(test.ok
            ? 'onboardingProviders.customCall.footerTestSuccess'
            : 'onboardingProviders.customCall.footerTestFailed')}
        </span>
      ) : null}
      {testPassed ? (
        <DesignButton
          variant="filled"
          onClick={saveTestedScript}
          leftSection={<IconCheck size={14} stroke={2} aria-hidden="true" />}
          className="h-9"
        >
          {requiresCapabilitySetup
            ? t('onboardingProviders.customCall.saveAndContinueCapability')
            : target.draft
              ? t('onboardingProviders.customCall.saveAndEnable')
              : t('onboardingProviders.customCall.saveScope', { scope: selectedScopeLabel })}
        </DesignButton>
      ) : (
        <span title={!script.trim() ? t('onboardingProviders.customCall.testNeedsScript') : undefined}>
          <DesignButton
            variant="filled"
            disabled={test.phase === 'cancelling' || (!testBusy && !script.trim())}
            onClick={() => { void runOrCancelTest() }}
            leftSection={testBusy
              ? <IconPlayerStop size={14} stroke={1.8} aria-hidden="true" />
              : <IconPlayerPlay size={14} stroke={1.8} aria-hidden="true" />}
            className={cn('h-9', testBusy && 'bg-workbench-danger hover:bg-workbench-danger')}
          >
            {test.phase === 'cancelling'
              ? t('onboardingProviders.customCall.testStopping')
              : test.phase === 'running'
                ? t('onboardingProviders.customCall.testStop')
                : t('onboardingProviders.customCall.testRun')}
          </DesignButton>
        </span>
      )}
    </div>
  ) : null

  const content = target ? (
        <div data-settings-unsaved={dirty ? 'true' : undefined} className={cn('flex w-full flex-col gap-3', presentation === 'page' && 'min-h-0 flex-1')}>
          <div className="text-caption text-nomi-ink-60 -mt-1">
            {t(target.draft ? 'onboardingProviders.customCall.draftSubtitle' : 'onboardingProviders.customCall.subtitle')}
          </div>

          <CustomCallScopeSelector
            modes={scriptModes}
            selectedModeId={selectedModeId}
            savedScripts={savedScripts}
            onSelect={(modeId) => { void selectMode(modeId) }}
          />

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body-sm font-semibold text-nomi-ink">
                {t('onboardingProviders.customCall.scriptLabel')}
              </span>
              {scriptModes.length > 0 ? (
                <span className="text-micro text-nomi-ink-40">
                  {t('onboardingProviders.customCall.currentScope', { scope: selectedScopeLabel })}
                </span>
              ) : null}
              <span className="min-w-0 flex-1" />
              <NomiSelect
                value=""
                options={(contract?.templates ?? []).map((tpl) => ({
                  value: tpl.id,
                  label: t(`onboardingProviders.customCall.template.${tpl.id}` as 'onboardingProviders.customCall.template.openaiImage'),
                }))}
                onChange={insertTemplate}
                ariaLabel={t('onboardingProviders.customCall.templatesMenu')}
                placeholder={t('onboardingProviders.customCall.templatesMenu')}
                size="xs"
              />
            </div>
            <textarea
              rows={presentation === 'page' ? 12 : 10}
              spellCheck={false}
              className={cn(
                inputCls,
                'resize-y font-nomi-mono text-caption leading-relaxed',
                presentation === 'page' ? 'min-h-[240px] w-full sm:min-h-[300px] sm:flex-1' : '',
              )}
              placeholder={t('onboardingProviders.customCall.scriptPlaceholder')}
              aria-label={t('onboardingProviders.customCall.scriptAriaScope', {
                name: target.label,
                scope: selectedScopeLabel,
              })}
              value={script}
              onChange={(e) => setScriptForMode(selectedModeId, e.currentTarget.value)}
            />
            {presentation !== 'page' ? (
              <details className="text-caption text-nomi-ink-60">
                <summary className="cursor-pointer select-none text-micro text-nomi-ink-40">
                  {t('onboardingProviders.customCall.varsLabel')}：{varNames.join(' · ')}
                </summary>
                <ul className="mt-1.5 flex flex-col gap-1 pl-1">
                  {varNames.map((name) => (
                    <li key={name} className="leading-snug">
                      <code className="rounded-nomi-sm bg-nomi-ink-05 px-1 py-[1px] font-nomi-mono text-micro text-nomi-ink-80">
                        {name}
                      </code>{' '}
                      {t(`onboardingProviders.customCall.vars.${name}` as 'onboardingProviders.customCall.vars.prompt')}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            {testBusy ? (
              <span role="status" className="text-micro leading-relaxed text-nomi-ink-40">
                {t('onboardingProviders.customCall.testRunningHint')}
              </span>
            ) : null}
            {test.phase === 'done' ? (
              <div
                ref={testResultRef}
                className={cn(
                  'flex flex-col gap-2 rounded-nomi-sm border p-2.5',
                  test.ok
                    ? 'border-[var(--workbench-success-soft)] bg-workbench-success-soft'
                    : 'border-[var(--workbench-danger-soft)] bg-[color-mix(in_srgb,var(--workbench-danger)_6%,var(--nomi-paper))]',
                )}
              >
                <div
                  className={cn(
                    'flex items-center gap-1.5 text-body-sm font-semibold',
                    test.ok ? 'text-workbench-success' : 'text-workbench-danger',
                  )}
                >
                  {test.ok ? <IconCheck size={16} stroke={2} /> : <IconAlertTriangle size={16} stroke={1.8} />}
                  {test.ok
                    ? test.text !== undefined
                      ? t('onboardingProviders.customCall.testTextOk', { seconds: (test.durationMs / 1000).toFixed(1) })
                      : t('onboardingProviders.customCall.testOk', {
                          count: test.assets.length,
                          seconds: (test.durationMs / 1000).toFixed(1),
                        })
                    : t('onboardingProviders.customCall.testFailed')}
                </div>
                {test.ok && test.text !== undefined ? (
                  <div className="select-text whitespace-pre-wrap break-words rounded-nomi-sm bg-nomi-ink-05 p-2 font-nomi-mono text-micro text-nomi-ink-80">
                    {test.text}
                  </div>
                ) : null}
                {!test.ok && test.errorMessage ? (
                  <div className="select-text break-words rounded-nomi-sm bg-nomi-ink-05 p-2 font-nomi-mono text-micro text-nomi-ink-80">
                    {test.errorMessage}
                  </div>
                ) : null}
                {test.ok && test.assets.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {test.assets.slice(0, 4).map((asset, i) =>
                      /^data:image|\.(png|jpe?g|webp)(\?|$)/i.test(asset) || asset.startsWith('data:image') ? (
                        <img
                          key={i}
                          src={asset}
                          alt=""
                          className="h-16 w-16 rounded-nomi-sm border border-nomi-line object-cover"
                        />
                      ) : (
                        <span
                          key={i}
                          className="max-w-full truncate rounded-nomi-sm bg-nomi-ink-05 px-2 py-1 font-nomi-mono text-micro text-nomi-ink-60"
                        >
                          {asset}
                        </span>
                      ),
                    )}
                  </div>
                ) : null}
                {test.transcript.length === 0 ? (
                  <div className="text-micro text-nomi-ink-40">{t('onboardingProviders.customCall.transcriptEmpty')}</div>
                ) : (
                  test.transcript.map((entry, i) => (
                    <details key={i} className="text-caption text-nomi-ink-80">
                      <summary className="cursor-pointer select-none truncate text-micro text-nomi-ink-60">
                        {t('onboardingProviders.customCall.transcriptRequest', {
                          index: i + 1,
                          method: entry.method,
                          url: entry.url,
                        })}
                        {entry.status === 'error' ? ' ✗' : ''}
                      </summary>
                      <div className="mt-1 flex flex-col gap-1">
                        {entry.requestPreview ? (
                          <div className="select-text break-all rounded-nomi-sm bg-nomi-ink-05 p-1.5 font-nomi-mono text-micro">
                            <span className="text-nomi-ink-40">{t('onboardingProviders.customCall.transcriptRequestBody')}：</span>
                            {entry.requestPreview}
                          </div>
                        ) : null}
                        {entry.responsePreview ? (
                          <div className="select-text break-all rounded-nomi-sm bg-nomi-ink-05 p-1.5 font-nomi-mono text-micro">
                            <span className="text-nomi-ink-40">{t('onboardingProviders.customCall.transcriptResponse')}：</span>
                            {entry.responsePreview}
                          </div>
                        ) : null}
                        {entry.errorMessage ? (
                          <div className="select-text break-all rounded-nomi-sm bg-nomi-ink-05 p-1.5 font-nomi-mono text-micro text-workbench-danger">
                            <span className="text-nomi-ink-40">{t('onboardingProviders.customCall.transcriptError')}：</span>
                            {entry.errorMessage}
                          </div>
                        ) : null}
                      </div>
                    </details>
                  ))
                )}
                {!test.ok ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <DesignButton
                      variant="filled"
                      onClick={() => void runAi({ lastError: [test.errorMessage, ...test.transcript.map((e) => e.errorMessage)].filter(Boolean).join('\n') })}
                      leftSection={<IconSparkles size={14} stroke={1.8} aria-hidden="true" />}
                    >
                      {t('onboardingProviders.customCall.aiRepair')}
                    </DesignButton>
                    {/*
                      「复制题面」是内建 AI 改不动之后的下一步，不是与它并列的第二个入口
                      （设计系统 §1.5 一功能一个家）。所以：只在失败块里出现、排在 aiRepair 之后、
                      前面加一句引导词把先后关系说出来。
                    */}
                    <span className="text-micro text-nomi-ink-40">{t('onboardingProviders.customCall.copyBriefLead')}</span>
                    <DesignButton
                      variant="light"
                      onClick={() => void copyBrief()}
                      leftSection={<IconCopy size={14} stroke={1.8} aria-hidden="true" />}
                    >
                      {briefCopied
                        ? t('onboardingProviders.customCall.copyBriefDone')
                        : t('onboardingProviders.customCall.copyBrief')}
                    </DesignButton>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <details className="border-t border-nomi-line-soft pt-3">
            <summary className="cursor-pointer select-none text-caption font-semibold text-nomi-ink-60 hover:text-nomi-ink">
              {t('onboardingProviders.customCall.aiHelpTitle')}
              <span className="ml-1.5 font-normal text-nomi-ink-40">{t('onboardingProviders.customCall.aiHelpHint')}</span>
            </summary>
            <div className="mt-2 flex flex-col gap-1.5">
              <DesignTextarea
                rows={3}
                autosize={false}
                className="font-nomi-mono text-caption leading-relaxed"
                placeholder={t('onboardingProviders.customCall.materialPlaceholder')}
                aria-label={t('onboardingProviders.customCall.materialLabel')}
                value={material}
                onChange={(e) => setMaterial(e.currentTarget.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <DesignButton
                  variant={aiRunning ? 'light' : 'filled'}
                  onClick={() => void runAi()}
                  leftSection={<IconSparkles size={14} stroke={1.8} aria-hidden="true" />}
                >
                  {aiRunning ? t('onboardingProviders.customCall.aiStop') : t('onboardingProviders.customCall.aiGenerate')}
                </DesignButton>
                {aiError ? <span className="min-w-0 flex-1 text-caption text-workbench-danger">{aiError}</span> : null}
              </div>
            </div>
          </details>

          {/* 自定义配置仅在已有内容时默认展开。 */}
          <details
            open={configOpen}
            onToggle={(event) => setConfigOpen(event.currentTarget.open)}
            className="flex flex-col gap-1.5"
          >
            <summary className="cursor-pointer select-none text-body-sm font-semibold text-nomi-ink">
              {hasCustomConfig(configRows)
                ? t('onboardingProviders.customCall.configLabelFilled', { count: configRows.filter((r) => r.name.trim()).length })
                : t('onboardingProviders.customCall.configLabel')}
            </summary>
            <div className="mt-1.5 flex flex-col gap-1.5">
              <div className="text-caption leading-relaxed text-nomi-ink-60">
                {t('onboardingProviders.customCall.configHint')}
                <span className="ml-1 text-nomi-ink-40">{t('onboardingProviders.customCall.configScope')}</span>
              </div>
              {configRows.map((row, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <DesignTextInput
                    className="min-w-0 flex-1"
                    classNames={{ input: 'font-nomi-mono text-caption' }}
                    placeholder={t('onboardingProviders.customCall.configNamePlaceholder')}
                    aria-label={t('onboardingProviders.customCall.configNameAria')}
                    value={row.name}
                    onChange={(e) => {
                      const name = e.currentTarget.value
                      setConfigRows((rows) => rows.map((r, i) => (i === index ? { ...r, name } : r)))
                    }}
                  />
                  <DesignTextInput
                    type="password"
                    className="min-w-0 flex-[1.3]"
                    classNames={{ input: 'font-nomi-mono text-caption' }}
                    placeholder={row.storedName && !row.valueChanged ? '••••••' : t('onboardingProviders.customCall.configValuePlaceholder')}
                    aria-label={t('onboardingProviders.customCall.configValueAria', { name: row.name })}
                    value={row.value}
                    onChange={(e) => {
                      const value = e.currentTarget.value
                      setConfigRows((rows) => rows.map((r, i) => (i === index ? { ...r, value, valueChanged: true } : r)))
                    }}
                  />
                  <IconActionButton
                    aria-label={t('onboardingProviders.customCall.configRemoveAria', { name: row.name })}
                    title={t('onboardingProviders.customCall.configRemoveAria', { name: row.name })}
                    onClick={() => setConfigRows((rows) => rows.filter((_, i) => i !== index))}
                    className="size-11 shrink-0 text-nomi-ink-30 hover:text-workbench-danger sm:size-8"
                    icon={<IconTrash size={14} stroke={1.8} aria-hidden="true" />}
                  />
                </div>
              ))}
              <DesignButton
                variant="light"
                onClick={() => setConfigRows((rows) => [...rows, { name: '', value: '', valueChanged: true }])}
                leftSection={<IconPlus size={12} stroke={1.8} aria-hidden="true" />}
                className="self-start"
              >
                {t('onboardingProviders.customCall.configAdd')}
              </DesignButton>
            </div>
          </details>

          <details className="text-micro leading-relaxed text-nomi-ink-40">
            <summary className="cursor-pointer select-none">{t('onboardingProviders.customCall.safetyTitle')}</summary>
            <p className="mt-1.5">
              {t('onboardingProviders.customCall.honestNote')}
              <span className="ml-1 text-[color:var(--nomi-warning)]">{t('onboardingProviders.customCall.limitNote')}</span>
            </p>
          </details>
          {presentation !== 'page' ? <div className="border-t border-nomi-line pt-3">{actionBar}</div> : null}
        </div>
  ) : (
    <span />
  )

  if (presentation === 'page') {
    return (
      <ModelSettingsPageSurface
        page="script"
        title={title}
        backLabel={t('common.back')}
        onBack={() => { void requestClose() }}
        contentClassName="workbench-shell"
        footer={actionBar}
      >
        <div className="grid min-h-0 w-full grid-cols-1 gap-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
          <CustomCallContractSidebar returnContract={returnContract} variables={variables} />
          <div data-custom-call-editor-main className="flex min-h-0 min-w-0 flex-col">
            {content}
          </div>
        </div>
      </ModelSettingsPageSurface>
    )
  }

  return (
    <DesignModal
      opened={target !== null}
      onClose={() => { void requestClose() }}
      centered
      size={640}
      title={title}
      classNames={{ content: 'workbench-shell' }}
      closeButtonProps={{ 'aria-label': t('onboardingProviders.customCall.closeAria') }}
    >
      {content}
    </DesignModal>
  )
}
