import type { ProductionRunService } from "../productionRun/productionRunService";
import type { ProductionGenerationAuthorizationEnvelopeV1 } from "../productionRun/productionGenerationAuthorization";
import type {
  GenerationAuthorizationProjectIdentity,
  PreparedProductionGenerationAuthorization,
} from "../productionRun/prepareProductionGenerationAuthorization";
import type { ProductionRun } from "../productionRun/productionRunTypes";
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
    const envelope = plan?.authorizationEnvelope;
    const digest = plan?.authorizationDigest;
    const gate = plan?.authorizationGateId
      ? run.gates.find((candidate) => candidate.gateId === plan.authorizationGateId)
      : undefined;
    if (
      !plan
      || !envelope
      || !digest
      || !gate
      || gate.status !== "waiting"
      || gate.authorizationDigest !== digest
      || gate.planHash !== digest
      || envelope.immutableProjectUuid !== lease.immutableProjectUuid
      || envelope.projectGeneration !== lease.projectGeneration
      || envelope.projectId !== lease.projectId
      || envelope.runId !== operationId
      || envelope.gateId !== gate.gateId
    ) {
      throw new Error("Generation gate does not match the sealed Run authorization");
    }
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
      maximumCost: envelope.budget.maximum,
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
    const plan = run.generationPlan;
    const envelope = plan?.authorizationEnvelope;
    const digest = plan?.authorizationDigest;
    const gate = plan?.authorizationGateId
      ? run.gates.find((candidate) => candidate.gateId === plan.authorizationGateId)
      : undefined;
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
  const challenge = input.receipts.requestChallenge({
    challengeKey: `${envelope.costScope}:${digest}`,
    immutableProjectUuid: envelope.immutableProjectUuid,
    projectGeneration: envelope.projectGeneration,
    projectId: envelope.projectId,
    runId: envelope.runId,
    gateId: envelope.gateId,
    contractHash: digest,
    targetHash: digest,
    projectRevision: envelope.projectRevision,
    revocationEpoch: input.lease.revocationEpoch,
    costScope: envelope.costScope,
    pricingSnapshotHash: digest,
    reservationPreview: { ...envelope.budget },
    display: input.display,
  });
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
    },
    issuedAt: now(),
  });
  input.receipts.consumeReceipt(receiptToken);
  return { approved: true, run: decision.run };
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
