import React from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconFolderPlus, IconTrash, IconX } from '../../../vendor/tablerIcons'
import { cn } from '../../../utils/cn'
import type { BrowserPromptExtractionMode } from './browserPromptExtraction'
import { TOOL_BUTTON_CLASS } from '../popover/browserAssetPopoverConstants'
import type {
  BrowserPromptExtractionTemplate,
  BrowserPromptExtractionTemplateSettings,
} from '../popover/browserAssetPopoverTypes'
import {
  browserPromptExtractionTemplatesForMode,
  defaultBrowserPromptTemplateId,
  normalizeBrowserPromptExtractionTemplateSettings,
} from './browserPromptExtractionSettings'

type BrowserPromptExtractionSettingsModalProps = {
  settings: BrowserPromptExtractionTemplateSettings
  projectAvailable: boolean
  onSave: (settings: BrowserPromptExtractionTemplateSettings) => void
  onClose: () => void
}

function updatePromptExtractionTemplate(
  settings: BrowserPromptExtractionTemplateSettings,
  mode: BrowserPromptExtractionMode,
  templateId: string,
  patch: Partial<Pick<BrowserPromptExtractionTemplate, 'title' | 'prompt'>>,
): BrowserPromptExtractionTemplateSettings {
  const updatedAt = new Date().toISOString()
  const defaultId = defaultBrowserPromptTemplateId(mode)
  if (templateId === defaultId) {
    const current = settings.defaultOverrides[mode] ?? {}
    return normalizeBrowserPromptExtractionTemplateSettings({
      ...settings,
      defaultOverrides: {
        ...settings.defaultOverrides,
        [mode]: { ...current, ...patch, updatedAt },
      },
      selectedTemplateIds: { ...settings.selectedTemplateIds, [mode]: templateId },
    })
  }
  return normalizeBrowserPromptExtractionTemplateSettings({
    ...settings,
    selectedTemplateIds: { ...settings.selectedTemplateIds, [mode]: templateId },
    customTemplates: {
      ...settings.customTemplates,
      [mode]: (settings.customTemplates[mode] ?? []).map((template) =>
        template.id === templateId ? { ...template, ...patch, updatedAt } : template,
      ),
    },
  })
}

