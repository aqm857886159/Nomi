import type { CanvasWriteApprovalAuthority } from '../shared/agentCapabilities/transportContracts'
import { randomUUID } from 'node:crypto'
import type { ProjectBinding } from '../shared/projectBinding'
import type { RuntimeToolCall, RuntimeToolDecision } from '../shared/agentCapabilities/transportContracts'
import type { PiTimelineReadTransportAdapter, PiTimelineWriteTransportAdapter, PreparedTimelineWrite } from '../capabilityCore/timelineTransportAdapters'
import type { PiCanvasWriteTransportAdapter, PreparedCanvasWrite, } from '../capabilityCore/canvasWriteTransportAdapters'
import type { PiPhase4SurfaceTransportAdapter, PreparedExportWrite } from '../capabilityCore/phase4SurfaceTransportAdapters'
import type { PiProductionRunTransportAdapter, PreparedProductionRunWrite } from '../capabilityCore/productionRunTransportAdapters'
import type { PiGenerationTransportAdapter } from '../capabilityCore/generationTransportAdapters'
import type { ProjectAgentProposalReceiptService } from '../capabilityCore/projectAgentProposalReceiptStore'
import { committedProjectAgentReceiptMatchesApproval } from '../capabilityCore/projectAgentProposalReceiptCorrelation'
import { modelToolCapabilityId } from '../shared/agentCapabilities/modelFacingTools'
import { residentGenerationUnavailableMessage } from '../capabilityCore/residentSurfaceLifecycle'
import { capabilityContractById } from '../shared/agentCapabilities/registry'
import { LANE_RECEIPT_AUTHORITY_NOTE } from '../shared/agentLane/laneReceiptAuthority'
import { LANE_DEFERRED_TOOL_CATALOG, LANE_DEFERRED_TOOL_GROUPS } from './laneToolCatalog'
import { createExtendedLaneTools } from './laneExtendedTools'
import { LaneDomainFailure, type OpenLaneOptions } from './laneRuntimePort'

type Prepared =
  | { kind: 'timeline'; value: PreparedTimelineWrite }
  | { kind: 'canvas'; value: PreparedCanvasWrite }
  | { kind: 'export'; value: PreparedExportWrite }
  | { kind: 'production'; value: PreparedProductionRunWrite }
  | { kind: 'direct'; value: { call: RuntimeToolCall } }

type Pending = { prepared: Prepared; approved?: CanvasWriteApprovalAuthority | true }

