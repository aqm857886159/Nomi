import { getDesktopBridge, type DesktopBridge } from '../../desktop/bridge'
import { TELEMETRY_ERROR_TYPE_PATTERN, type CapabilitySlot, type DurationBucket, type TelemetryResult } from '../../../electron/shared/contracts/telemetry'
import { isTerminalTaskStatus, type TaskStatus } from '../../../electron/shared/taskStatus'
import { classifyGenerationError } from '../observability/classifyError'
import { describeOpaqueFailure } from '../observability/opaqueFailure'
import { trackNodeSubmit } from '../generationCanvas/runner/nodeSubmitInFlight'

export type TaskKind =
  | 'chat'
  | 'prompt_refine'
  | 'text_to_image'
  | 'image_to_prompt'
  | 'image_to_video'
  | 'text_to_video'
  | 'image_edit'
  | 'text_to_audio'
  | 'transcribe'
  | 'text_to_3d'
  | 'image_to_3d'

export type { TaskStatus }

export type TaskAssetDto = {
  type: 'image' | 'video' | 'audio'
  url: string
  thumbnailUrl?: string | null
  assetId?: string | null
  assetRefId?: string | null
  assetName?: string | null
  durationSeconds?: number
  /** Intrinsic source dimensions from the desktop asset localization boundary. */
  width?: number | null
  height?: number | null
  /** 原始 CDN URL（https://...）。供后续生成直接用，任何 vendor 都能接受，无需上传或转 base64。 */
  providerUrl?: string | null
}

export type TaskResultDto = {
  id: string
  kind: TaskKind
  status: TaskStatus
  assets: TaskAssetDto[]
  raw: unknown
  /**
   * status==='failed' 时的真实失败原因（上游原话）。主进程 taskFailureMessageFromResponse 按
   * profile 声明的 error_message 映射取出（取不到才按形状下钻）——渲染层直接用，
   * 不再自己解析 raw 的形状（那份副本猜不到 failMsg/errorMessage 等家族专属字段）。
   */
  error?: string
  /**
   * E11: Complete provenance for reproducibility. Populated by the electron
   * runtime on successful generation. Renderer copies into
   * GenerationNodeResult.provenance via extractProvenanceFromTaskResult.
   */
  provenance?: {
    provider?: string
    modelKey?: string
    modelVersion?: string
    prompt?: string
    negativePrompt?: string
    seed?: number
    params?: Record<string, unknown>
    vendorRequestId?: string
    cost?: { amount: number; currency: string; unit: 'estimate' }
    timestamp: number
    agentRunId?: string
  }
}

export type TaskRequestDto = {
  kind: TaskKind
  prompt: string
  negativePrompt?: string
  seed?: number
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  extras?: Record<string, unknown>
}

/**
 * 任务的项目身份：提交那一刻由调用方显式给出，随任务持久化，轮询/找回原样复述。
 * `null` = 明确不属于任何项目（接入测试、提示词改写等）。这里从不读「当前项目」补它。
 */
export type TaskProjectIdentity = string | null

function withTaskProjectIdentity(
  request: TaskRequestDto,
  projectId: TaskProjectIdentity,
): TaskRequestDto & { extras: Record<string, unknown> } {
  const declared = request.extras?.projectId
  if (declared !== undefined && declared !== (projectId ?? undefined)) {
    throw new Error('TASK_PROJECT_MISMATCH: request.extras.projectId disagrees with the task project identity')
  }
  const extras: Record<string, unknown> = { ...(request.extras || {}) }
  delete extras.projectId
  return { ...request, extras: { ...extras, ...(projectId ? { projectId } : {}) } }
}

export type FetchWorkbenchTaskResultRequestDto = {
  taskId: string
  vendor?: string
  taskKind?: TaskKind
  prompt?: string | null
  modelKey?: string | null
  /** Persisted archetype mode discriminator for mode-specific mappings. */
  archetype?: { modeId?: string | null } | null
  /** 任务提交时固定的项目身份（必填，null = 不属于任何项目）：主进程据此核对缓存任务、无状态重建时本地化资产。 */
  projectId: TaskProjectIdentity
}

export type FetchWorkbenchTaskResultResponseDto = {
  vendor: string
  result: TaskResultDto
}

export type ComfyCandidateTestResultDto =
  | { ok: true; revisionId: string; active: { vendorKey: string; modelKey: string }; remoteTaskId?: string }
  | { ok: false; revisionId: string; reasonCode: string; params: Record<string, string | number | boolean> }

