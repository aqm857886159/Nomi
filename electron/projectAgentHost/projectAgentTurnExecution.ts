import type { AgentChatToolDecision } from "../harness/agentChatContracts";
import type { ProjectAgentExecutionEventPayload, ProjectAgentMutation, ProjectAgentFailureItem, ProjectAgentHostState, ProjectAgentQueueItem, ProjectAgentStatus, ProposalApprovalRef } from "../shared/projectAgentContracts";
import type { PiCanvasReadTransportAdapter } from "../capabilityCore/canvasReadTransportAdapters";
import type { PiDocumentReadTransportAdapter } from "../capabilityCore/documentReadTransportAdapters";
import type { PiDocumentWriteTransportAdapter, PreparedDocumentWrite } from "../capabilityCore/documentWriteTransportAdapters";
import type { PiCanvasWriteTransportAdapter, PreparedCanvasWrite } from "../capabilityCore/canvasWriteTransportAdapters";
import type { PiTimelineReadTransportAdapter, PiTimelineWriteTransportAdapter, PreparedTimelineWrite } from "../capabilityCore/timelineTransportAdapters";
import type { PiPhase4SurfaceTransportAdapter, PreparedExportWrite } from "../capabilityCore/phase4SurfaceTransportAdapters";
import type { PiSkillReadTransportAdapter } from "../capabilityCore/skillReadTransportAdapters";
import type { PiSkillWriteTransportAdapter, PreparedSkillWrite } from "../capabilityCore/skillWriteTransportAdapters";
import type { PiProductionRunTransportAdapter } from "../capabilityCore/productionRunTransportAdapters";
import type { PiGenerationTransportAdapter } from "../capabilityCore/generationTransportAdapters";
import type { OfflineProjectAgentHost } from "./projectAgentHost";
import { proposalSettlementsFor, readProposalReceiptSafely, type ActiveExecution, type CanvasWriteCapabilityOutcomeCode, type ExecutionPartition, type ProjectAgentExecutionCoordinatorDeps } from "./projectAgentExecutionCoordinatorTypes";
import { executeProductionApproval, reprepareEffectiveCall } from "./projectAgentApprovalHelpers";
import { resolveCapabilityAlias } from "../shared/agentCapabilities/registry";
import { projectAgentWorkModeDecision } from "./projectAgentExecutionPolicy";
import { DOCUMENT_READ_CAPABILITY } from "../shared/agentCapabilities/documentRead";
import { CANVAS_DELETE_CAPABILITY } from "../shared/agentCapabilities/canvasDelete";
import { CANVAS_WRITE_CAPABILITY } from "../shared/agentCapabilities/canvasWrite";
import { TIMELINE_READ_CAPABILITY } from "../shared/agentCapabilities/timelineRead";
import { TIMELINE_WRITE_CAPABILITY } from "../shared/agentCapabilities/timelineWrite";
import { ASSET_READ_CAPABILITY } from "../shared/agentCapabilities/assetRead";
import { EXPORT_READ_CAPABILITY, EXPORT_WRITE_CAPABILITY } from "../shared/agentCapabilities/exportCapabilities";
import { SKILL_WRITE_CAPABILITY } from "../shared/agentCapabilities/skillWrite";
import { SKILL_READ_CAPABILITY } from "../shared/agentCapabilities/skillRead";
import { committedProjectAgentReceiptMatchesApproval } from "./projectAgentProposalReceiptCorrelation";
import { digest, steeredExecutionPrompt, exportJobTaskItems, productionRunTaskItems, statusForResponse, toolItem, hostPromptLedgerForTurn } from "./projectAgentExecutionHelpers";
import { isPiGenerationToolName } from "../capabilityCore/generationTransportAdapters";

type ToolCall = { toolCallId: string; toolName: string; args: unknown };
type PreparedInvocation = { target: ProjectAgentQueueItem["target"]; preconditions: ProjectAgentQueueItem["preconditions"]; policyRevision: number; inputHash: string; actionHash: string };

