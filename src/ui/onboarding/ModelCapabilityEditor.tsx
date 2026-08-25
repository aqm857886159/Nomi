import React from 'react'
import { IconChevronRight, IconDeviceFloppy, IconPlus, IconRefresh } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import {
  parseCustomCapabilityContract,
  replaceCustomCapabilityContractMeta,
  resolveArchetypeForModel,
} from '../../config/modelArchetypes'
import { getDesktopBridge } from '../../desktop/bridge'
import { confirmDialog, DesignButton } from '../../design'
import type { ChipModel } from './ModelChipGroups'
import { ModelSettingsPageHeader } from './ModelSettingsWorkspacePages'
import { CapabilityModeEditor } from './CapabilityModeEditor'
import {
  createCapabilityContractDraft,
  CAPABILITY_EDITOR_LIMITS,
  createCapabilityModeDraft,
  replaceCapabilityModeDraft,
  validateCapabilityContractDraft,
  type CapabilityContractDraft,
  type CapabilityDraftErrorCode,
} from './capabilityContractDraft'

function serializedDraft(draft: CapabilityContractDraft | null): string {
  return JSON.stringify(draft)
}

async function currentModelMeta(model: ChipModel): Promise<{ found: true; meta: unknown } | { found: false }> {
  const bridge = getDesktopBridge()
  if (!bridge) return { found: false }
  const latest = (await bridge.modelCatalog.listModels({ vendorKey: model.vendorKey }) as Array<Record<string, unknown>>)
    .find((candidate) => String(candidate.modelKey) === model.modelKey)
  return latest ? { found: true, meta: latest.meta } : { found: false }
}

