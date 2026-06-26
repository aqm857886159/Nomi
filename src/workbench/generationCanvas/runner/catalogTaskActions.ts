import {
  type TaskKind,
  type TaskRequestDto,
  type TaskResultDto,
  fetchWorkbenchTaskResultByVendor,
  runWorkbenchTaskByVendor,
  runWorkbenchTextTaskStream,
} from '../../api/taskApi'
import type {
  GenerationCanvasNode,
  GenerationNodeResult,
} from '../model/generationCanvasTypes'
import type { ResolvedGenerationReferences } from './generationReferenceResolver'
import { narrateProgress, type GenerationProgressPhase, type ProgressNarrationContext } from '../../observability/narrate'
import { resolveArchetypeForModel } from '../../../config/modelArchetypes'
import { buildArchetypeInputParams, orderedSentImageReferenceUrls } from '../nodes/controls/archetypeMeta'
import { projectPromptForSend } from '../../assets/promptMentions'
import {
  type CatalogTaskActionOptions,
  asFiniteNumber,
  asTrimmedString,
  readStringArray,
  resolveExecutableNodeFromCatalog,
  resolveTaskKind,
  selectedModelKey,
  selectedVendor,
  uniqueStrings,
} from './catalogTaskResolve'
import { normalizeCatalogTaskResult } from './catalogTaskResultParse'
import { RecoverableTimeoutError } from './recoverableTimeout'

// 重导出：实现已拆到 catalogTaskResolve（节点→vendor/model/kind 选择）与
// catalogTaskResultParse（raw/asset/failure/provenance 解析），但 catalogTaskActions
// 对外公共导出面保持不变，外部 import 路径无需改动。
export type { CatalogTaskActionOptions } from './catalogTaskResolve'
export { normalizeCatalogTaskResult } from './catalogTaskResultParse'

const TERMINAL_STATUSES = new Set(['succeeded', 'failed'])

// 走流式文本通道的 kind(与 catalogTaskResultParse 的 TEXT_TASK_KINDS 同语义)。
const TEXT_STREAM_KINDS = new Set<TaskKind>(['chat', 'prompt_refine', 'image_to_prompt'])

function buildReferenceExtras(
  node: GenerationCanvasNode,
  references: Partial<ResolvedGenerationReferences>,
): Record<string, unknown> {
  const meta = node.meta || {}
  const referenceImages = uniqueStrings([
    ...readStringArray(meta.referenceImages),
    ...(references.referenceImages || []),
  ])
  const styleReferenceImages = uniqueStrings([
    ...readStringArray(meta.styleReferenceImages),
    ...(references.styleReferenceImages || []),
  ])
  const characterReferenceImages = uniqueStrings([
    ...readStringArray(meta.characterReferenceImages),
    ...(references.characterReferenceImages || []),
  ])
  const compositionReferenceImages = uniqueStrings([
    ...readStringArray(meta.compositionReferenceImages),
    ...(references.compositionReferenceImages || []),
  ])
  // 认得档案的模型 → renderer 据**当前模式**把参考值打成完整 snake input（含 per-mode enum），放进
  // extras.archetypeInput，runtime 原样铺进 params（M1/M2/M3）。别的模式的残留键根本不进结果（互斥）。
  // 认不出 → 现有无条件带首/尾帧（非档案模型走老路）。
  const archetype = resolveArchetypeForModel({
    modelKey: asTrimmedString(meta.modelKey),
    modelAlias: asTrimmedString(meta.modelAlias),
    meta,
  })
  if (archetype) {
    const archetypeInput = buildArchetypeInputParams(meta, archetype, {
      firstFrameUrl: asTrimmedString(references.firstFrameUrl) || null,
      lastFrameUrl: asTrimmedString(references.lastFrameUrl) || null,
      // 切片1：把画布边产出的实时参考图喂进档案 image 槽（此前只读 meta，边的角色图被丢）。
      // referenceImages 已是 meta.referenceImages + 边超集的去重并集。
      referenceImages,
      // B4：连线进来的视频/音频参考喂进 video_ref/audio_ref 槽（此前只收 meta 上传）。
      referenceVideos: references.referenceVideos || [],
      referenceAudios: references.referenceAudios || [],
    })
    return {
      ...(referenceImages.length ? { referenceImages } : {}),
      archetypeInput,
      ...(styleReferenceImages.length ? { styleReferenceImages } : {}),
      ...(characterReferenceImages.length ? { characterReferenceImages } : {}),
      ...(compositionReferenceImages.length ? { compositionReferenceImages } : {}),
    }
  }

  const firstFrameUrl = asTrimmedString(references.firstFrameUrl) || asTrimmedString(meta.firstFrameUrl)
  const lastFrameUrl = asTrimmedString(references.lastFrameUrl) || asTrimmedString(meta.lastFrameUrl)
  return {
    ...(referenceImages.length ? { referenceImages } : {}),
    ...(firstFrameUrl ? { firstFrameUrl } : {}),
    ...(lastFrameUrl ? { lastFrameUrl } : {}),
    ...(styleReferenceImages.length ? { styleReferenceImages } : {}),
    ...(characterReferenceImages.length ? { characterReferenceImages } : {}),
    ...(compositionReferenceImages.length ? { compositionReferenceImages } : {}),
  }
}

