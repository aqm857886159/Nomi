import { resolveProductionReferenceUrls } from "../capabilityCore/productionReferenceUrls";
import { sumBudgetAmounts } from "./budgetLedger";
import type { ExecutionContractV1, PlanCandidate } from "../capabilityCore/executionContract";
import {
  createGenerationRuntimeAdapter,
  type GenerationProvider,
} from "../capabilityCore/generationRuntimeAdapter";
import type { ProjectLeaseV2 } from "../capabilityCore/projectLease";
import type { GenerationSealMultiShot } from "../capabilityCore/mcpGenerationMultiShot";
import {
  PRODUCTION_GENERATION_AUTHORIZATION_VERSION,
  countUnknownJobPrices,
  createProductionGenerationAuthorizationEnvelope,
  productionGenerationAuthorizationDigest,
  productionGenerationJobId,
  productionGenerationProviderIdempotencyKey,
  sumKnownJobCeilings,
  type ProductionGenerationAuthorizationEnvelopeV1,
} from "./productionGenerationAuthorization";
import type { ShotPrice } from "./shotPricing";
import { authorizationGateForJob, authorizedReferenceUrls, spendAuthorizationGates } from "../shared/productionSpendAuthority";

/**
 * 一镜的授权上限。**目录算不出 → `null`，不是 0**（2026-09-21 用户拍板：价格未知不许挡住生成）。
 *
 * 这一行就是从前 `assertKnownShotPrice` 抛 `generation_pricing_unknown` 的那个位置。抛点删掉了，
 * 因为它防的从来不是「未知的生成」，是「未知被静默当成 0 元放行」——而这件事现在由类型防：
 * `price.maximum` 一旦是 `number | null`，任何求和/比较都得先回答「未知怎么办」。
 */
function jobPriceCeiling(price: ShotPrice): number | null {
  return price.known ? price.amount : null;
}
import type { ProductionGenerationShot, ProductionJob, ProductionRun } from "./productionRunTypes";

type AuthorizationOperation = Readonly<{
  operationId: string;
  projectId: string;
  candidate: PlanCandidate;
  planVersion?: number;
}>;

export type GenerationAuthorizationProjectIdentity = Pick<
  ProjectLeaseV2,
  "projectId" | "immutableProjectUuid" | "projectGeneration" | "revocationEpoch"
>;

type AuthorizationUnit = Readonly<{
  shotId: string;
  jobShotId?: string;
  candidate: PlanCandidate;
  contract: ExecutionContractV1;
}>;

export type PreparedProductionGenerationAuthorization = Readonly<{
  envelope: ProductionGenerationAuthorizationEnvelopeV1;
  authorizationDigest: string;
}>;

export type PreparedProductionGenerationReauthorization = PreparedProductionGenerationAuthorization & Readonly<{
  shotId?: string;
  attempt: number;
  parentJobId: string;
}>;

export const REWORKABLE_JOB_STATUSES = new Set<ProductionJob["status"]>([
  "ready",
  "adopted",
  "needs_attention",
  "cancelled_remote",
  "detached",
  "too_late",
]);

function unitsFor(
  operation: AuthorizationOperation,
  contract: ExecutionContractV1,
  multiShot?: GenerationSealMultiShot,
): AuthorizationUnit[] {
  if (!multiShot) {
    return [{ shotId: operation.candidate.candidateId, candidate: operation.candidate, contract }];
  }
  // 这一次封印盖的镜（逐镜点击）：调用方必须说清楚，没有「缺省 = 整批」这条暗路。
  const scope = new Set(multiShot.scope);
  return multiShot.shots
    .filter((shot) => shot.included !== false && scope.has(shot.shotId))
    .map((shot) => {
      if (!shot.contract) throw new Error(`Included generation shot has no sealed contract: ${shot.shotId}`);
      return {
        shotId: shot.shotId,
        jobShotId: shot.shotId,
        candidate: shot.candidate,
        contract: shot.contract,
      };
    });
}

