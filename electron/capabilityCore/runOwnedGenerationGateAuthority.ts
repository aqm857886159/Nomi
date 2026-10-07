import type { ProductionRunService } from "../productionRun/productionRunService";
import type { ProductionGenerationAuthorizationEnvelopeV1 } from "../productionRun/productionGenerationAuthorization";
import type {
  GenerationAuthorizationProjectIdentity,
  PreparedProductionGenerationAuthorization,
} from "../productionRun/prepareProductionGenerationAuthorization";
import type { ProductionRun, RunCommand } from "../productionRun/productionRunTypes";
import { spendAuthorizationGates, waitingAuthorizationGates } from "../shared/productionSpendAuthority";
import type {
  ApprovalReceiptAuthority,
  HumanApprovalDisplay,
  HumanApprovalReceiptV1,
} from "./approvalReceipt";
import type { DispatchContext } from "./dispatcher";
import type { GenerationOperationStore } from "./mcpGenerationTools";
import type { ProjectLeaseV2 } from "./projectLease";

type RunOwner = Pick<ProductionRunService, "readFull" | "command">;

type GateConfirmation = (input: { challengeToken: string }) => Promise<unknown>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function operationIdFrom(params: Record<string, unknown>): string {
  const operationId = typeof params.operationId === "string" ? params.operationId.trim() : "";
  if (!operationId) throw new Error("Generation operation id is required");
  return operationId;
}

export function createRunOwnedGenerationGateAuthority(input: Readonly<{
  owner: RunOwner;
  operations: GenerationOperationStore;
  planning: NonNullable<DispatchContext["generationPlanning"]>;
  receipts: ApprovalReceiptAuthority;
  now?: () => string;
}>) {
  const now = input.now ?? (() => new Date().toISOString());

  const requestGenerationGate: NonNullable<DispatchContext["requestGenerationGate"]> = async ({ params, lease }) => {
    const planned = record(await input.planning({
      capability: "gate_request",
      params,
      lease,
      origin: { host: "nomi" },
    }), "generation gate plan");
    const operationId = operationIdFrom(params);
    const run = input.owner.readFull(lease.projectId, operationId);
    const plan = run.generationPlan;
    // 这一次 gate_request 刚封的那一份（按它回的摘要找那道门）——每点一次一份，信封住在门上。
    const sealedDigest = typeof planned.contractHash === "string" ? planned.contractHash : undefined;
    const gate = sealedDigest ? waitingAuthorizationGates(run).find((candidate) => candidate.authorizationDigest === sealedDigest) : undefined;
    const envelope = gate?.authorizationEnvelope;
    const digest = gate?.authorizationDigest;
    if (
      !plan
      || !envelope
      || !digest
      || !gate
      || gate.planHash !== digest
      || envelope.immutableProjectUuid !== lease.immutableProjectUuid
      || envelope.projectGeneration !== lease.projectGeneration
      || envelope.projectId !== lease.projectId
      || envelope.runId !== operationId
      || envelope.gateId !== gate.gateId
    ) {
      throw new Error("Generation gate does not match the sealed Run authorization");
    }
    // 这里不再核项目此刻的版本（付费卡① 第 14 条）：批的是这份信封里冻住的事实（门、合同哈希、线上报文哈希），
    // 收据也逐字绑它们和信封封好时的版本。卡开着时 Nomi 往画布上落别的镜，项目版本照常前进，不让这一下点击失败。
    const currentMs = Date.parse(now());
    const expiryMs = Date.parse(envelope.expiresAt);
    if (!Number.isFinite(currentMs) || !Number.isFinite(expiryMs) || expiryMs <= currentMs) {
      throw new Error("Generation authorization has expired");
    }
    const model = typeof planned.model === "string" ? planned.model : "当前模型";
    const challenge = input.receipts.requestChallenge({
      challengeKey: `${envelope.costScope}:${operationId}:${digest}`,
      immutableProjectUuid: envelope.immutableProjectUuid,
      projectGeneration: envelope.projectGeneration,
      projectId: envelope.projectId,
      runId: envelope.runId,
      gateId: envelope.gateId,
      contractHash: digest,
      targetHash: digest,
      projectRevision: envelope.projectRevision,
      revocationEpoch: lease.revocationEpoch,
      costScope: envelope.costScope,
      pricingSnapshotHash: digest,
      reservationPreview: structuredClone(envelope.budget),
      ttlMs: expiryMs - currentMs,
      display: {
        model,
        shotSummary: typeof planned.shotSummary === "string" ? planned.shotSummary : undefined,
        referenceCount: typeof planned.referenceCount === "number" ? planned.referenceCount : undefined,
        ...(planned.shots && typeof planned.shots === "object" && !Array.isArray(planned.shots)
          ? { shots: planned.shots as never }
          : {}),
      },
    });
    return {
      ...planned,
      contractHash: digest,
      gateId: envelope.gateId,
      costScope: envelope.costScope,
      // 一批**全是**未知价：没有已知金额可报，如实回 null（绝不是 ¥0）。
      maximumCost: envelope.budget.unknownJobCount === envelope.jobs.length ? null : envelope.budget.maximum,
      ...(envelope.budget.unknownJobCount > 0 ? { unknownShotCount: envelope.budget.unknownJobCount } : {}),
      currency: envelope.budget.currency,
      challengeId: challenge.challenge.challengeId,
      nonce: challenge.challenge.nonce,
      expiresAt: challenge.challenge.expiresAt,
      handoff: {
        challengeToken: challenge.token,
        clientAttestation: true,
        contractHash: digest,
        operationId,
      },
    };
  };

  const authorizeGeneration: NonNullable<DispatchContext["authorizeGeneration"]> = async ({ params, lease, receipt }) => {
    const operationId = operationIdFrom(params);
    const run = input.owner.readFull(lease.projectId, operationId);
    // 收据上写着它批的是哪一道门：决的就是那一道（它自己那一份信封），不是计划上某一份。
    const gate = spendAuthorizationGates(run).find((candidate) => candidate.gateId === receipt.gateId);
    const envelope = gate?.authorizationEnvelope;
    const digest = gate?.authorizationDigest;
    assertReceiptMatchesAuthorization(receipt, lease, operationId, envelope, digest, gate?.gateId);
    if (!gate || gate.status !== "waiting" || gate.authorizationDigest !== digest || gate.planHash !== digest) {
      throw new Error("Generation authorization gate is not waiting for this receipt");
    }
    await input.owner.command(lease.projectId, operationId, {
      commandId: `generation.gate.decide:${gate.gateId}:${receipt.receiptId}`,
      expectedRevision: run.revision,
      type: "gate.decide",
      payload: {
        gateId: gate.gateId,
        status: "approved",
        receiptId: receipt.receiptId,
        authorizationDigest: digest,
        projectRevision: envelope!.projectRevision,
      },
      issuedAt: now(),
    });
    const operation = await input.operations.read(lease.projectId, operationId);
    return { operation, operationId, state: operation?.state, nextAction: "start" };
  };

  return { requestGenerationGate, authorizeGeneration };
}