export type ProjectAgentTurnExecutionContext = Readonly<{
  now: () => string;
  dispatchPartition: (partition: ExecutionPartition, mutation: ProjectAgentMutation) => ReturnType<OfflineProjectAgentHost["dispatch"]>;
  publish: (partition: ExecutionPartition, event: ProjectAgentExecutionEventPayload) => void;
  dispatchFresh: (partition: ExecutionPartition, build: (state: ProjectAgentHostState) => ProjectAgentMutation) => Promise<Awaited<ReturnType<OfflineProjectAgentHost["dispatch"]>>>;
  queueExecutionMutation: (execution: ActiveExecution, work: () => Promise<void>) => Promise<void>;
  recordProposalSettlement: (execution: ActiveExecution, approvalId: string, status: ProjectAgentStatus) => void;
  cleanupExecution: (partition: ExecutionPartition, execution: ActiveExecution, keepRequest: boolean) => void;
  reportInternalError: NonNullable<ProjectAgentExecutionCoordinatorDeps["reportInternalError"]>;
  runAgent: NonNullable<ProjectAgentExecutionCoordinatorDeps["runAgent"]>;
  awaitToolDecision: (partition: ExecutionPartition, execution: ActiveExecution, call: ToolCall, signal: AbortSignal) => Promise<AgentChatToolDecision>;
  persistPreparedProposal: (partition: ExecutionPartition, execution: ActiveExecution, call: ToolCall, decision: AgentChatToolDecision, prepared: { invocation: PreparedInvocation }) => Promise<ProposalApprovalRef>;
  persistApprovedProposal: (partition: ExecutionPartition, execution: ActiveExecution, call: ToolCall, decision: AgentChatToolDecision, verified?: Readonly<{
    approvalId: string;
    receiptProposalId: string;
    target: ProjectAgentQueueItem["target"];
    preconditions: ProjectAgentQueueItem["preconditions"];
    policyRevision: number;
    inputHash: string;
    actionHash: string;
  }>) => Promise<ProposalApprovalRef | undefined>;
  rememberCanvasWriteOutcome: (execution: ActiveExecution, toolCallId: string, code: string | undefined, fallback: CanvasWriteCapabilityOutcomeCode, denied?: boolean) => Extract<AgentChatToolDecision, { ok: false }>;
  canvasReadFor: (partition: ExecutionPartition, preferredSubscriptionId: string, turnCanvasRead?: PiCanvasReadTransportAdapter) => PiCanvasReadTransportAdapter | undefined;
  documentReadFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiDocumentReadTransportAdapter | undefined;
  documentWriteFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiDocumentWriteTransportAdapter | undefined;
  canvasWriteFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiCanvasWriteTransportAdapter | undefined;
  timelineReadFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiTimelineReadTransportAdapter | undefined;
  timelineWriteFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiTimelineWriteTransportAdapter | undefined;
  phase4SurfaceFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiPhase4SurfaceTransportAdapter | undefined;
  skillReadFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiSkillReadTransportAdapter | undefined;
  skillWriteFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiSkillWriteTransportAdapter | undefined;
  productionRunFor: (partition: ExecutionPartition) => PiProductionRunTransportAdapter | undefined;
  generationFor: (partition: ExecutionPartition) => PiGenerationTransportAdapter | undefined;
  proposalReceiptReaderFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => (() => import("../shared/projectAgentProposalReceipt").ProjectAgentProposalReceiptView | null) | undefined;
}>;