function requireDesktopRuntime(feature: string): DesktopBridge {
  const desktop = getDesktopBridge()
  if (!desktop) throw new Error(`${feature} requires the Electron desktop runtime`)
  return desktop
}

/**
 * 付费守卫：真人确认后铸一次性令牌（绑 nodeIds），返回 grantId。画布已不用它（批准住在各自的单镜 Run 上）；
 * 只剩新手引导的 ComfyUI 试生成这一处登记的例外（到期 2026-11-15，见 concept-owners 的 spend.pending-identity）。
 */
export async function mintSpendGrant(nodeIds: string[], maxAttemptsPerNode?: number): Promise<string> {
  const desktop = requireDesktopRuntime('spend authorization')
  const { grantId } = await desktop.tasks.grantSpend({
    nodeIds,
    ...(maxAttemptsPerNode ? { maxAttemptsPerNode } : {}),
  })
  return grantId
}

function telemetryCapability(kind: TaskKind): CapabilitySlot | null {
  if (kind === 'text_to_image') return 'image'
  if (kind === 'image_edit') return 'image-edit'
  if (kind === 'text_to_video' || kind === 'image_to_video') return 'video'
  if (kind === 'text_to_audio') return 'audio'
  if (kind === 'text_to_3d' || kind === 'image_to_3d') return '3d'
  return null
}

/**
 * 失败只上报「类别码」——`classifyGenerationError` 那一张分类表的 kind，原文、URL、提示词、
 * 文件名、供应商返回体一个字都不出这个函数。分不出来就是 'unknown'。
 */
function failureTypeOf(message: string | undefined): string {
  try {
    const kind = classifyGenerationError(String(message ?? '')).kind
    return TELEMETRY_ERROR_TYPE_PATTERN.test(kind) ? kind : 'unknown'
  } catch {
    return 'unknown'
  }
}

function trackGenerationOutcome(desktop: DesktopBridge, capability: CapabilitySlot, startedAt: number, result: TelemetryResult, failureMessage?: string): void {
  const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
  void desktop.telemetry?.track({
    eventName: 'generation.completed',
    props: {
      capability,
      durationBucket: durationBucketOf(elapsed),
      result,
      attemptCountBucket: '1',
      ...(result === 'failure' ? { errorType: failureTypeOf(failureMessage) } : {}),
    },
  })
}

function durationBucketOf(ms: number): DurationBucket {
  return ms < 1000 ? '<1s' : ms <= 5000 ? '1-5s' : '>5s'
}

/** 已提交、还没到终态的异步生成：任务 id → 开始时间与能力。到终态报一次就删；上限防泄漏。 */
const inFlightGenerations = new Map<string, { capability: CapabilitySlot; startedAt: number }>()
const IN_FLIGHT_LIMIT = 200
function rememberInFlightGeneration(taskId: string, capability: CapabilitySlot, startedAt: number): void {
  if (!taskId) return
  if (inFlightGenerations.size >= IN_FLIGHT_LIMIT) {
    const oldest = inFlightGenerations.keys().next().value
    if (oldest !== undefined) inFlightGenerations.delete(oldest)
  }
  inFlightGenerations.set(taskId, { capability, startedAt })
}

