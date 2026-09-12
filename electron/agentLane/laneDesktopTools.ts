import { committedProjectAgentReceiptMatchesApproval } from '../capabilityCore/projectAgentProposalReceiptCorrelation'
import type { CanvasWriteApprovalAuthority } from '../shared/agentCapabilities/transportContracts'
import { randomUUID } from 'node:crypto'
import type { IpcMainInvokeEvent } from 'electron'
import type { ProjectBinding } from '../shared/projectBinding'
import type { LaneComposerContext } from '../shared/agentLane/laneDesktopContracts'
import type { RuntimeToolCall, RuntimeToolDecision } from '../shared/agentCapabilities/transportContracts'
import type { CanvasWriteResult } from '../shared/agentCapabilities/canvasWrite'
import type { DocumentWriteResult } from '../shared/agentCapabilities/documentWrite'
import { LaneDomainFailure, type OpenLaneOptions } from './laneRuntimePort'
import { createDocumentLaneTools } from './laneDocumentTools'
import { createCanvasLaneTools } from './laneCanvasTools'
import { createTimelineLaneTools } from './laneTimelineTools'
import type { DesktopCanvasReadRuntime } from '../capabilityCore/canvasReadMainRuntime'
import { canvasReadSurfaceRuntime } from '../capabilityCore/canvasReadSurfaceRuntime'
import { createPiCanvasReadTransportAdapter } from '../capabilityCore/canvasReadTransportAdapters'
import { createPiDocumentReadTransportAdapter } from '../capabilityCore/documentReadTransportAdapters'
import { createPiDocumentWriteTransportAdapter, type PreparedDocumentWrite } from '../capabilityCore/documentWriteTransportAdapters'
import { createPiCanvasWriteTransportAdapter, type PreparedCanvasWrite, } from '../capabilityCore/canvasWriteTransportAdapters'
import { createPiTimelineReadTransportAdapter, createPiTimelineWriteTransportAdapter } from '../capabilityCore/timelineTransportAdapters'
import { createPiPhase4SurfaceTransportAdapter } from '../capabilityCore/phase4SurfaceTransportAdapters'
import { createPiSkillReadTransportAdapter } from '../capabilityCore/skillReadTransportAdapters'
import { createPiSkillWriteTransportAdapter } from '../capabilityCore/skillWriteTransportAdapters'
import { requestRenderer } from '../capabilityCore/rendererBridge'
import type { PiGenerationTransportAdapter } from '../capabilityCore/generationTransportAdapters'
import { createLaneExtendedDesktopPorts } from './laneExtendedDesktopPorts'
import { canvasWriteInputOf } from './laneCanvasTools'
import { documentWriteInputOf } from './laneDocumentTools'
import { specsForCapability } from '../shared/agentCapabilities/modelFacingToolRegistry'
import { bindLaneTool } from './laneRuntimePort'
import { LANE_RECEIPT_AUTHORITY_NOTE } from '../shared/agentLane/laneReceiptAuthority'
import { laneToolMutates } from '../shared/agentLane/laneToolContract'
import type { ProjectAgentProposalReceiptService } from '../capabilityCore/projectAgentProposalReceiptStore'
import type { ResidentGenerationAdapterFactory } from '../capabilityCore/residentGenerationAdapterFactory'
import { documentProposalReceiptFor, prepareDocumentProposalReceipt, commitDocumentProposalReceipt, abandonDocumentProposalReceipt } from '../capabilityCore/projectAgentDocumentReceipt'

function resultOf(decision: RuntimeToolDecision | null): unknown {
  if (!decision?.ok) throw new LaneDomainFailure({
    code: decision?.code ?? 'capability_unsupported',
    message: decision?.message ?? 'The selected surface could not complete this action.',
    nextAction: 'Read the current surface again and use its current identifiers and revision before retrying.',
  })
  return decision.result
}