/**
 * 这个 Run 已经担下的钱：账本里的预留 + 实付 + 待结，再加上**批过、还没派出去**的作业的价格上限。
 *
 * 后一项是逐镜之后才有的（2026-09-30 付费卡逐镜）：第 1 镜批了还在排队（还没预留），用户又点了第 2 镜——
 * 第 2 份授权的天花板必须把第 1 份也算进去，否则调度器派完第 1 镜，第 2 镜会撞上账本 reserve 那道只够一镜的硬墙。
 * 算不出价的作业不进金额（未知不当 0，也不当无穷，见 `jobPriceCeiling`）。新封的一份和重做都用它：重做的是一镜
 * 已经收尾的尝试（`REWORKABLE_JOB_STATUSES` 里没有 `authorized`），别的镜批过、还在排队的那份钱照样要算进去
 * ——以前重做只算账本里的三项，于是「参考卡重拍一次，等着形象放行的镜」会撞上那道墙（2026-10-01）。
 */
export function committedLiability(run: ProductionRun): number {
  const approvedUndispatched = run.jobs
    .filter((job) => job.status === "authorized")
    .map((job) => authorizationGateForJob(run, job)?.authorizationEnvelope.jobs.find((entry) => entry.jobId === job.jobId)?.price.maximum ?? null)
    .filter((amount): amount is number => typeof amount === "number");
  return sumBudgetAmounts([run.budget.reserved, run.budget.actual, run.budget.unsettled, ...approvedUndispatched]);
}

/** Attempts belong to a durable shot, including executions of earlier candidate revisions. */
export function nextGenerationAttempt(run: ProductionRun | undefined, shotId?: string): number {
  return 1 + (run?.jobs ?? [])
    .filter(job => job.stageId === "generate" && job.metadata?.shotId === shotId)
    .reduce((latest, job) => Math.max(latest, job.attempt), 0);
}

