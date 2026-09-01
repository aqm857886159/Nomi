import i18n from '../../../i18n'

import {
  BROWSER_IMAGE_REPLICATE_PROMPT_EXTRACTION_PROMPT,
  BROWSER_IMAGE_STYLE_PROMPT_EXTRACTION_PROMPT,
  BROWSER_PROMPT_EXTRACTION_MODE_LABEL_KEYS,
  browserPromptExtractionPromptForMode,
  type BrowserPromptExtractionMode,
} from './browserPromptExtraction'
import type { BrowserPromptExtractionTemplate, BrowserPromptExtractionTemplateSettings } from '../popover/browserAssetPopoverTypes'

const BROWSER_PROMPT_EXTRACTION_SETTINGS_VERSION = 1
const BROWSER_PROMPT_TEMPLATE_DEFAULT_IDS: Record<BrowserPromptExtractionMode, string> = {
  replicate: 'default:replicate',
  style: 'default:style',
}
// 内置模板的默认标题:**每次取值时**翻译,不做成模块顶层常量——
// 常量会把 import 那一刻的语言冻住,切语言后内置模板名不跟着变。
// (标题只用于显示;持久化认的是 BROWSER_PROMPT_TEMPLATE_DEFAULT_IDS 那个语言无关的 id。)
function defaultTemplateTitle(mode: BrowserPromptExtractionMode): string {
  return i18n.t(BROWSER_PROMPT_EXTRACTION_MODE_LABEL_KEYS[mode])
}
const BROWSER_PROMPT_TEMPLATE_DEFAULT_PROMPTS: Record<BrowserPromptExtractionMode, string> = {
  replicate: BROWSER_IMAGE_REPLICATE_PROMPT_EXTRACTION_PROMPT,
  style: BROWSER_IMAGE_STYLE_PROMPT_EXTRACTION_PROMPT,
}

export function defaultBrowserPromptTemplateId(mode: BrowserPromptExtractionMode): string {
  return BROWSER_PROMPT_TEMPLATE_DEFAULT_IDS[mode]
}

export function createDefaultBrowserPromptExtractionTemplateSettings(): BrowserPromptExtractionTemplateSettings {
  return {
    version: BROWSER_PROMPT_EXTRACTION_SETTINGS_VERSION,
    selectedTemplateIds: {
      replicate: BROWSER_PROMPT_TEMPLATE_DEFAULT_IDS.replicate,
      style: BROWSER_PROMPT_TEMPLATE_DEFAULT_IDS.style,
    },
    defaultOverrides: {},
    customTemplates: {},
  }
}

function normalizeBrowserPromptExtractionTemplate(input: unknown): BrowserPromptExtractionTemplate | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const prompt = typeof record.prompt === 'string' ? record.prompt : ''
  if (!id || id.startsWith('default:')) return null
  return {
    id,
    title: title || i18n.t('browserAssets.extraction.unnamedTemplate'),
    prompt,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
  }
}

export function normalizeBrowserPromptExtractionTemplateSettings(input: unknown): BrowserPromptExtractionTemplateSettings {
  const defaults = createDefaultBrowserPromptExtractionTemplateSettings()
  if (!input || typeof input !== 'object' || Array.isArray(input)) return defaults
  const record = input as Record<string, unknown>
  const selected = record.selectedTemplateIds && typeof record.selectedTemplateIds === 'object'
    ? record.selectedTemplateIds as Partial<Record<BrowserPromptExtractionMode, unknown>>
    : {}
  const rawOverrides = record.defaultOverrides && typeof record.defaultOverrides === 'object'
    ? record.defaultOverrides as Partial<Record<BrowserPromptExtractionMode, unknown>>
    : {}
  const rawCustom = record.customTemplates && typeof record.customTemplates === 'object'
    ? record.customTemplates as Partial<Record<BrowserPromptExtractionMode, unknown>>
    : {}
  const defaultOverrides: BrowserPromptExtractionTemplateSettings['defaultOverrides'] = {}
  const customTemplates: BrowserPromptExtractionTemplateSettings['customTemplates'] = {}
  for (const mode of ['replicate', 'style'] as const) {
    const override = rawOverrides[mode]
    if (override && typeof override === 'object' && !Array.isArray(override)) {
      const item = override as Record<string, unknown>
      const title = typeof item.title === 'string' ? item.title.trim() : ''
      const prompt = typeof item.prompt === 'string' ? item.prompt : ''
      if (title || prompt.trim()) {
        defaultOverrides[mode] = {
          ...(title ? { title } : {}),
          ...(prompt.trim() ? { prompt } : {}),
          ...(typeof item.updatedAt === 'string' ? { updatedAt: item.updatedAt } : {}),
        }
      }
    }
    customTemplates[mode] = Array.isArray(rawCustom[mode])
      ? rawCustom[mode].map(normalizeBrowserPromptExtractionTemplate).filter((item): item is BrowserPromptExtractionTemplate => Boolean(item))
      : []
    const selectedId = typeof selected[mode] === 'string' ? selected[mode]!.trim() : ''
    const validIds = new Set([BROWSER_PROMPT_TEMPLATE_DEFAULT_IDS[mode], ...customTemplates[mode]!.map((template) => template.id)])
    defaults.selectedTemplateIds[mode] = validIds.has(selectedId) ? selectedId : BROWSER_PROMPT_TEMPLATE_DEFAULT_IDS[mode]
  }
  return { ...defaults, defaultOverrides, customTemplates }
}

export function browserPromptExtractionTemplatesForMode(
  settings: BrowserPromptExtractionTemplateSettings,
  mode: BrowserPromptExtractionMode,
): BrowserPromptExtractionTemplate[] {
  const override = settings.defaultOverrides[mode]
  return [
    {
      id: BROWSER_PROMPT_TEMPLATE_DEFAULT_IDS[mode],
      title: override?.title || defaultTemplateTitle(mode),
      prompt: override?.prompt || BROWSER_PROMPT_TEMPLATE_DEFAULT_PROMPTS[mode],
      builtin: true,
      updatedAt: override?.updatedAt,
    },
    ...(settings.customTemplates[mode] ?? []),
  ]
}

export function selectedBrowserPromptExtractionTemplate(
  settings: BrowserPromptExtractionTemplateSettings,
  mode: BrowserPromptExtractionMode,
): BrowserPromptExtractionTemplate {
  const templates = browserPromptExtractionTemplatesForMode(settings, mode)
  return templates.find((template) => template.id === settings.selectedTemplateIds[mode]) ?? templates[0]
}

export function browserPromptExtractionPromptFromSettings(
  settings: BrowserPromptExtractionTemplateSettings,
  mode: BrowserPromptExtractionMode,
): string {
  return selectedBrowserPromptExtractionTemplate(settings, mode).prompt || browserPromptExtractionPromptForMode(mode)
}