export async function runWorkbenchTaskByVendor(
  vendor: string,
  request: TaskRequestDto,
  projectId: TaskProjectIdentity,
): Promise<TaskResultDto> {
  const normalizedVendor = String(vendor || '').trim()
  if (!normalizedVendor) throw new Error('vendor is required')
  const desktop = requireDesktopRuntime('task execution')
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const capability = telemetryCapability(request.kind)
  // 这一笔在主进程回话之前都算「在途」——切项目重装画布时，装载收敛据此不把它当幽灵转圈收成空闲。
  const settleSubmit = trackNodeSubmit(typeof request.extras?.nodeId === 'string' ? request.extras.nodeId : undefined)
  try {
    const response = await desktop.tasks.run({
      vendor: normalizedVendor,
      request: withTaskProjectIdentity(request, projectId),
    }) as TaskResultDto
    if (capability) {
      if (isTerminalTaskStatus(response.status)) {
        trackGenerationOutcome(desktop, capability, startedAt, response.status === 'succeeded' ? 'success' : 'failure', response.error)
      } else {
        // 还在跑（queued/running）：这不是一个结果。最终结果在轮询到终态时报（fetchWorkbenchTaskResultByVendor），
        // 之前把它记成 cancel，视频这类异步任务的成败就全丢了。
        rememberInFlightGeneration(response.id, capability, startedAt)
      }
    }
    return response
  } catch (error) {
    if (capability) trackGenerationOutcome(desktop, capability, startedAt, 'failure', error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    settleSubmit()
  }
}

/**
 * 画布单节点 ↑ 的唯一付费口（发动机收敛第一刀）：主进程建一个单镜 Run，这一下点击就是批准，经提交出口交出去。
 * 回话与 `runWorkbenchTaskByVendor` 同形（受理号或同步结果），渲染层的等待循环不变。
 * `runRecordId` = 节点这一次运行记录号：同一次意图的重试复用它，主进程照 Run 账本回话、绝不交第二次。
 */
export async function submitCanvasShotRun(input: {
  projectId: string
  nodeId: string
  runRecordId: string
  vendor: string
  request: TaskRequestDto
}): Promise<TaskResultDto> {
  const desktop = requireDesktopRuntime('canvas generation')
  if (!desktop.tasks.canvasSubmit) throw new Error('canvas generation requires a newer desktop runtime')
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const capability = telemetryCapability(input.request.kind)
  const settleSubmit = trackNodeSubmit(input.nodeId)
  try {
    const response = await desktop.tasks.canvasSubmit({
      projectId: input.projectId,
      nodeId: input.nodeId,
      runRecordId: input.runRecordId,
      vendor: String(input.vendor || '').trim(),
      request: withTaskProjectIdentity(input.request, input.projectId),
    }) as TaskResultDto
    if (capability) {
      if (isTerminalTaskStatus(response.status)) trackGenerationOutcome(desktop, capability, startedAt, response.status === 'succeeded' ? 'success' : 'failure', response.error)
      else rememberInFlightGeneration(response.id, capability, startedAt)
    }
    return response
  } catch (error) {
    if (capability) trackGenerationOutcome(desktop, capability, startedAt, 'failure', error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    settleSubmit()
  }
}

/** 查这一次运行的结果：经它的单镜 Run（主进程记下每一次查询，出片就记进 Run）。没有这个 Run 回 null。 */
export async function pollCanvasShotRun(input: { projectId: string; runRecordId: string }): Promise<TaskResultDto | null> {
  const desktop = getDesktopBridge()
  if (!desktop?.tasks?.canvasPoll) return null
  const result = await desktop.tasks.canvasPoll(input) as TaskResultDto | null
  if (!result) return null
  const pending = inFlightGenerations.get(result.id)
  if (pending && isTerminalTaskStatus(result.status)) {
    inFlightGenerations.delete(result.id)
    trackGenerationOutcome(desktop, pending.capability, pending.startedAt, result.status === 'succeeded' ? 'success' : 'failure', result.error)
  }
  return result
}

/** 渲染层不再等这一次（点了停）：主进程把还在路上的交给观察者收完，钱花了的结果照样进项目。 */
export async function releaseCanvasShotRun(input: { projectId: string; runRecordId: string }): Promise<void> {
  await getDesktopBridge()?.tasks?.canvasRelease?.(input)
}

/** 批量卡上要花钱的一镜：节点、它这一次的运行记录号、点确认那一刻选着的家 / 模型 / 任务种类。 */
export type CanvasConsentShot = { nodeId: string; runRecordId: string; vendor: string; modelKey: string; kind: string }

/**
 * 批量卡上点了确认：卡上列出的每一镜在主进程各建一个单镜 Run，出价开着 = 这一镜他同意了（这一张卡就是这一份授权）。
 * 什么都还没交；轮到它时 `submitCanvasShotRun` 才冻住请求、批、交。主进程拒（没装好 / 出错）就抛，整批不开始、不花钱。
 */
export async function consentCanvasShots(input: { projectId: string; shots: CanvasConsentShot[] }): Promise<string[]> {
  const desktop = requireDesktopRuntime('canvas batch generation')
  if (!desktop.tasks.canvasConsent) throw new Error('canvas batch generation requires a newer desktop runtime')
  return (await desktop.tasks.canvasConsent(input)).runIds
}

/**
 * 收回还没交的那几镜的同意：`removed` = 任务列表里把排队的这一镜去掉了；`user_closed` = 整批点了 ×；
 * `stopped` = 这一批跑完了还剩没轮到的（上游失败、缺料、被刹车后取消）。已经交出去的照常跑完，主进程对它们什么都不做。
 */
export function withdrawCanvasShots(input: { projectId: string; runRecordIds: string[]; by: 'removed' | 'user_closed' | 'stopped' }): void {
  if (input.runRecordIds.length === 0) return
  void getDesktopBridge()?.tasks?.canvasWithdraw?.(input)?.catch(() => undefined)
}

export async function runComfyCandidateTestByVendor(
  vendor: string,
  payload: { candidate: { revisionId: string; modelKey: string; taskKind: TaskKind }; request: TaskRequestDto },
  projectId: TaskProjectIdentity,
): Promise<ComfyCandidateTestResultDto> {
  const normalizedVendor = String(vendor || '').trim()
  if (!normalizedVendor) throw new Error('vendor is required')
  const desktop = requireDesktopRuntime('ComfyUI candidate certification')
  if (!desktop.tasks.runComfyCandidateTest) throw new Error('ComfyUI candidate certification is unavailable')
  return desktop.tasks.runComfyCandidateTest({
    vendor: normalizedVendor,
    candidate: payload.candidate,
    request: withTaskProjectIdentity(payload.request, projectId),
  })
}

export async function cancelComfyCandidateTestRevision(candidate: {
  revisionId: string; modelKey: string; taskKind: TaskKind
}): Promise<{ ok: boolean }> {
  const desktop = requireDesktopRuntime('ComfyUI candidate cancellation')
  if (!desktop.tasks.cancelComfyCandidateTest) throw new Error('ComfyUI candidate cancellation is unavailable')
  return desktop.tasks.cancelComfyCandidateTest(candidate)
}

export async function fetchWorkbenchTaskResultByVendor(
  payload: FetchWorkbenchTaskResultRequestDto,
): Promise<FetchWorkbenchTaskResultResponseDto> {
  // 只复述任务自带的项目身份：缓存命中时主进程核对它与提交时一致，miss 后无状态重建用它本地化资产。
  const { projectId, ...query } = payload
  const desktop = requireDesktopRuntime('task result polling')
  const response = await desktop.tasks.result({
    ...query,
    ...(projectId ? { projectId } : {}),
  }) as FetchWorkbenchTaskResultResponseDto
  const pending = inFlightGenerations.get(payload.taskId)
  if (pending && isTerminalTaskStatus(response.result.status)) {
    inFlightGenerations.delete(payload.taskId)
    trackGenerationOutcome(desktop, pending.capability, pending.startedAt, response.result.status === 'succeeded' ? 'success' : 'failure', response.result.error)
  }
  return response
}

/**
 * 文本任务流式执行：逐 token 回调 onDelta，最终 resolve 与 runWorkbenchTaskByVendor 同形的
 * TaskResultDto（status:'succeeded'，raw 为 OpenAI choices 形状）。把 IPC 的 streamId+事件
 * 订阅包成一个 Promise，调用方无需感知通道细节。
 */
export async function runWorkbenchTextTaskStream(
  vendor: string,
  request: TaskRequestDto,
  projectId: TaskProjectIdentity,
  opts: { onDelta?: (delta: string) => void; signal?: AbortSignal } = {},
): Promise<TaskResultDto> {
  const normalizedVendor = String(vendor || '').trim()
  if (!normalizedVendor) throw new Error('vendor is required')
  const desktop = requireDesktopRuntime('text streaming')
  const payload = {
    vendor: normalizedVendor,
    request: withTaskProjectIdentity(request, projectId),
  }
  const { streamId } = await desktop.tasks.runTextStream(payload)
  return new Promise<TaskResultDto>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      unsubscribe()
      fn()
    }
    const unsubscribe = desktop.tasks.onTextEvent(streamId, (event) => {
      const evt = event as { type?: string; delta?: string; result?: TaskResultDto; message?: string }
      if (evt?.type === 'delta') {
        opts.onDelta?.(String(evt.delta || ''))
      } else if (evt?.type === 'done') {
        finish(() => resolve(evt.result as TaskResultDto))
      } else if (evt?.type === 'error') {
        finish(() => reject(new Error(evt.message || describeOpaqueFailure(null))))
      }
    })
    // 外部取消：通知主进程真中断流 + 兜底 reject。
    if (opts.signal) {
      const onAbort = () => finish(() => {
        void desktop.tasks.cancelTextStream(streamId)
        reject(new DOMException('文本流式已取消', 'AbortError'))
      })
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}
