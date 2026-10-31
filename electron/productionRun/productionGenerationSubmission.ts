import { GenerationMaterializationUnsupportedError, GenerationMaterializationError, GenerationOutputRetrievalFailedError, deterministicRetrievalFailure, classifyProviderStatus, isPendingProviderStatus, isSuccessfulProviderStatus, isFailedProviderStatus, type GenerationSubmissionMaterializeResult } from "./productionGenerationMaterialization";
import crypto from "node:crypto";
import { readGenerationExecution } from "./productionGenerationHistory";
import path from "node:path";

import {
  createGenerationRuntimeAdapter,
  GenerationProviderObservationError,
  resolveExecutionContract,
  type GenerationProvider,
  type GenerationProviderOutput,
} from "../capabilityCore/generationRuntimeAdapter";
import type { ExecutionContractV1 } from "../capabilityCore/executionContract";
import {
  productionGenerationJobId,
  productionGenerationProviderIdempotencyKey,
} from "./productionGenerationAuthorization";
import { nextGenerationAttempt } from "./prepareProductionGenerationAuthorization";
import { authorizationGateForJob } from "../shared/productionSpendAuthority";
import { DispatchConsentLapsedError, dispatchConsentOpen } from "../shared/productionDispatchConsent";
import { createProductionRunRuntimeEnvelope, type ProductionRunRuntimeEnvelope } from "./productionRunRuntimeEnvelope";
import { createProductionRunIntentLog } from "./productionRunIntentLog";
import { productionRunPaths } from "./productionRunPaths";
import { createProductionRunLock } from "./productionRunLock";
import type { ProductionRunRepository } from "./productionRunRepository";
import { isTransportLevelFailure, observeSubmissionHandoffs } from "../outboundDispatchEvidence";
import {
  SubmissionNotDispatchedError,
  SubmissionReceiptUnknownError,
  SubmissionReconciliationRequiredError,
  createSubmissionOutbox,
  submissionFailureOutcome,
} from "./submissionOutbox";
import { createProductionExecutionBinding, validateProductionExecutionBinding, type ProductionExecutionBinding } from "./productionExecutionBinding";
import { OUTPUT_RETRIEVAL_FAILED, type ProductionArtifact, type ProductionJob, type ProductionRun, type RunCommand } from "./productionRunTypes";
import { tagNomiError } from "../shared/nomiErrorCodes";
import { singleShotRunningCommand } from "./singleShotRunLifecycle";
import { assertShotAdmission, type LandedShotAdmission } from "./shotLandingAdmission";
import { createProductionShotDispatchGuard } from "./productionShotDispatchGuard";

export { SubmissionReceiptUnknownError, SubmissionReconciliationRequiredError };

export type GenerationSubmissionStartInput = {
  projectId: string;
  operationId: string;
  /** Explicitly selected attempt; omitted means the latest durable attempt. */
  attempt?: number;
  /**
   * P4 S1 shot addressing: which shot's sub-contract to submit. Omitted = the default (single) shot,
   * behaving exactly as the P1–P3 single-shot chain (top-level plan contract). Backward compatible.
   */
  shotId?: string;
};

/**
 * 派发（花钱）那一下的入参：除了地址，还必须带这一镜「已落地」的准入（架构③ 先落节点、再发请求）。
 * 准入只有 `shotLandingAdmission.admitShotsForDispatch` 造得出来——不经准入就派，编译不过；拿到了这里还按耐久 Run 复核。
 */
export type GenerationSubmissionDispatchInput = GenerationSubmissionStartInput & {
  admission: LandedShotAdmission;
};

export type GenerationSubmissionResult = {
  operationId: string;
  runId: string;
  jobId: string;
  providerTaskId: string;
  attempt: number;
  nextAction: "observe";
};

export type GenerationSubmissionPollResult = {
  operationId: string;
  runId: string;
  jobId: string;
  providerTaskId: string;
  providerStatus: string;
  nextAction: "poll" | "materialize" | "attention";
};

export { GenerationMaterializationUnsupportedError, GenerationMaterializationError, GenerationOutputRetrievalFailedError } from "./productionGenerationMaterialization";
export type { GenerationSubmissionMaterializeResult } from "./productionGenerationMaterialization";

