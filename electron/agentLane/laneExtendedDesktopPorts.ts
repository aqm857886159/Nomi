import type { CanvasWriteApprovalAuthority } from '../shared/agentCapabilities/transportContracts'
import { randomUUID } from 'node:crypto'
import type { ProjectBinding } from '../shared/projectBinding'
import type { RuntimeToolCall, RuntimeToolDecision } from '../shared/agentCapabilities/transportContracts'
import type { PiTimelineReadTransportAdapter, PiTimelineWriteTransportAdapter, PreparedTimelineWrite } from '../capabilityCore/timelineTransportAdapters'
import type { PiCanvasWriteTransportAdapter, PreparedCanvasWrite } from '../capabilityCore/canvasWriteTransportAdapters'
import type { PiPhase4SurfaceTransportAdapter, PreparedExportWrite } from '../capabilityCore/phase4SurfaceTransportAdapters'
import type { PiGenerationTransportAdapter } from '../capabilityCore/generationTransportAdapters'
import type { PiSkillReadTransportAdapter } from '../capabilityCore/skillReadTransportAdapters'
import type { PiSkillWriteTransportAdapter, PreparedSkillWrite } from '../capabilityCore/skillWriteTransportAdapters'
import type { ProjectAgentProposalReceiptService } from '../capabilityCore/projectAgentProposalReceiptStore'
import { committedProjectAgentReceiptMatchesApproval } from '../capabilityCore/projectAgentProposalReceiptCorrelation'
import { modelToolCapabilityId } from '../shared/agentCapabilities/modelFacingTools'
import { capabilityContractById } from '../shared/agentCapabilities/registry'
import { LANE_RECEIPT_AUTHORITY_NOTE } from '../shared/agentLane/laneReceiptAuthority'
import { LANE_DEFERRED_TOOL_CATALOG, LANE_DEFERRED_TOOL_GROUPS } from './laneToolCatalog'
import { createExtendedLaneTools } from './laneExtendedTools'
import { LaneDomainFailure, type OpenLaneOptions } from './laneRuntimePort'
import { exportJobTransportCall, verbToTransportCall, type VerbTransportCall } from './laneVerbTransport'

type Prepared =
  | { kind: 'timeline'; value: PreparedTimelineWrite }
  | { kind: 'canvas'; value: PreparedCanvasWrite }
  | { kind: 'export'; value: PreparedExportWrite }
  | { kind: 'skill'; value: PreparedSkillWrite }
  | { kind: 'direct'; value: { call: RuntimeToolCall } }

type Pending = { call: RuntimeToolCall; prepared: Prepared; approved?: CanvasWriteApprovalAuthority | true }

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
  onTaskCreated?(call: RuntimeToolCall, result: unknown): Promise<void>
}

function failure(code: string): Extract<RuntimeToolDecision, { ok: false }> {
  return { ok: false, code, message: code }
}

function rejectPreparation(code: string): never {
  throw new LaneDomainFailure({ code, message: `Nomi could not prepare this domain action (${code}).`,
    nextAction: 'Read the current project again and request a new action with its current identifiers and revision.' })
}

/** 生成域说「不认识这个 operationId」的那一族码；`check_job` / `cancel_job` 据此转问导出域。 */
const UNKNOWN_GENERATION_JOB = new Set(['generation_operation_not_found', 'capability_execution_failed', 'generation_surface_unavailable'])

/**
 * One lane boundary over existing executors; it owns no second domain store or mutation path.
 * 模型面是 20 个动词；这里按 `verbToTransportCall` 把动词翻成传输层方法，再交给各领域适配器。
 */
export function createLaneExtendedDesktopPorts(input: LaneExtendedDesktopPortsInput) {
  const byName = new Map(LANE_DEFERRED_TOOL_CATALOG.map(spec => [spec.name, spec]))
  const pending = new Map<string, Pending>()
  let disposed = false

  const translate = (wire: RuntimeToolCall): VerbTransportCall => {
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
      const call = { ...wire, args: spec.schema.parse(wire.args) }
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
      } else if (lane === 'generation' && call.toolName === 'cancel_job') {
        // 取消一个任务：先问导出域认不认这个 id；不认就是生成任务，走生成域的取消（直接路径，审批由闸管）。
        const exportCall = exportJobTransportCall(call)
        const value: PreparedExportWrite | null = await input.phase4.prepareWrite(exportCall, signal).catch(() => null)
        prepared = value ? { kind: 'export', value } : { kind: 'direct', value: { call } }
      } else {
        // Draft creation, generation planning and the model-setup panel have their own durable domain owner.
        prepared = { kind: 'direct', value: { call } }
      }
      if (disposed || signal.aborted) rejectPreparation('capability_cancelled')
      pending.set(call.toolCallId, { call, prepared })
    },
    async approved(call, record) {
      const entry = pending.get(call.toolCallId)
      if (!entry) return
      if (entry.approved || disposed || entry.call.toolName !== call.toolName) rejectPreparation('capability_authority_invalid')
      if (entry.prepared.kind === 'direct') {
        // The lane's approval note is already durable before this callback; no G5 journal is fabricated.
        entry.approved = true
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

  async function executeRead(call: RuntimeToolCall, signal: AbortSignal): Promise<RuntimeToolDecision> {
    const { lane, call: transport } = translate(call)
    if (lane === 'skillRead') return await input.skillRead.tryExecute(transport, signal) ?? failure('capability_unsupported')
    if (lane === 'generation') {
      // `check_job`：生成域先答；它不认识这个 id 就问导出域（同一个动词，用户不需要知道任务住哪个域）。
      const generation = await input.generation()?.tryExecute(transport, signal)
      if (generation?.ok || (generation && !UNKNOWN_GENERATION_JOB.has(generation.code ?? ''))) return generation
      return await input.phase4.tryExecuteRead(exportJobTransportCall(call), signal) ?? generation ?? failure('generation_surface_unavailable')
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
    const normalizedCall = { ...call, args: spec.schema.parse(call.args) }
    const contract = capabilityContractById(modelToolCapabilityId(spec, normalizedCall.args))
    if (!contract) return failure('capability_unsupported')
    if (contract.effect === 'read') return executeRead(normalizedCall, signal)
    const entry = pending.get(call.toolCallId)
    if (!entry?.approved || entry.call.toolName !== normalizedCall.toolName
      || JSON.stringify(entry.call.args) !== JSON.stringify(normalizedCall.args)) return failure('capability_authority_invalid')
    // Consume before crossing the domain boundary. Even an exception cannot reuse this approval.
    pending.delete(call.toolCallId)
    const { prepared, approved } = entry
    let result: RuntimeToolDecision
    if (prepared.kind === 'direct') {
      const { call: transport } = translate(normalizedCall)
      result = await input.generation()?.tryExecute(transport, signal) ?? failure('generation_surface_unavailable')
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
    if (result.ok && normalizedCall.toolName === 'draft_shots' && !(normalizedCall.args as { draftId?: unknown }).draftId) {
      await input.onTaskCreated?.(normalizedCall, result.result)
    }
    return result
  }

  return { tools: createExtendedLaneTools({ execute }), toolLifecycle, groups: LANE_DEFERRED_TOOL_GROUPS,
    dispose() { disposed = true; pending.clear() },
  }
}
