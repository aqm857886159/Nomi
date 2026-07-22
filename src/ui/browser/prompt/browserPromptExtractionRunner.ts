// 网页提示词提取 runner（素材面收敛 2026-07-22）：产物只此一家=主提示词库「我的库」。
// 此前提取在素材盒弹层内跑、结果存 localStorage 私账卡（正牌提示词库找不到、顶栏浮窗恒空）；
// 收敛后提取由浏览器侧直接驱动：toast 反馈进度，成品 addUserPrompt 入主库（带参考图+模式标签）。
import i18n from '../../../i18n'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import { getDesktopBridge } from '../../../desktop/bridge'
import { addUserPrompt, getTextBrain } from '../../../workbench/api/promptLibraryApi'
import { runWorkbenchTaskByVendor } from '../../../workbench/api/taskApi'
import { toast } from '../../toast'
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
import {
  BROWSER_PROMPT_EXTRACTION_MODE_LABELS,
  extractTextFromTaskResult,
  parseBrowserPromptExtraction,
  type BrowserPromptExtractionMode,
} from './browserPromptExtraction'
import {
  browserPromptExtractionPromptFromSettings,
  createDefaultBrowserPromptExtractionTemplateSettings,
  normalizeBrowserPromptExtractionTemplateSettings,
} from './browserPromptExtractionSettings'

async function loadExtractionSettings(): Promise<BrowserPromptExtractionTemplateSettings> {
  const browserBridge = getDesktopBridge()?.browser
  const projectId = getDesktopActiveProjectId()
  if (!projectId || !browserBridge?.readPromptExtractionSettings) return createDefaultBrowserPromptExtractionTemplateSettings()
  try {
    const result = await browserBridge.readPromptExtractionSettings({ projectId })
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
  const projectId = getDesktopActiveProjectId()
  const sourceUrl = request.sourceUrl?.trim() || initialReferences[0]?.sourceUrl || initialReferences[0]?.url || ''
  if (request.sourceType === 'screenshot' && request.viewId && browserBridge?.capturePromptScreenshot) {
    const captured = await browserBridge.capturePromptScreenshot({
      viewId: request.viewId,
      ...(projectId ? { projectId } : {}),
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
      ...(projectId ? { projectId } : {}),
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
): Promise<{ title: string; prompt: string }> {
  if (!modelImageUrl) throw new Error('没有可分析的参考图')
  const brain = await getTextBrain()
  if (!brain) throw new Error('请先在「模型接入」里启用一个支持图片输入的文本模型')
  const result = await runWorkbenchTaskByVendor(brain.vendor, {
    kind: 'image_to_prompt',
    prompt: browserPromptExtractionPromptFromSettings(settings, mode),
    extras: {
      modelKey: brain.modelKey,
      referenceImages: [modelImageUrl],
      temperature: mode === 'style' ? 0.2 : 0.35,
      maxTokens: mode === 'style' ? 1800 : 1600,
    },
  })
  const text = extractTextFromTaskResult(result)
  if (!text) throw new Error('模型没有返回提示词')
  const parsed = parseBrowserPromptExtraction(text, mode)
  if (!parsed.prompt) throw new Error('模型没有返回可用提示词')
  return parsed
}

function fallbackTitle(request: BrowserAssetPromptCaptureRequest, extractedTitle: string): string {
  const title = (extractedTitle || request.title || request.pageTitle || '').trim()
  if (title) return title.slice(0, 48)
  const mode = promptExtractionModeFromRequest(request)
  if (mode === 'style') return request.sourceType === 'screenshot' ? i18n.t('browserAssets.screenshotStyle') : i18n.t('browserAssets.extraction.style')
  return request.sourceType === 'screenshot' ? i18n.t('browserAssets.screenshotPromptTitle') : i18n.t('browserAssets.extraction.imagePrompt')
}

/** 浏览器截图/图片右键 → 提取提示词 → 直存主提示词库。fire-and-forget，进度/结果全走 toast。 */
export async function runBrowserPromptExtractionToLibrary(request: BrowserAssetPromptCaptureRequest): Promise<void> {
  const mode = promptExtractionModeFromRequest(request)
  toast(i18n.t('browserAssets.extractingPrompt', { mode: BROWSER_PROMPT_EXTRACTION_MODE_LABELS[mode] }))
  try {
    const settings = await loadExtractionSettings()
    const initialReferences = promptReferenceImagesFromRequest(request)
    const prepared = await preparePromptReference(request, initialReferences)
    const extracted = await runPromptExtraction(prepared.modelImageUrl, mode, settings)
    const title = fallbackTitle(request, extracted.title)
    await addUserPrompt({
      title,
      prompt: extracted.prompt,
      promptType: 'image',
      tags: ['网页提取', BROWSER_PROMPT_EXTRACTION_MODE_LABELS[mode]],
      referenceImages: prepared.references,
    })
    toast(i18n.t('browserAssets.savedToPromptLibraryNamed', { name: title }), 'success')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error('[nomi:browser] 提示词提取失败:', reason)
    toast(i18n.t('browserAssets.promptExtractionFailedToast', { error: reason }), 'error')
  }
}