export async function decideRunOwnedGenerationGate(input: Readonly<{
  owner: RunOwner;
  receipts: ApprovalReceiptAuthority;
  confirm: GateConfirmation;
  lease: GenerationAuthorizationProjectIdentity;
  operationId: string;
  authorization: PreparedProductionGenerationAuthorization;
  display: HumanApprovalDisplay;
  commandPrefix: string;
  now?: () => string;
}>): Promise<{ approved: boolean; run: ProductionRun }> {
  const now = input.now ?? (() => new Date().toISOString());
  const { envelope } = input.authorization;
  const digest = input.authorization.authorizationDigest;
  const challenge = input.receipts.requestChallenge(gateChallengeInput(input.authorization, input.lease, input.display));
  const confirmation = await input.confirm({ challengeToken: challenge.token }) as {
    confirmed?: unknown;
    receiptToken?: unknown;
  } | null;
  const receiptToken = confirmation?.confirmed === true && typeof confirmation.receiptToken === "string"
    ? confirmation.receiptToken.trim()
    : "";
  if (!receiptToken) {
    const rejecting = input.owner.readFull(input.lease.projectId, input.operationId);
    const decision = await input.owner.command(input.lease.projectId, input.operationId, {
      commandId: `${input.commandPrefix}-reject:${envelope.gateId}`,
      expectedRevision: rejecting.revision,
      type: "gate.decide",
      payload: { gateId: envelope.gateId, status: "rejected", authorizationDigest: digest },
      issuedAt: now(),
    });
    return { approved: false, run: decision.run };
  }
  const receipt = input.receipts.verifyReceipt(receiptToken);
  // 批的是信封里冻住的事实，不是项目此刻的版本（付费卡① 第 14 条）：确认框开着时别的镜照常落画布。
  assertReceiptMatchesAuthorization(receipt, input.lease, input.operationId, envelope, digest, envelope.gateId);
  const approving = input.owner.readFull(input.lease.projectId, input.operationId);
  const decision = await input.owner.command(input.lease.projectId, input.operationId, {
    commandId: `${input.commandPrefix}-decide:${envelope.gateId}:${receipt.receiptId}`,
    expectedRevision: approving.revision,
    type: "gate.decide",
    payload: {
      gateId: envelope.gateId,
      status: "approved",
      receiptId: receipt.receiptId,
      authorizationDigest: digest,
      projectRevision: envelope.projectRevision,
    },
    issuedAt: now(),
  });
  input.receipts.consumeReceipt(receiptToken);
  return { approved: true, run: decision.run };
}

