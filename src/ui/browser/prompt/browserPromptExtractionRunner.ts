import type { ToastType } from '../../toast'
// 网页提示词提取 runner（素材面收敛 2026-07-22）：产物只此一家=主提示词库「我的库」。
// 此前提取在素材盒弹层内跑、结果存 localStorage 私账卡（正牌提示词库找不到、顶栏浮窗恒空）；
// 提取由浏览器侧直接驱动：请求宿主原地反馈进度，成品 addUserPrompt 入主库（带参考图+模式标签）。
import i18n from '../../../i18n'
import { getDesktopBridge } from '../../../desktop/bridge'
import { addUserPrompt, getTextBrain } from '../../../workbench/api/promptLibraryApi'
import { runWorkbenchTaskByVendor } from '../../../workbench/api/taskApi'
import { isProjectExecutionContextCurrent, type ProjectExecutionContext } from '../../../workbench/project/projectCanvasReadSurface'
import { notify } from '../../notificationPolicy'
import type {
  BrowserAssetPromptCaptureRequest,
  BrowserAssetPromptReference,
  BrowserPromptExtractionTemplateSettings,
} from '../popover/browserAssetPopoverTypes'
import {
  promptExtractionModeFromRequest,
  promptReferenceImagesFromRequest,
  referenceResultDataUrl,
  referenceResultUrl,
} from '../popover/browserAssetPopoverUtils'
import { logRendererError } from '../../../desktop/rendererLog'
import {
  BROWSER_PROMPT_EXTRACTION_MODE_LABEL_KEYS,
  extractTextFromTaskResult,
  parseBrowserPromptExtraction,
  type BrowserPromptExtractionMode,
} from './browserPromptExtraction'
import {
  browserPromptExtractionPromptFromSettings,
  createDefaultBrowserPromptExtractionTemplateSettings,
  normalizeBrowserPromptExtractionTemplateSettings,
} from './browserPromptExtractionSettings'

async function loadExtractionSettings(projectId: string | null): Promise<BrowserPromptExtractionTemplateSettings> {
  const browserBridge = getDesktopBridge()?.browser
  if (!projectId || !browserBridge?.readPromptExtractionSettings) return createDefaultBrowserPromptExtractionTemplateSettings()
  try {
    const result = await browserBridge.readPromptExtractionSettings()
    return normalizeBrowserPromptExtractionTemplateSettings(result?.settings)
  } catch {
    return createDefaultBrowserPromptExtractionTemplateSettings()
  }
}

/** 截图/原图落成可喂模型的参考（与旧弹层内 preparePromptReference 同一产路，去 React 化）。 */
async function preparePromptReference(
  request: BrowserAssetPromptCaptureRequest,
  initialReferences: readonly BrowserAssetPromptReference[],
): Promise<{ references: BrowserAssetPromptReference[]; modelImageUrl: string }> {
  const browserBridge = getDesktopBridge()?.browser
  const sourceUrl = request.sourceUrl?.trim() || initialReferences[0]?.sourceUrl || initialReferences[0]?.url || ''
  if (request.sourceType === 'screenshot' && request.viewId && browserBridge?.capturePromptScreenshot) {
    const captured = await browserBridge.capturePromptScreenshot({
      viewId: request.viewId,
      fileName: request.fileName,
      title: request.title,
      sourceRect: request.sourceRect,
    })
    const referenceUrl = referenceResultUrl(captured) || referenceResultDataUrl(captured)
    const dataUrl = referenceResultDataUrl(captured) || referenceUrl
    return {
      references: referenceUrl ? [{ url: referenceUrl, title: request.title, sourceUrl: sourceUrl || request.pageUrl }] : [...initialReferences],
      modelImageUrl: dataUrl || request.modelImageUrl || referenceUrl || sourceUrl,
    }
  }
  if (request.viewId && /^(https?:\/\/|blob:)/i.test(sourceUrl) && browserBridge?.capturePromptImage) {
    const captured = await browserBridge.capturePromptImage({
      viewId: request.viewId,
      url: sourceUrl,
      fileName: request.fileName,
      title: request.title,
    })
    const referenceUrl = referenceResultUrl(captured) || referenceResultDataUrl(captured)
    const dataUrl = referenceResultDataUrl(captured) || referenceUrl
    return {
      references: referenceUrl ? [{ url: referenceUrl, title: request.title, sourceUrl }] : [...initialReferences],
      modelImageUrl: dataUrl || request.modelImageUrl || referenceUrl || sourceUrl,
    }
  }
  return { references: [...initialReferences], modelImageUrl: request.modelImageUrl || sourceUrl || initialReferences[0]?.url || '' }
}

