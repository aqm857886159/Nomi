import { getDesktopBridge } from '../../../desktop/bridge'
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
import { resolveGenerationReferences } from './generationReferenceResolver'
import { readParameterReferenceSlots } from '../model/parameterReferenceSlots'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { applyRelayFirstFrame } from './relayFrameResolver'
import { narrateProgress, type GenerationProgressPhase, type ProgressNarrationContext } from '../../observability/narrate'
import { buildArchetypeInputParams, currentArchetypeMode, orderedSentImageReferenceUrls, orderedSentMediaReferenceUrls } from '../nodes/controls/archetypeMeta'
import { projectPromptForSend } from '../../assets/promptMentions'
import {
  type CatalogTaskActionOptions,
  asFiniteNumber,
  asTrimmedString,
  readStringArray,
  resolveTaskArchetype,
  resolveExecutableNodeFromCatalog,
  resolveTaskKind,
  selectedModelKey,
  selectedVendor,
  uniqueStrings,
} from './catalogTaskResolve'
import { promptRequiredForNode } from './promptRequirement'
import { normalizeCatalogTaskResult } from './catalogTaskResultParse'
import { localizeRemoteResultUrl } from './resultAssetLocalization'
import {
  LocalTaskCancelledError,
  isTaskCancelRequested,
  unwatchComfyuiProgress,
  watchComfyuiProgress,
} from './localTaskControl'
import { isComfyuiVendorKey } from '../model/comfyuiVendor'
import { getActiveWorkbenchProjectId } from '../../project/workbenchProjectSession'
import { RecoverableTimeoutError } from './recoverableTimeout'
import { parseVendorErrorFromMessage } from './vendorErrorIpc'
import { collectLocalAssetUrls } from '../../../../electron/catalog/assetLocalization'
import { readParameterReferenceContract } from '../../../../electron/catalog/parameterReferenceContract'

// 重导出：实现已拆到 catalogTaskResolve（节点→vendor/model/kind 选择）与
// catalogTaskResultParse（raw/asset/failure/provenance 解析），但 catalogTaskActions
// 对外公共导出面保持不变，外部 import 路径无需改动。
export type { CatalogTaskActionOptions } from './catalogTaskResolve'
export { normalizeCatalogTaskResult } from './catalogTaskResultParse'

const TERMINAL_STATUSES = new Set(['succeeded', 'failed'])

// 任务已提交(付费已发生)后，查结果连续失败多久就放弃轮询、落「可找回」态（不重发，给「重新拉取」入口）。
// 短于此 = 网络抖动，免费重试查询；长于此 = 上游/网络持续不可达，没必要干等到硬超时(视频 20min)空耗。
const POLL_FAILURE_GRACE_MS = 45000

// 走流式文本通道的 kind(与 catalogTaskResultParse 的 TEXT_TASK_KINDS 同语义)。
const TEXT_STREAM_KINDS = new Set<TaskKind>(['chat', 'prompt_refine', 'image_to_prompt'])

// Imported Comfy media inputs are exact keyed parameters. Unique-slot uploads
// still persist these generic aliases for old projects/non-Comfy consumers, but
// none of them may cross the Comfy request boundary and become a second wire.
// A declared slot key always wins even if it happens to share a legacy name.
const COMFY_PARAMETER_GENERIC_REFERENCE_KEYS = new Set([
  'image', 'image_url', 'imageUrl',
  'referenceImages', 'referenceImageUrl', 'referenceImageUrls', 'referenceImageRef', 'referenceImageRefs',
  'reference_images', 'reference_image_urls',
  'firstFrameUrl', 'firstFrameRef', 'firstFrameReference', 'first_frame_url',
  'lastFrameUrl', 'lastFrameRef', 'lastFrameReference', 'last_frame_url',
  'referenceVideoUrls', 'reference_video_urls', 'sourceVideoUrl', 'source_video_url', 'video_url',
  'referenceAudioUrls', 'reference_audio_urls',
  'styleReferenceImages', 'characterReferenceImages', 'compositionReferenceImages',
  'upstreamResultUrls', 'archetypeInput', 'activeAssetUrls',
])