export function prepareProductionGenerationAuthorization(input: Readonly<{
  lease: GenerationAuthorizationProjectIdentity;
  projectRevision: number;
  /**
   * 必填。`run?` 曾经是一个降级口：不传就按「这一镜还没有任何 attempt」算，于是 attempt 恒为 1；
   * 校验那一侧（`productionGenerationAuthorizationState`）是无条件按真实 Run 算的，两边对不上就抛。
   * 生产三个调用点一直都传，只有 harness 不传——结果是**第二批次那条真实路径从来没有一条测试走过**。
   */
  run: ProductionRun;
  operation: AuthorizationOperation;
  contract: ExecutionContractV1;
  multiShot?: GenerationSealMultiShot;
  providers: readonly GenerationProvider[];
  resolveShotPrice: (contract: ExecutionContractV1) => ShotPrice;
  now: string;
  ttlMs?: number;
  referenceUrlsByContract?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}>): PreparedProductionGenerationAuthorization {
  if (input.operation.projectId !== input.lease.projectId) {
    throw new Error("Generation operation does not belong to the leased project");
  }
  const planVersion = input.operation.planVersion;
  if (!Number.isSafeInteger(planVersion) || (planVersion as number) < 1) {
    throw new Error("Generation operation has no durable plan version");
  }
  if (!Number.isSafeInteger(input.projectRevision) || input.projectRevision < 0) {
    throw new Error("Generation authorization requires the current project revision");
  }
  if (input.run.runId !== input.operation.operationId || input.run.projectId !== input.operation.projectId || input.run.planVersion !== planVersion) {
    throw new Error("Generation authorization requires the current Run snapshot");
  }
  const adapter = createGenerationRuntimeAdapter({ providers: input.providers });
  const units = unitsFor(input.operation, input.contract, input.multiShot);
  const currency = "CNY";
  const jobs = units.map((unit) => {
    const attempt = nextGenerationAttempt(input.run, unit.jobShotId);
    if (attempt > input.run.policy.maxAttemptsPerJob) throw new Error("Generation attempt limit exceeded");
    const price = input.resolveShotPrice(unit.contract);
    const jobId = productionGenerationJobId(
      input.operation.operationId,
      unit.contract.contractHash,
      attempt,
      unit.jobShotId,
    );
    const providerIdempotencyKey = productionGenerationProviderIdempotencyKey(
      input.operation.operationId,
      unit.contract.contractHash,
      attempt,
      unit.jobShotId,
    );
    const prepared = adapter.prepareAuthorization({
      contract: unit.contract,
      providerIdempotencyKey,
      referenceUrls: input.referenceUrlsByContract?.[unit.contract.contractHash],
    });
    return {
      jobId,
      shotId: unit.shotId,
      attempt,
      target: {
        kind: "generation-operation" as const,
        operationId: input.operation.operationId,
        candidateRevision: unit.candidate.revision,
      },
      contractHash: unit.contract.contractHash,
      providerId: unit.contract.providerId,
      modelId: unit.contract.modelId,
      mode: unit.contract.mode,
      parameters: unit.contract.parameters,
      references: unit.contract.references,
      ...(input.referenceUrlsByContract?.[unit.contract.contractHash] ? { referenceUrls: input.referenceUrlsByContract[unit.contract.contractHash] } : {}),
      providerWirePayloadHash: prepared.providerRequestHash,
      providerIdempotencyKey,
      price: { currency, maximum: jobPriceCeiling(price) },
    };
  });
  const issuedAt = Date.parse(input.now);
  if (!Number.isFinite(issuedAt)) throw new Error("Generation authorization time is invalid");
  // 已知价之和；未知的那几镜单独数一次，两个数都不许折进对方。
  const jobMaximum = sumKnownJobCeilings(jobs);
  const unknownJobCount = countUnknownJobPrices(jobs);
  // 这一份授权盖的就是这一次点到的那几镜的全部（2026-10-01 删掉了「Run 有硬上限时只先批一部分、其余等派到时停批再续」：
  // 那是整批一份授权时的做法，逐镜之后它只会批出一份派不完的授权）。Run 的硬上限照旧在落门时由
  // `productionGenerationAuthorizationState` 判：盖不住就整份拒，不批一半。
  const ledgerCeiling = Math.max(input.run.budget.authorized, sumBudgetAmounts([committedLiability(input.run), jobMaximum]));
  const expiresAt = new Date(issuedAt + (input.ttlMs ?? 10 * 60 * 1000)).toISOString();
  const runId = input.operation.operationId;
  const envelope = createProductionGenerationAuthorizationEnvelope({
    schemaVersion: PRODUCTION_GENERATION_AUTHORIZATION_VERSION,
    immutableProjectUuid: input.lease.immutableProjectUuid,
    projectGeneration: input.lease.projectGeneration,
    projectId: input.lease.projectId,
    projectRevision: input.projectRevision,
    runId,
    planVersion: planVersion as number,
    // 同一个计划版本里可以有好几份授权（卡上每点一次一份），门号按这是第几份付费门来分。
    gateId: `generation-authorization:${runId}:v${planVersion}:n${spendAuthorizationGates(input.run).length + 1}`,
    costScope: input.multiShot ? `generation.multi-shot:${runId}` : `generation.single-shot:${runId}`,
    expiresAt,
    jobs,
    budget: {
      currency,
      maximum: jobMaximum,
      ledgerCeiling,
      unknownJobCount,
    },
  });
  return { envelope, authorizationDigest: productionGenerationAuthorizationDigest(envelope) };
}

