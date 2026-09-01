import { createHash } from "node:crypto";
import type { RuntimeToolCall, RuntimeToolDecision } from "../harness/runtime/runtimePort";
import {
  productionRunToolDescriptors,
  productionRunReadToolNames,
  productionRunWriteToolNames,
  productionArtifactWriteToolNames,
} from "../harness/tools/productionRunDescriptors";
import type { ProjectBinding } from "../shared/projectBinding";
import type { PreconditionSet, TargetRef } from "../shared/capabilityTargeting";
import type { ProductionRunService } from "../productionRun/productionRunService";
import { isAnchorCheckpointGate } from "../productionRun/anchorCheckpoint";
import type { ArtifactReviewDecision } from "../productionRun/productionRunReducer";

const PUBLIC_FAILURE_CODES = new Set([
  "capability_input_invalid",
  "capability_cancelled",
  "capability_execution_failed",
  "capability_target_stale",
  "production_gate_requires_nomi",
  "production_run_not_found",
]);

function safeFailure(error: unknown): Extract<RuntimeToolDecision, { ok: false }> {
  const rawCode = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code = rawCode && PUBLIC_FAILURE_CODES.has(rawCode)
    ? rawCode
    : /not found/i.test(message) ? "production_run_not_found" : "capability_execution_failed";
  return { ok: false, code, message: message || code };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseTool(name: string, args: unknown): Record<string, unknown> | null {
  const descriptor = productionRunToolDescriptors[name as keyof typeof productionRunToolDescriptors];
  if (!descriptor) return null;
  const parsed = descriptor.parameters.safeParse(args);
  if (!parsed.success) throw Object.assign(new Error("capability_input_invalid"), { code: "capability_input_invalid" });
  return parsed.data as Record<string, unknown>;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = typeof args[key] === "string" ? args[key].trim() : "";
  if (!value) throw Object.assign(new Error("capability_input_invalid"), { code: "capability_input_invalid" });
  return value;
}

type ProductionService = Pick<ProductionRunService,
  "createDraft" | "readProjection" | "readFull" | "readEvents" | "readArtifactProjection" | "readArtifactContent"
  | "command" | "requestArtifactRevision" | "reviewArtifact" | "materializeStoryboard"
>;

type PreparedProductionInvocation = Readonly<{
  target: Extract<TargetRef, { kind: "production" }>;
  preconditions: PreconditionSet;
  policyRevision: number;
  inputHash: string;
  actionHash: string;
}>;

export type PreparedProductionRunWrite = Readonly<{
  call: RuntimeToolCall;
  args: Record<string, unknown>;
  invocation: PreparedProductionInvocation;
}>;

export type PiProductionRunTransportAdapter = Readonly<{
  tryExecute(call: RuntimeToolCall, signal: AbortSignal): Promise<RuntimeToolDecision | null>;
  prepare(call: RuntimeToolCall, signal: AbortSignal): Promise<PreparedProductionRunWrite | null>;
  execute(
    prepared: PreparedProductionRunWrite,
    approval: Readonly<{ receiptProposalId: string; approvalId: string; actionHash: string }>,
    signal: AbortSignal,
  ): Promise<RuntimeToolDecision>;
  dispose(): void;
}>;

export function createPiProductionRunTransportAdapter(input: Readonly<{
  service: ProductionService;
  binding: ProjectBinding;
}>): PiProductionRunTransportAdapter {
  let disposed = false;
  const assertProject = (args: Record<string, unknown>): void => {
    if (args.projectId !== undefined && args.projectId !== input.binding.projectId) {
      throw Object.assign(new Error("production project mismatch"), { code: "capability_target_stale" });
    }
  };
  const readRun = (args: Record<string, unknown>) => input.service.readFull(input.binding.projectId, requiredString(args, "runId"));

  return Object.freeze({
    async tryExecute(call, signal) {
      if (![...productionRunReadToolNames, ...productionRunWriteToolNames].includes(call.toolName)) return null;
      if (disposed) return { ok: false, code: "capability_execution_failed", message: "production surface unavailable" };
      if (signal.aborted) return { ok: false, code: "capability_cancelled", message: "capability_cancelled" };
      try {
        const args = parseTool(call.toolName, call.args);
        if (!args) return null;
        assertProject(args);
        if (call.toolName === "start_production_run") {
          const goal = requiredString(args, "goal");
          const projection = input.service.createDraft({
            projectId: input.binding.projectId,
            playbook: {
              name: typeof args.playbook === "string" && args.playbook.trim() ? args.playbook.trim() : "brand.promo",
              version: typeof args.playbookVersion === "string" && args.playbookVersion.trim() ? args.playbookVersion.trim() : "1.0.0",
            },
            origin: { host: "embedded-agent" },
            brief: {
              goal,
              ...(typeof args.audience === "string" ? { audience: args.audience } : {}),
              ...(typeof args.channel === "string" ? { channel: args.channel } : {}),
              ...(typeof args.tone === "string" ? { tone: args.tone } : {}),
              ...(typeof args.durationSeconds === "number" ? { durationSeconds: args.durationSeconds } : {}),
              ...(Array.isArray(args.sellingPoints) ? { sellingPoints: args.sellingPoints as string[] } : {}),
            },
          });
          return { ok: true, result: projection, silent: true };
        }
        const runId = requiredString(args, "runId");
        if (call.toolName === "get_production_run") {
          return { ok: true, result: input.service.readProjection(input.binding.projectId, runId), silent: true };
        }
        if (call.toolName === "subscribe_production_run") {
          const events = await input.service.readEvents(
            input.binding.projectId,
            runId,
            typeof args.afterCursor === "number" ? args.afterCursor : 0,
            typeof args.waitMs === "number" ? args.waitMs : 0,
          );
          return { ok: true, result: events, silent: true };
        }
        const artifactId = requiredString(args, "artifactId");
        if (call.toolName === "read_production_artifact") {
          return { ok: true, result: input.service.readArtifactProjection(input.binding.projectId, runId, artifactId), silent: true };
        }
        if (call.toolName === "read_production_artifact_content") {
          return { ok: true, result: input.service.readArtifactContent(input.binding.projectId, runId, artifactId), silent: true };
        }
        return null;
      } catch (error) {
        return safeFailure(error);
      }
    },
    async prepare(call, signal) {
      if (!productionRunWriteToolNames.has(call.toolName) && !productionArtifactWriteToolNames.has(call.toolName)) return null;
      if (disposed) throw Object.assign(new Error("production surface unavailable"), { code: "capability_execution_failed" });
      if (signal.aborted) throw Object.assign(new Error("capability_cancelled"), { code: "capability_cancelled" });
      const args = parseTool(call.toolName, call.args);
      if (!args || call.toolName === "start_production_run") return null;
      assertProject(args);
      const runId = requiredString(args, "runId");
      const run = input.service.readFull(input.binding.projectId, runId);
      const invocation: PreparedProductionInvocation = {
        target: {
          kind: "production",
          runId,
          ...(typeof args.gateId === "string" ? { gateId: args.gateId } : {}),
        },
        preconditions: { run: { runId, revision: run.revision } },
        policyRevision: run.revision,
        inputHash: digest({ toolName: call.toolName, args }),
        actionHash: digest({ toolName: call.toolName, args, runId, revision: run.revision }),
      };
      return Object.freeze({ call, args, invocation });
    },
    async execute(prepared, approval, signal) {
      if (disposed) return { ok: false, code: "capability_execution_failed", message: "production surface unavailable" };
      if (signal.aborted) return { ok: false, code: "capability_cancelled", message: "capability_cancelled" };
      try {
        const { call, args } = prepared;
        const runId = requiredString(args, "runId");
        if (call.toolName === "control_production_run") {
          const action = requiredString(args, "action");
          await input.service.command(input.binding.projectId, runId, {
            commandId: `agent:${approval.approvalId}:control`,
            expectedRevision: prepared.invocation.preconditions.run!.revision,
            type: "run.control",
            payload: { action, ...(typeof args.trustLevel === "string" ? { trustLevel: args.trustLevel } : {}) },
            issuedAt: new Date().toISOString(),
          });
        } else if (call.toolName === "decide_production_gate") {
          const run = readRun(args);
          const gateId = requiredString(args, "gateId");
          const gate = run.gates.find((item) => item.gateId === gateId);
          if (!gate) throw new Error("Production gate not found");
          const creativeGate = gate.scope === "stage"
            && (gate.gateId.startsWith("gate-direction-") || gate.gateId.startsWith("gate-sample-") || gate.gateId.startsWith("gate-freeze-"));
          if (!creativeGate && !isAnchorCheckpointGate(gate)) {
            throw Object.assign(new Error("This production gate must be decided in Nomi"), { code: "production_gate_requires_nomi" });
          }
          await input.service.command(input.binding.projectId, runId, {
            commandId: `agent:${approval.approvalId}:gate`,
            expectedRevision: run.revision,
            type: "gate.decide",
            payload: {
              gateId,
              status: requiredString(args, "decision"),
              ...(typeof args.choiceKey === "string" ? { choiceKey: args.choiceKey } : {}),
            },
            issuedAt: new Date().toISOString(),
          });
        } else if (call.toolName === "revise_production_artifact") {
          const result = await input.service.requestArtifactRevision({
            projectId: input.binding.projectId, runId, artifactId: requiredString(args, "artifactId"),
            expectedVersion: args.expectedVersion as number,
            instruction: requiredString(args, "instruction"), kind: args.kind as "script" | "storyboard",
          });
          return { ok: true, result, silent: true, proposalId: approval.receiptProposalId };
        } else if (call.toolName === "review_production_artifact") {
          const result = await input.service.reviewArtifact({
            projectId: input.binding.projectId, runId, artifactId: requiredString(args, "artifactId"),
            expectedVersion: args.expectedVersion as number,
            decision: args.decision as ArtifactReviewDecision,
          });
          return { ok: true, result, silent: true, proposalId: approval.receiptProposalId };
        } else if (call.toolName === "materialize_production_storyboard") {
          const result = await input.service.materializeStoryboard({
            projectId: input.binding.projectId, runId, artifactId: requiredString(args, "artifactId"),
            expectedVersion: args.expectedVersion as number,
          });
          return { ok: true, result, silent: true, proposalId: approval.receiptProposalId };
        } else {
          const result = input.service.readProjection(input.binding.projectId, runId);
          return { ok: true, result, silent: true, proposalId: approval.receiptProposalId };
        }
        return { ok: true, result: input.service.readProjection(input.binding.projectId, runId), silent: true, proposalId: approval.receiptProposalId };
      } catch (error) {
        return safeFailure(error);
      }
    },
    dispose() { disposed = true; },
  });
}
