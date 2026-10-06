import { argumentFailure } from '../shared/agentLane/laneArgumentFailure';
import { ZodError } from "zod";
import type { CanvasWriteApprovalAuthority } from '../shared/agentCapabilities/transportContracts'
import { randomUUID } from 'node:crypto'
import type { ProjectBinding } from '../shared/projectBinding'
import type { RuntimeToolCall, RuntimeToolDecision } from '../shared/agentCapabilities/transportContracts'
import type { PiTimelineReadTransportAdapter, PiTimelineWriteTransportAdapter, PreparedTimelineWrite } from '../capabilityCore/timelineTransportAdapters'
import type { PiCanvasWriteTransportAdapter, PreparedCanvasWrite } from '../capabilityCore/canvasWriteTransportAdapters'
import type { PiPhase4SurfaceTransportAdapter, PreparedExportWrite } from '../capabilityCore/phase4SurfaceTransportAdapters'
import type { PiGenerationTransportAdapter, ShotCandidateFacts } from '../capabilityCore/generationTransportAdapters'
import type { PiSkillReadTransportAdapter } from '../capabilityCore/skillReadTransportAdapters'
import type { PiSkillWriteTransportAdapter, PreparedSkillWrite } from '../capabilityCore/skillWriteTransportAdapters'
import type { ProjectAgentProposalReceiptService } from '../capabilityCore/projectAgentProposalReceiptStore'
import { committedProjectAgentReceiptMatchesApproval } from '../capabilityCore/projectAgentProposalReceiptCorrelation'
import { modelToolCapabilityId } from '../shared/agentCapabilities/modelFacingTools'
import { residentGenerationUnavailableMessage } from '../capabilityCore/residentSurfaceLifecycle'
import { capabilityContractById } from '../shared/agentCapabilities/registry'
import { LANE_RECEIPT_AUTHORITY_NOTE } from '../shared/agentLane/laneReceiptAuthority'
import { LANE_DEFERRED_TOOL_CATALOG, LANE_DEFERRED_TOOL_GROUPS } from './laneToolCatalog'
import { createExtendedLaneTools } from './laneExtendedTools'
import { LaneDomainFailure, type OpenLaneOptions } from './laneRuntimePort'
import { verbToTransportCall, type VerbTransportCall } from './laneVerbTransport'
import { taskReferenceSchema } from '../shared/agentCapabilities/taskReference'
import { GENERATE_USER_DECISION_KEY, type GenerateUserDecision } from '../shared/agentLane/generateUserDecision'
import type { GenerationInvocationContext } from '../shared/agentCapabilities/generationInvocationContext'
import type { LaneComposerContext } from '../shared/agentLane/laneDesktopContracts'

type Prepared =
  | { kind: 'timeline'; value: PreparedTimelineWrite }
  | { kind: 'canvas'; value: PreparedCanvasWrite }
  | { kind: 'export'; value: PreparedExportWrite }
  | { kind: 'skill'; value: PreparedSkillWrite }
  | { kind: 'direct'; value: { call: RuntimeToolCall } }

type Pending = { call: RuntimeToolCall; prepared: Prepared; approved?: CanvasWriteApprovalAuthority | true; generationContext?: GenerationInvocationContext
  /** `generate` 在预检期就已经有了结局（见 `preflightGenerate`）：execute 只把它交出去，不再碰领域、不再等任何人。 */
  decided?: RuntimeToolDecision }

/** 「这份结果说的是：报价卡已经摆到用户面前，在等他点头」（`mcpGenerationTools` present 分支的 `nextAction`）。 */
function awaitsUserOnSpendCard(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && (result as { nextAction?: unknown }).nextAction === 'await_user')
}