/** Verified Surface adapters own authority. The lane supplies approval and ordering. */
export function createDesktopLaneTools(input: {
  event: IpcMainInvokeEvent
  binding: ProjectBinding
  surface: DesktopCanvasReadRuntime
  context(): LaneComposerContext
  receipts: ProjectAgentProposalReceiptService
  generationFactory: () => ResidentGenerationAdapterFactory['factory'] | undefined
  onTaskCreated(call: RuntimeToolCall, result: unknown): Promise<void>
}) {
  if (!input.surface.surfacePortRuntime) throw new Error('surface_port_unavailable')
  const capturedPort = input.surface.surfaceCapture.captureCommittedCanvasReadPort(input.event, input.binding)
  const shared = { registry: canvasReadSurfaceRuntime.registry, capturedPort,
    requestId: `lane-${randomUUID()}`, executor: input.surface.executor }
  const canvasRead = createPiCanvasReadTransportAdapter(shared)
  const documentRead = createPiDocumentReadTransportAdapter(shared)
  const documentWrite = createPiDocumentWriteTransportAdapter(shared)
  const timelineRead = createPiTimelineReadTransportAdapter(shared)
  const timelineWrite = createPiTimelineWriteTransportAdapter(shared)
  const phase4 = createPiPhase4SurfaceTransportAdapter(shared)
  const skillRead = createPiSkillReadTransportAdapter()
  const skillWrite = createPiSkillWriteTransportAdapter({ binding: input.binding })
  const canvasWrite = createPiCanvasWriteTransportAdapter({ ...shared,
    port: input.surface.surfacePortRuntime.createCanvasWritePort(capturedPort) })
  const preparedDocuments = new Map<string, PreparedDocumentWrite>()
  const preparedCanvases = new Map<string, PreparedCanvasWrite>()
  const approvals = new Map<string, CanvasWriteApprovalAuthority>()
  const approvedCalls = new Set<string>()
  const documentReceipts = new Map<string, { proposal: ReturnType<typeof documentProposalReceiptFor>; prepared: ReturnType<typeof prepareDocumentProposalReceipt>; approvalId: string }>()

  const tools = [
    ...createDocumentLaneTools({
      read: async (scope, context) => resultOf(await documentRead.tryExecute({
        toolCallId: context.toolCallId, toolName: 'nomi_document_read', args: { scope },
      }, input.context().documentId ?? '', context.signal)),
      write: async (_value, context) => {
        const prepared = preparedDocuments.get(context.toolCallId)
        const receipt = documentReceipts.get(context.toolCallId)
        if (!prepared || !receipt || !approvedCalls.delete(context.toolCallId)) throw new Error('capability_authority_invalid')
        preparedDocuments.delete(context.toolCallId)
        let decision: RuntimeToolDecision
        try { decision = await documentWrite.execute(prepared, context.signal) } catch (error) {
          abandonDocumentProposalReceipt(input.receipts, receipt.prepared, receipt.proposal, receipt.approvalId)
          throw error
        }
        if (!decision.ok) abandonDocumentProposalReceipt(input.receipts, receipt.prepared, receipt.proposal, receipt.approvalId)
        const result = resultOf(decision) as DocumentWriteResult
        commitDocumentProposalReceipt(input.receipts, receipt.prepared, receipt.proposal, receipt.approvalId)
        return result
      },
    }),
    ...createCanvasLaneTools({
      read: async (context) => resultOf(await canvasRead.tryExecute({
        toolCallId: context.toolCallId, toolName: 'nomi_canvas_read', args: {},
      }, context.signal)),
      write: async (_value, context) => {
        const prepared = preparedCanvases.get(context.toolCallId)
        const approval = approvals.get(context.toolCallId)
        if (!prepared || !approval || !approvedCalls.delete(context.toolCallId)) throw new Error('capability_authority_invalid')
        preparedCanvases.delete(context.toolCallId)
        const decision = await canvasWrite.execute(prepared, approval, context.signal)
        if (decision.ok && !committedProjectAgentReceiptMatchesApproval(input.binding, input.receipts.read(), approval)) {
          throw new Error('capability_receipt_unresolved')
        }
        return resultOf(decision) as CanvasWriteResult
      },
    }),
    ...createTimelineLaneTools({ read: async ({ operation, ...args }, context) => resultOf(await timelineRead.tryExecute({
      // The alias transport owns operation binding; its strict args exclude that semantic field.
      toolCallId: context.toolCallId, toolName: operation, args,
    }, context.signal)) }),
    // `start_model_setup`：只打开「设置 · 模型」面板并预填供应商；密钥永远由用户在面板里输入。
    ...specsForCapability('model.setup.open').map(spec => bindLaneTool(spec, async (args) => {
      const provider = typeof (args as { provider?: unknown }).provider === 'string' ? (args as { provider: string }).provider : undefined
      await requestRenderer('settings.open-model-provider', { ...(provider ? { provider } : {}) }, 30_000)
      return { ok: true, text: 'Nomi opened the model settings panel.' + (provider ? ` The ${provider} provider is preselected.` : ''), details: { opened: true, ...(provider ? { provider } : {}) },
        nextAction: { kind: 'user_sees_panel', userSees: `The model settings panel is open${provider ? ` on ${provider}` : ''}; the user pastes the API key there. This call stored nothing.` } }
    })),
  ]
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const toolLifecycle: NonNullable<OpenLaneOptions['toolLifecycle']> = {
    prepare: async (call: RuntimeToolCall, signal: AbortSignal) => {
      const tool = byName.get(call.toolName)
      if (!tool || !laneToolMutates(tool.effect)) return
      const verbArgs = tool.schema.parse(call.args)
      if (tool.contractId === 'document.write') {
        const context = input.context()
        if (!context.documentId || !context.target || !context.preconditions) throw new Error('document_target_stale')
        // 传输层按方法词表（insert/replace/append）认路；动词参数在这里翻一次，`laneDocumentTools.ts` 是唯一对应表。
        const { operation, content } = documentWriteInputOf(verbArgs)
        const prepared = await documentWrite.prepare({ ...call, toolName: operation, args: { content } }, {
          documentId: context.documentId, target: context.target, preconditions: context.preconditions,
        }, signal)
        if (!prepared) throw new Error('capability_unsupported')
        preparedDocuments.set(call.toolCallId, prepared)
      } else if (tool.contractId === 'canvas.write') {
        // 三个画布写动词 → 契约 operation（`canvasWriteInputOf`，唯一对应表）；传输层按 `nomi_canvas_edit` + operation 认路。
        const prepared = await canvasWrite.prepare({ ...call, toolName: 'nomi_canvas_edit', args: canvasWriteInputOf(call.toolName, verbArgs) }, signal)
        if (!prepared) throw new Error('capability_unsupported')
        preparedCanvases.set(call.toolCallId, prepared)
      }
    },
    settled: (call) => {
      preparedDocuments.delete(call.toolCallId)
      preparedCanvases.delete(call.toolCallId)
      approvals.delete(call.toolCallId)
      approvedCalls.delete(call.toolCallId)
      documentReceipts.delete(call.toolCallId)
    },
    approved: async (call, record) => {
      const document = preparedDocuments.get(call.toolCallId)
      const prepared = preparedCanvases.get(call.toolCallId) ?? document
      if (prepared) {
        const authority: CanvasWriteApprovalAuthority = { approvalId: `approval-${randomUUID()}`,
          receiptProposalId: `receipt-${randomUUID()}`, actionHash: prepared.invocation.actionHash }
        // Await durable confirmation before exposing authority to the executor or renderer receipt writer.
        await record(LANE_RECEIPT_AUTHORITY_NOTE, { ...authority, toolCallId: call.toolCallId })
        approvals.set(call.toolCallId, authority)
        if (document) {
          const proposal = documentProposalReceiptFor(call, authority, document)
          documentReceipts.set(call.toolCallId, { proposal, approvalId: authority.approvalId,
            prepared: prepareDocumentProposalReceipt(input.receipts, proposal, authority.approvalId) })
        }
      }
      if (prepared || preparedDocuments.has(call.toolCallId)) approvedCalls.add(call.toolCallId)
    },
  }
  let installedFactory: ResidentGenerationAdapterFactory['factory'] | undefined
  let generation: PiGenerationTransportAdapter | undefined
  const extended = createLaneExtendedDesktopPorts({ binding: input.binding,
    timelineRead, timelineWrite, canvasWrite, phase4, skillRead, skillWrite, receipts: input.receipts,
    generation: () => {
      const factory = input.generationFactory()
      if (factory !== installedFactory) {
        generation?.dispose()
        installedFactory = factory
        generation = factory?.(input.binding)
      }
      return generation
    }, onTaskCreated: input.onTaskCreated,
  })
  return {
    tools: [...tools, ...extended.tools],
    toolLifecycle: {
      prepare: async (call, signal) => { await toolLifecycle.prepare(call, signal); await extended.toolLifecycle.prepare(call, signal) },
      approved: async (call, record) => { await toolLifecycle.approved(call, record); await extended.toolLifecycle.approved(call, record) },
      settled: (call) => { toolLifecycle.settled(call); extended.toolLifecycle.settled(call) },
    } satisfies NonNullable<OpenLaneOptions['toolLifecycle']>,
    dispose: () => {
      extended.dispose(); generation?.dispose()
      for (const port of [canvasRead, documentRead, documentWrite, canvasWrite, timelineRead, timelineWrite, phase4, skillRead, skillWrite]) port.dispose()
      preparedDocuments.clear(); preparedCanvases.clear(); approvals.clear(); approvedCalls.clear()
      documentReceipts.clear()
    },
  }
}
