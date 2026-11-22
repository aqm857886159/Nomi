import type { ProductionRunService } from "../productionRun/productionRunService";
import type { ProductionGenerationAuthorizationEnvelopeV1 } from "../productionRun/productionGenerationAuthorization";
import type {
  GenerationAuthorizationProjectIdentity,
  PreparedProductionGenerationAuthorization,
} from "../productionRun/prepareProductionGenerationAuthorization";
import type { ProductionRun, RunCommand } from "../productionRun/productionRunTypes";
import { reservationMaximumForDisplay } from "./approvalReceipt";
import { spendAuthorizationGates, waitingAuthorizationGates } from "../shared/productionSpendAuthority";
import type { ApprovalDecisionRecord, ApprovalDecisionRef } from "./approvalReceiptDecision";
import type {
  ApprovalReceiptAuthority,
  createApprovalReceiptAuthority,
  HumanApprovalDisplay,
  HumanApprovalReceiptV1,
  MainProcessDecision,
} from "./approvalReceipt";
import type { DispatchContext } from "./dispatcher";
import type { GenerationOperationStore } from "./mcpGenerationTools";
import type { ProjectLeaseV2 } from "./projectLease";
import { assertIssuedGenerationPlanning } from "./generationPlanningIssue";

type ApprovalReceiptIssuer = Omit<ReturnType<typeof createApprovalReceiptAuthority>, keyof ApprovalReceiptAuthority | "reader">;

const receiptIssuers = new WeakMap<ApprovalReceiptAuthority, ApprovalReceiptIssuer>();

/** 生产装配只向主人交签发引用；读面无法取回它，也不能重新绑定。 */
export function bindApprovalReceiptIssuer(receipts: ApprovalReceiptAuthority, issuer: ApprovalReceiptIssuer): void {
  if (receiptIssuers.has(receipts)) throw new Error("Approval receipt issuer is already bound");
  receiptIssuers.set(receipts, issuer);
}

function issuerFor(receipts: ApprovalReceiptAuthority | ReturnType<typeof createApprovalReceiptAuthority>): ApprovalReceiptIssuer {
  // 既有测试装配传完整工厂对象；生产 reader 只从装配时绑定的私有表取签发能力。
  const issuer = "reader" in receipts
    ? receipts
    : receiptIssuers.get(receipts);
  if (!issuer) throw new Error("Approval receipt issuer is unavailable");
  return issuer;
}

type RunOwner = Pick<ProductionRunService, "readFull" | "command">;

type GateConfirmation = (input: { challengeToken: string }) => Promise<unknown>;

// ── 付费批准只在这里判（概念 spend.approval-decision）────────────────────────────
//
// 助手要花钱时有四件事：要不要问人、问没问到人、批的是哪几镜、批过的用一次就作废。应用内的卡、外部客户端、
// 回环那一跳只把人的原话交到这里、把这里的结论原样显示；「算批准」的那句话（`confirmed: true` 带收据）
// 只有这里说得出来，`scripts/concept-owners-approval.mjs` 拦别处自己说。

/**
 * 只读：这一笔有没有够格的答复、是谁答的（Nomi 里点的 / 客户端里答的 / 全自动策略）、还能不能用。不盖章、不写库。
 * 重发等只想「看一眼」的调用方只走这里。
 */
export function readApprovalDecision(receipts: ApprovalReceiptAuthority, ref: ApprovalDecisionRef): ApprovalDecisionRecord {
  return receipts.readDecisionRecord(ref);
}

type RendererTarget = { webContentsId: number; frameId: number; origin: string };

/** 客户端那边人的原话（MCP elicitation 的 action + 表单里那一格），由主进程判算不算「是」。 */
export type ClientGateAnswer = { action?: unknown; confirm?: unknown };

export type GenerationGateAnswer = {
  confirmed: boolean;
  challengeId?: string;
  receiptId?: string;
  receiptToken?: string;
  trialFirst?: true;
  declined?: true;
};

/**
 * 两种问人的地方，一个判法：Nomi 里的卡（应用内助手，以及外部客户端问不了时的兜底卡）和外部客户端自己的确认框。
 * 都是先看这一笔是不是已经花掉了（花掉的不再问、不再签），再拿人的原话判，判成「是」才由主进程签收据。
 * 等人没有期限（2026-09-11 拍板）；调用方走了（取消信号）就不再等，晚到的「是」也不签。
 */