export interface LaneExtendedDesktopPortsInput {
  binding: ProjectBinding
  /** These adapters must be minted by the committed Surface/main domain owner. */
  timelineRead: PiTimelineReadTransportAdapter
  timelineWrite: PiTimelineWriteTransportAdapter
  canvasWrite: PiCanvasWriteTransportAdapter
  phase4: PiPhase4SurfaceTransportAdapter
  skillRead: PiSkillReadTransportAdapter
  skillWrite: PiSkillWriteTransportAdapter
  /** Main generation owner may become ready after the project opens. */
  generation(): PiGenerationTransportAdapter | undefined
  receipts: Pick<ProjectAgentProposalReceiptService, 'read'>
  /**
   * 「这一次出价关了没有」——回合等付费卡时唯一的消息来源，直接看 Run 账本（`laneDesktopSpend.whenCardCloses`）。
   * 卡上每一镜都决定了、点了 ×、计划被取消……哪条路关的都一样：关了就去问宿主逐镜结局。
   */
  spendCard: Readonly<{ whenCardCloses(operationId: string): Readonly<{ closed: Promise<void>; dispose(): void }> }>
  onTaskCreated?(call: RuntimeToolCall, result: unknown): Promise<void>
  context?(): LaneComposerContext
  /**
   * 3D-BOX 花钱闸（开关开的构建才接上）：这次要生成的镜头里，哪些挂着还没好的参考预演。
   * 出卡**之前**问——问到了就不出卡、不花钱，原因交给模型；问不到（渲染层不在）也不出卡（fail-closed）。
   */
  directorPreviewBlocks?(operationId: string, shotIds: readonly string[] | undefined, candidate: ShotCandidateFacts): Promise<readonly DirectorPreviewBlock[]>
}

export type DirectorPreviewBlock = Readonly<{
  nodeId: string
  shotId?: string
  reason: 'rendering' | 'failed' | 'not_referenced' | 'duration_mismatch'
  failure?: string
  previewAssetId?: string
  /** duration_mismatch：挂上去的预演有多长、这一镜的候选要生成多长（秒）。 */
  previewSeconds?: number
  shotSeconds?: number
}>

/** 预演挡着的那几镜 → 一句模型读得懂、能照做的话（不出卡、没花钱、下一步是什么）。 */
export function directorPreviewBlockedDecision(blocks: readonly DirectorPreviewBlock[]): Extract<RuntimeToolDecision, { ok: false }> {
  const rendering = blocks.filter((block) => block.reason === 'rendering')
  const failed = blocks.filter((block) => block.reason === 'failed')
  const unreferenced = blocks.filter((block) => block.reason === 'not_referenced')
  const mismatched = blocks.filter((block) => block.reason === 'duration_mismatch')
  const name = (block: DirectorPreviewBlock) => block.shotId ?? block.nodeId
  if (!rendering.length && !failed.length && mismatched.length) {
    const seconds = (value: number | undefined) => `${Number((value ?? 0).toFixed(2))}s`
    return { ok: false, code: 'director_preview_pending',
      message: `No spend card was shown and nothing was spent: the 3D-BOX preview attached to ${mismatched.map((block) => `shot ${name(block)} is ${seconds(block.previewSeconds)} but that shot would be generated as ${seconds(block.shotSeconds)}`).join('; ')}. The preview must be exactly as long as the shot. `
        + 'Either change the shot duration back to the preview length with draft_shots (same operationId and shotId), or change the 3D-BOX plan with stage_shot edits so every shot and blocking window fits the new duration (the preview re-renders and re-attaches). Tell the user which one you are doing, then call generate again.' }
  }
  if (!rendering.length && !failed.length && unreferenced.length) {
    return { ok: false, code: 'director_preview_pending',
      message: `No spend card was shown and nothing was spent: the 3D-BOX preview is ready, but the draft that would be generated does not use it (${unreferenced.map((block) => `shot ${name(block)} needs preview asset ${block.previewAssetId}`).join('; ')}). `
        + 'Update those shots with draft_shots (same operationId and shotId): add the preview asset id to references and pick a mode of that model that accepts a reference video (list_models). Then call generate again.' }
  }
  const parts = [
    rendering.length ? `the 3D-BOX preview for ${rendering.map(name).join(", ")} is still rendering` : '',
    failed.length ? `the 3D-BOX preview for ${failed.map(name).join(", ")} failed${failed.some((block) => block.failure === 'too_long') ? ' (longer than the 10-second preview limit)' : ''}` : '',
  ].filter(Boolean)
  return { ok: false, code: 'director_preview_pending',
    message: `No spend card was shown and nothing was spent: ${parts.join('; ')}. Generating now would send the shot without its reference video. `
      + (failed.length ? 'Tell the user; shorten the plan with stage_shot edits or ask him to press Retry preview on the 3D-BOX node, then call generate again.' : 'Tell the user the preview is still rendering and call generate again once look_at_canvas shows preview=ready.') }
}

