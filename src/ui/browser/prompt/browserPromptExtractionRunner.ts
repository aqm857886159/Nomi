import type { ToastType } from '../../toast'
// 网页提示词提取 runner（素材面收敛 2026-07-22）：产物只此一家=主提示词库「我的库」。
// 此前提取在素材盒弹层内跑、结果存 localStorage 私账卡（正牌提示词库找不到、顶栏浮窗恒空）；
// 提取由浏览器侧直接驱动：请求宿主原地反馈进度，成品 addUserPrompt 入主库（带参考图+模式标签）。
// 读图那一次调用在主进程（2026-10-27，docs/plan/2026-10-27-browser-extract-grant.md）：这里只备好参考图交过去，
// 主进程每次弹卡问人、铸令牌、再发；渲染层不碰令牌，也不再自己定温度与 maxTokens。
import i18n from '../../../i18n'
import { getDesktopBridge } from '../../../desktop/bridge'
import { addUserPrompt, getTextBrain } from '../../../workbench/api/promptLibraryApi'
import type { TaskResultDto } from '../../../workbench/api/taskApi'
import { classifyGenerationError } from '../../../workbench/observability/classifyError'
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

type PreparedPromptReference = {
  references: BrowserAssetPromptReference[]
  modelImageUrl: string
  /** 这张图的来处（卡上「图片」那一行）：原图地址；截图为空串（卡上写「页面截图」）。 */
  imageSourceUrl: string
}

/** 截图/原图落成可喂模型的参考（与旧弹层内 preparePromptReference 同一产路，去 React 化）。 */
async function preparePromptReference(
  request: BrowserAssetPromptCaptureRequest,
  initialReferences: readonly BrowserAssetPromptReference[],
): Promise<PreparedPromptReference> {
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
      imageSourceUrl: '',
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
      // 主进程真正去抓的就是这个地址：卡上写它，用户看到的就是模型会读的那张。
      imageSourceUrl: sourceUrl,
    }
  }
  const modelImageUrl = request.modelImageUrl || sourceUrl || initialReferences[0]?.url || ''
  return {
    references: [...initialReferences],
    modelImageUrl,
    imageSourceUrl: request.sourceType === 'screenshot' ? '' : sourceUrl || modelImageUrl,
  }
}

/** runner 自己说得清的失败（缺图、缺读图模型、入口不在、模型没回可用提示词）：这句话本身就是给人看的，原样上屏。 */
class PromptExtractionFailure extends Error {}

type ExtractionOutcome =
  | { outcome: 'done'; extracted: { title: string; prompt: string } }
  | { outcome: 'not-confirmed' }
  | { outcome: 'busy' }

async function runPromptExtraction(
  request: BrowserAssetPromptCaptureRequest,
  prepared: PreparedPromptReference,
  mode: BrowserPromptExtractionMode,
  settings: BrowserPromptExtractionTemplateSettings,
  projectId: string | null,
): Promise<ExtractionOutcome> {
  if (!prepared.modelImageUrl) throw new PromptExtractionFailure(i18n.t('browserAssets.promptReferenceMissing'))
  const brain = await getTextBrain({ strict: true })
  if (!brain) throw new PromptExtractionFailure(i18n.t('browserAssets.promptVisionModelMissing'))
  const runInMain = getDesktopBridge()?.browser?.runPromptExtraction
  if (!runInMain) throw new PromptExtractionFailure(i18n.t('browserAssets.promptEntryFailed'))
  // 主进程每次弹卡问人；卡上的来源页与图片由主进程从这两个地址算（来源页 = 主进程记下的浏览视图真实地址）。
  const outcome = await runInMain({
    vendor: brain.vendor,
    modelKey: brain.modelKey,
    prompt: browserPromptExtractionPromptFromSettings(settings, mode),
    imageUrl: prepared.modelImageUrl,
    mode,
    projectId,
    pageUrl: request.pageUrl?.trim() || '',
    imageSourceUrl: prepared.imageSourceUrl,
  })
  if (outcome.outcome !== 'done') return outcome
  const text = extractTextFromTaskResult(outcome.result as TaskResultDto)
  if (!text) throw new PromptExtractionFailure(i18n.t('browserAssets.promptModelEmpty'))
  const parsed = parseBrowserPromptExtraction(text, mode)
  if (!parsed.prompt) throw new PromptExtractionFailure(i18n.t('browserAssets.promptModelInvalid'))
  return { outcome: 'done', extracted: parsed }
}

/** 失败那一句：主进程 / 供应商的错误过 classifyGenerationError（IPC 外壳与结构化标记不上屏），runner 自己的原样说。 */
function failureMessage(error: unknown): string {
  if (error instanceof PromptExtractionFailure) return i18n.t('browserAssets.promptExtractionFailedToast', { error: error.message })
  const report = classifyGenerationError(error instanceof Error ? error.message : String(error))
  return report.hint
    ? i18n.t('browserAssets.promptExtractionFailedWithHint', { reason: report.reason, hint: report.hint })
    : i18n.t('browserAssets.promptExtractionFailedToast', { error: report.reason })
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
 * 弹卡之前换了项目就整次取消（那时一分钱没花）。弹卡之后不再判：钱可能已经花了，结果照样存进
 * 提示词库——库是全局的，不绑项目（协调 10-27 定）。
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
    const outcome = await runPromptExtraction(request, prepared, mode, settings, projectId)
    if (outcome.outcome === 'not-confirmed') {
      report(i18n.t('browserAssets.promptExtractionCancelled'), 'info')
      return
    }
    if (outcome.outcome === 'busy') {
      report(i18n.t('browserAssets.promptExtractionBusy'), 'warning')
      return
    }
    const title = fallbackTitle(request, outcome.extracted.title)
    await addUserPrompt({
      title,
      prompt: outcome.extracted.prompt,
      promptType: 'image',
      tags: [i18n.t('browserAssets.webExtraction'), i18n.t(BROWSER_PROMPT_EXTRACTION_MODE_LABEL_KEYS[mode])],
      referenceImages: prepared.references,
    })
    report(i18n.t('browserAssets.savedToPromptLibraryNamed', { name: title }), 'success')
  } catch (error) {
    logRendererError('browser-prompt-extraction-failed', error)
    report(failureMessage(error), 'error')
  }
}