function comfyParameterContract(meta: Record<string, unknown>) {
  const contract = readParameterReferenceContract(meta)
  return contract && isComfyuiVendorKey(contract.vendorKey) ? contract : null
}

function parameterContractRequestMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const contract = comfyParameterContract(meta)
  if (!contract) return meta
  const declaredKeys = new Set(contract.slots.map((slot) => slot.key))
  return Object.fromEntries(Object.entries(meta).filter(([key]) =>
    declaredKeys.has(key) || !COMFY_PARAMETER_GENERIC_REFERENCE_KEYS.has(key)))
}

function parameterReferenceInputs(
  meta: Record<string, unknown>,
  references: Partial<ResolvedGenerationReferences>,
): Record<string, string | null> {
  return Object.fromEntries(readParameterReferenceSlots(meta)
    .filter((slot) => Object.prototype.hasOwnProperty.call(references.parameterReferenceUrls ?? {}, slot.key))
    .map((slot) => [slot.key, references.parameterReferenceUrls![slot.key]]))
}

function usesComfyParameterContract(meta: Record<string, unknown>): boolean {
  return Boolean(comfyParameterContract(meta))
}

// 本地进程/队列后端：codex(`codex exec $imagegen`,官方 smoke 就 ~75s)、本地 ComfyUI 队列(可达数分钟)——
// 都跑在用户机器上,时延本质是「秒级到分钟级」且方差大,不能和「秒级返回的云图像 API」共用 2min 硬超时:
// 否则本地图还在生成就被判超时落「可找回」,用户体验成「Codex 生图拉取步骤超时」(群反馈 2026-07-30 的根因)。
// 判据用 vendor key(稳定:codex-local/comfyui-local 都是 local:// 或本机 127.0.0.1 后端)。
// ComfyUI 单列走前缀判据:第 2+ 台实例的 key 是 `comfyui-local-{slug}`,放进定值集合只覆盖得了第一台,
// 用户加第二台机器就会被云 API 的 2min 硬超时腰斩。
const SLOW_LOCAL_BACKENDS = new Set(['codex-local', 'antigravity-cli'])

// 轮询按「后端时延」而非「视频 vs 图像」分档:慢道 = 视频 ∪ 本地进程后端。这样本地生图(codex/comfyui)
// 不再被云 API 的 2min 硬超时腰斩,而 codex 进程真跑完(成功/失败)时 query 立即返回终态、循环自然结束,
// 故放宽硬超时纯为「等它跑完」、不会平白多等(查结果免费、不重发、不二次扣费)。
export function isSlowLaneBackend(kind: TaskKind, vendor: string): boolean {
  return kind === 'text_to_video' || kind === 'image_to_video'
    || SLOW_LOCAL_BACKENDS.has(vendor) || isComfyuiVendorKey(vendor)
}

/** 轮询预算(ms):慢道(视频/本地进程后端)5min 软 / 20min 硬;快道云 API 2min 软=硬。 */
export function resolvePollBudget(kind: TaskKind, vendor: string): { softMs: number; hardMs: number } {
  return isSlowLaneBackend(kind, vendor)
    ? { softMs: 300000, hardMs: 1200000 }
    : { softMs: 120000, hardMs: 120000 }
}

/**
 * 轮询**间隔**(ms)：慢道 3s、快道 1.5s。分档判据复用 isSlowLaneBackend，不另立第二套。
 *
 * 3s 不是拍脑袋：厂商文档明写「将任务查询间隔分散到 3 至 5 秒以上，避免所有任务在同一时刻轮询」
 * （2026-07-31 Seedance 2.0 交付文档 §5.1，见 docs/plan/2026-07-31-seedance-api-contract-reconciliation.md）。
 * 只放慢慢道：视频/本地后端本身就是分钟级，1.5s→3s 用户零感知；云图像是秒级返回的，
 * 拉长立刻被察觉成「慢了」。对所有 vendor 生效——礼貌轮询不是给某一家开的小灶。
 *
 * 无头/MCP 那条循环在主进程（electron/capabilityCore/core.ts），跨进程边界 import 不到这里，
 * 那边是**配对常量、改一处必改另一处**（同 vendorErrorIpc 的 MARKER 约定）。
 */