function failure(code: string): Extract<RuntimeToolDecision, { ok: false }> {
  return { ok: false, code, message: code }
}

/**
 * 生成面不在：code 照旧，message 说的是常驻生成面此刻的**相**（按配置关掉 / 还在起 / 装配抛了 /
 * 已停），由 residentSurfaceLifecycle 这一个 owner 回答。模型据此能告诉用户「等一会儿再试」还是
 * 「这个会话没有这条面」，而不是一句零信息的「生成服务暂时不可用」。
 */
function generationSurfaceUnavailable(): Extract<RuntimeToolDecision, { ok: false }> {
  return { ok: false, code: 'generation_surface_unavailable', message: residentGenerationUnavailableMessage() }
}

/**
 * 契约 parse：失败走**与 `laneTools` 同一个**正文构造器，不抛裸 `ZodError`。
 * 裸 `ZodError` 的 `message` 是 `JSON.stringify(issues, null, 2)`——模型读到的是一段 JSON 数组。
 */
function parseToolArguments(spec: { name: string; schema: { parse(value: unknown): unknown } }, args: unknown): unknown {
  try {
    return spec.schema.parse(args)
  } catch (error) {
    if (error instanceof ZodError) throw new LaneDomainFailure(argumentFailure(spec.name, args, error))
    throw error
  }
}

function rejectPreparation(code: string): never {
  if (code === 'task_reference_required') throw new LaneDomainFailure({ code,
    message: 'The task reference has no verified domain (task_reference_required).',
    nextAction: 'Read the task result or canvas and copy domain and jobId from taskRef. Do not infer a task ID from a node ID.' })
  throw new LaneDomainFailure({ code, message: `Nomi could not prepare this domain action (${code}).`,
    nextAction: 'Read the current project again and request a new action with its current identifiers and revision.' })
}

function captureGenerationContext(context: LaneComposerContext | undefined): GenerationInvocationContext | undefined {
  if (!context) return undefined;
  // 模型名随这条消息的目录一起来（渲染层 displayName）：宿主递回给 Agent 的事实要带用户认得的名字。
  const names = Object.fromEntries((context.availableModels ?? []).filter(entry => entry.vendor && entry.displayName)
    .map(entry => [`${entry.vendor}/${entry.modelId}`, entry.displayName as string]));
  const modelNames = Object.keys(names).length ? { modelNames: names } : {};
  if (context.admissionSurface === 'document' && context.storyboardTarget) {
    const target = structuredClone(context.storyboardTarget);
    return { ...modelNames, storyboardTarget: target, sourceDocument: { documentId: target.sourceDocumentId,
      revision: target.sourceDocumentRevision, contentHash: target.sourceDocumentContentHash } };
  }
  // 渲染层声称的来源文稿。记录与比对用（见 GenerationInvocationContext 的头注释），不是凭据。
  const source = context.admissionSurface === 'document' && context.documentId && context.preconditions?.document
    && typeof context.preconditions.document.contentHash === 'string'
    ? { documentId: context.documentId, revision: context.preconditions.document.revision, contentHash: context.preconditions.document.contentHash }
    : undefined;
  return source || modelNames.modelNames ? { ...modelNames, ...(source ? { sourceDocument: source } : {}) } : undefined;
}

/**
 * One lane boundary over existing executors; it owns no second domain store or mutation path.
 * 模型面是 20 个动词；这里按 `verbToTransportCall` 把动词翻成传输层方法，再交给各领域适配器。
 */