export function ModelCapabilityEditor({
  model,
  vendorName,
  onBack,
  onSaved,
  enableAfterSave = false,
}: {
  model?: ChipModel
  vendorName: string
  onBack: () => void
  onSaved: () => void
  enableAfterSave?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const customContract = React.useMemo(() => parseCustomCapabilityContract(model?.meta), [model?.meta])
  const archetype = React.useMemo(() => model ? resolveArchetypeForModel({
    modelKey: model.modelKey,
    vendorKey: model.vendorKey,
    meta: model.meta,
  }) : null, [model])
  const makeDraft = React.useCallback(() => model ? createCapabilityContractDraft({
    modelKind: model.kind,
    customContract,
    archetype,
    defaultModeLabel: t('onboardingProviders.workspace.capability.editor.initialModeName'),
  }) : null, [archetype, customContract, model, t])
  const [draft, setDraft] = React.useState<CapabilityContractDraft | null>(makeDraft)
  const [errors, setErrors] = React.useState<Record<string, CapabilityDraftErrorCode>>({})
  const [saveError, setSaveError] = React.useState('')
  const [activeModeIndex, setActiveModeIndex] = React.useState<number | null>(null)
  const initialDraftRef = React.useRef(serializedDraft(draft))
  const pageRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const next = makeDraft()
    setDraft(next)
    initialDraftRef.current = serializedDraft(next)
    setErrors({})
    setSaveError('')
    setActiveModeIndex(null)
  }, [makeDraft])

  const focusFirstError = React.useCallback((nextErrors: Record<string, CapabilityDraftErrorCode>) => {
    const firstPath = Object.keys(nextErrors).find((path) => path !== 'form')
    if (!firstPath) return
    const modeIndex = Number(firstPath.match(/^modes\.(\d+)/)?.[1])
    if (Number.isInteger(modeIndex)) setActiveModeIndex(modeIndex)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const targets = pageRef.current?.querySelectorAll<HTMLElement>('[data-capability-field]') ?? []
        const field = [...targets].find((target) => target.dataset.capabilityField === firstPath)
        const focusTarget = field?.matches('input, textarea, button')
          ? field
          : field?.querySelector<HTMLElement>('input, textarea, button')
        focusTarget?.focus({ preventScroll: false })
        field?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    })
  }, [])

  const save = React.useCallback(async () => {
    if (!model || !draft) return
    const validation = validateCapabilityContractDraft(draft)
    setErrors(validation.errors)
    setSaveError('')
    if (!validation.contract) {
      focusFirstError(validation.errors)
      return
    }
    const bridge = getDesktopBridge()
    if (!bridge) {
      setSaveError(t('onboardingProviders.workspace.capability.editor.desktopUnavailable'))
      return
    }
    try {
      const latest = await currentModelMeta(model)
      if (!latest.found) throw new Error(t('onboardingProviders.workspace.modelMissing'))
      const meta = replaceCustomCapabilityContractMeta(latest.meta, {
        customCapabilityContract: validation.contract,
      })
      bridge.modelCatalog.upsertModel({
        vendorKey: model.vendorKey,
        modelKey: model.modelKey,
        ...(enableAfterSave ? { enabled: true } : {}),
        meta,
      })
      onSaved()
      onBack()
    } catch (error) {
      setSaveError(t('onboardingProviders.workspace.capability.editor.saveFailed', {
        message: error instanceof Error ? error.message : String(error),
      }))
    }
  }, [draft, enableAfterSave, focusFirstError, model, onBack, onSaved, t])

  const requestBack = React.useCallback(async () => {
    if (activeModeIndex !== null) {
      const returningIndex = activeModeIndex
      setActiveModeIndex(null)
      window.requestAnimationFrame(() => {
        pageRef.current?.querySelector<HTMLElement>(`[data-capability-mode-row="${returningIndex}"]`)?.focus()
      })
      return
    }
    if (serializedDraft(draft) === initialDraftRef.current) {
      onBack()
      return
    }
    const discard = await confirmDialog({
      title: t('onboardingProviders.workspace.capability.editor.discardTitle'),
      message: t('onboardingProviders.workspace.capability.editor.discardMessage'),
      confirmLabel: t('onboardingProviders.workspace.capability.editor.discard'),
      danger: true,
    })
    if (discard) onBack()
  }, [activeModeIndex, draft, onBack, t])

  const clearCustomContract = React.useCallback(async () => {
    if (!model || !customContract) return
    const confirmed = await confirmDialog({
      title: t('onboardingProviders.workspace.capability.editor.restoreTitle'),
      message: t('onboardingProviders.workspace.capability.editor.restoreMessage'),
      confirmLabel: t('onboardingProviders.workspace.capability.editor.restore'),
      danger: true,
    })
    if (!confirmed) return
    const bridge = getDesktopBridge()
    if (!bridge) {
      setSaveError(t('onboardingProviders.workspace.capability.editor.desktopUnavailable'))
      return
    }
    try {
      const latest = await currentModelMeta(model)
      if (!latest.found) throw new Error(t('onboardingProviders.workspace.modelMissing'))
      bridge.modelCatalog.upsertModel({
        vendorKey: model.vendorKey,
        modelKey: model.modelKey,
        meta: replaceCustomCapabilityContractMeta(latest.meta, {}),
      })
      onSaved()
      onBack()
    } catch (error) {
      setSaveError(t('onboardingProviders.workspace.capability.editor.saveFailed', {
        message: error instanceof Error ? error.message : String(error),
      }))
    }
  }, [customContract, model, onBack, onSaved, t])

  const updateMode = React.useCallback((modeIndex: number, nextMode: CapabilityContractDraft['modes'][number]) => {
    setErrors({})
    setSaveError('')
    setDraft((current) => {
      if (!current) return current
      const previousMode = current.modes[modeIndex]
      const next = replaceCapabilityModeDraft(current, modeIndex, nextMode)
      return current.defaultModeId === previousMode?.id
        ? { ...next, defaultModeId: nextMode.id }
        : next
    })
  }, [])

  const removeMode = React.useCallback((modeIndex: number) => {
    setErrors({})
    setSaveError('')
    setDraft((current) => {
      if (!current || current.modes.length <= 1) return current
      const nextModes = current.modes.filter((_, index) => index !== modeIndex)
      return {
        ...current,
        modes: nextModes,
        defaultModeId: current.defaultModeId === current.modes[modeIndex].id
          ? nextModes[0].id
          : current.defaultModeId,
      }
    })
  }, [])

  const addMode = React.useCallback(() => {
    if (!draft) return
    setErrors({})
    setSaveError('')
    let sequence = draft.modes.length + 1
    let next = createCapabilityModeDraft(
      draft.kind,
      sequence - 1,
      t('onboardingProviders.workspace.capability.editor.newModeName', { count: sequence }),
    )
    const ids = new Set(draft.modes.map((mode) => mode.id))
    while (ids.has(next.id)) {
      sequence += 1
      next = createCapabilityModeDraft(
        draft.kind,
        sequence - 1,
        t('onboardingProviders.workspace.capability.editor.newModeName', { count: sequence }),
      )
    }
    setDraft({ ...draft, modes: [...draft.modes, next] })
    setActiveModeIndex(draft.modes.length)
  }, [draft, t])

  const title = model?.labelZh || model?.modelKey || t('onboardingProviders.workspace.capability.editor.title')
  const dirty = serializedDraft(draft) !== initialDraftRef.current
  const activeMode = activeModeIndex === null ? undefined : draft?.modes[activeModeIndex]
  return (
    <div
      ref={pageRef}
      className="flex h-full min-h-0 flex-col"
      data-model-settings-page="capability"
      data-model-settings-model={model?.modelKey}
      data-settings-unsaved={dirty ? 'true' : undefined}
    >
      <ModelSettingsPageHeader
        title={activeMode
          ? t('onboardingProviders.workspace.capability.editor.editModeTitle')
          : t('onboardingProviders.workspace.capability.editor.title')}
        subtitle={model ? activeMode ? `${activeMode.displayName || activeMode.id} / ${title}` : `${title} / ${vendorName}` : undefined}
        backLabel={t('common.back')}
        onBack={() => { void requestBack() }}
        actions={draft ? (
          <DesignButton
            variant="filled"
            onClick={save}
            aria-label={t('onboardingProviders.workspace.capability.editor.save')}
            title={t('onboardingProviders.workspace.capability.editor.save')}
            leftSection={<IconDeviceFloppy size={16} stroke={1.8} aria-hidden="true" />}
            className="size-11 px-0 sm:h-8 sm:w-auto sm:px-3"
          >
            <span className="hidden sm:inline">{t('onboardingProviders.workspace.capability.editor.save')}</span>
          </DesignButton>
        ) : null}
      />

      <div className="mx-auto w-full max-w-[800px] flex-1 overflow-y-auto p-4 sm:p-5">
        {!model ? (
          <div className="text-caption text-nomi-ink-60">{t('onboardingProviders.workspace.modelMissing')}</div>
        ) : !draft ? (
          <>
            <div className="border-l-2 border-nomi-line bg-nomi-ink-05 px-3 py-2 text-caption leading-relaxed text-nomi-ink-60">
              {t('onboardingProviders.workspace.capability.textNotApplicable')}
            </div>
            {customContract ? (
              <DesignButton
                variant="subtle"
                onClick={() => { void clearCustomContract() }}
                className="mt-4 text-workbench-danger"
                leftSection={<IconRefresh size={14} stroke={1.8} aria-hidden="true" />}
              >
                {t('onboardingProviders.workspace.capability.editor.restore')}
              </DesignButton>
            ) : null}
          </>
        ) : (
          <>
            {activeMode ? null : (
              <div className="mb-4 border-l-2 border-nomi-accent bg-nomi-accent-soft px-3 py-2 text-caption leading-relaxed text-nomi-ink-60">
                {t('onboardingProviders.workspace.capability.editor.intro')}
              </div>
            )}

            {errors.form ? (
              <div className="mb-4 border-l-2 border-workbench-danger bg-nomi-ink-05 px-3 py-2 text-caption text-workbench-danger" role="alert">
                {t(`onboardingProviders.workspace.capability.editor.errors.${errors.form}` as 'onboardingProviders.workspace.capability.editor.errors.contractInvalid')}
              </div>
            ) : null}
            {errors.modes ? (
              <div className="mb-4 border-l-2 border-workbench-danger bg-nomi-ink-05 px-3 py-2 text-caption text-workbench-danger" role="alert">
                {t(`onboardingProviders.workspace.capability.editor.errors.${errors.modes}` as 'onboardingProviders.workspace.capability.editor.errors.required')}
              </div>
            ) : null}
            {saveError ? (
              <div className="mb-4 border-l-2 border-workbench-danger bg-nomi-ink-05 px-3 py-2 text-caption text-workbench-danger" role="alert">
                {saveError}
              </div>
            ) : null}

            {activeMode && activeModeIndex !== null ? (
              <CapabilityModeEditor
                key={activeModeIndex}
                draftKind={draft.kind}
                mode={activeMode}
                modeIndex={activeModeIndex}
                isDefault={draft.defaultModeId === activeMode.id}
                canRemove={draft.modes.length > 1}
                errors={errors}
                onChange={(nextMode) => updateMode(activeModeIndex, nextMode)}
                onSetDefault={() => {
                  setErrors({})
                  setSaveError('')
                  setDraft((current) => current ? { ...current, defaultModeId: activeMode.id } : current)
                }}
                onRemove={() => {
                  removeMode(activeModeIndex)
                  setActiveModeIndex(null)
                }}
              />
            ) : (
              <>
                <div className="border-y border-nomi-line" data-capability-mode-list>
                  {draft.modes.map((mode, modeIndex) => {
                    const hasModeError = Object.keys(errors).some((path) => path.startsWith(`modes.${modeIndex}`))
                    return (
                      <div key={modeIndex} className="flex min-h-14 items-center border-b border-nomi-line last:border-b-0">
                        <label
                          className="grid size-11 shrink-0 cursor-pointer place-items-center"
                          title={t('onboardingProviders.workspace.capability.editor.makeDefault')}
                        >
                          <input
                            type="radio"
                            name="default-capability-mode-list"
                            checked={draft.defaultModeId === mode.id}
                            onChange={() => {
                              setErrors({})
                              setSaveError('')
                              setDraft((current) => current ? { ...current, defaultModeId: mode.id } : current)
                            }}
                            aria-label={t('onboardingProviders.workspace.capability.editor.makeDefaultFor', { name: mode.displayName || mode.id })}
                            className="size-4 accent-nomi-accent"
                          />
                        </label>
                        <button
                          type="button"
                          data-capability-mode-row={modeIndex}
                          onClick={() => setActiveModeIndex(modeIndex)}
                          className="group flex min-w-0 flex-1 items-center gap-3 px-1 py-2 text-left hover:bg-nomi-ink-05"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-body-sm font-semibold text-nomi-ink">
                                {mode.displayName || t('onboardingProviders.workspace.capability.editor.unnamedMode')}
                              </span>
                              {draft.defaultModeId === mode.id ? (
                                <span className="shrink-0 rounded-pill bg-nomi-accent-soft px-2 py-0.5 text-micro font-medium text-nomi-accent">
                                  {t('onboardingProviders.workspace.capability.editor.defaultMode')}
                                </span>
                              ) : null}
                              {hasModeError ? (
                                <span className="shrink-0 text-micro text-workbench-danger">
                                  {t('onboardingProviders.workspace.capability.editor.needsFix')}
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block truncate text-micro text-nomi-ink-40">
                              {t('onboardingProviders.workspace.capability.editor.modeSummary', {
                                task: t(`onboardingProviders.adapterVerification.mode.${mode.taskKind}` as 'onboardingProviders.adapterVerification.mode.text_to_video'),
                                inputs: mode.slots.length,
                                parameters: mode.parameters.length,
                              })}
                            </span>
                          </span>
                          <IconChevronRight size={16} stroke={1.6} className="shrink-0 text-nomi-ink-30 group-hover:text-nomi-accent" aria-hidden="true" />
                        </button>
                      </div>
                    )
                  })}
                </div>

                <span title={draft.modes.length >= CAPABILITY_EDITOR_LIMITS.modes
                  ? t('onboardingProviders.workspace.capability.editor.limitReached')
                  : undefined}>
                  <DesignButton
                    variant="light"
                    disabled={draft.modes.length >= CAPABILITY_EDITOR_LIMITS.modes}
                    onClick={addMode}
                    className="mt-3"
                    leftSection={<IconPlus size={16} stroke={1.8} aria-hidden="true" />}
                  >
                    {t('onboardingProviders.workspace.capability.editor.addMode')}
                  </DesignButton>
                </span>

                {customContract ? (
                  <div className="mt-6 border-t border-nomi-line pt-3">
                    <DesignButton
                      variant="subtle"
                      onClick={() => { void clearCustomContract() }}
                      className="text-workbench-danger"
                      leftSection={<IconRefresh size={14} stroke={1.8} aria-hidden="true" />}
                    >
                      {t('onboardingProviders.workspace.capability.editor.restore')}
                    </DesignButton>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