export function createGenerationGateAnswers(deps: Readonly<{
  receipts: ApprovalReceiptAuthority;
  requestRendererDecision: (channel: "generation.gate.confirm", payload: Record<string, unknown>) => Promise<unknown>;
  rendererTargetIdentity: () => RendererTarget | null;
  onTrialFirst?: (input: { projectId: string; operationId: string }) => void | Promise<void>;
  onTrialFirstError?: (error: unknown) => void;
}>) {
  const { receipts } = deps;
  const spent = (challengeToken: string) => readApprovalDecision(receipts, { challengeToken }).state === "used";

  async function confirmInNomi(
    { challengeToken }: { challengeToken: string },
    options: { signal?: AbortSignal } = {},
  ): Promise<GenerationGateAnswer> {
    const challenge = receipts.verifyChallenge(challengeToken);
    const notConfirmed: GenerationGateAnswer = { confirmed: false, challengeId: challenge.challengeId };
    if (spent(challengeToken)) return notConfirmed;
    const target = deps.rendererTargetIdentity();
    const { signal } = options;
    if (!target || !challenge.display?.model || signal?.aborted) return notConfirmed;
    // 卡在等真人按，没有墙钟期限（2026-09-11 拍板）。挑战自己的 expiresAt 仍在——
    // 那是凭据新鲜度（过期只是这张凭据不能再用，门照样等着人），不是替他答「否」。
    const asked = deps.requestRendererDecision("generation.gate.confirm", {
      challengeId: challenge.challengeId,
      projectName: challenge.display.projectName,
      shotSummary: challenge.display.shotSummary,
      model: challenge.display.model,
      referenceCount: challenge.display.referenceCount,
      maximumCost: reservationMaximumForDisplay(challenge.reservationPreview),
      ...(challenge.reservationPreview.unknownJobCount ? { unknownShotCount: challenge.reservationPreview.unknownJobCount } : {}),
      currency: challenge.reservationPreview.currency,
      expiresAt: challenge.expiresAt,
      ...(challenge.display.shots ? { shots: challenge.display.shots } : {}),
    }) as Promise<{ confirmed?: unknown; trialFirst?: unknown } | null>;
    const ABANDONED = Symbol("abandoned");
    let stopWatching = () => {};
    const result = signal
      ? await Promise.race([
          asked,
          new Promise<typeof ABANDONED>((resolve) => {
            const onAbort = () => resolve(ABANDONED);
            signal.addEventListener("abort", onAbort, { once: true });
            stopWatching = () => signal.removeEventListener("abort", onAbort);
          }),
        ]).finally(() => stopWatching())
      : await asked;
    if (result === ABANDONED) {
      // 问的人已经走了：卡上晚到的那一下不再签任何东西。
      asked.catch(() => {});
      return notConfirmed;
    }
    if (result?.confirmed !== true) {
      if (result?.trialFirst === true && deps.onTrialFirst && challenge.runId && challenge.projectId) {
        try {
          await deps.onTrialFirst({ projectId: challenge.projectId, operationId: challenge.runId });
        } catch (error) {
          deps.onTrialFirstError?.(error);
        }
      }
      return {
        ...notConfirmed,
        ...(result?.trialFirst === true ? { trialFirst: true as const } : {}),
        // 卡真的弹出来、用户点了「忽略」才是拒绝；渲染端没应答（null）不是——Agent 要靠它分清「拒绝」与「没人答」（C-4）。
        ...(result !== null && typeof result === "object" && result.trialFirst !== true ? { declined: true as const } : {}),
      };
    }
    if (spent(challengeToken)) return notConfirmed;
    const receipt = issuerFor(receipts).mintReceipt(challengeToken, issuerFor(receipts).createMainProcessGestureAttestation(challengeToken, {
      ...target,
      decision: "accept",
    }));
    return { confirmed: true, challengeId: challenge.challengeId, receiptId: receipt.receipt.receiptId, receiptToken: receipt.token };
  }

  /**
   * 外部客户端问过人之后来要收据：主进程看人的原话（accept 且表单里勾了「是」）才签；身份是回环那一跳
   * 请求头里验过的那个客户端，不是参数里自报的。没有原话、原话不是「是」、这一笔已经花掉 → 一律不签。
   */
  function answerFromClient(input: { challengeToken: string; client: string; answer?: ClientGateAnswer }): GenerationGateAnswer {
    receipts.verifyChallenge(input.challengeToken);
    const notConfirmed: GenerationGateAnswer = { confirmed: false };
    const client = typeof input.client === "string" ? input.client.trim() : "";
    if (!client || input.answer?.action !== "accept" || input.answer.confirm !== true) return notConfirmed;
    if (spent(input.challengeToken)) return notConfirmed;
    const receipt = issuerFor(receipts).mintReceipt(input.challengeToken, issuerFor(receipts).createClientElicitationAttestation(input.challengeToken, client));
    return { confirmed: true, receiptId: receipt.receipt.receiptId, receiptToken: receipt.token };
  }

  return { confirmInNomi, answerFromClient };
}

/**
 * 没有 Run 的旧挑战路上，「全自动」档由用户此前选的档位代答：同一张挑战、同一个收据铸造口，attestation 来自策略。
 * 判不判「全自动」由调用方问 `spendDecisionByPolicy`；这里只签。
 */
export function approveGateByPolicy(
  receipts: ApprovalReceiptAuthority,
  challengeToken: string,
  policy: { policyMode: "project"; policySurface: string },
): { token: string; receipt: HumanApprovalReceiptV1 } {
  return issuerFor(receipts).mintReceipt(challengeToken, issuerFor(receipts).createPolicyDecisionAttestation(challengeToken, policy));
}

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
  // 门只认生成装配工厂发的规划（强转骗得过类型，骗不过名单）。
  assertIssuedGenerationPlanning(input.planning, "generation gate authority");
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
      maximumCost: reservationMaximumForDisplay(envelope.budget),
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
 * 主进程这一次受信调用本身就是决定（画布 ↑、卡上点了「生成」之后的派发是那一下手势；「直接生成」档交给画布的那一镜是策略）：
 * 一次写完收据（`issueDecisionReceipt`），回一条「这道门批了」的命令，由调用方和封印放进**同一次落盘**（`repository.executeBatch`）。
 * 收据仍逐字核对信封，和要人在卡上点的那条路（`decideRunOwnedGenerationGate`）批的是同一份东西。
 */
export function mainProcessGateApproval(input: Readonly<{
  receipts: ApprovalReceiptAuthority;
  lease: GenerationAuthorizationProjectIdentity;
  operationId: string;
  authorization: PreparedProductionGenerationAuthorization;
  decision: MainProcessDecision;
  display: HumanApprovalDisplay;
  commandPrefix: string;
  issuedAt: string;
}>): Omit<RunCommand, "expectedRevision"> {
  const { envelope } = input.authorization;
  const digest = input.authorization.authorizationDigest;
  const receipt = issuerFor(input.receipts).issueDecisionReceipt(gateChallengeInput(input.authorization, input.lease, input.display), input.decision);
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