/** Reuse asset transport once for the exact included scope, then seal its durable URL snapshot. */
export async function prepareProductionGenerationAuthorizationWithReferences(
  input: Parameters<typeof prepareProductionGenerationAuthorization>[0] & { assertCurrent: () => void },
  resolveReferences: typeof resolveProductionReferenceUrls = resolveProductionReferenceUrls,
): Promise<PreparedProductionGenerationAuthorization> {
  input.assertCurrent();
  if (input.operation.projectId !== input.lease.projectId) throw new Error("Generation operation does not belong to the leased project");
  if (!Number.isSafeInteger(input.operation.planVersion) || (input.operation.planVersion ?? 0) < 1
    || !Number.isSafeInteger(input.projectRevision) || input.projectRevision < 0
    || input.run.runId !== input.operation.operationId || input.run.projectId !== input.lease.projectId || input.run.planVersion !== input.operation.planVersion) {
    throw new Error("Generation reference preparation requires the current Run snapshot");
  }
  const referenceUrlsByContract: Record<string, Readonly<Record<string, string>>> = {};
  for (const unit of unitsFor(input.operation, input.contract, input.multiShot)) {
    if (unit.contract.references.length === 0) continue;
    referenceUrlsByContract[unit.contract.contractHash] = await resolveReferences({
      projectId: input.lease.projectId, providerId: unit.contract.providerId,
      references: unit.contract.references, assertCurrent: input.assertCurrent,
    });
  }
  input.assertCurrent();
  return prepareProductionGenerationAuthorization({ ...input, referenceUrlsByContract });
}

/**
 * 返工这一镜被拒的结构化原因（2026-09-29）。appIntegrationProductionActions 照它回语义码，渲染层照语义码说人话、
 * 给能做的事。以前只有英文句子，外层用正则猜：上一次还在跑也被说成「这一镜还没生成过」，排队中的镜挡着返工
 * 则落成一句「操作没成功」前面拼着这行英文。
 */
export type GenerationReworkRefusal = "no_prior_attempt" | "previous_attempt_unsettled" | "attempt_limit";

export class GenerationReworkRefusedError extends Error {
  constructor(readonly refusal: GenerationReworkRefusal, message: string) {
    super(message);
    this.name = "GenerationReworkRefusedError";
  }
}

function addressedUnit(run: ProductionRun, shotId?: string): {
  shot?: ProductionGenerationShot;
  candidate: PlanCandidate;
  contract: ExecutionContractV1;
} {
  const plan = run.generationPlan;
  if (!plan || (plan.state !== "sealed" && plan.state !== "submitted")) {
    throw new GenerationReworkRefusedError("no_prior_attempt", "This generation Run cannot create new paid work until it has a sealed authorization");
  }
  if (shotId) {
    const shot = (plan.shots ?? []).find((candidate) => candidate.shotId === shotId);
    // 这一镜没有封过的合同 = 从没有过一次授权的尝试，谈不上重做。
    if (!shot?.contract) throw new GenerationReworkRefusedError("no_prior_attempt", `Generation shot is not sealed: ${shotId}`);
    return { shot, candidate: shot.candidate, contract: shot.contract };
  }
  if (plan.shots?.length) throw new Error("A multi-shot reauthorization requires a shot id");
  if (!plan.contract) throw new Error("Generation contract is not sealed");
  return { candidate: plan.candidate, contract: plan.contract };
}

function latestJobFor(run: ProductionRun, contractHash: string, shotId?: string): ProductionJob | undefined {
  const prefix = productionGenerationJobId(run.runId, contractHash, 1, shotId);
  return run.jobs
    .filter((job) => job.jobId === prefix || job.jobId.startsWith(`${prefix}-attempt-`))
    .sort((left, right) => right.attempt - left.attempt)[0];
}

