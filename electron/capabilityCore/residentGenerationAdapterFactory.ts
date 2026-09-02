import { signMcpClient } from "./security";
import { createMcpConnectionContext, type McpConnectionContext } from "./mcpConnectionContext";
import type { ProjectSessionAuthority } from "./projectSessionAuthority";
import type { ApprovalReceiptAuthority } from "./approvalReceipt";
import type { DispatchContext } from "./dispatcher";
import type { ProjectLeaseV2 } from "./projectLease";
import {
  createPiGenerationTransportAdapter,
  type PiGenerationTransportAdapter,
} from "./generationTransportAdapters";
import type { ProjectBinding } from "../shared/projectBinding";
import type { ProductionRunService } from "../productionRun/productionRunService";

type RunOwner = Pick<ProductionRunService, "readFull" | "command">;

export type ResidentGenerationAdapterFactoryInput = Readonly<{
  planning: NonNullable<DispatchContext["generationPlanning"]>;
  requestGenerationGate?: DispatchContext["requestGenerationGate"];
  authorizeGeneration?: DispatchContext["authorizeGeneration"];
  confirmGenerationInNomi?: (input: { challengeToken: string }) => Promise<unknown>;
  approvalReceiptAuthority: ApprovalReceiptAuthority;
  projectSessionAuthority?: ProjectSessionAuthority;
  owner: RunOwner;
}>;

export type ResidentGenerationAdapterFactory = Readonly<{
  factory: (binding: ProjectBinding) => PiGenerationTransportAdapter;
  dispose: () => void;
}>;

/** Install the factory and return a disposer for app shutdown/restart. */
export function installResidentGenerationAdapter(
  input: ResidentGenerationAdapterFactoryInput,
  onReady?: (factory: ResidentGenerationAdapterFactory["factory"]) => void,
): () => void {
  const adapter = createResidentGenerationAdapterFactory(input);
  onReady?.(adapter.factory);
  return adapter.dispose;
}

/**
 * Build the one main-process transport used by the resident Host.  It reuses
 * the same session authority, run owner, receipt authority and semantic
 * planner as MCP; no renderer project scalar or second operation store is
 * introduced here.
 */
export function createResidentGenerationAdapterFactory(
  input: ResidentGenerationAdapterFactoryInput,
): ResidentGenerationAdapterFactory {
  const connections = new Map<string, McpConnectionContext>();
  const leases = new Map<string, ProjectLeaseV2>();
  let disposed = false;
  const sessionAuthority = input.projectSessionAuthority;

  const leaseFor = async (binding: ProjectBinding): Promise<ProjectLeaseV2> => {
    if (disposed) throw Object.assign(new Error("generation_session_unavailable"), { code: "generation_session_unavailable" });
    const key = `${binding.projectId}:${binding.immutableProjectUuid}:${binding.projectGeneration}`;
    const cached = leases.get(key);
    if (cached && Date.parse(cached.expiresAt) - Date.now() > 30_000) return cached;
    if (!sessionAuthority) throw Object.assign(new Error("generation_session_unavailable"), { code: "generation_session_unavailable" });
    let connection = connections.get(key);
    if (!connection) {
      const proof = signMcpClient("codex");
      if (!proof) throw Object.assign(new Error("generation_session_unavailable"), { code: "generation_session_unavailable" });
      connection = createMcpConnectionContext({ client: "codex", proof });
      connections.set(key, connection);
    }
    const opened = await sessionAuthority.open({ bootstrap: { mode: "current_project" } }, connection);
    const lease = await sessionAuthority.verifyLease(opened.leaseHandle, {
      connection,
      projectHint: binding.projectId,
    });
    if (lease.immutableProjectUuid !== binding.immutableProjectUuid || lease.projectGeneration !== binding.projectGeneration) {
      throw Object.assign(new Error("project_binding_stale"), { code: "project_binding_stale" });
    }
    leases.set(key, lease);
    return lease;
  };

  const reject = async ({ params, lease }: { params: Record<string, unknown>; lease: ProjectLeaseV2 }): Promise<void> => {
    const operationId = typeof params.operationId === "string" ? params.operationId.trim() : "";
    if (!operationId) return;
    const current = input.owner.readFull(lease.projectId, operationId);
    const gateId = current.generationPlan?.authorizationGateId;
    const gate = gateId ? current.gates.find((candidate) => candidate.gateId === gateId) : undefined;
    if (!gate || gate.status !== "waiting") return;
    await input.owner.command(lease.projectId, operationId, {
      commandId: `generation.gate.reject:${gate.gateId}`,
      expectedRevision: current.revision,
      type: "gate.decide",
      payload: { gateId: gate.gateId, status: "rejected", authorizationDigest: current.generationPlan?.authorizationDigest },
      issuedAt: new Date().toISOString(),
    });
  };

  const factory = (binding: ProjectBinding): PiGenerationTransportAdapter => createPiGenerationTransportAdapter(binding, {
    planning: input.planning,
    requestGenerationGate: input.requestGenerationGate,
    authorizeGeneration: input.authorizeGeneration,
    rejectGeneration: reject,
    confirmGenerationInNomi: input.confirmGenerationInNomi,
    approvalReceiptAuthority: input.approvalReceiptAuthority,
    leaseFor,
  });

  return {
    factory,
    dispose() {
      disposed = true;
      connections.clear();
      leases.clear();
    },
  };
}