export function BrowserPromptExtractionSettingsModal({
  settings,
  projectAvailable,
  onSave,
  onClose,
}: BrowserPromptExtractionSettingsModalProps): JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = React.useState(() => normalizeBrowserPromptExtractionTemplateSettings(settings))
  const [mode, setMode] = React.useState<BrowserPromptExtractionMode>('replicate')
  const defaultId = defaultBrowserPromptTemplateId(mode)
  const selectedId = draft.selectedTemplateIds[mode] || defaultId
  const templates = browserPromptExtractionTemplatesForMode(draft, mode)
  const selectedTemplate = templates.find((template) => template.id === selectedId) ?? templates[0]
  const isDefaultTemplate = selectedTemplate.id === defaultId
  const modeLabel = React.useCallback(
    (value: BrowserPromptExtractionMode): string =>
      t(`browserAssets.extraction.${value}` as 'browserAssets.extraction.replicate'),
    [t],
  )
  const selectedTemplateTitle =
    isDefaultTemplate && !draft.defaultOverrides[mode]?.title ? modeLabel(mode) : selectedTemplate.title

  const selectTemplate = React.useCallback(
    (templateId: string): void => {
      setDraft((current) =>
        normalizeBrowserPromptExtractionTemplateSettings({
          ...current,
          selectedTemplateIds: { ...current.selectedTemplateIds, [mode]: templateId },
        }),
      )
    },
    [mode],
  )

  const updateTemplate = React.useCallback(
    (patch: Partial<Pick<BrowserPromptExtractionTemplate, 'title' | 'prompt'>>): void => {
      setDraft((current) => updatePromptExtractionTemplate(current, mode, selectedId, patch))
    },
    [mode, selectedId],
  )

  const addCustomTemplate = React.useCallback((): void => {
    const now = new Date().toISOString()
    const id = `custom:${mode}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const template: BrowserPromptExtractionTemplate = {
      id,
      title: t('browserAssets.extraction.customTemplate', { mode: modeLabel(mode) }),
      prompt: selectedTemplate.prompt,
      createdAt: now,
      updatedAt: now,
    }
    setDraft((current) =>
      normalizeBrowserPromptExtractionTemplateSettings({
        ...current,
        selectedTemplateIds: { ...current.selectedTemplateIds, [mode]: id },
        customTemplates: { ...current.customTemplates, [mode]: [template, ...(current.customTemplates[mode] ?? [])] },
      }),
    )
  }, [mode, modeLabel, selectedTemplate.prompt, t])

  const deleteSelectedTemplate = React.useCallback((): void => {
    if (isDefaultTemplate) return
    setDraft((current) =>
      normalizeBrowserPromptExtractionTemplateSettings({
        ...current,
        selectedTemplateIds: { ...current.selectedTemplateIds, [mode]: defaultBrowserPromptTemplateId(mode) },
        customTemplates: {
          ...current.customTemplates,
          [mode]: (current.customTemplates[mode] ?? []).filter((template) => template.id !== selectedId),
        },
      }),
    )
  }, [isDefaultTemplate, mode, selectedId])

  const resetDefaultTemplate = React.useCallback((): void => {
    if (!isDefaultTemplate) return
    setDraft((current) =>
      normalizeBrowserPromptExtractionTemplateSettings({
        ...current,
        defaultOverrides: Object.fromEntries(
          Object.entries(current.defaultOverrides).filter(([key]) => key !== mode),
        ) as BrowserPromptExtractionTemplateSettings['defaultOverrides'],
        selectedTemplateIds: { ...current.selectedTemplateIds, [mode]: defaultBrowserPromptTemplateId(mode) },
      }),
    )
  }, [isDefaultTemplate, mode])

  const dialog = (
    <div
      className="fixed inset-0 z-[3400] grid place-items-center bg-nomi-ink/38 p-5 font-nomi-sans text-nomi-ink backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={t('browserAssets.extraction.settings')}
      data-nomi-prompt-extraction-settings-dialog="true"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <motion.div
        className="flex h-[min(720px,calc(100vh-40px))] w-[min(920px,calc(100vw-40px))] flex-col overflow-hidden rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-lg"
        initial={{ opacity: 0, scale: 0.985, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
      >
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-nomi-line-soft px-4">
          <div className="min-w-0">
            <div className="truncate text-body-sm font-bold text-nomi-ink">
              {t('browserAssets.extraction.settings')}
            </div>
            <div className="mt-0.5 truncate text-micro text-nomi-ink-40">
              {t('browserAssets.extraction.settingsPath')}
            </div>
          </div>
          <button
            type="button"
            className={TOOL_BUTTON_CLASS}
            aria-label={t('browserAssets.extraction.closeSettings')}
            onClick={onClose}
          >
            <IconX size={17} stroke={1.8} aria-hidden="true" />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <section className="flex min-h-0 flex-col gap-3">
            <div className="grid grid-cols-2 gap-1 rounded-nomi bg-nomi-ink-05 p-1">
              {(['replicate', 'style'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={cn(
                    'h-8 rounded-nomi-sm border-0 bg-transparent px-2 text-caption font-semibold',
                    'cursor-pointer transition-colors duration-[var(--nomi-transition-fast)]',
                    mode === item
                      ? 'bg-nomi-paper text-nomi-ink shadow-nomi-sm'
                      : 'text-nomi-ink-55 hover:text-nomi-ink',
                  )}
                  onClick={() => setMode(item)}
                >
                  {modeLabel(item)}
                </button>
              ))}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
              {templates.map((template) => {
                const active = template.id === selectedTemplate.id
                return (
                  <button
                    key={template.id}
                    type="button"
                    className={cn(
                      'min-h-10 rounded-nomi border px-3 py-2 text-left text-caption font-semibold',
                      'cursor-pointer transition-colors duration-[var(--nomi-transition-fast)]',
                      active
                        ? 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent'
                        : 'border-nomi-line bg-nomi-paper text-nomi-ink-65 hover:bg-nomi-ink-05 hover:text-nomi-ink',
                    )}
                    onClick={() => selectTemplate(template.id)}
                  >
                    <span className="block truncate">
                      {template.builtin && !draft.defaultOverrides[mode]?.title ? modeLabel(mode) : template.title}
                    </span>
                    {template.builtin ? (
                      <span className="mt-0.5 block text-micro text-nomi-ink-40">
                        {t('browserAssets.extraction.default')}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-nomi border border-nomi-line bg-nomi-paper px-3 text-caption font-semibold text-nomi-ink-80 hover:bg-nomi-ink-05"
              onClick={addCustomTemplate}
            >
              <IconFolderPlus size={15} stroke={1.8} aria-hidden="true" />
              {t('browserAssets.extraction.addCustom')}
            </button>
          </section>
          <section className="flex min-h-0 flex-col gap-3">
            <label className="grid gap-1.5">
              <span className="text-caption font-semibold text-nomi-ink-65">{t('browserAssets.extraction.name')}</span>
              <input
                value={selectedTemplateTitle}
                className="h-9 rounded-nomi border border-nomi-line bg-nomi-bg px-3 text-body-sm text-nomi-ink outline-none focus:border-nomi-accent"
                onChange={(event) => updateTemplate({ title: event.target.value })}
              />
            </label>
            <label className="flex min-h-0 flex-1 flex-col gap-1.5">
              <span className="text-caption font-semibold text-nomi-ink-65">
                {t('browserAssets.extraction.prompt')}
              </span>
              <textarea
                value={selectedTemplate.prompt}
                className="min-h-[340px] flex-1 resize-none rounded-nomi border border-nomi-line bg-nomi-bg p-3 text-body-sm leading-relaxed text-nomi-ink outline-none focus:border-nomi-accent"
                onChange={(event) => updateTemplate({ prompt: event.target.value })}
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-caption text-nomi-ink-40">
                {projectAvailable
                  ? t('browserAssets.extraction.projectPortable')
                  : t('browserAssets.extraction.projectUnavailable')}
              </div>
              <div className="flex items-center gap-2">
                {isDefaultTemplate ? (
                  <button
                    type="button"
                    className="inline-flex h-9 items-center rounded-nomi border border-nomi-line bg-nomi-paper px-3 text-caption font-semibold text-nomi-ink-60 hover:bg-nomi-ink-05"
                    onClick={resetDefaultTemplate}
                  >
                    {t('browserAssets.extraction.restoreDefault')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-2 rounded-nomi border border-workbench-danger/35 bg-nomi-paper px-3 text-caption font-semibold text-workbench-danger hover:bg-workbench-danger-soft"
                    onClick={deleteSelectedTemplate}
                  >
                    <IconTrash size={15} stroke={1.8} aria-hidden="true" />
                    {t('browserAssets.extraction.delete')}
                  </button>
                )}
                <button
                  type="button"
                  className="inline-flex h-9 items-center rounded-nomi border border-nomi-line bg-nomi-paper px-3 text-caption font-semibold text-nomi-ink-80 hover:bg-nomi-ink-05"
                  onClick={onClose}
                >
                  {t('browserAssets.extraction.cancel')}
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-2 rounded-nomi border-0 bg-nomi-ink px-4 text-caption font-semibold text-nomi-paper hover:bg-nomi-accent"
                  onClick={() => onSave(normalizeBrowserPromptExtractionTemplateSettings(draft))}
                >
                  <IconCheck size={15} stroke={2} aria-hidden="true" />
                  {t('browserAssets.extraction.save')}
                </button>
              </div>
            </div>
          </section>
        </div>
      </motion.div>
    </div>
  )
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