export function resolvePollIntervalMs(kind: TaskKind, vendor: string): number {
  return isSlowLaneBackend(kind, vendor) ? 3000 : 1500
}

/**
 * 抖动幅度 ±30%。批量生成时最多 8 个节点在同一 tick 起跑（runGenerationNodesBatch 的 worker 池），
 * 不抖动它们就**永远同相位**，对上游状态端点是「每个间隔一次 8 连发」的脉冲——正是上面那份文档
 * 点名要避免的模式。抖动把同一批请求摊进整个间隔窗口。
 */
const POLL_JITTER_RATIO = 0.3

/** 连续 429 的退避封顶(ms)。没有封顶的话久限流会把间隔滚到分钟级，白白拖长「出片了但界面没反应」。 */
const POLL_BACKOFF_CAP_MS = 30000

/**
 * 下一次查询前该等多久 = 基准间隔 × 429 连击退避（2^n），再叠 ±30% 抖动，最后封顶。
 *
 * 以前 429 被空 catch 吞掉、下一轮照原节奏再敲——上游说「太频繁」我们还加倍撞，只会撞得更狠。
 * `random` 注入以便直测（默认 Math.random）。
 */
export function nextPollDelayMs(
  baseMs: number,
  rateLimitStreak: number,
  random: () => number = Math.random,
): number {
  const backoffMs = rateLimitStreak > 0 ? baseMs * 2 ** rateLimitStreak : baseMs
  const jitter = 1 + (random() * 2 - 1) * POLL_JITTER_RATIO
  return Math.max(1, Math.min(Math.round(backoffMs * jitter), POLL_BACKOFF_CAP_MS))
}

/**
 * 这次查询失败是不是「被限流」。优先信 structured（VendorRequestError 经 IPC 标记穿透的事实，
 * 429 → category quota），拿不到再退回文案。**只有它才触发退避**：普通网络抖动退避会平白拖慢出片。
 */
export function isRateLimitedPollError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const structured = parseVendorErrorFromMessage(message)
  if (structured) return structured.httpStatus === 429 || structured.category === 'quota'
  return /(^|\D)429(\D|$)/.test(message) || /rate limit|too many requests/i.test(message)
}