export interface LaneExtendedDesktopPortsInput {
  binding: ProjectBinding
  /** These adapters must be minted by the committed Surface/main domain owner. */
  timelineRead: PiTimelineReadTransportAdapter
  timelineWrite: PiTimelineWriteTransportAdapter
  canvasWrite: PiCanvasWriteTransportAdapter
  phase4: PiPhase4SurfaceTransportAdapter
  production: PiProductionRunTransportAdapter
  /** Main generation owner may become ready after the project opens. */
  generation(): PiGenerationTransportAdapter | undefined
  receipts: Pick<ProjectAgentProposalReceiptService, 'read'>
  onTaskCreated?(call: RuntimeToolCall, result: unknown): Promise<void>
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

function rejectPreparation(code: string): never {
  throw new LaneDomainFailure({ code, message: `Nomi could not prepare this domain action (${code}).`,
    nextAction: 'Read the current project again and request a new action with its current identifiers and revision.' })
}

/** One lane boundary over existing executors; it owns no second domain store or mutation path. */
export function createLaneExtendedDesktopPorts(input: LaneExtendedDesktopPortsInput) {
  const byName = new Map(LANE_DEFERRED_TOOL_CATALOG.map(spec => [spec.name, spec]))
  const pending = new Map<string, Pending>()
  let disposed = false
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
      let prepared: Prepared
      if (spec.contractId === 'timeline.write') {
        const value = await input.timelineWrite.prepare(call, signal)
        if (!value) rejectPreparation('capability_unsupported')
        prepared = { kind: 'timeline', value }
      } else if (spec.contractId === 'canvas.delete') {
        const value = await input.canvasWrite.prepare(call, signal)
        if (!value) rejectPreparation('capability_unsupported')
        prepared = { kind: 'canvas', value }
      } else if (spec.contractId === 'export.write') {
        const value = await input.phase4.prepareWrite(call, signal)
        if (!value) rejectPreparation('capability_unsupported')
        prepared = { kind: 'export', value }
      } else if (spec.internalGroup === 'production' && call.toolName !== 'start_production_run') {
        const value = await input.production.prepare(call, signal)
        if (!value) rejectPreparation('capability_unsupported')
        prepared = { kind: 'production', value }
      } else {
        // Draft creation and generation planning have their own durable domain owner.
        prepared = { kind: 'direct', value: { call } }
      }
      if (disposed || signal.aborted) rejectPreparation('capability_cancelled')
      pending.set(call.toolCallId, { prepared })
    },
    async approved(call, record) {
      const entry = pending.get(call.toolCallId)
      if (!entry) return
      if (entry.approved || disposed || entry.prepared.value.call.toolName !== call.toolName) rejectPreparation('capability_authority_invalid')
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

  async function execute(call: RuntimeToolCall, signal: AbortSignal): Promise<RuntimeToolDecision> {
    if (disposed || signal.aborted) return failure('capability_cancelled')
    const spec = byName.get(call.toolName)
    if (!spec) return failure('capability_unsupported')
    const contract = capabilityContractById(modelToolCapabilityId(spec, call.args))
    if (!contract) return failure('capability_unsupported')
    if (contract.effect === 'read') {
      if (spec.internalGroup === 'timeline') return await input.timelineRead.tryExecute(call, signal) ?? failure('capability_unsupported')
      if (spec.internalGroup === 'media') return await input.phase4.tryExecuteRead(call, signal) ?? failure('capability_unsupported')
      if (spec.internalGroup === 'production') return await input.production.tryExecute(call, signal) ?? failure('capability_unsupported')
      return await input.generation()?.tryExecute(call, signal) ?? generationSurfaceUnavailable()
    }
    const entry = pending.get(call.toolCallId)
    if (!entry?.approved || entry.prepared.value.call.toolName !== call.toolName
      || JSON.stringify(entry.prepared.value.call.args) !== JSON.stringify(call.args)) return failure('capability_authority_invalid')
    // Consume before crossing the domain boundary. Even an exception cannot reuse this approval.
    pending.delete(call.toolCallId)
    const { prepared, approved } = entry
    let result: RuntimeToolDecision
    if (prepared.kind === 'direct') {
      result = spec.internalGroup === 'production'
        ? await input.production.tryExecute(call, signal) ?? failure('capability_unsupported')
        : await input.generation()?.tryExecute(call, signal) ?? generationSurfaceUnavailable()
    } else {
      if (approved === true) return failure('capability_authority_invalid')
      switch (prepared.kind) {
        case 'timeline': result = await input.timelineWrite.execute(prepared.value, approved, signal); break
        case 'canvas': result = await input.canvasWrite.execute(prepared.value, approved, signal); break
        case 'export': result = await input.phase4.executeWrite(prepared.value, approved, signal); break
        case 'production': result = await input.production.execute(prepared.value, approved, signal); break
      }
      if (result.ok && (prepared.kind === 'canvas' || prepared.kind === 'export')) {
        if (!committedProjectAgentReceiptMatchesApproval(input.binding, input.receipts.read(), approved)) {
          return failure('capability_receipt_unresolved')
        }
      }
      if (result.ok && prepared.kind === 'production' && result.proposalId !== approved.receiptProposalId) {
        return failure('capability_receipt_unresolved')
      }
    }
    if (result.ok && (call.toolName === 'start_production_run'
      || call.toolName === 'nomi_generation_plan' && (call.args as { operation?: unknown }).operation === 'create')) {
      await input.onTaskCreated?.(call, result.result)
    }
    return result
  }

  return { tools: createExtendedLaneTools({ execute }), toolLifecycle, groups: LANE_DEFERRED_TOOL_GROUPS,
    dispose() { disposed = true; pending.clear() },
  }
}