export type ProductionGenerationSubmissionDependencies = {
  repository: ProductionRunRepository;
  projectRoot: string;
  immutableProjectUuid: string;
  projectGeneration: number;
  intentMacKey: string | NodeJS.TypedArray;
  provider?: GenerationProvider;
  providers?: readonly GenerationProvider[];
  now?: () => string;
  runtimeTaskId?: (input: { runId: string; contractHash: string; attempt?: number }) => string;
  afterProviderAcceptance?: (input: { providerTaskId: string; run: ProductionRun }) => void | Promise<void>;
  /**
   * 额外的派发前检查（只给测试观察 / 注入用）。**镜头认领闸不在这里注入**：它长在提交出口里（`start` 每交一镜都过），
   * 调用方换不掉、漏不了——急停 / 取消 / 画布接手 / 节点删了，逐镜都按最新的耐久 Run 再判一次（#1139）。
   * 先跑这个、再跑认领闸；抛错 = 这一镜这次不提交，什么都没写。
   */
  beforeDispatch?: (input: { run: ProductionRun; job: ProductionJob }) => void | Promise<void>;
  /** Asset store owns bytes, identity and leases; the submission seam only commits its returned receipt. */
  materializeOutput?: (input: {
    projectId: string;
    operationId: string;
    run: ProductionRun;
    job: ProductionJob;
    contract: ExecutionContractV1;
    providerTaskId: string;
    output: GenerationProviderOutput;
  }) => Promise<Pick<ProductionArtifact, "artifactId" | "kind" | "contentHash" | "projectRelativePath" | "thumbnailRelativePath" | "previewState" | "width" | "height">>;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Generation request must contain finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  throw new Error("Generation request must be JSON serializable");
}

