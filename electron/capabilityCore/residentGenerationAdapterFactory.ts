import { signMcpClient } from "./security";
import { createMcpConnectionContext, type McpConnectionContext } from "./mcpConnectionContext";
import type { ProjectSessionAuthority } from "./projectSessionAuthority";
import type { ApprovalReceiptAuthority } from "./approvalReceipt";
import type { DispatchContext } from "./dispatcher";
import type { ProjectLeaseV2 } from "./projectLease";
import {
  createPiGenerationTransportAdapter,
  type GenerationTransportAdapterDependencies,
  type PiGenerationTransportAdapter,
} from "./generationTransportAdapters";
import type { ProjectBinding } from "../shared/projectBinding";
import type { ProjectAgentApprovalPolicy } from "../shared/agentCapabilities/capabilityApprovalPolicy";
import { readAgentApprovalPolicy } from "../settings/agentApprovalPolicySettings";
import type { ProductionRunService } from "../productionRun/productionRunService";
import { waitingAuthorizationGates } from "../shared/productionSpendAuthority";
import { withHandedOverAttempts } from "../shared/agentCapabilities/directGenerationBrakes";
import { assertIssuedGenerationPlanning } from "./generationPlanningIssue";

type RunOwner = Pick<ProductionRunService, "readFull" | "command">;

export type ResidentGenerationAdapterFactoryInput = Readonly<{
  planning: NonNullable<DispatchContext["generationPlanning"]>;
  requestGenerationGate?: DispatchContext["requestGenerationGate"];
  authorizeGeneration?: DispatchContext["authorizeGeneration"];
  confirmGenerationInNomi?: (input: { challengeToken: string }) => Promise<unknown>;
  approvalReceiptAuthority: ApprovalReceiptAuthority;
  projectSessionAuthority?: ProjectSessionAuthority;
  owner: RunOwner;
  /** 草稿落地之后「此刻在画布上吗」（见 `GenerationTransportAdapterDependencies.draftLanding`）。 */
  draftLanding?: GenerationTransportAdapterDependencies["draftLanding"];
  /** 「直接生成」档把几镜交给画布（见 `GenerationTransportAdapterDependencies.handOverToCanvas`）。 */
  handOverToCanvas?: GenerationTransportAdapterDependencies["handOverToCanvas"];
}>;

export type ResidentGenerationAdapterFactory = Readonly<{
  /**
   * `approvalPolicy` 是宿主持有的档位快照（lane 传 `() => composer.approvalPolicy`，它和主进程
   * 那份权威值是同一个东西——lane 每次切档都写回去）。**缺席不再等于「按默认档」**：这时直接读
   * 主进程持有的那份权威值。调用方永远没有办法「自报」一个更松的档位。
   */
  factory: (binding: ProjectBinding, approvalPolicy?: () => ProjectAgentApprovalPolicy | undefined) => PiGenerationTransportAdapter;
  dispose: () => void;
}>;

/**
 * 常驻传输读写 Run 的那三件：拒掉外部宿主那道在等的门、把出价标成「要人决定」、读刹车要看的事实（带上交给画布的那几镜
 * 在画布单镜 Run 里的尝试，读不到的画布 Run 跳过）。工厂与端到端夹具共用这一份，夹具测的就是生产这一份接线。
 */
export function residentRunFacts(owner: RunOwner): Required<Pick<GenerationTransportAdapterDependencies, "rejectGeneration" | "markPolicyDecisionFailed" | "readRun">> {
  return {
    async rejectGeneration({ params, lease }) {
      const operationId = typeof params.operationId === "string" ? params.operationId.trim() : "";
      if (!operationId) return;
      // 这一次在等决定的授权（外部宿主那一整份，住在它自己那道门上）。没有在等的 = 已经决过了，no-op。
      let current = owner.readFull(lease.projectId, operationId);
      for (const gate of waitingAuthorizationGates(current)) {
        current = (await owner.command(lease.projectId, operationId, {
          commandId: `generation.gate.reject:${gate.gateId}`,
          expectedRevision: current.revision,
          type: "gate.decide",
          payload: { gateId: gate.gateId, status: "rejected", authorizationDigest: gate.authorizationDigest },
          issuedAt: new Date().toISOString(),
        })).run;
      }
    },
    async markPolicyDecisionFailed({ params, lease }) {
      const operationId = typeof params.operationId === "string" ? params.operationId.trim() : "";
      if (!operationId) return;
      const current = owner.readFull(lease.projectId, operationId);
      await owner.command(lease.projectId, operationId, {
        commandId: `generation.policy_decision_failed:${operationId}:${current.revision}`,
        expectedRevision: current.revision,
        type: "generation.policy_decision_failed",
        payload: {},
        issuedAt: new Date().toISOString(),
      });
    },
    readRun: (projectId, operationId) => withHandedOverAttempts(owner.readFull(projectId, operationId), (canvasRunId) => {
      try { return owner.readFull(projectId, canvasRunId); } catch { return null; }
    }),
  };
}

/**
 * Install the factory and return a disposer for app shutdown/restart.
 * 「装好了」这件事由调用方记进 `residentSurfaceLifecycle`（唯一 owner），这里不再带回调——
 * 回调是第二条把工厂交出去的路，而第二条路就是第二份「装没装」的真相。
 */
export function installResidentGenerationAdapter(input: ResidentGenerationAdapterFactoryInput): ResidentGenerationAdapterFactory {
  return createResidentGenerationAdapterFactory(input);
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
  // 常驻生成面只认生成装配工厂发的规划。
  assertIssuedGenerationPlanning(input.planning, "resident generation adapter");
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

  const factory = (
    binding: ProjectBinding,
    approvalPolicy?: () => ProjectAgentApprovalPolicy | undefined,
  ): PiGenerationTransportAdapter => createPiGenerationTransportAdapter(binding, {
    planning: input.planning,
    requestGenerationGate: input.requestGenerationGate,
    authorizeGeneration: input.authorizeGeneration,
    ...residentRunFacts(input.owner),
    confirmGenerationInNomi: input.confirmGenerationInNomi,
    approvalReceiptAuthority: input.approvalReceiptAuthority,
    leaseFor,
    ...(input.draftLanding ? { draftLanding: input.draftLanding } : {}),
    ...(input.handOverToCanvas ? { handOverToCanvas: input.handOverToCanvas } : {}),
    // 宿主没给档位时**不再按默认档走**：档位是用户设置，主进程自己就持有那份权威值。
    // 此前这里缺席 = 照旧弹卡，于是用户选了「全自动」而非 lane 的宿主（外部 MCP 等）仍然每步问人。
    approvalPolicy: approvalPolicy ?? readAgentApprovalPolicy,
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