export function createLaneExtendedDesktopPorts(input: LaneExtendedDesktopPortsInput) {
  const byName = new Map(LANE_DEFERRED_TOOL_CATALOG.map(spec => [spec.name, spec]))
  const pending = new Map<string, Pending>()
  let disposed = false

  const translate = (wire: RuntimeToolCall): VerbTransportCall => {
    if ((wire.toolName === 'check_job' || wire.toolName === 'cancel_job') && !taskReferenceSchema.safeParse(wire.args).success) {
      rejectPreparation('task_reference_required')
    }
    const translated = verbToTransportCall(wire)
    if (!translated) rejectPreparation('capability_unsupported')
    return translated
  }

  const toolLifecycle: NonNullable<OpenLaneOptions['toolLifecycle']> = {
    async prepare(wire, signal) {
      const spec = byName.get(wire.toolName)
      if (!spec) return
      if (disposed || signal.aborted) rejectPreparation('capability_cancelled')
      if (pending.has(wire.toolCallId)) rejectPreparation('capability_authority_invalid')
      const call = { ...wire, args: parseToolArguments(spec, wire.args) }
      const contract = capabilityContractById(modelToolCapabilityId(spec, call.args))
      if (!contract) rejectPreparation('capability_unsupported')
      if (contract.effect === 'read') return
      const { lane, call: transport } = translate(call)
      let prepared: Prepared
      if (lane === 'timeline') {
        const value = await input.timelineWrite.prepare(transport, signal)
        if (!value) rejectPreparation('capability_unsupported')
        prepared = { kind: 'timeline', value }
      } else if (lane === 'canvas') {
        const value = await input.canvasWrite.prepare(transport, signal)
        if (!value) rejectPreparation('capability_unsupported')
        prepared = { kind: 'canvas', value }
      } else if (lane === 'export') {
        const value = await input.phase4.prepareWrite(transport, signal)
        if (!value) rejectPreparation('capability_unsupported')
        prepared = { kind: 'export', value }
      } else if (lane === 'skillWrite') {
        const dirName = String((call.args as { dirName?: unknown }).dirName ?? '')
        const value = await input.skillWrite.prepare(transport, { target: { kind: 'skill', dirName }, preconditions: {} }, signal)
        if (!value) rejectPreparation('capability_unsupported')
        prepared = { kind: 'skill', value }
      } else {
        // Draft creation, generation planning and the model-setup panel have their own durable domain owner.
        prepared = { kind: 'direct', value: { call } }
      }
      if (disposed || signal.aborted) rejectPreparation('capability_cancelled')
      pending.set(call.toolCallId, { call, prepared, generationContext: captureGenerationContext(input.context?.()) })
    },
    async approved(call, record, host) {
      const entry = pending.get(call.toolCallId)
      if (!entry) return
      if (entry.approved || disposed || entry.call.toolName !== call.toolName) rejectPreparation('capability_authority_invalid')
      if (entry.prepared.kind === 'direct') {
        // The lane's approval note is already durable before this callback; no G5 journal is fabricated.
        entry.approved = true
        if (entry.call.toolName === 'generate' && host) entry.decided = await preflightGenerate(entry, host)
        return
      }
      const approval: CanvasWriteApprovalAuthority = { approvalId: `approval-${randomUUID()}`,
        receiptProposalId: `receipt-${randomUUID()}`, actionHash: entry.prepared.value.invocation.actionHash }
      await record(LANE_RECEIPT_AUTHORITY_NOTE, { ...approval, toolCallId: call.toolCallId })
      // Abort/settlement may have run while persistence was in flight.
      if (disposed || pending.get(call.toolCallId) !== entry) rejectPreparation('capability_cancelled')
      entry.approved = approval
    },
    settled(call) { pending.delete(call.toolCallId) },
  }

  /**
   * `generate` 的全部「等人」都发生在这里——`before_tool` 里，**不计入工具超时**（2026-09-22 裁决 A）。
   *
   * 此前这一步住在 execute 里：报价卡那条路以「错误 + STOP」把回合当场结束（用户点完「生成」之后没有回合接结果），
   * 文稿方案那条路干脆在工具执行里等用户点头，撞 60 秒写类预算——三轮实测一次没成过。
   *
   * 顺序：present（卡出现）→ 卡真的在等人才向闸借一次等待 → 等到账本里**这一次出价**不再开着。
   * 用户手快、在借到等待之前就点完了也接得住：结论在账本里，不在一次会错过的递送里（2026-10-05 删掉转接表）。
   * 全自动档由策略当场决完、文稿方案在它自己的确认里等完——这两条路 present 返回时就已经有结局，不借等待。
   */
  async function preflightGenerate(entry: Pending, host: NonNullable<Parameters<NonNullable<OpenLaneOptions['toolLifecycle']>['approved']>[2]>): Promise<RuntimeToolDecision> {
    const generation = input.generation()
    if (!generation) return generationSurfaceUnavailable()
    if (input.directorPreviewBlocks) {
      const args = entry.call.args as { operationId?: unknown; shotIds?: unknown }
      const shotIds = Array.isArray(args.shotIds) ? args.shotIds.filter((value): value is string => typeof value === 'string') : undefined
      let blocks: readonly DirectorPreviewBlock[]
      try {
        // 只读：候选里每一镜带了哪些素材、要生成多长。写者仍只有 draft_shots。
        if (!generation.readShotCandidateFacts) throw new Error('director_preview_candidate_unreadable')
        const candidate = await generation.readShotCandidateFacts(String(args.operationId ?? ''))
        blocks = await input.directorPreviewBlocks(String(args.operationId ?? ''), shotIds, candidate)
      } catch {
        return { ok: false, code: 'director_preview_pending', message: 'No spend card was shown and nothing was spent: Nomi could not check whether the 3D-BOX previews for these shots are ready. Call generate again in a moment.' }
      }
      if (blocks.length) return directorPreviewBlockedDecision(blocks)
    }
    const { call: transport } = translate(entry.call)
    const operationId = String((entry.call.args as { operationId?: unknown }).operationId ?? '')
    let card: ReturnType<typeof input.spendCard.whenCardCloses> | undefined
    try {
      const presented = await generation.tryExecute(transport, host.signal, entry.generationContext) ?? generationSurfaceUnavailable()
      if (!presented.ok || !awaitsUserOnSpendCard(presented.result)) return presented
      const decided = (userDecision: GenerateUserDecision): RuntimeToolDecision =>
        ({ ok: true, result: { ...(presented.result as Record<string, unknown>), [GENERATE_USER_DECISION_KEY]: userDecision } })
      if (!host.canAskUser) {
        // 卡摆出去了却没有人能点它（没有窗口的 lane）：收回这次出价，照实说。这是真错误，error 形状是对的。
        await generation.withdrawPresentation(operationId, 'stopped')
        return { ok: false, code: 'generation_approval_unavailable', message: 'This session has no window where the user could approve the spend, so nothing was generated.' }
      }
      const wait = host.waitForUser()
      card = input.spendCard.whenCardCloses(operationId)
      void card.closed.then(() => { wait.settle({ kind: 'card-closed' }) })
      const outcome = await wait.outcome
      // 卡关了（每一镜都决定了 / × / 计划被取消——关它的那条路已经把账本写好了）：每一镜的结局只问宿主，这里不替它说。
      if (outcome.kind === 'card-closed') {
        const shots = await generation.readPresentationOutcome(operationId)
        // 读不到结局就不编：卡上可能已经有镜在生成，照实说「结果要去核对」，而不是「都开始了」或「什么都没发生」。
        if (!shots) return { ok: false, code: 'generation_execution_failed', message: 'generation_execution_failed' }
        return decided({ outcome: 'card_closed', shots })
      }
      // 另外两种结局（用户打了字 / 回合被停下）同样不是「不要这份草稿」：收回的只是这一次出价（没决定的镜不生成），计划留着。
      if (outcome.kind === 'redirected') {
        await generation.withdrawPresentation(operationId, 'user_wrote')
        const shots = await generation.readPresentationOutcome(operationId)
        return decided({ outcome: 'redirected', userSaid: outcome.text, ...(shots ? { shots } : {}) })
      }
      // 回合被停下 / 窗口关了：**不等**收回落盘就把钩子还给 pi。这一支多半跑在退出路上，等它就是让 pi 的
      // abort 收不了尾——进程带着一个 `cancel_requested` 的半截回合退出，重开后这条对话永远停在「在跑」，
      // 用户之后打的每一句都安静地排在后面（走查 agent-spend-waiting-owner 实测）。收回本身是幂等的，
      // 这里没赶上的那一次由启动清扫（`stalePresentationSweep`）兜住。
      void generation.withdrawPresentation(operationId, 'stopped').catch(() => undefined)
      return { ok: false, code: 'generation_cancelled', message: 'generation_cancelled', denied: true }
    } finally {
      card?.dispose()
    }
  }

  async function executeRead(call: RuntimeToolCall, signal: AbortSignal): Promise<RuntimeToolDecision> {
    const { lane, call: transport } = translate(call)
    if (lane === 'skillRead') return await input.skillRead.tryExecute(transport, signal) ?? failure('capability_unsupported')
    if (lane === 'media' || lane === 'export') return await input.phase4.tryExecuteRead(transport, signal) ?? failure('capability_unsupported')
    if (lane === 'generation') {
      return await input.generation()?.tryExecute(transport, signal) ?? generationSurfaceUnavailable()
    }
    return failure('capability_unsupported')
  }

  async function execute(call: RuntimeToolCall, signal: AbortSignal): Promise<RuntimeToolDecision> {
    if (disposed || signal.aborted) return failure('capability_cancelled')
    const spec = byName.get(call.toolName)
    if (!spec) return failure('capability_unsupported')
    // Compare the same schema-normalized arguments captured during prepare. Zod
    // may materialize defaults/normalization, so comparing the raw wire object
    // would reject an otherwise identical approved call.
    const normalizedCall = { ...call, args: parseToolArguments(spec, call.args) }
    const contract = capabilityContractById(modelToolCapabilityId(spec, normalizedCall.args))
    if (!contract) return failure('capability_unsupported')
    // 读走 `executeRead`：路由判据是**动词声明翻出来的 lane**（`translate`，20 动词那张传输表），
    // 不再是这里按 `internalGroup` 手写的分支树。`origin/main` 那棵树里的 `production` 一支随
    // 37 个内部名一起退役（v2 的声明里没有 `production` 组）；生成面不在时的那句相由
    // `generationSurfaceUnavailable()` 说（#785 的 owner），在 `executeRead` 里。
    if (contract.effect === 'read') return executeRead(normalizedCall, signal)
    const entry = pending.get(call.toolCallId)
    if (!entry?.approved || entry.call.toolName !== normalizedCall.toolName
      || JSON.stringify(entry.call.args) !== JSON.stringify(normalizedCall.args)) return failure('capability_authority_invalid')
    // Consume before crossing the domain boundary. Even an exception cannot reuse this approval.
    pending.delete(call.toolCallId)
    const { prepared, approved } = entry
    let result: RuntimeToolDecision
    if (prepared.kind === 'direct') {
      // `generate` 的结局在预检期就定了（`preflightGenerate`）：这里**没有任何等待**，也不再碰一次领域——
      // 再 present 一次会把用户刚答完的那张卡重新摆出来。
      if (entry.decided) return entry.decided
      // 传输方法名同样由声明翻（`translate`），不按组名手写；生成面不在 → #785 那句「此刻是哪个相」。
      const { call: transport } = translate(normalizedCall)
      result = await input.generation()?.tryExecute(transport, signal, entry.generationContext) ?? generationSurfaceUnavailable()
    } else {
      if (approved === true) return failure('capability_authority_invalid')
      switch (prepared.kind) {
        case 'timeline': result = await input.timelineWrite.execute(prepared.value, approved, signal); break
        case 'canvas': result = await input.canvasWrite.execute(prepared.value, approved, signal); break
        case 'export': result = await input.phase4.executeWrite(prepared.value, approved, signal); break
        case 'skill': result = await input.skillWrite.execute(prepared.value, approved, signal); break
      }
      if (result.ok && (prepared.kind === 'canvas' || prepared.kind === 'export')) {
        if (!committedProjectAgentReceiptMatchesApproval(input.binding, input.receipts.read(), approved)) {
          return failure('capability_receipt_unresolved')
        }
      }
    }
    if (result.ok && normalizedCall.toolName === 'draft_shots' && !(normalizedCall.args as { operationId?: unknown }).operationId) {
      await input.onTaskCreated?.(normalizedCall, result.result)
    }
    return result
  }

  return { tools: createExtendedLaneTools({ execute }), toolLifecycle, groups: LANE_DEFERRED_TOOL_GROUPS,
    dispose() { disposed = true; pending.clear() },
  }
}