function buildReferenceExtras(
  meta: Record<string, unknown>,
  references: Partial<ResolvedGenerationReferences>,
): Record<string, unknown> {
  const parameterInputs = parameterReferenceInputs(meta, references)
  const exactComfyParameters = usesComfyParameterContract(meta)
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
  const archetype = resolveTaskArchetype(meta)
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
    // 标准参考面（camelCase firstFrameUrl/lastFrameUrl/referenceImages）**与档案投影并存**——
    // electron 侧的标准键（reference_images/chat_image_parts/image_url…）由它派生，通用中转模板
    // 只认标准键。旧实现档案分支把 firstFrameUrl/lastFrameUrl 丢掉、archetypeInput 独占参考通道 →
    // 中转上撞档案名的模型改图不带图/i2v 首帧到不了 wire（2026-07-24 群反馈根因）。
    // M2 互斥同样约束标准面：首/尾帧只在**当前模式声明了对应槽**时才带（活边优先、meta 兜底），
    // 否则「首帧模式残留尾帧」的 §2 坑2 会从标准键复活（kie 同名 token 渲进 body）。
    const mode = currentArchetypeMode(archetype, meta)
    const modeHasFirst = (mode.slots || []).some((slot) => slot.kind === 'first_frame')
    const modeHasLast = (mode.slots || []).some((slot) => slot.kind === 'last_frame')
    const firstFrameUrl = modeHasFirst
      ? asTrimmedString(references.firstFrameUrl) || asTrimmedString(meta.firstFrameUrl)
      : ''
    const lastFrameUrl = modeHasLast
      ? asTrimmedString(references.lastFrameUrl) || asTrimmedString(meta.lastFrameUrl)
      : ''
    // 档案图槽的上传住 meta.referenceImageUrls（ARRAY_SLOT_ROUTE.image_ref.metaKey）——它同样必须进
    // 标准面，否则中转 multipart 的 params.reference_images 恒空、0 张图被诚实抛（走查 B 段抓出的
    // 第二个吞点）。同样按当前模式门控（声明了 image_ref 槽才带，防 t2i 残留复活进 chat 回退 body）。
    const modeHasImageArray = (mode.slots || []).some((slot) => slot.kind === 'image_ref')
    const standardReferenceImages = uniqueStrings([
      ...referenceImages,
      ...(modeHasImageArray ? readStringArray(meta.referenceImageUrls) : []),
    ])
    const derived = {
      ...(standardReferenceImages.length ? { referenceImages: standardReferenceImages } : {}),
      ...(firstFrameUrl ? { firstFrameUrl } : {}),
      ...(lastFrameUrl ? { lastFrameUrl } : {}),
      archetypeInput,
      ...(styleReferenceImages.length ? { styleReferenceImages } : {}),
      ...(characterReferenceImages.length ? { characterReferenceImages } : {}),
      ...(compositionReferenceImages.length ? { compositionReferenceImages } : {}),
    }
    return exactComfyParameters ? { ...derived, ...parameterInputs } : { ...parameterInputs, ...derived }
  }

  const firstFrameUrl = asTrimmedString(references.firstFrameUrl) || asTrimmedString(meta.firstFrameUrl)
  const lastFrameUrl = asTrimmedString(references.lastFrameUrl) || asTrimmedString(meta.lastFrameUrl)
  // 连线进来的视频参考：档案分支喂进 video_ref 槽，**无档案分支此前整个丢掉** ——
  // ComfyUI 导入的工作流正是无档案，于是「补帧 / 视频超分 / 视频去背景」这类图
  // 连了视频也永远收不到（electron 侧 referenceInputParams 据此派生 source_video_url）。
  const referenceVideoUrls = uniqueStrings(references.referenceVideos || [])
  const derived = {
    ...(referenceImages.length ? { referenceImages } : {}),
    ...(referenceVideoUrls.length ? { referenceVideoUrls } : {}),
    ...(firstFrameUrl ? { firstFrameUrl } : {}),
    ...(lastFrameUrl ? { lastFrameUrl } : {}),
    ...(styleReferenceImages.length ? { styleReferenceImages } : {}),
    ...(characterReferenceImages.length ? { characterReferenceImages } : {}),
    ...(compositionReferenceImages.length ? { compositionReferenceImages } : {}),
  }
  return exactComfyParameters ? { ...derived, ...parameterInputs } : { ...parameterInputs, ...derived }
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
  // 需不需要提示词按模型派生（promptRequirement 单源）：处理类 ComfyUI 工作流（去背景/超分/补帧）
  // 本就没有提示词槽，此前这里无条件抛一句英文 'prompt is required' 把整类工作流堵死。
  if (!rawPrompt && promptRequiredForNode(node, vendor)) throw new Error('请先写点提示词再生成。')

  const references = options.references || {}
  const kind = resolveTaskKind(node, references)
  const meta = parameterContractRequestMeta(node.meta || {})
  // @ 内联引用投影(R6 单源 · option 2):把 prompt 里的 @[asset:url] 标记转成 @imageN，
  // N = url 在「连线在前+上传」有序数组里的位置——**与实际发送的 reference_image 数组逐位一致**。此前只读
  // meta.referenceImageUrls，把连线进来的参考图当成「不在数组里」直接把 @ 标记删成空串（连线图 @ 不到/被
  // 删空的根因）。纯文字 prompt 无标记 → 原样(no-op)。无档案模型回退旧口径（仅上传）。
  const promptRefArchetype = resolveTaskArchetype(meta)
  const orderedReferenceUrls = promptRefArchetype
    ? orderedSentImageReferenceUrls(meta, promptRefArchetype, references.referenceImages || [])
    : readStringArray(meta.referenceImageUrls)
  const orderedPromptReferences = promptRefArchetype
    ? orderedSentMediaReferenceUrls(meta, promptRefArchetype, {
      image: references.referenceImages || [],
      video: references.referenceVideos || [],
      audio: references.referenceAudios || [],
    })
    : orderedReferenceUrls
  const prompt = projectPromptForSend(rawPrompt, orderedPromptReferences)
  // 站位构图参考：出关键帧时把 staging 灰模图当「构图蓝图」而非编辑底图——照站位/姿势/机位，
  // 但写实重渲染，别照搬灰模 3D 外观（评测发现 image_edit 直喂会出 CGI 感）。只对图像生成加。
  const renderedPrompt =
    references.stagingComposition && (kind === 'text_to_image' || kind === 'image_edit')
      ? `${prompt}\n\n（构图参考仅用于确定人物站位、各自姿势和镜头机位；请据此完全写实地重新渲染人物与场景——真实皮肤/衣物/光影，不要保留参考图里灰色人偶或 3D 渲染的外观。）`
      : prompt
  // Production QA targeted retries carry a short, machine-authored correction directive.
  // Keep it out of the node's durable prompt (the original remains inspectable) and append it
  // only to this submission so a retry fixes the flagged axis without rewriting the storyboard.
  const promptSuffix = asTrimmedString(options.promptSuffix)
  const finalPrompt = promptSuffix ? `${renderedPrompt}\n\n${promptSuffix}` : renderedPrompt
  const width = asFiniteNumber(meta.width)
  const height = asFiniteNumber(meta.height)
  const steps = asFiniteNumber(meta.steps)
  const cfgScale = asFiniteNumber(meta.cfgScale)
  const seed = asFiniteNumber(meta.seed)
  const referenceExtras = buildReferenceExtras(meta, references)
  const extras = {
    ...meta,
    modelKey,
    modelAlias: asTrimmedString(meta.modelAlias) || modelKey,
    nodeId: node.id,
    nodeKind: node.kind,
    // 付费守卫令牌：随 extras 下到主进程 runTask 核验消费（无则主进程拦截）。
    ...(options.grantId ? { grantId: options.grantId } : {}),
    ...(options.anonymousAssetHostingConsent ? { anonymousAssetHostingConsent: options.anonymousAssetHostingConsent } : {}),
    // 提交幂等键：随 extras 下到主进程 runTask，同键提交内核 at-most-once（堵「丢回执→重试→二次下单」）。
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    // S8 缓存语义:节点血统里已出过图(result 或 history,含「基于此重生成」副本)→
    // 再点生成=用户要重抽 → 强制重跑绕指纹缓存;首次生成/批量补跑同配方命中缓存
    // 秒回零花费(防双击/重复受理重复扣费)。路由旗标,不进指纹。
    ...(node.result || (node.history && node.history.length > 0) ? { forceRerun: true } : {}),
    ...referenceExtras,
  }
  const activeAssetUrls = Array.from(collectLocalAssetUrls(extras))
  const exactParameterInputs = usesComfyParameterContract(meta)
    ? parameterReferenceInputs(meta, references)
    : {}

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
      // 主进程根据这个 allowlist 只上传仍然活跃的本地素材；过期/残留引用不再把生成卡死。
      extras: {
        ...extras,
        ...(activeAssetUrls.length ? { activeAssetUrls } : {}),
        ...exactParameterInputs,
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
  // 基准间隔按后端分档（慢道 3s / 快道 1.5s，见 resolvePollIntervalMs）；每轮实际等待还要叠
  // 429 退避与 ±30% 抖动（nextPollDelayMs）。options.pollIntervalMs 覆盖时仍走抖动/退避，
  // 但测试给 1ms 时抖动后仍是 1ms 量级，不影响既有用例。
  const pollIntervalMs = options.pollIntervalMs ?? resolvePollIntervalMs(request.kind, vendor)
  // 软超时：到点不报错，只把文案切成「仍在生成·已超常规时长」，后台继续等（慢道 5min→续拉到 hard）。
  // 硬超时：真停，抛可找回错误（慢道=视频/本地进程后端 20min；快道云 API 2min）。
  // 分档见 resolvePollBudget：按后端时延分,不再把本地生图(codex/comfyui)当快道云 API 腰斩。
  // options.pollTimeoutMs 覆盖时 soft=hard（测试可控）。
  const budget = resolvePollBudget(request.kind, vendor)
  const softTimeoutMs = options.pollTimeoutMs ?? budget.softMs
  const hardTimeoutMs = options.pollTimeoutMs ?? budget.hardMs
  const startedAt = Date.now()
  const fetchResult = options.fetchTaskResult || fetchWorkbenchTaskResultByVendor

  // ⚠️ 钱安全铁律：到这里 runTask 已成功、付费已发生(initialResult.id 是真任务)。本轮询【只查不提交】，
  // 且查结果失败【绝不】能冒泡出去——否则会落进外层 runGenerationNode 的重试循环重新 runTask 二次扣费
  // (单确认最多 ×3/节点、批量再乘节点数 = 用户报「平台冒出很多视频、被扣费」的根因)。查结果是免费的：
  // 抖动就免费重试查询；持续失败超 grace(或到硬超时) → 落可找回态(不重发)。recoverable 在外层不触发重试。
  const recoverableTimeout = () => new RecoverableTimeoutError({
    taskId: initialResult.id,
    vendor,
    taskKind: request.kind,
    modelKey: asTrimmedString(request.extras?.modelKey),
  })
  let current = initialResult
  let pollFailureStreakStartedAt: number | null = null
  // 连续被限流的次数 → 指数退避的指数。查成功或换成别的失败原因即复位。
  let rateLimitStreak = 0
  const cancelNodeId = asTrimmedString(request.extras?.nodeId)
  while (!TERMINAL_STATUSES.has(current.status)) {
    // P 轨遮罩取消：/interrupt 已发（免费幂等），这里把免费轮询也即刻停掉，不等 20min 硬超时。
    if (cancelNodeId && isTaskCancelRequested(cancelNodeId)) throw new LocalTaskCancelledError()
    const elapsedMs = Date.now() - startedAt
    if (elapsedMs > hardTimeoutMs) {
      // 超时≠失败：上游可能仍在跑/已出片 → 抛可找回错误，节点落 recoverable，给「重新拉取」入口。
      throw recoverableTimeout()
    }
    // S2:每个轮询 tick 回报进度(人话 + 已等秒数),不再静默吞掉 status。软超时后切「仍在生成·已超常规时长」。
    const overSoft = elapsedMs > softTimeoutMs
    options.onProgress?.({
      phase: overSoft ? 'still-generating' : 'generating',
      message: narrateProgress(overSoft ? 'still-generating' : 'generating', { elapsedMs }),
      taskId: initialResult.id,
    })
    await delay(nextPollDelayMs(pollIntervalMs, rateLimitStreak, options.pollRandom))
    try {
      const response = await fetchResult({
        taskId: initialResult.id,
        vendor,
        taskKind: request.kind,
        prompt: request.prompt,
        modelKey: asTrimmedString(request.extras?.modelKey) || null,
      })
      if (cancelNodeId && isTaskCancelRequested(cancelNodeId)) throw new LocalTaskCancelledError()
      current = response.result
      pollFailureStreakStartedAt = null // 查成功 → 重置失败连击计数
      rateLimitStreak = 0
    } catch (error) {
      if (error instanceof LocalTaskCancelledError) throw error
      // 查结果失败：免费重试(下一轮再查)，绝不冒泡触发重发。持续失败超 grace 或已到硬超时 → 落可找回。
      // 被限流才累计退避；别的失败（网络抖动等）复位，否则一次抖动就把间隔滚上去、白拖出片。
      rateLimitStreak = isRateLimitedPollError(error) ? rateLimitStreak + 1 : 0
      const now = Date.now()
      if (pollFailureStreakStartedAt == null) pollFailureStreakStartedAt = now
      if (now - pollFailureStreakStartedAt > POLL_FAILURE_GRACE_MS || now - startedAt > hardTimeoutMs) {
        throw recoverableTimeout()
      }
      // 仍在 grace 内：回报「仍在生成」(对用户=后台还在等)，继续下一轮免费查询。
      options.onProgress?.({
        phase: 'still-generating',
        message: narrateProgress('still-generating', { elapsedMs: now - startedAt }),
        taskId: initialResult.id,
      })
    }
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
  const currentOptions = options.referenceContext
    ? { ...options, references: resolveGenerationReferences(executableNode, options.referenceContext) }
    : options
  // Resolve video relay only after the final catalog projection; no later graph refresh may replace the extracted frame.
  const references = currentOptions.references
  if (getGenerationNodeExecutionKind(executableNode.kind) === 'video' && references?.relayFromVideoUrl) {
    const videoUrl = references.relayFromVideoUrl
    await applyRelayFirstFrame(references)
    for (const slot of readParameterReferenceSlots(executableNode.meta)) {
      // Generic image parameters can inherit explicit first_frame edges; video parameters keep the original clip.
      if (slot.mediaKind !== 'video' && references.parameterReferenceUrls?.[slot.key] === videoUrl) {
        references.parameterReferenceUrls[slot.key] = references.firstFrameUrl || null
      }
    }
  }
  const { vendor, request } = buildCatalogTaskRequest(executableNode, currentOptions)

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
  // ComfyUI 新协议允许客户端预生成 prompt UUID。先登记 WS、再 POST /prompt，极快任务的首事件也有归属；
  // 旧服若忽略该 UUID 并返回另一个 id，下方会切换 watcher，history 轮询始终照常兜底。
  const requestedComfyPromptId = isComfyuiVendorKey(vendor) ? crypto.randomUUID() : ''
  if (requestedComfyPromptId) {
    request.extras = { ...(request.extras ?? {}), comfyPromptId: requestedComfyPromptId }
  }
  let watchedPromptId = ''
  if (requestedComfyPromptId) {
    const registered = await watchComfyuiProgress({
      promptId: requestedComfyPromptId,
      nodeId: asTrimmedString(request.extras?.nodeId),
      projectId: asTrimmedString(request.extras?.projectId),
      taskKind: request.kind,
      modelKey: asTrimmedString(request.extras?.modelKey) || null,
      vendorKey: vendor,
    })
    if (registered) watchedPromptId = requestedComfyPromptId
  }
  let initialResult: TaskResultDto
  try {
    initialResult = await runTask(vendor, request)
  } catch (error) {
    if (watchedPromptId) unwatchComfyuiProgress(watchedPromptId)
    throw error
  }
  if (isTaskCancelRequested(asTrimmedString(request.extras?.nodeId))) {
    if (initialResult.id.startsWith('local-')) await getDesktopBridge()?.tasks.cancel?.(initialResult.id)
    throw new LocalTaskCancelledError()
  }
  report('waiting', initialResult.id)
  // 旧 ComfyUI 可能不接受客户端 prompt id：按服务端真实回执切 watcher。
  const comfyWatching = isComfyuiVendorKey(vendor) && Boolean(initialResult.id)
  if (comfyWatching && initialResult.id !== watchedPromptId) {
    if (watchedPromptId) unwatchComfyuiProgress(watchedPromptId)
    const registered = await watchComfyuiProgress({
      promptId: initialResult.id,
      nodeId: asTrimmedString(request.extras?.nodeId),
      projectId: asTrimmedString(request.extras?.projectId),
      taskKind: request.kind,
      modelKey: asTrimmedString(request.extras?.modelKey) || null,
      vendorKey: vendor,
    })
    watchedPromptId = registered ? initialResult.id : ''
  }
  let finalResult: TaskResultDto
  try {
    finalResult = await waitForCatalogTaskResult(vendor, request, initialResult, options)
  } finally {
    if (watchedPromptId) unwatchComfyuiProgress(watchedPromptId)
  }
  report('finalizing', initialResult.id)
  const normalized = normalizeCatalogTaskResult(finalResult, executableNode)
  // 结构闸：主进程漏本地化（projectId 时序为空）时，用「当前打开的项目」这一更可靠的 id 兜底，
  // 绝不让厂商临时 URL 落进节点 → 隔天过期播不了。主进程已落地时这里判为非 http，零开销 no-op。
  return localizeRemoteResultUrl(normalized, getActiveWorkbenchProjectId() ?? '', executableNode.id)
}