/** 批这一份信封要的那张挑战：收据逐字绑信封里冻住的事实（门、摘要、项目身份、额度预览）。 */
function gateChallengeInput(
  authorization: PreparedProductionGenerationAuthorization,
  lease: GenerationAuthorizationProjectIdentity,
  display: HumanApprovalDisplay,
) {
  const { envelope } = authorization;
  const digest = authorization.authorizationDigest;
  return {
    challengeKey: `${envelope.costScope}:${digest}`,
    immutableProjectUuid: envelope.immutableProjectUuid,
    projectGeneration: envelope.projectGeneration,
    projectId: envelope.projectId,
    runId: envelope.runId,
    gateId: envelope.gateId,
    contractHash: digest,
    targetHash: digest,
    projectRevision: envelope.projectRevision,
    revocationEpoch: lease.revocationEpoch,
    costScope: envelope.costScope,
    pricingSnapshotHash: digest,
    reservationPreview: { ...envelope.budget },
    display,
  };
}

/**
 * 主进程这一次受信调用本身就是手势（画布 ↑、批量卡确认之后的派发）：一次写完收据（`issueGestureReceipt`），回一条
 * 「这道门批了」的命令，由调用方和封印放进**同一次落盘**（`repository.executeBatch`）。收据仍逐字核对信封，
 * 和要人在卡上点的那条路（`decideRunOwnedGenerationGate`）批的是同一份东西。
 */
export function gestureGateApproval(input: Readonly<{
  receipts: ApprovalReceiptAuthority;
  lease: GenerationAuthorizationProjectIdentity;
  operationId: string;
  authorization: PreparedProductionGenerationAuthorization;
  gesture: { webContentsId: number; frameId: number; origin: string };
  display: HumanApprovalDisplay;
  commandPrefix: string;
  issuedAt: string;
}>): Omit<RunCommand, "expectedRevision"> {
  const { envelope } = input.authorization;
  const digest = input.authorization.authorizationDigest;
  const receipt = input.receipts.issueGestureReceipt(gateChallengeInput(input.authorization, input.lease, input.display), input.gesture);
  assertReceiptMatchesAuthorization(receipt, input.lease, input.operationId, envelope, digest, envelope.gateId);
  return {
    commandId: `${input.commandPrefix}-decide:${envelope.gateId}:${receipt.receiptId}`,
    type: "gate.decide",
    payload: {
      gateId: envelope.gateId,
      status: "approved",
      receiptId: receipt.receiptId,
      authorizationDigest: digest,
      projectRevision: envelope.projectRevision,
    },
    issuedAt: input.issuedAt,
  };
}

export function assertReceiptMatchesAuthorization(
  receipt: HumanApprovalReceiptV1,
  lease: Pick<ProjectLeaseV2, "immutableProjectUuid" | "projectGeneration" | "revocationEpoch">,
  operationId: string,
  envelope: ProductionGenerationAuthorizationEnvelopeV1 | undefined,
  digest: string | undefined,
  gateId: string | undefined,
): void {
  if (
    !envelope
    || !digest
    || !gateId
    || receipt.immutableProjectUuid !== envelope.immutableProjectUuid
    || receipt.projectGeneration !== envelope.projectGeneration
    || receipt.revocationEpoch !== lease.revocationEpoch
    || receipt.projectId !== envelope.projectId
    || receipt.runId !== operationId
    || receipt.gateId !== gateId
    || receipt.contractHash !== digest
    || receipt.targetHash !== digest
    || receipt.projectRevision !== envelope.projectRevision
    || receipt.costScope !== envelope.costScope
    || receipt.pricingSnapshotHash !== digest
  ) {
    throw new Error("Generation approval receipt does not match the sealed Run authorization");
  }
}