async function runPromptExtraction(
  modelImageUrl: string,
  mode: BrowserPromptExtractionMode,
  settings: BrowserPromptExtractionTemplateSettings,
  projectId: string | null,
): Promise<{ title: string; prompt: string }> {
  if (!modelImageUrl) throw new Error(i18n.t('browserAssets.promptReferenceMissing'))
  const brain = await getTextBrain()
  if (!brain) throw new Error(i18n.t('browserAssets.promptVisionModelMissing'))
  const result = await runWorkbenchTaskByVendor(brain.vendor, {
    kind: 'image_to_prompt',
    prompt: browserPromptExtractionPromptFromSettings(settings, mode),
    extras: {
      modelKey: brain.modelKey,
      referenceImages: [modelImageUrl],
      temperature: mode === 'style' ? 0.2 : 0.35,
      maxTokens: mode === 'style' ? 1800 : 1600,
    },
  }, projectId)
  const text = extractTextFromTaskResult(result)
  if (!text) throw new Error(i18n.t('browserAssets.promptModelEmpty'))
  const parsed = parseBrowserPromptExtraction(text, mode)
  if (!parsed.prompt) throw new Error(i18n.t('browserAssets.promptModelInvalid'))
  return parsed
}

function fallbackTitle(request: BrowserAssetPromptCaptureRequest, extractedTitle: string): string {
  const title = (extractedTitle || request.title || request.pageTitle || '').trim()
  if (title) return title.slice(0, 48)
  const mode = promptExtractionModeFromRequest(request)
  if (mode === 'style') return request.sourceType === 'screenshot' ? i18n.t('browserAssets.screenshotStyle') : i18n.t('browserAssets.extraction.style')
  return request.sourceType === 'screenshot' ? i18n.t('browserAssets.screenshotPromptTitle') : i18n.t('browserAssets.extraction.imagePrompt')
}

/**
 * 提取结果由请求宿主原地承接；纯 runner 不另开素材盒或全局提示。
 * `project` 是用户发起提取那一刻签发的项目（没打开项目 = null）：模板设置、参考截图都按它读写；
 * 中途换了项目就取消，不把一半的结果写回。
 */
export async function runBrowserPromptExtractionToLibrary(
  request: BrowserAssetPromptCaptureRequest,
  present: (message: string) => void,
  project: ProjectExecutionContext | null,
): Promise<void> {
  const projectId = project?.binding.projectId ?? null
  const stillCurrent = () => !project || isProjectExecutionContextCurrent(project)
  const mode = promptExtractionModeFromRequest(request)
  const report = (message: string, type: ToastType) => notify({ identity: `browser-prompt:${request.requestId}`, reason: 'extraction', level: 'inline', message, type, present })
  report(i18n.t('browserAssets.extractingPrompt', { mode: i18n.t(BROWSER_PROMPT_EXTRACTION_MODE_LABEL_KEYS[mode]) }), 'info')
  try {
    const settings = await loadExtractionSettings(projectId)
    if (!stillCurrent()) return
    const initialReferences = promptReferenceImagesFromRequest(request)
    const prepared = await preparePromptReference(request, initialReferences)
    if (!stillCurrent()) return
    const extracted = await runPromptExtraction(prepared.modelImageUrl, mode, settings, projectId)
    if (!stillCurrent()) return
    const title = fallbackTitle(request, extracted.title)
    await addUserPrompt({
      title,
      prompt: extracted.prompt,
      promptType: 'image',
      tags: [i18n.t('browserAssets.webExtraction'), i18n.t(BROWSER_PROMPT_EXTRACTION_MODE_LABEL_KEYS[mode])],
      referenceImages: prepared.references,
    })
    report(i18n.t('browserAssets.savedToPromptLibraryNamed', { name: title }), 'success')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logRendererError('browser-prompt-extraction-failed', error)
    report(i18n.t('browserAssets.promptExtractionFailedToast', { error: reason }), 'error')
  }
}