function sha256(value: unknown): string {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function requiredRun(repository: ProductionRunRepository, projectId: string, runId: string): ProductionRun {
  const run = repository.read(projectId, runId);
  if (!run) throw new Error(`Production run not found: ${runId}`);
  return run;
}

/**
 * P4 S1: resolve the sub-contract this call addresses.
 * - No shotId → the default (single) shot: the top-level plan contract.
 * - shotId → that shot's sealed sub-contract.
 * 批没批准不在这里判：派发前 `prepareAuthorizedSubmission` 核「批这个 job 的那道门」（唯一判据），这里只要合同在。
 */
function requiredContract(run: ProductionRun, shotId?: string): ExecutionContractV1 {
  const plan = run.generationPlan;
  if (!plan || (plan.state !== "sealed" && plan.state !== "submitted")) {
    throw new Error("Seal and confirm the generation plan before starting");
  }
  if (shotId) {
    const shot = (plan.shots ?? []).find((candidate) => candidate.shotId === shotId);
    if (!shot?.contract) throw new Error("Seal and confirm the generation plan before starting");
    return shot.contract;
  }
  if (!plan.contract) throw new Error("Seal and confirm the generation plan before starting");
  return plan.contract;
}

/**
 * 「这次提交要发的是第几次尝试」**只有一个 owner**：`nextGenerationAttempt`（按 `metadata.shotId`
 * 数这一镜已有的 attempt）。授权在 job 落盘**之前**问它，拿到 `max + 1`；提交在 job 落盘**之后**问，
 * 要的就是那一条，于是 `- 1`。
 *
 * 这里原本另有一份 `latestGenerationAttempt`，按 jobId 前缀（含 contractHash）去数。它今天给的答案
 * 和这条一样，但口径不同：换了参数就换 contractHash，于是它对「同一镜的第几次」这个问题的回答
 * 会从头开始。一个语义两个推导式、两边都不报错 —— 那正是要收掉的形状（P1/R14.1）。
 *
 * P4 S1 identity: shotId is part of the jobId so two shots with identical parameters (equal contract
 * hash) never collide. The default shot keeps the legacy prefix (`generation-<run>-<hash16>`) so
 * durable Runs and single-shot callers are byte-compatible; a named shot inserts `-<shotId>` after it.
 */
export function addressedGenerationAttempt(run: ProductionRun, shotId?: string): number {
  return Math.max(1, nextGenerationAttempt(run, shotId) - 1);
}

function envelopeRefFor(runId: string, jobId: string): string {
  return `.nomi/runs/${runId}/jobs/${jobId}/runtime-envelope.json`;
}

/**
 * The binding's `shotId` is the addressed shot (default shot → its jobId, keeping single-shot bindings
 * byte-identical). The providerIdempotencyKey MUST include the shotId so two shots that hash identically
 * derive different keys (#5): a two-shot batch with equal parameters must not collapse to one provider task.
 */
function sealedBindingFor(sealed: ProductionRunRuntimeEnvelope | null, contract: ExecutionContractV1): ProductionExecutionBinding | undefined {
  const candidate = (sealed?.request as { executionBinding?: unknown } | undefined)?.executionBinding;
  if (!sealed || candidate === undefined || sealed.contractHash !== contract.contractHash) return undefined;
  const binding = validateProductionExecutionBinding(candidate);
  return binding.providerNamespace === contract.providerId ? binding : undefined;
}

function ensureBinding(deps: ProductionGenerationSubmissionDependencies, run: ProductionRun, contract: ExecutionContractV1, jobId: string, attempt: number, fencingEpoch: number, shotId?: string): ProductionExecutionBinding {
  const existing = run.jobs.find((job) => job.jobId === jobId)?.executionBinding;
  if (existing) {
    if (existing.contractHash !== contract.contractHash || existing.providerNamespace !== contract.providerId) {
      throw new Error("Sealed generation job binding does not match the current contract");
    }
    return existing;
  }
  // The default shot keeps the jobId as its shot identity (single-shot binding unchanged); a named shot
  // uses its stable shotId. Both feed the idempotency key so identical-parameter shots stay distinct.
  const bindingShotId = shotId ?? jobId;
  const runtimeTaskId = deps.runtimeTaskId?.({ runId: run.runId, contractHash: contract.contractHash, attempt })
    || `runtime-${run.runId}-${contract.contractHash.slice(0, 16)}-attempt-${attempt}`;
  const requestFingerprint = sha256({
    contractHash: contract.contractHash,
    providerId: contract.providerId,
    modelId: contract.modelId,
    mode: contract.mode,
    prompt: contract.prompt,
    parameters: contract.parameters,
    references: contract.references,
  });
  return createProductionExecutionBinding({
    immutableProjectUuid: deps.immutableProjectUuid,
    projectGeneration: deps.projectGeneration,
    runId: run.runId,
    shotId: bindingShotId,
    contractHash: contract.contractHash,
    runtimeTaskId,
    providerNamespace: contract.providerId,
    providerIdempotencyKey: `generation:${run.runId}:${bindingShotId}:${contract.contractHash}:attempt-${attempt}`,
    requestFingerprint,
    runtimeEnvelopeRef: envelopeRefFor(run.runId, jobId),
    fencingEpoch,
  });
}

export function createProductionGenerationSubmission(deps: ProductionGenerationSubmissionDependencies) {
  const now = deps.now ?? (() => new Date().toISOString());
  const providers = deps.providers ?? (deps.provider ? [deps.provider] : []);
  if (providers.length === 0) throw new Error("At least one generation provider is required");
  const adapter = createGenerationRuntimeAdapter({ providers });
  // 交一镜的唯一边界自己带着认领闸（#1139）：以前它由装配方注入，生产三处都注入了，可测试夹具一律注入空函数，
  // 「整批准入之后被停下」这一类在夹具里永远看不见；任何新装配方也能忘了接。现在它不是依赖，是提交出口的一部分。
  const assertShotCanDispatch = createProductionShotDispatchGuard({ readRun: (projectId, runId) => deps.repository.read(projectId, runId) ?? undefined });

  function intentLog(runId: string) {
    return createProductionRunIntentLog({
      filePath: productionRunPaths(deps.projectRoot, runId).intents,
      macKey: deps.intentMacKey,
    });
  }

  function lock(runId: string) {
    const paths = productionRunPaths(deps.projectRoot, runId);
    return createProductionRunLock({ filePath: paths.lock, epochPath: paths.lockEpoch, ownerId: `semantic-generation-${process.pid}` });
  }

  function envelope(runId: string, jobId: string) {
    return createProductionRunRuntimeEnvelope({ filePath: path.join(deps.projectRoot, envelopeRefFor(runId, jobId)) });
  }

  function command(run: ProductionRun, type: string, payload: Record<string, unknown>, suffix: string): ProductionRun {
    return deps.repository.execute(run.projectId, run.runId, {
      commandId: `generation.runtime:${run.runId}:${suffix}`,
      expectedRevision: run.revision,
      type,
      payload,
      issuedAt: now(),
    }).run;
  }

  function prepareAuthorizedSubmission(
    run: ProductionRun,
    contract: ExecutionContractV1,
    jobId: string,
    attempt: number,
    fencingEpoch: number,
    shotId?: string,
  ): {
    run: ProductionRun;
    envelope: ReturnType<typeof createProductionRunRuntimeEnvelope>;
    approvalId: string;
    authorizationDigest: string;
    /** `null` = 目录算不出价（2026-09-21 开闸）。绝不是 0 元。 */
    costCeiling: number | null;
    currency: string;
    expectedProviderRequestHash: string;
    preparedProviderRequest: unknown;
    /** 这次执行的绑定还没落盘：交给提交出口，和预留 / 提交意向 / 提交中放进同一次落盘（交给供应商之前）。 */
    leadingCommands: Array<Omit<RunCommand, "expectedRevision">>;
  } {
    const current = run;
    const plan = current.generationPlan;
    const existingJob = current.jobs.find((job) => job.jobId === jobId);
    // 批这个 job 的**那一道门**（每点一次一份授权，信封住在门上）。不是计划上某一份：那一份已删——它让排在前面、
    // 已经批过的镜在下一次批准时失去授权，也让「只批这一镜」只能靠把别的镜移出这一批来实现（2026-09-30）。
    const gate = existingJob ? authorizationGateForJob(current, existingJob) : undefined;
    const authorizationEnvelope = gate?.authorizationEnvelope;
    const authorizationDigest = gate?.authorizationDigest;
    const gateId = gate?.gateId;
    if (!plan || !existingJob || !gate || !authorizationEnvelope || !authorizationDigest || !gateId) {
      throw new Error("This generation Run has no sealed paid authorization; it is read-only until re-planned");
    }
    if (
      // 派发时核的是「还是不是那个项目、那一个 Run、批它的那一道门」。**不核活的项目文档版本、也不核活的计划版本**：
      // 批准那一刻它们是前提（收据只对当时的版本有效，见 productionRunApprovalReceipt.assertCurrentProjectRevision），
      // 批准之后项目照常会变——Nomi 自己把占位和参考卡结果落到画布上、用户在卡上改下一镜，都会让它们前进。以前这里要求
      // 派发时它们仍等于封信封时的值，于是定妆照检查点放行、急停后继续、重开项目这些「批准之后过一会儿才派」的路一律报
      // 「Generation authorization no longer matches」，视频镜永远排队（2026-09-29 用户实见）。发出去的请求本身已由
      // 合同哈希、线上报文哈希、幂等键逐字钉死（下面那组比对），文档和计划怎么变都改不了它。
      authorizationEnvelope.immutableProjectUuid !== deps.immutableProjectUuid
      || authorizationEnvelope.projectGeneration !== deps.projectGeneration
      || authorizationEnvelope.projectId !== current.projectId
      || authorizationEnvelope.runId !== current.runId
      || authorizationEnvelope.gateId !== gateId
    ) {
      throw new Error("Generation authorization no longer matches the current project or Run");
    }
    const authorized = authorizationEnvelope.jobs.find((job) => job.jobId === jobId);
    const approvalId = `approval:${gateId}`;
    const approval = deps.repository.readApprovals(current.projectId, current.runId)
      .find((candidate) => candidate.approvalId === approvalId);
    if (
      !authorized
      || authorized.attempt !== attempt
      || authorized.contractHash !== contract.contractHash
      || authorized.providerId !== contract.providerId
      || authorized.modelId !== contract.modelId
      || authorized.providerIdempotencyKey !== productionGenerationProviderIdempotencyKey(current.runId, contract.contractHash, attempt, shotId)
      || existingJob.authorizationDigest !== authorizationDigest
      || existingJob.providerIdempotencyKey !== authorized.providerIdempotencyKey
      || gate.status !== "approved"
      || gate.planHash !== authorizationDigest
      || !gate.receiptId
      || !approval
      || approval.authorizationDigest !== authorizationDigest
      || approval.planHash !== authorizationDigest
      || approval.receiptId !== gate.receiptId
      || !approval.jobIds.includes(jobId)
    ) {
      throw new Error("Generation submission is not covered by the approved Run authorization");
    }
    // 「现在派出去还算不算用户同意过」只有一个判据（付费卡① 第 13 条，`productionDispatchConsent`）：离他最近一次点头
    // ——批准这一镜，或之后放行形象、停下后点「继续」——不超过同意窗口。以前这里拿信封封好那一刻起的 10 分钟判，
    // 于是放行形象、急停后继续、第二天重开这些「批准之后过一会儿才派」的路永远派不出去，镜头一直「排队中」。
    // 过了窗口 = 没有人替他续：这一镜不派，调度器接住这个错，批次如实停下等他再点一次（不是失败）。
    if (!dispatchConsentOpen(gate, now())) throw new DispatchConsentLapsedError(gateId, jobId);

    // This is the last zero-side-effect check. If provider serialization drifted since the gate,
    // nothing below (Run events, ledger, intents, runtime envelope or provider) is touched.
    const providerPreparation = adapter.prepareAuthorization({
      contract,
      providerIdempotencyKey: authorized.providerIdempotencyKey,
      referenceUrls: authorized.referenceUrls,
    });
    if (providerPreparation.providerRequestHash !== authorized.providerWirePayloadHash) {
      throw new Error("Provider wire payload no longer matches the approved authorization");
    }

    // 先封信封、绑定随提交前那一批一起落盘（发动机收敛第一刀第 3 步的性能尾巴，少一次 Run 落盘）。崩在两者之间：
    // 信封里已经封着那一份绑定（含当时的锁纪元），重来时沿用它，信封 seal 幂等、交出去的还是同一份请求。
    const sealedEnvelope = envelope(current.runId, jobId);
    const binding = existingJob.executionBinding
      ?? sealedBindingFor(sealedEnvelope.read(), contract)
      ?? ensureBinding(deps, current, contract, jobId, attempt, fencingEpoch, shotId);
    const leadingCommands: Array<Omit<RunCommand, "expectedRevision">> = existingJob.executionBinding ? [] : [{
      commandId: `generation.runtime:${current.runId}:job-bind:${jobId}`,
      type: "job.patch",
      payload: {
        jobId,
        patch: {
          executionBinding: binding,
          requestFingerprint: binding.requestFingerprint,
          providerIdempotencyKey: binding.providerIdempotencyKey,
          idempotencyKey: binding.providerIdempotencyKey,
          runtimeEnvelopeRef: binding.runtimeEnvelopeRef,
        },
      },
      issuedAt: now(),
    }];
    const resolved = resolveExecutionContract(contract, binding);
    sealedEnvelope.seal({
      runId: current.runId,
      jobId,
      runtimeTaskId: binding.runtimeTaskId,
      contractHash: contract.contractHash,
      providerIdempotencyKey: binding.providerIdempotencyKey,
      requestFingerprint: binding.requestFingerprint,
      request: resolved,
    });
    return {
      run: current,
      envelope: sealedEnvelope,
      approvalId,
      authorizationDigest,
      costCeiling: authorized.price.maximum,
      currency: authorized.price.currency,
      expectedProviderRequestHash: authorized.providerWirePayloadHash,
      preparedProviderRequest: providerPreparation.providerRequest,
      leadingCommands,
    };
  }

  /**
   * 只观察已经交给供应商、供应商已受理的那一次（#1139 N1：从 start 里拆出来）。**不收准入**：节点被删以后，已经交出去的
   * 那一次照样要把结果收回来；它只读账本、必要时把计划记成已交，绝不调用供应商提交。没有已受理的这一次 = null。
   */
  function observeAccepted(input: GenerationSubmissionStartInput): GenerationSubmissionResult | null {
    const shotId = input.shotId;
    let run = requiredRun(deps.repository, input.projectId, input.operationId);
    const contract = shotId ? run.generationPlan?.shots?.find((shot) => shot.shotId === shotId)?.contract : run.generationPlan?.contract;
    if (!contract) return null;
    const attempt = input.attempt ?? addressedGenerationAttempt(run, shotId);
    if (!Number.isInteger(attempt) || attempt < 1) return null;
    const jobId = productionGenerationJobId(run.runId, contract.contractHash, attempt, shotId);
    const existingJob = run.jobs.find((job) => job.jobId === jobId);
    if (existingJob?.status !== "provider_accepted" || !existingJob.providerTaskId) return null;
    if (run.generationPlan?.state !== "submitted") run = command(run, "generation.submit", {}, `plan-submit:v${run.planVersion}`);
    return { operationId: run.runId, runId: run.runId, jobId, providerTaskId: existingJob.providerTaskId, attempt, nextAction: "observe" };
  }

  /**
   * **只给新派发**（花钱那一下）。每一次都先过准入（#1139 N1）：这一镜此刻在画布上没有节点、或准入是伪造 / 过期的，
   * 什么都不写、不交。已经受理过的那一次不再从这里回「观察」——那是 observeAccepted 的事，它不收准入。
   */
  async function start(input: GenerationSubmissionDispatchInput): Promise<GenerationSubmissionResult> {
    const shotId = input.shotId;
    let run = requiredRun(deps.repository, input.projectId, input.operationId);
    assertShotAdmission(run, shotId, input.admission);
    const contract = requiredContract(run, shotId);
    const attempt = input.attempt ?? addressedGenerationAttempt(run, shotId);
    if (!Number.isInteger(attempt) || attempt < 1) throw new Error("Generation attempt is invalid");
    let jobId = productionGenerationJobId(run.runId, contract.contractHash, attempt, shotId);
    const existingJob = run.jobs.find((job) => job.jobId === jobId);
    // 没有任何一份授权（门）盖着的旧 job 只能看、不能再发：它的那一轮授权已经不在了。
    if (existingJob && !authorizationGateForJob(run, existingJob)) {
      throw new Error("Historical generation execution is observation-only");
    }
    if (existingJob?.status === "provider_accepted" && existingJob.providerTaskId) {
      throw Object.assign(new Error("generation_already_accepted: observe it with observeAccepted"), { code: "generation_already_accepted" });
    }
    if (existingJob && ["submission_unknown", "reconciling", "needs_attention", "cancel_requested"].includes(existingJob.status)) {
      throw new SubmissionReconciliationRequiredError();
    }
    const runLock = lock(run.runId);
    return runLock.withLock(async (lease) => {
      run = requiredRun(deps.repository, input.projectId, input.operationId);
      // 锁里再按最新的耐久 Run 复核一次：等锁期间节点可能被删（detached）。
      assertShotAdmission(run, shotId, input.admission);
      const lockedContract = requiredContract(run, shotId);
      if (lockedContract.contractHash !== contract.contractHash) throw new Error("Generation contract changed while waiting for the Run lock");
      const lockedAttempt = input.attempt ?? addressedGenerationAttempt(run, shotId);
      jobId = productionGenerationJobId(run.runId, lockedContract.contractHash, lockedAttempt, shotId);
      const prepared = prepareAuthorizedSubmission(run, lockedContract, jobId, lockedAttempt, lease.fencingEpoch, shotId);
      run = prepared.run;
      const log = intentLog(run.runId);
      let rawReceipt: unknown;
      const outbox = createSubmissionOutbox({
        repository: deps.repository,
        intentLog: log,
        lock: runLock,
        lockLease: lease,
        now,
        beforeDispatch: async (dispatchInput) => {
          await deps.beforeDispatch?.({ run: dispatchInput.run, job: dispatchInput.job });
          assertShotCanDispatch({ run: dispatchInput.run, job: dispatchInput.job });
        },
        // 供应商档案真声明了幂等（并把键带到请求上）才允许在「结果未知」后用同一个键重发一次；
        // 目前没有任何生产供应商声明（APIMart 明确 false），所以生产里这条恒为 false。
        canResendAfterUnknown: (error, dispatchInput) =>
          providers.some((provider) => provider.providerId === dispatchInput.job.provider && provider.capabilities.submitIdempotency === true)
          && isTransportLevelFailure(error),
        dispatch: async (dispatchInput) => {
          const currentBinding = dispatchInput.job.executionBinding;
          if (!currentBinding) throw new Error("Generation job is missing its sealed execution binding");
          // 「一个字节都没离开本机」是**可证明**的一档：这次派发一个可能花钱的请求都没交给网络（在本机就被拦下），
          // 或交出去的全在连上之前就失败了。它和「写出去了不知道结果」性质完全不同：前者供应商那边什么都没发生，
          // 后者可能已经在扣费。判据只有一个 owner：`outboundDispatchEvidence.ts`；证明不了一律是后者。
          const transport = providers.find((provider) => provider.providerId === lockedContract.providerId)?.networkTransport;
          const observed = await observeSubmissionHandoffs(transport, () => adapter.submit({
            contract: lockedContract,
            binding: currentBinding,
            expectedProviderRequestHash: prepared.expectedProviderRequestHash,
            preparedProviderRequest: prepared.preparedProviderRequest,
          }));
          if (observed.ok) {
            rawReceipt = observed.value.raw;
            return { providerTaskId: observed.value.providerTaskId };
          }
          const { error } = observed;
          if (observed.notDispatched) {
            throw new SubmissionNotDispatchedError(error instanceof Error ? error.message : String(error), observed.notDispatched);
          }
          // 只有「结果未知」才记进信封。确定的答复——供应商当场明确拒绝（收到了 4xx / 失败信封、没有任务号），或答了、结果在
          // 回答里但本机落地失败（落地门的正证据）——信封留在封好的状态（它没有「答了但没有任务号」这一态，耐久的结局记在
          // Run 的 job 上），由出口按同一个封闭结局落盘。
          if (submissionFailureOutcome(error, false) !== "unknown") throw error;
          prepared.envelope.markSubmittedUnknown();
          throw error;
        },
        afterDispatch: async (result, dispatchInput) => {
          prepared.envelope.markProviderAccepted({ providerTaskId: result.providerTaskId, rawReceipt });
          try {
            await deps.afterProviderAcceptance?.({ providerTaskId: result.providerTaskId, run: dispatchInput.run });
          } catch (error) {
            prepared.envelope.markSubmittedUnknown();
            throw error;
          }
        },
      });
      const result = await outbox.submit({
        projectId: run.projectId,
        runId: run.runId,
        jobId,
        approvalId: prepared.approvalId,
        planHash: prepared.authorizationDigest,
        costCeiling: prepared.costCeiling,
        currency: prepared.currency,
        leadingCommands: prepared.leadingCommands,
        acceptedCommands: (accepting) => [
          ...(accepting.generationPlan?.state === "submitted" ? [] : [{
            commandId: `generation.runtime:${accepting.runId}:plan-submit:v${accepting.planVersion}`,
            type: "generation.submit",
            payload: {},
            issuedAt: now(),
          }]),
          ...[singleShotRunningCommand(accepting, now)].filter((command) => command !== null),
        ],
      });
      run = result.run;
      if (run.generationPlan?.state !== "submitted") run = command(run, "generation.submit", {}, `plan-submit:v${run.planVersion}`);
      return { operationId: run.runId, runId: run.runId, jobId, providerTaskId: result.providerTaskId, attempt: lockedAttempt, nextAction: "observe" };
    });
  }

  async function poll(input: GenerationSubmissionStartInput): Promise<GenerationSubmissionPollResult> {
    const run = requiredRun(deps.repository, input.projectId, input.operationId);
    const { job, contract } = readGenerationExecution(deps.repository, run, input);
    if (!job?.providerTaskId) throw new SubmissionReconciliationRequiredError("A provider task id is required before polling");

    // A completed immutable execution is read from its receipt; do not poll or rewrite it again.
    const stored = envelope(run.runId, job.jobId).read();
    if (stored?.state === "materialized") return {
      operationId: run.runId, runId: run.runId, jobId: job.jobId, providerTaskId: job.providerTaskId,
      providerStatus: stored.lastPoll?.status ?? "succeeded", nextAction: "materialize",
    };
    // 这笔任务的模型 / 模式从冻结合同里读、随查询递下去：供应商实例是每次新建的，
    // 它自己内存里记的「这笔任务用的哪个模型」活不过观察窗重踢 / 重开项目 / 重启（见 GenerationProviderTaskContext）。
    const envelopeStore = envelope(run.runId, job.jobId);
    let observation: { status: string; raw?: unknown } | { error: unknown };
    try {
      const result = await adapter.query({ providerId: job.provider, providerTaskId: job.providerTaskId, context: { modelId: contract.modelId, mode: contract.mode, parameters: contract.parameters } });
      observation = { status: result.providerStatus, raw: result.raw };
    } catch (error) { observation = { error }; }
    if (!stored) throw new SubmissionReconciliationRequiredError("A runtime envelope is required before polling");
    const settled = await envelopeStore.markPolled({ observed: stored, ...observation }, (next) => {
      const current = requiredRun(deps.repository, input.projectId, input.operationId);
      const currentJob = current.jobs.find((candidate) => candidate.jobId === job.jobId)!;
      const providerStatus = next.lastPoll!.status;
      const statusClass = classifyProviderStatus(providerStatus);
      const observedAt = next.lastPoll!.observedAt;
      const statusChanged = currentJob.providerStatus !== providerStatus;
      const nextStatus = statusClass === "pending" ? "polling" : statusClass === "failed" || statusClass === "unknown" ? "needs_attention" : currentJob.status;
      const patch = { providerStatus, lastPollAt: observedAt,
        ...(statusChanged ? { lastVendorStateChangeAt: observedAt } : {}),
        ...(statusClass === "failed" ? { errorCode: "provider_task_failed", errorMessage: "供应商任务已返回失败状态" }
          : statusClass === "unknown" ? { errorCode: "provider_status_unknown", errorMessage: "供应商返回了未识别的任务状态，需要人工核对" } : {}),
      };
      if (statusClass !== "pending" || statusChanged || nextStatus !== currentJob.status) command(current, nextStatus === currentJob.status ? "job.patch" : "job.status", {
        jobId: currentJob.jobId, ...(nextStatus === currentJob.status ? { patch } : { status: nextStatus, patch }),
      }, `poll:${current.revision}:${providerStatus}`);
    });
    const providerStatus = settled.lastPoll?.status ?? "succeeded";
    const statusClass = classifyProviderStatus(providerStatus);
    return {
      operationId: run.runId,
      runId: run.runId,
      jobId: job.jobId,
      providerTaskId: job.providerTaskId,
      providerStatus,
      nextAction: statusClass === "pending" ? "poll" : statusClass === "succeeded" ? "materialize" : "attention",
    };
  }

  async function materialize(input: GenerationSubmissionStartInput): Promise<GenerationSubmissionMaterializeResult> {
    for (;;) {
      const run = requiredRun(deps.repository, input.projectId, input.operationId);
      const { job, contract } = readGenerationExecution(deps.repository, run, input);
      const jobId = job.jobId, providerTaskId = job.providerTaskId;
      if (!providerTaskId) throw new GenerationMaterializationError("A provider task id is required before materialization");
      const store = envelope(run.runId, jobId);
      const observed = store.read();
      const artifactFor = (current: ProductionRun) => current.artifacts.find((artifact) => artifact.jobId === jobId && ["image", "video", "audio"].includes(artifact.kind) && artifact.status === "ready" && artifact.contentHash);
      const resultFor = (artifact: ProductionArtifact): GenerationSubmissionMaterializeResult => ({ operationId: run.runId, runId: run.runId, jobId, providerTaskId, artifactId: artifact.artifactId, contentHash: artifact.contentHash!, nextAction: "completed" });
      /**
       * 已有 ready 产物的唯一出口。一次落地要写好几份记录（产物、job、信封），崩在任何两步之间都会留下半状态，
       * 所以产物一旦在账上，来的人就负责把 job 和信封补齐，再回话：不管崩在哪，下一次查都能收尾。
       */
      const settleWithArtifact = (artifact: ProductionArtifact, complete: () => void): GenerationSubmissionMaterializeResult => {
        let current = requiredRun(deps.repository, input.projectId, input.operationId);
        const behind = current.jobs.find((candidate) => candidate.jobId === jobId)!;
        // 停成「需要处理」的不能直达 ready，先回轮询（同一条可重放的边）。已取消 / 脱离的没有这条边，不补。
        if (behind.status === "needs_attention") current = command(current, "job.status", { jobId, status: "polling", patch: { errorCode: "", errorMessage: "" } }, `materialize-job-resume:${jobId}:${current.revision}`);
        if (behind.status === "needs_attention" || behind.status === "provider_accepted" || behind.status === "polling") command(current, "job.status", { jobId, status: "ready", patch: { lastPollAt: behind.lastPollAt } }, `materialize-job:${jobId}`);
        complete();
        return resultFor(artifact);
      };
      const existing = artifactFor(run);
      if (observed?.state === "materialized" && existing) return settleWithArtifact(existing, () => undefined);
      if (!observed?.providerTaskId || observed.state !== "provider_accepted") throw new GenerationMaterializationError("Provider acceptance is required before materialization");
      const polled = observed.lastPoll;
      if (!polled || isPendingProviderStatus(polled.status)) throw new GenerationMaterializationError("The provider task is still processing");
      if (isFailedProviderStatus(polled.status)) throw new GenerationMaterializationError("The provider task did not complete successfully");
      if (!isSuccessfulProviderStatus(polled.status)) throw new GenerationMaterializationError("The provider returned an unknown status; reconcile before materialization");
      let extraction: { outputs: readonly GenerationProviderOutput[] } | undefined;
      let extractionError: unknown;
      if (!existing) {
        try { extraction = await adapter.materialize({ providerId: job.provider, providerTaskId, raw: polled.raw, context: { modelId: contract.modelId, mode: contract.mode, parameters: contract.parameters } }); }
        catch (error) { extractionError = error; }
      }
      const settled = await store.withMaterialization(observed, async (currentEnvelope, complete, assertOwned) => {
        let current = requiredRun(deps.repository, input.projectId, input.operationId);
        const ready = artifactFor(current);
        if (ready) return settleWithArtifact(ready, complete);
        if (currentEnvelope.state === "materialized") throw new GenerationMaterializationError("Materialized runtime has no ready artifact receipt");
        const latestJob = current.jobs.find((candidate) => candidate.jobId === jobId)!;
        if (latestJob.status === "needs_attention") throw new GenerationMaterializationError(latestJob.errorMessage ?? "Output retrieval requires attention before continuing");
        const park = (patch: { errorCode: string; errorMessage: string }, failure: Error): never => {
          assertOwned();
          current = requiredRun(deps.repository, input.projectId, input.operationId);
          const currentJob = current.jobs.find((candidate) => candidate.jobId === jobId);
          if (currentJob && currentJob.status !== "needs_attention") command(current, "job.status", { jobId, status: "needs_attention", patch }, `retrieval-failed:${jobId}:${current.revision}`);
          throw failure;
        };
        const unsupported = (): never => park({ errorCode: "provider_materialization_unsupported", errorMessage: "This provider has no verified output materialization path" }, new GenerationMaterializationUnsupportedError());
        const failed = (detail: string): never => park({ errorCode: OUTPUT_RETRIEVAL_FAILED, errorMessage: tagNomiError("output-retrieval-failed", `The provider finished this shot, but Nomi could not retrieve the result: ${detail}`) }, new GenerationOutputRetrievalFailedError(detail));
        if (extractionError instanceof GenerationProviderObservationError) return unsupported();
        if (extractionError !== undefined) throw extractionError;
        if (!extraction || extraction.outputs.length !== 1) return failed(extraction?.outputs.length === 0 ? "Provider did not expose a materializable output" : "Single-shot generation returned more than one output");
        if (!deps.materializeOutput) return unsupported();
        let receipt: Awaited<ReturnType<NonNullable<typeof deps.materializeOutput>>>;
        try {
          assertOwned();
          receipt = await deps.materializeOutput({ projectId: input.projectId, operationId: run.runId, run: current, job: current.jobs.find((candidate) => candidate.jobId === jobId)!, contract, providerTaskId, output: extraction.outputs[0]! });
        } catch (error) {
          const readyAfterWait = artifactFor(requiredRun(deps.repository, input.projectId, input.operationId));
          if (readyAfterWait) return settleWithArtifact(readyAfterWait, complete);
          if (!deterministicRetrievalFailure(error)) throw error;
          return failed(error.message);
        }
        assertOwned();
        current = requiredRun(deps.repository, input.projectId, input.operationId);
        const readyAfterWait = artifactFor(current);
        if (readyAfterWait) return settleWithArtifact(readyAfterWait, complete);
        const artifactId = typeof receipt.artifactId === "string" ? receipt.artifactId.trim() : "";
        const contentHash = typeof receipt.contentHash === "string" ? receipt.contentHash.trim() : "";
        const projectRelativePath = typeof receipt.projectRelativePath === "string" ? receipt.projectRelativePath.trim() : "";
        if (!artifactId || !contentHash || !projectRelativePath) throw new GenerationMaterializationError("Asset store returned an incomplete materialization receipt");
        const artifact: ProductionArtifact = { artifactId, stageId: "generate", jobId, kind: receipt.kind, status: "ready", source: "external-mcp", contentHash, projectRelativePath,
          ...(receipt.thumbnailRelativePath ? { thumbnailRelativePath: receipt.thumbnailRelativePath } : {}), ...(receipt.previewState ? { previewState: receipt.previewState } : {}),
          ...(receipt.width && receipt.height ? { width: receipt.width, height: receipt.height } : {}), createdAt: now() };
        command(current, "artifact.add", { artifact }, `materialize-artifact:${artifact.artifactId}`);
        return settleWithArtifact(artifact, complete);
      });
      if (settled.kind === "result") return settled.value;
      // Observation changed while extracting: read the existing task's newest raw, never submit again.
    }
  }

  return { start, observeAccepted, poll, materialize };
}

export type ProductionGenerationSubmission = ReturnType<typeof createProductionGenerationSubmission>;