export function buildCatalogTaskRequest(
  node: GenerationCanvasNode,
  options: CatalogTaskActionOptions = {},
): { vendor: string; request: TaskRequestDto } {
  const vendor = selectedVendor(node)
  if (!vendor) throw new Error('请先在模型管理里选择一个可用模型')
  const modelKey = selectedModelKey(node)
  if (!modelKey) throw new Error('请先选择模型')
  const rawPrompt = asTrimmedString(node.prompt)
  if (!rawPrompt) throw new Error('prompt is required')

  const references = options.references || {}
  const kind = resolveTaskKind(node, references)
  const meta = node.meta || {}
  // @ 内联引用投影(R6 单源 · option 2 · 2026-06-25):把 prompt 里的 @[asset:url] 标记转成 character{N}，
  // N = url 在「连线在前+上传」有序数组里的位置——**与实际发送的 reference_image 数组逐位一致**。此前只读
  // meta.referenceImageUrls，把连线进来的参考图当成「不在数组里」直接把 @ 标记删成空串（连线图 @ 不到/被
  // 删空的根因）。纯文字 prompt 无标记 → 原样(no-op)。无档案模型回退旧口径（仅上传）。
  const promptRefArchetype = resolveArchetypeForModel({
    modelKey: asTrimmedString(meta.modelKey),
    modelAlias: asTrimmedString(meta.modelAlias),
    meta,
  })
  const orderedReferenceUrls = promptRefArchetype
    ? orderedSentImageReferenceUrls(meta, promptRefArchetype, references.referenceImages || [])
    : readStringArray(meta.referenceImageUrls)
  const prompt = projectPromptForSend(rawPrompt, orderedReferenceUrls)
  // 站位构图参考：出关键帧时把 staging 灰模图当「构图蓝图」而非编辑底图——照站位/姿势/机位，
  // 但写实重渲染，别照搬灰模 3D 外观（评测发现 image_edit 直喂会出 CGI 感）。只对图像生成加。
  const finalPrompt =
    references.stagingComposition && (kind === 'text_to_image' || kind === 'image_edit')
      ? `${prompt}\n\n（构图参考仅用于确定人物站位、各自姿势和镜头机位；请据此完全写实地重新渲染人物与场景——真实皮肤/衣物/光影，不要保留参考图里灰色人偶或 3D 渲染的外观。）`
      : prompt
  const width = asFiniteNumber(meta.width)
  const height = asFiniteNumber(meta.height)
  const steps = asFiniteNumber(meta.steps)
  const cfgScale = asFiniteNumber(meta.cfgScale)
  const seed = asFiniteNumber(meta.seed)

  return {
    vendor,
    request: {
      kind,
      prompt: finalPrompt,
      ...(typeof seed === 'number' ? { seed } : {}),
      ...(typeof width === 'number' ? { width } : {}),
      ...(typeof height === 'number' ? { height } : {}),
      ...(typeof steps === 'number' ? { steps } : {}),
      ...(typeof cfgScale === 'number' ? { cfgScale } : {}),
      extras: {
        ...meta,
        modelKey,
        modelAlias: asTrimmedString(meta.modelAlias) || modelKey,
        nodeId: node.id,
        nodeKind: node.kind,
        // 付费守卫令牌：随 extras 下到主进程 runTask 核验消费（无则主进程拦截）。
        ...(options.grantId ? { grantId: options.grantId } : {}),
        // S8 缓存语义:节点血统里已出过图(result 或 history,含「基于此重生成」副本)→
        // 再点生成=用户要重抽 → 强制重跑绕指纹缓存;首次生成/批量补跑同配方命中缓存
        // 秒回零花费(防双击/重复受理重复扣费)。路由旗标,不进指纹。
        ...(node.result || (node.history && node.history.length > 0) ? { forceRerun: true } : {}),
        ...buildReferenceExtras(node, references),
      },
    },
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

async function waitForCatalogTaskResult(
  vendor: string,
  request: TaskRequestDto,
  initialResult: TaskResultDto,
  options: CatalogTaskActionOptions,
): Promise<TaskResultDto> {
  if (TERMINAL_STATUSES.has(initialResult.status)) return initialResult
  const pollIntervalMs = options.pollIntervalMs ?? 1500
  const isVideo = request.kind === 'text_to_video' || request.kind === 'image_to_video'
  // 软超时：到点不报错，只把文案切成「仍在生成·已超常规时长」，后台继续等（视频 5min→续拉到 hard）。
  // 硬超时：真停，抛可找回错误（视频 20min；非视频 2min）。options.pollTimeoutMs 覆盖时 soft=hard（测试可控）。
  const softTimeoutMs = options.pollTimeoutMs ?? (isVideo ? 300000 : 120000)
  const hardTimeoutMs = options.pollTimeoutMs ?? (isVideo ? 1200000 : 120000)
  const startedAt = Date.now()
  const fetchResult = options.fetchTaskResult || fetchWorkbenchTaskResultByVendor

  let current = initialResult
  while (!TERMINAL_STATUSES.has(current.status)) {
    const elapsedMs = Date.now() - startedAt
    if (elapsedMs > hardTimeoutMs) {
      // 超时≠失败：上游可能仍在跑/已出片 → 抛可找回错误，节点落 recoverable，给「重新拉取」入口。
      throw new RecoverableTimeoutError({
        taskId: initialResult.id,
        vendor,
        taskKind: request.kind,
        modelKey: asTrimmedString(request.extras?.modelKey),
      })
    }
    // S2:每个轮询 tick 回报进度(人话 + 已等秒数),不再静默吞掉 status。软超时后切「仍在生成·已超常规时长」。
    const overSoft = elapsedMs > softTimeoutMs
    options.onProgress?.({
      phase: overSoft ? 'still-generating' : 'generating',
      message: narrateProgress(overSoft ? 'still-generating' : 'generating', { elapsedMs }),
      taskId: initialResult.id,
    })
    await delay(pollIntervalMs)
    const response = await fetchResult({
      taskId: initialResult.id,
      vendor,
      taskKind: request.kind,
      prompt: request.prompt,
      modelKey: asTrimmedString(request.extras?.modelKey) || null,
    })
    current = response.result
  }
  return current
}

export async function runCatalogGenerationTask(
  node: GenerationCanvasNode,
  options: CatalogTaskActionOptions = {},
): Promise<GenerationNodeResult> {
  // S2 进度报告:每个阶段说人话(narrate 注册表),治"卡 30 秒像死了"(bug② 根因之一:
  // 此前轮询拿到 status 后随手丢弃,且无任何阶段回报)。
  const report = (phase: GenerationProgressPhase, taskId?: string, ctx?: ProgressNarrationContext) =>
    options.onProgress?.({ phase, message: narrateProgress(phase, ctx), ...(taskId ? { taskId } : {}) })
  report('resolving')
  const executableNode = await resolveExecutableNodeFromCatalog(node, options)
  const { vendor, request } = buildCatalogTaskRequest(executableNode, options)

  // 文本任务 + 调用方要逐字 → 走流式通道:逐 token 回调 onTextDelta,终态直接返回
  // (文本无轮询,流 resolve 即 succeeded),不走下面的 runTask + 轮询。runTask 覆盖项
  // (测试注入)优先,保持单测可控。
  if (options.onTextDelta && TEXT_STREAM_KINDS.has(request.kind) && !options.runTask) {
    const runTextStream = options.runTextStream || runWorkbenchTextTaskStream
    report('requesting')
    const streamed = await runTextStream(vendor, request, { onDelta: options.onTextDelta })
    report('finalizing', streamed.id)
    return normalizeCatalogTaskResult(streamed, executableNode)
  }

  const runTask = options.runTask || runWorkbenchTaskByVendor
  report('requesting')
  const initialResult = await runTask(vendor, request)
  report('waiting', initialResult.id)
  const finalResult = await waitForCatalogTaskResult(vendor, request, initialResult, options)
  report('finalizing', initialResult.id)
  return normalizeCatalogTaskResult(finalResult, executableNode)
}