/** Prepare a fresh, single-unit paid authority for an explicit user rework. */
export function prepareProductionGenerationReauthorization(input: Readonly<{
  lease: GenerationAuthorizationProjectIdentity;
  projectRevision: number;
  run: ProductionRun;
  shotId?: string;
  providers: readonly GenerationProvider[];
  resolveShotPrice: (contract: ExecutionContractV1) => ShotPrice;
  now: string;
  ttlMs?: number;
  /**
   * 这一次返工要发的参考链接表。不给 = 沿用上一次批准冻住的那份（`authorizedReferenceUrls`）；给了（重新换过链接）
   * 就用它——它同时进线上报文哈希和信封，派发时按这一份授权自己的链接核，所以换链接不会被「报文对不上」拒发。
   */
  referenceUrls?: Readonly<Record<string, string>>;
}>): PreparedProductionGenerationReauthorization {
  if (
    input.run.projectId !== input.lease.projectId
    || input.run.generationPlan?.operationId !== input.run.runId
  ) {
    throw new Error("Generation reauthorization does not belong to the leased Run");
  }
  if (!Number.isSafeInteger(input.projectRevision) || input.projectRevision < 0) {
    throw new Error("Generation reauthorization requires the current project revision");
  }
  const unit = addressedUnit(input.run, input.shotId);
  const parent = latestJobFor(input.run, unit.contract.contractHash, input.shotId);
  if (!parent) throw new GenerationReworkRefusedError("no_prior_attempt", "The previous generation attempt is not safely reworkable");
  if (!REWORKABLE_JOB_STATUSES.has(parent.status)) {
    throw new GenerationReworkRefusedError("previous_attempt_unsettled", "The previous generation attempt is not safely reworkable");
  }
  const attempt = parent.attempt + 1;
  if (attempt > input.run.policy.maxAttemptsPerJob) {
    throw new GenerationReworkRefusedError("attempt_limit", "Generation rework exceeds the Run attempt limit");
  }
  const price = input.resolveShotPrice(unit.contract);
  const priceCeiling = jobPriceCeiling(price);

  const jobId = productionGenerationJobId(input.run.runId, unit.contract.contractHash, attempt, input.shotId);
  const providerIdempotencyKey = productionGenerationProviderIdempotencyKey(
    input.run.runId,
    unit.contract.contractHash,
    attempt,
    input.shotId,
  );
  const referenceUrls = input.referenceUrls ?? authorizedReferenceUrls(input.run, unit.contract.contractHash);
  const prepared = createGenerationRuntimeAdapter({ providers: input.providers }).prepareAuthorization({
    contract: unit.contract,
    providerIdempotencyKey,
    referenceUrls,
  });
  const issuedAt = Date.parse(input.now);
  if (!Number.isFinite(issuedAt)) throw new Error("Generation reauthorization time is invalid");
  const shotScope = input.shotId ?? unit.candidate.candidateId;
  const liability = committedLiability(input.run);
  const envelope = createProductionGenerationAuthorizationEnvelope({
    schemaVersion: PRODUCTION_GENERATION_AUTHORIZATION_VERSION,
    immutableProjectUuid: input.lease.immutableProjectUuid,
    projectGeneration: input.lease.projectGeneration,
    projectId: input.run.projectId,
    projectRevision: input.projectRevision,
    runId: input.run.runId,
    planVersion: input.run.planVersion,
    gateId: `generation-authorization:${input.run.runId}:v${input.run.planVersion}:${shotScope}:attempt-${attempt}`,
    costScope: `generation.rework:${input.run.runId}:${shotScope}:attempt-${attempt}`,
    expiresAt: new Date(issuedAt + (input.ttlMs ?? 10 * 60 * 1000)).toISOString(),
    jobs: [{
      jobId,
      shotId: shotScope,
      attempt,
      target: {
        kind: "generation-operation",
        operationId: input.run.runId,
        candidateRevision: unit.candidate.revision,
      },
      contractHash: unit.contract.contractHash,
      providerId: unit.contract.providerId,
      modelId: unit.contract.modelId,
      mode: unit.contract.mode,
      parameters: unit.contract.parameters,
      references: unit.contract.references,
      referenceUrls,
      providerWirePayloadHash: prepared.providerRequestHash,
      providerIdempotencyKey,
      price: { currency: input.run.budget.currency, maximum: priceCeiling },
    }],
    budget: {
      currency: input.run.budget.currency,
      // 重拍这一镜价格未知 → 这次决定覆盖的**已知**负债是 0，但那不是「免费」：
      // `unknownJobCount: 1` 才是这份信封在说的话。
      maximum: priceCeiling ?? 0,
      ledgerCeiling: Math.max(input.run.budget.authorized, liability + (priceCeiling ?? 0)),
      unknownJobCount: priceCeiling === null ? 1 : 0,
    },
  });
  return {
    envelope,
    authorizationDigest: productionGenerationAuthorizationDigest(envelope),
    ...(input.shotId ? { shotId: input.shotId } : {}),
    attempt,
    parentJobId: parent.jobId,
  };
}