export async function executeProjectAgentTurn(context: ProjectAgentTurnExecutionContext, partition: ExecutionPartition, execution: ActiveExecution): Promise<"continue" | "stop"> {
  const { now, dispatchPartition, publish, dispatchFresh, queueExecutionMutation, recordProposalSettlement, cleanupExecution, reportInternalError, runAgent, awaitToolDecision, persistApprovedProposal, persistPreparedProposal, rememberCanvasWriteOutcome, canvasReadFor, documentReadFor, documentWriteFor, canvasWriteFor, timelineReadFor, timelineWriteFor, phase4SurfaceFor, skillReadFor, skillWriteFor, productionRunFor, generationFor, proposalReceiptReaderFor } = context;
  const startAt = now();
  const current = partition.host.getSnapshot(partition.binding);
  const assistantItem = Object.freeze({
    itemId: `assistant-${digest([execution.turn.executionToken, "assistant"])}`,
    threadId: execution.turn.threadId,
    turnId: execution.turn.turnId,
    kind: "assistant" as const,
    text: "",
    textRevision: 0,
    status: "running" as const,
    retryable: false,
    deviated: false,
    createdAt: startAt,
    updatedAt: startAt,
  });
  try {
    await dispatchPartition(partition, {
      commandId: `turn-start-${execution.turn.executionToken}`,
      expectedRevision: current.hostRevision,
      binding: partition.binding,
      sender: { kind: "internal", senderId: execution.turn.executionToken },
      type: "turn.start",
      payload: {
        turnId: execution.turn.turnId,
        queueItemId: execution.queueItem.queueItemId,
        assistantItem,
        occurredAt: startAt,
      },
    });
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === "revision_conflict" || code === "running_turn_exists" || code === "queue_order_violation") {
      cleanupExecution(partition, execution, true);
      return partition.host.getSnapshot(partition.binding).hostRevision !== current.hostRevision ? "continue" : "stop";
    }
    if (!execution.controller.signal.aborted) {
      reportInternalError(error, {
        phase: "start",
        turnId: execution.turn.turnId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    cleanupExecution(partition, execution, false);
    return "stop";
  }
  const append = (delta: string): void => {
    void queueExecutionMutation(execution, async () => {
      if (execution.controller.signal.aborted || !delta) return;
      const state = partition.host.getSnapshot(partition.binding);
      const item = state.items.find(
        (candidate) => candidate.kind === "assistant" && candidate.turnId === execution.turn.turnId,
      );
      if (!item || item.kind !== "assistant") return;
      try {
        await dispatchFresh(partition, (state) => ({
          commandId: `assistant-append-${execution.turn.executionToken}-${item.textRevision + 1}-${digest(delta).slice(0, 12)}`,
          expectedRevision: state.hostRevision,
          binding: partition.binding,
          sender: { kind: "embedded-agent", senderId: execution.turn.executionToken },
          type: "assistant.append",
          payload: {
            turnId: execution.turn.turnId,
            itemId: item.itemId,
            executionToken: execution.turn.executionToken,
            expectedTextRevision: item.textRevision,
            delta,
            occurredAt: now(),
          },
        }));
      } catch (error) {
        if (!execution.controller.signal.aborted && !String((error as { code?: unknown })?.code).includes("stale"))
          throw error;
      }
    });
  };
  try {
    const request = {
      ...execution.request,
      history: { kind: "ephemeral" as const },
      projectId: execution.request.projectId ?? partition.binding.projectId,
      canvasProjectId: execution.request.canvasProjectId ?? partition.binding.projectId,
      prompt: steeredExecutionPrompt(partition.host.getSnapshot(partition.binding), execution.turn.turnId, execution.request, execution.steering), hostPromptLedger: hostPromptLedgerForTurn(partition.host.getSnapshot(partition.binding), execution.turn.threadId),
    };
    const response = await runAgent(request, {
      abortSignal: execution.controller.signal,
      emit: (event) => {
        if (event.type === "content-delta") append(event.delta);
      },
      awaitToolConfirmation: async (call, signal) => {
        const frozen = partition.requests.get(execution.turn.turnId);
        const canonicalCapability = resolveCapabilityAlias(call.toolName)?.contract;
        const workModeDecision = projectAgentWorkModeDecision(execution.turn.workMode, call.toolName, call.args);
        if (!workModeDecision.allowed) {
          return {
            ok: false,
            denied: true,
            code: "work_mode_denied",
            message: workModeDecision.reason ?? "Agent work mode denied this action",
          };
        }
        const isCanvasMutation = canonicalCapability?.id === CANVAS_WRITE_CAPABILITY.id || canonicalCapability?.id === CANVAS_DELETE_CAPABILITY.id || ["nomi_canvas_plan", "nomi_canvas_edit", "nomi_canvas_maintenance"].includes(call.toolName);
        const canvasOperation = call.args && typeof call.args === "object" && !Array.isArray(call.args)
          ? (call.args as Record<string, unknown>).operation
          : undefined;
        const isRendererHandledStoryboardProposal =
          canonicalCapability?.id === CANVAS_WRITE_CAPABILITY.id
          && (
            // The renderer-owned planner still emits this historical alias;
            // keep it on the same guarded path while MCP uses the canonical
            // nomi_canvas_plan operation envelope.
            call.toolName === "propose_storyboard_plan"
            || (
              call.toolName === "nomi_canvas_plan"
              && (canvasOperation === "propose_storyboard_plan" || canvasOperation === "patch_shots")
            )
          );
        if (isCanvasMutation && execution.blockedCanvasWriteDecision) {
          return execution.blockedCanvasWriteDecision;
        }
        const read = await canvasReadFor(
          partition,
          frozen?.preferredSubscriptionId ?? "",
          execution.canvasRead,
        )?.tryExecute(call, signal);
        if (read) return read;
        const documentId = execution.queueItem.target.kind === "document" ? execution.queueItem.target.documentId : "";
        const documentAdapter = documentReadFor(partition, frozen?.preferredSubscriptionId ?? "");
        const document = await documentAdapter?.tryExecute(call, documentId, signal);
        if (document) return document;
        if (canonicalCapability?.id === DOCUMENT_READ_CAPABILITY.id) {
          return { ok: false, code: "surface_port_unavailable", message: "surface_port_unavailable" };
        }
        const timelineReadAdapter = timelineReadFor(partition, frozen?.preferredSubscriptionId ?? "");
        const timelineRead = await timelineReadAdapter?.tryExecute(call, signal);
        if (timelineRead) return timelineRead;
        if (canonicalCapability?.id === TIMELINE_READ_CAPABILITY.id) {
          return { ok: false, code: "surface_port_unavailable", message: "surface_port_unavailable" };
        }
        const phase4Surface = phase4SurfaceFor(partition, frozen?.preferredSubscriptionId ?? "");
        const phase4Read = await phase4Surface?.tryExecuteRead(call, signal);
        if (phase4Read) return phase4Read;
        if (
          canonicalCapability?.id === ASSET_READ_CAPABILITY.id
          || canonicalCapability?.id === EXPORT_READ_CAPABILITY.id
        ) {
          return { ok: false, code: "surface_port_unavailable", message: "surface_port_unavailable" };
        }
        if (isPiGenerationToolName(call.toolName)) return (await generationFor(partition)?.tryExecute(call, signal)) ?? { ok: false, code: "generation_surface_unavailable", message: "generation_surface_unavailable" };
        const productionRun = productionRunFor(partition);
        const productionRead = await productionRun?.tryExecute(call, signal);
        if (productionRead) return productionRead;
        if (productionRun) {
          const production = await executeProductionApproval({ adapter: productionRun, call, signal, awaitDecision: (nextCall, nextSignal) => awaitToolDecision(partition, execution, nextCall, nextSignal), persist: (nextCall, decision, prepared) => persistPreparedProposal(partition, execution, nextCall, decision, prepared as { invocation: { target: ProjectAgentQueueItem["target"]; preconditions: ProjectAgentQueueItem["preconditions"]; policyRevision: number; inputHash: string; actionHash: string } }), remember: (code, fallback, denied) => rememberCanvasWriteOutcome(execution, call.toolCallId, code, fallback as CanvasWriteCapabilityOutcomeCode, denied), settle: (approvalId, status) => recordProposalSettlement(execution, approvalId, status) });
          if (production) return production;
        }
        if (resolveCapabilityAlias(call.toolName)?.contract?.execution.port === "production-run") {
          return rememberCanvasWriteOutcome(execution, call.toolCallId, "capability_surface_unavailable", "capability_surface_unavailable");
        }
        // Skill loading is a canonical read capability.  It must be handled
        // by the same main-process catalog owner as MCP/Workbench reads;
        // never turn it into a renderer approval request or let the model
        // receive a synthetic success from the generic confirmation path.
        const skillReadAdapter = skillReadFor(partition, frozen?.preferredSubscriptionId ?? "");
        const skillRead = await skillReadAdapter?.tryExecute(call, signal);
        if (skillRead) return skillRead;
        if (canonicalCapability?.id === SKILL_READ_CAPABILITY.id) {
          return rememberCanvasWriteOutcome(
            execution,
            call.toolCallId,
            "capability_surface_unavailable",
            "capability_surface_unavailable",
          );
        }
        const skillWriteAdapter = skillWriteFor(partition, frozen?.preferredSubscriptionId ?? "");
        if (skillWriteAdapter) {
          let prepared: PreparedSkillWrite | null;
          try {
            prepared = await skillWriteAdapter.prepare(call, {
              target: execution.queueItem.target,
              preconditions: execution.queueItem.preconditions,
            }, signal);
          } catch (error) {
            const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
              ? (error as { code: string }).code
              : error instanceof Error ? error.message : "capability_execution_failed";
            return rememberCanvasWriteOutcome(execution, call.toolCallId, code, "capability_execution_failed");
          }
          if (prepared) {
            const decision = await awaitToolDecision(partition, execution, call, signal);
            if (!decision.ok) {
              return rememberCanvasWriteOutcome(
                execution,
                call.toolCallId,
                decision.code,
                signal.aborted ? "capability_cancelled" : "capability_declined",
                decision.denied,
              );
            }
            const effective = await reprepareEffectiveCall(
              call,
              decision,
              prepared,
              (effectiveCall) => skillWriteAdapter.prepare(effectiveCall, {
                target: execution.queueItem.target,
                preconditions: execution.queueItem.preconditions,
              }, signal),
            );
            if (!effective.ok) {
              return rememberCanvasWriteOutcome(execution, call.toolCallId, effective.code, effective.code);
            }
            let persisted: ProposalApprovalRef;
            try {
              persisted = await persistPreparedProposal(
                partition,
                execution,
                effective.call,
                decision,
                effective.prepared,
              );
            } catch {
              return rememberCanvasWriteOutcome(
                execution,
                call.toolCallId,
                "capability_execution_failed",
                "capability_execution_failed",
              );
            }
            let executed: AgentChatToolDecision;
            try {
              executed = await skillWriteAdapter.execute(effective.prepared, {
                receiptProposalId: persisted.receiptProposalId,
                approvalId: persisted.approvalId,
                actionHash: persisted.actionHash,
              }, signal);
            } catch {
              executed = { ok: false, code: "capability_execution_failed", message: "capability_execution_failed" };
            }
            if (!executed.ok) {
              recordProposalSettlement(execution, persisted.approvalId, "failed");
              return rememberCanvasWriteOutcome(
                execution,
                call.toolCallId,
                executed.code,
                signal.aborted ? "capability_cancelled" : "capability_execution_failed",
              );
            }
            if (executed.proposalId !== persisted.receiptProposalId) {
              recordProposalSettlement(execution, persisted.approvalId, "failed");
              return rememberCanvasWriteOutcome(
                execution,
                call.toolCallId,
                "capability_receipt_unresolved",
                "capability_receipt_unresolved",
              );
            }
            recordProposalSettlement(execution, persisted.approvalId, "done");
            return executed;
          }
        }
        if (canonicalCapability?.id === SKILL_WRITE_CAPABILITY.id) {
          return rememberCanvasWriteOutcome(
            execution,
            call.toolCallId,
            "capability_surface_unavailable",
            "capability_surface_unavailable",
          );
        }
        const canvasWriteAdapter = canvasWriteFor(partition, frozen?.preferredSubscriptionId ?? "");
        if (canvasWriteAdapter) {
          let prepared: PreparedCanvasWrite | null;
          try {
            prepared = await canvasWriteAdapter.prepare(call, signal);
          } catch (error) {
            const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
              ? (error as { code: string }).code
              : error instanceof Error ? error.message : "capability_execution_failed";
            return rememberCanvasWriteOutcome(execution, call.toolCallId, code, "capability_unsupported");
          }
          if (prepared) {
            const decision = await awaitToolDecision(partition, execution, call, signal);
            if (!decision.ok) {
              return rememberCanvasWriteOutcome(
                execution,
                call.toolCallId,
                decision.code,
                signal.aborted ? "capability_cancelled" : "capability_declined",
                decision.denied,
              );
            }
            const effective = await reprepareEffectiveCall(call, decision, prepared, (effectiveCall) => canvasWriteAdapter.prepare(effectiveCall, signal));
            if (!effective.ok) return rememberCanvasWriteOutcome(execution, call.toolCallId, effective.code, effective.code);
            const persisted = await persistPreparedProposal(partition, execution, effective.call, decision, effective.prepared);
            let executed: AgentChatToolDecision | undefined;
            try {
              executed = await canvasWriteAdapter.execute(effective.prepared, {
                receiptProposalId: persisted.receiptProposalId,
                approvalId: persisted.approvalId,
                actionHash: persisted.actionHash,
              }, signal);
            } catch {
              executed = undefined;
            }
            const receipt = readProposalReceiptSafely(proposalReceiptReaderFor(
              partition,
              frozen?.preferredSubscriptionId ?? "",
            ));
            const receiptMatches = committedProjectAgentReceiptMatchesApproval(
              partition.binding,
              receipt,
              persisted,
            );
            if (receiptMatches && (!executed || !executed.ok)) {
              const recovered = {
                ok: true,
                proposalId: persisted.receiptProposalId,
                silent: true,
              } as const;
              recordProposalSettlement(execution, persisted.approvalId, "done");
              execution.blockedCanvasWriteDecision = recovered;
              return recovered;
            }
            const outputProposalId = executed?.ok && executed.result
              && typeof executed.result === "object"
              && !Array.isArray(executed.result)
              && typeof (executed.result as { proposalId?: unknown }).proposalId === "string"
              ? (executed.result as { proposalId: string }).proposalId
              : undefined;
            if (
              outputProposalId !== persisted.receiptProposalId
              || !receiptMatches
            ) {
              const unresolved = rememberCanvasWriteOutcome(
                execution,
                call.toolCallId,
                "capability_receipt_unresolved",
                "capability_receipt_unresolved",
              );
              execution.blockedCanvasWriteDecision = unresolved;
              recordProposalSettlement(execution, persisted.approvalId, "failed");
              return unresolved;
            }
            recordProposalSettlement(execution, persisted.approvalId, "done");
            return executed!;
          }
          if (isCanvasMutation) {
            return rememberCanvasWriteOutcome(
              execution,
              call.toolCallId,
              "capability_unsupported",
              "capability_unsupported",
            );
          }
        }
        if (isCanvasMutation && !isRendererHandledStoryboardProposal) {
          return rememberCanvasWriteOutcome(
            execution,
            call.toolCallId,
            "capability_surface_unavailable",
            "capability_surface_unavailable",
          );
        }
        if (phase4Surface) {
          let prepared: PreparedExportWrite | null;
          try {
            prepared = await phase4Surface.prepareWrite(call, signal);
          } catch (error) {
            const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
              ? (error as { code: string }).code
              : error instanceof Error ? error.message : "capability_execution_failed";
            return rememberCanvasWriteOutcome(execution, call.toolCallId, code, "capability_unsupported");
          }
          if (prepared) {
            const decision = await awaitToolDecision(partition, execution, call, signal);
            if (!decision.ok) {
              return rememberCanvasWriteOutcome(
                execution,
                call.toolCallId,
                decision.code,
                signal.aborted ? "capability_cancelled" : "capability_declined",
                decision.denied,
              );
            }
            const effective = await reprepareEffectiveCall(call, decision, prepared, (effectiveCall) => phase4Surface.prepareWrite(effectiveCall, signal));
            if (!effective.ok) return rememberCanvasWriteOutcome(execution, call.toolCallId, effective.code, effective.code);
            const persisted = await persistPreparedProposal(partition, execution, effective.call, decision, effective.prepared);
            const executed = await phase4Surface.executeWrite(effective.prepared, {
              receiptProposalId: persisted.receiptProposalId,
              approvalId: persisted.approvalId,
              actionHash: persisted.actionHash,
            }, signal);
            const receipt = readProposalReceiptSafely(proposalReceiptReaderFor(
              partition,
              frozen?.preferredSubscriptionId ?? "",
            ));
            const receiptMatches = committedProjectAgentReceiptMatchesApproval(
              partition.binding,
              receipt,
              persisted,
            );
            if (!executed.ok || !receiptMatches) {
              recordProposalSettlement(execution, persisted.approvalId, "failed");
              return rememberCanvasWriteOutcome(
                execution,
                call.toolCallId,
                executed.ok ? "capability_receipt_unresolved" : executed.code,
                signal.aborted ? "capability_cancelled" : "capability_receipt_unresolved",
              );
            }
            recordProposalSettlement(execution, persisted.approvalId, "done");
            return executed;
          }
        }
        if (canonicalCapability?.id === EXPORT_WRITE_CAPABILITY.id) {
          return rememberCanvasWriteOutcome(
            execution,
            call.toolCallId,
            "capability_surface_unavailable",
            "capability_surface_unavailable",
          );
        }
        const timelineWriteAdapter = timelineWriteFor(partition, frozen?.preferredSubscriptionId ?? "");
        if (timelineWriteAdapter) {
          let prepared: PreparedTimelineWrite | null;
          try {
            prepared = await timelineWriteAdapter.prepare(call, signal);
          } catch (error) {
            const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
              ? (error as { code: string }).code
              : error instanceof Error ? error.message : "capability_execution_failed";
            return rememberCanvasWriteOutcome(execution, call.toolCallId, code, "capability_unsupported");
          }
          if (prepared) {
            const decision = await awaitToolDecision(partition, execution, call, signal);
            if (!decision.ok) {
              return rememberCanvasWriteOutcome(
                execution,
                call.toolCallId,
                decision.code,
                signal.aborted ? "capability_cancelled" : "capability_declined",
                decision.denied,
              );
            }
            const effective = await reprepareEffectiveCall(call, decision, prepared, (effectiveCall) => timelineWriteAdapter.prepare(effectiveCall, signal));
            if (!effective.ok) return rememberCanvasWriteOutcome(execution, call.toolCallId, effective.code, effective.code);
            const persisted = await persistPreparedProposal(partition, execution, effective.call, decision, effective.prepared);
            const executed = await timelineWriteAdapter.execute(effective.prepared, {
              receiptProposalId: persisted.receiptProposalId,
              approvalId: persisted.approvalId,
              actionHash: persisted.actionHash,
            }, signal);
            recordProposalSettlement(execution, persisted.approvalId, executed.ok ? "done" : "failed");
            if (!executed.ok) {
              return rememberCanvasWriteOutcome(
                execution,
                call.toolCallId,
                executed.code,
                signal.aborted ? "capability_cancelled" : "capability_target_stale",
              );
            }
            return executed;
          }
        }
        if (canonicalCapability?.id === TIMELINE_WRITE_CAPABILITY.id) {
          return rememberCanvasWriteOutcome(
            execution,
            call.toolCallId,
            "capability_surface_unavailable",
            "capability_surface_unavailable",
          );
        }
        const writeAdapter = documentWriteFor(partition, frozen?.preferredSubscriptionId ?? "");
        if (writeAdapter) {
          const documentId = execution.queueItem.target.kind === "document" ? execution.queueItem.target.documentId : "";
          let prepared: PreparedDocumentWrite | null;
          try {
            prepared = await writeAdapter.prepare(call, {
              documentId,
              target: execution.queueItem.target,
              preconditions: execution.queueItem.preconditions,
            }, signal);
          } catch (error) {
            const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
              ? (error as { code: string }).code
              : error instanceof Error ? error.message : "capability_execution_failed";
            return { ok: false, code, message: code };
          }
          if (prepared) {
            const decision = await awaitToolDecision(partition, execution, call, signal);
            if (!decision.ok) return decision;
            const effective = await reprepareEffectiveCall(call, decision, prepared, (effectiveCall) => writeAdapter.prepare(effectiveCall, { documentId, target: execution.queueItem.target, preconditions: execution.queueItem.preconditions }, signal));
            if (!effective.ok) return { ok: false, message: effective.code, code: effective.code };
            try {
              const persisted = await persistPreparedProposal(partition, execution, effective.call, decision, effective.prepared);
              const executed = await writeAdapter.execute(effective.prepared, signal);
              recordProposalSettlement(execution, persisted.approvalId, executed.ok ? "done" : "failed");
              return executed;
            } catch {
              return { ok: false, message: "approval_persistence_failed" };
            }
          }
        }
        const decision = await awaitToolDecision(partition, execution, call, signal);
        if (decision.ok && !decision.silent) {
          try {
            await persistApprovedProposal(partition, execution, call, decision);
          } catch {
            return { ok: false, message: "approval_persistence_failed" };
          }
        }
        return decision;
      },
    });
    await execution.publicationTail;
    const finalState = partition.host.getSnapshot(partition.binding);
    const assistant = finalState.items.find(
      (candidate) => candidate.kind === "assistant" && candidate.turnId === execution.turn.turnId,
    );
    const capabilityOutcome = execution.capabilityOutcome;
    const status = capabilityOutcome?.status ?? statusForResponse(response);
    const proposalSettlements = proposalSettlementsFor(execution, status);
    const receivedAt = now();
    const beforeResult = partition.host.getSnapshot(partition.binding);
    const toolItems = response.toolCalls.map((item) => toolItem(partition.binding, execution.turn, item, receivedAt, response.provenance));
    const settledApprovalIds = new Set(
      proposalSettlements.filter((settlement) => settlement.status === "done").map((settlement) => settlement.approvalId),
    );
    const receiptCorrelatedToolCallIds = new Set(
      beforeResult.proposalApprovals.flatMap((approval) => settledApprovalIds.has(approval.ref.approvalId)
        ? [approval.ref.toolCallId]
        : []),
    );
    const taskItems = exportJobTaskItems(
      partition.binding,
      execution.turn,
      response.toolCalls.filter((record) => receiptCorrelatedToolCallIds.has(record.toolCallId)),
      beforeResult.items,
      receivedAt,
    );
    const productionTaskItems = productionRunTaskItems(partition.binding, execution.turn, response.toolCalls.filter((record) => record.status === "ok"), [...beforeResult.items, ...taskItems], receivedAt);
    const resultItems = [...toolItems, ...taskItems, ...productionTaskItems];
    const outcomeFailure: ProjectAgentFailureItem | undefined = capabilityOutcome
      ? Object.freeze({
          itemId: `failure-${digest([execution.turn.executionToken, capabilityOutcome.toolCallId, capabilityOutcome.code])}`,
          threadId: execution.turn.threadId,
          turnId: execution.turn.turnId,
          correlationId: capabilityOutcome.toolCallId,
          kind: "failure" as const,
          code: capabilityOutcome.code,
          message: capabilityOutcome.message,
          nextAction: capabilityOutcome.nextAction,
          status: capabilityOutcome.status,
          retryable: capabilityOutcome.retryable,
          deviated: false,
          createdAt: receivedAt,
          updatedAt: receivedAt,
        })
      : undefined;
    const currentStatus = beforeResult.turns.find((turn) => turn.turnId === execution.turn.turnId)?.status;
    if (!currentStatus || ["queued", "running", "proposed"].includes(currentStatus)) {
      await dispatchFresh(partition, (state) => ({
        commandId: `async-result-${execution.turn.executionToken}`,
        expectedRevision: state.hostRevision,
        binding: partition.binding,
        sender: { kind: "embedded-agent", senderId: execution.turn.executionToken },
        type: "async.result",
        payload: {
          asyncToken: execution.turn.executionToken,
          binding: partition.binding,
          threadId: execution.turn.threadId,
          turnId: execution.turn.turnId,
          queueItemId: execution.queueItem.queueItemId,
          target: execution.queueItem.target,
          preconditions: execution.queueItem.preconditions,
          expectedRevision: state.hostRevision,
          items: outcomeFailure ? [...resultItems, outcomeFailure] : resultItems,
          turnStatus: status,
          ...(capabilityOutcome ? { retryable: capabilityOutcome.retryable } : {}),
          ...(proposalSettlements.length > 0
            ? { proposalSettlements }
            : {}),
          ...(assistant && assistant.kind === "assistant"
            ? {
                assistantFinal: {
                  itemId: assistant.itemId,
                  executionToken: execution.turn.executionToken,
                  expectedTextRevision: assistant.textRevision,
                  text: response.text,
                },
              }
            : {}),
          receivedAt,
        },
      }));
    }
    const committed = partition.host.getSnapshot(partition.binding);
    const committedStatus = committed.turns.find((turn) => turn.turnId === execution.turn.turnId)?.status;
    if (!committedStatus || ["queued", "running", "proposed"].includes(committedStatus)) {
      throw new Error("Project Agent execution result has no committed terminal turn");
    }
    publish(partition, {
      type: "execution-result",
      binding: partition.binding,
      turnId: execution.turn.turnId,
      executionToken: execution.turn.executionToken,
      response,
    });
  } catch (error) {
    if (!execution.controller.signal.aborted) {
      const message = error instanceof Error && error.message ? error.message : String(error) || "Agent execution failed";
      // A runtime failure is a canonical transcript fact. Commit both the
      // terminal assistant and a Failure Item before notifying views.
      let terminalError: unknown;
      try {
        await execution.publicationTail;
        const beforeFailure = partition.host.getSnapshot(partition.binding);
        const currentStatus = beforeFailure.turns.find((turn) => turn.turnId === execution.turn.turnId)?.status;
        const assistant = beforeFailure.items.find(
          (item) => item.kind === "assistant" && item.turnId === execution.turn.turnId,
        );
        if (currentStatus === "running" && assistant?.kind === "assistant") {
          const failedAt = now();
          const proposalSettlements = proposalSettlementsFor(execution, "failed");
          await dispatchFresh(partition, (state) => ({
            commandId: `execution-failed-${execution.turn.executionToken}`,
            expectedRevision: state.hostRevision,
            binding: partition.binding,
            sender: { kind: "embedded-agent", senderId: execution.turn.executionToken },
            type: "async.result",
            payload: {
              asyncToken: execution.turn.executionToken,
              binding: partition.binding,
              threadId: execution.turn.threadId,
              turnId: execution.turn.turnId,
              queueItemId: execution.queueItem.queueItemId,
              target: execution.queueItem.target,
              preconditions: execution.queueItem.preconditions,
              expectedRevision: state.hostRevision,
              items: [Object.freeze({
                itemId: `failure-${digest([execution.turn.executionToken, "runtime-failure"])}`,
                threadId: execution.turn.threadId,
                turnId: execution.turn.turnId,
                kind: "failure" as const,
                code: "runtime_error",
                message,
                status: "failed" as const,
                retryable: true,
                deviated: false,
                createdAt: failedAt,
                updatedAt: failedAt,
              })],
              turnStatus: "failed" as const,
              ...(proposalSettlements.length > 0
                ? { proposalSettlements }
                : {}),
              assistantFinal: {
                itemId: assistant.itemId,
                executionToken: execution.turn.executionToken,
                expectedTextRevision: assistant.textRevision,
                text: assistant.text,
              },
              receivedAt: failedAt,
            },
          }));
        }
      } catch (failureCommitError) {
        terminalError = failureCommitError;
      }
      const committed = partition.host.getSnapshot(partition.binding);
      const committedStatus = committed.turns.find(
        (turn) => turn.turnId === execution.turn.turnId,
      )?.status;
      if (committedStatus === "failed") {
        publish(partition, {
          type: "execution-error",
          binding: partition.binding,
          turnId: execution.turn.turnId,
          executionToken: execution.turn.executionToken,
          message,
        });
      } else {
        reportInternalError(terminalError ?? error, {
          phase: "terminalize-runtime-failure",
          turnId: execution.turn.turnId,
          message,
        });
      }
    }
    try {
      await execution.publicationTail;
    } catch {
      /* terminal publication is best effort after cancellation */
    }
  } finally {
    cleanupExecution(partition, execution, false);
  }
  return "continue";
}
