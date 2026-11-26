import { artifactFromMaterializationReceipt, type GenerationMaterializationReceipt, catchUpJobToArtifact, GenerationMaterializationUnsupportedError, GenerationMaterializationError, GenerationOutputRetrievalFailedError, deterministicRetrievalFailure, polledFailureMessage, classifyProviderStatus, isPendingProviderStatus, isSuccessfulProviderStatus, isFailedProviderStatus, type GenerationSubmissionMaterializeResult } from "./productionGenerationMaterialization";
import { addressedGenerationAttempt, readGenerationExecution, requiredGenerationContract } from "./productionGenerationHistory";
export { addressedGenerationAttempt } from "./productionGenerationHistory";
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
import { authorizationGateForJob } from "../shared/productionSpendAuthority";
import { DispatchConsentLapsedError, dispatchConsentOpen } from "../shared/productionDispatchConsent";
import { prepareProviderOrLandRefusal, type JobRefusalPatch } from "./productionProviderPreparation";
import { createProductionRunRuntimeEnvelope } from "./productionRunRuntimeEnvelope";
import { createProductionRunIntentLog } from "./productionRunIntentLog";
import { productionRunPaths } from "./productionRunPaths";
import { createProductionRunLock } from "./productionRunLock";
import type { ProductionRunRepository } from "./productionRunRepository";
import { observeSubmissionHandoffs } from "../outboundDispatchEvidence";
import {
  SubmissionNotDispatchedError,
  SubmissionReceiptUnknownError,
  SubmissionReconciliationRequiredError,
  createSubmissionOutbox,
  submissionFailureOutcome,
} from "./submissionOutbox";
import { ensureBinding, envelopeRefFor, sealedBindingFor } from "./productionGenerationBinding";
import { OUTPUT_RETRIEVAL_FAILED, type ProductionArtifact, type ProductionJob, type ProductionRun, type RunCommand } from "./productionRunTypes";
import { tagNomiError } from "../shared/nomiErrorCodes";
import { isReferenceFetchRefusal } from "../shared/assets/referenceFetchRefusal";
import { taskFailureMessageFromResponse } from "../tasks/responseParsing";
import { restoreEnvelopeAcceptance, singleShotRunningCommand } from "./singleShotRunLifecycle";
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
  rawReceipt?: unknown;
  nextAction: "observe";
};

export type GenerationSubmissionPollResult = {
  operationId: string;
  runId: string;
  jobId: string;
  providerTaskId: string;
  providerStatus: string;
  raw?: unknown;
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
    /** 这份产物在这一单全部产物里的序号（从 0 起）：同一单的第几份，产物号按它派生。 */
    outputIndex: number;
  }) => Promise<GenerationMaterializationReceipt>;
};

function requiredRun(repository: ProductionRunRepository, projectId: string, runId: string): ProductionRun {
  const run = repository.read(projectId, runId);
  if (!run) throw new Error(`Production run not found: ${runId}`);
  return run;
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
    return createProductionRunRuntimeEnvelope({ filePath: path.join(deps.projectRoot, envelopeRefFor(runId, jobId)), receiptKey: deps.intentMacKey });
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

    // Last check before any submission side effect; the only durable write allowed here is a definite pre-send refusal
    // landing the job on needs_attention (see productionProviderPreparation).
    const onRefusal = (patch: JobRefusalPatch) => existingJob.status === "authorized"
      && command(current, "job.status", { jobId, status: "needs_attention", patch }, `definite-send-refusal:${jobId}`);
    const providerPreparation = prepareProviderOrLandRefusal(adapter, contract, authorized, onRefusal);

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
    let existingJob = run.jobs.find((job) => job.jobId === jobId);
    if (existingJob?.status === "submitting") {
      const stored = envelope(run.runId, jobId).read();
      if (stored) {
        run = restoreEnvelopeAcceptance(deps.repository, run, existingJob, stored, now);
        existingJob = run.jobs.find((job) => job.jobId === jobId);
      }
    }
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
    const contract = requiredGenerationContract(run, shotId);
    const attempt = input.attempt ?? addressedGenerationAttempt(run, shotId);
    if (!Number.isInteger(attempt) || attempt < 1) throw new Error("Generation attempt is invalid");
    let jobId = productionGenerationJobId(run.runId, contract.contractHash, attempt, shotId);
    const existingJob = run.jobs.find((job) => job.jobId === jobId);
    // 没有任何一份授权（门）盖着的旧 job 只能看、不能再发：它的那一轮授权已经不在了。
    if (existingJob && !authorizationGateForJob(run, existingJob)) {
      throw new Error("Historical generation execution is observation-only");
    }
    if (existingJob && (existingJob.providerTaskId || existingJob.status === "submitting" && observeAccepted(input))) {
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
      const lockedContract = requiredGenerationContract(run, shotId);
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
        persistAcceptance: (receipt) => { prepared.envelope.markProviderAccepted({ providerTaskId: receipt.taskId, acceptance: receipt }); },
        afterDispatch: (result) => {
          prepared.envelope.markProviderAccepted({ providerTaskId: result.providerTaskId, rawReceipt });
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
      await deps.afterProviderAcceptance?.({ providerTaskId: result.providerTaskId, run });
      if (run.generationPlan?.state !== "submitted") run = command(run, "generation.submit", {}, `plan-submit:v${run.planVersion}`);
      return { operationId: run.runId, runId: run.runId, jobId, providerTaskId: result.providerTaskId, attempt: lockedAttempt, rawReceipt, nextAction: "observe" };
    });
  }

  async function poll(input: GenerationSubmissionStartInput): Promise<GenerationSubmissionPollResult> {
    let run = requiredRun(deps.repository, input.projectId, input.operationId);
    const execution = readGenerationExecution(deps.repository, run, input);
    const { contract } = execution;
    let job = execution.job;
    const stored = envelope(run.runId, job.jobId).read();
    if (stored && stored.contractHash !== contract.contractHash) throw new SubmissionReconciliationRequiredError("Run contract differs from the receipt");
    if (!job.providerTaskId && stored) {
      run = restoreEnvelopeAcceptance(deps.repository, run, job, stored, now);
      job = run.jobs.find(candidate => candidate.jobId === job.jobId)!;
    }
    if (!job.providerTaskId) throw new SubmissionReconciliationRequiredError("A provider task id is required before polling");
    if (!stored) throw new SubmissionReconciliationRequiredError("A runtime envelope is required before polling");
    if (stored.state === "materialized") return {
      operationId: run.runId, runId: run.runId, jobId: job.jobId, providerTaskId: job.providerTaskId,
      providerStatus: stored.lastPoll?.status ?? "succeeded", nextAction: "materialize",
    };
    // 这笔任务的模型 / 模式从冻结合同里读、随查询递下去：供应商实例是每次新建的，
    // 它自己内存里记的「这笔任务用的哪个模型」活不过观察窗重踢 / 重开项目 / 重启（见 GenerationProviderTaskContext）。
    const envelopeStore = envelope(run.runId, job.jobId);
    let observation: { status: string; raw?: unknown } | { error: unknown };
    try {
      const result = await adapter.query({ providerId: job.provider, providerTaskId: job.providerTaskId, context: { modelId: contract.modelId, mode: contract.mode, parameters: contract.parameters, acceptance: stored?.acceptance, rawReceipt: stored?.rawReceipt } });
      observation = { status: result.providerStatus, raw: result.raw };
    } catch (error) { observation = { error }; }
    const settled = await envelopeStore.markPolled({ observed: stored, ...observation }, (next) => {
      const current = requiredRun(deps.repository, input.projectId, input.operationId);
      const currentJob = current.jobs.find((candidate) => candidate.jobId === job.jobId)!;
      const providerStatus = next.lastPoll!.status;
      const statusClass = classifyProviderStatus(providerStatus);
      const observedAt = next.lastPoll!.observedAt;
      const statusChanged = currentJob.providerStatus !== providerStatus;
      const nextStatus = statusClass === "pending" ? "polling" : statusClass === "failed" || statusClass === "unknown" ? "needs_attention" : currentJob.status;
      const failure = statusClass === "failed" ? taskFailureMessageFromResponse(next.lastPoll!.raw, null) : "";
      const patch = { providerStatus, lastPollAt: observedAt,
        ...(statusChanged ? { lastVendorStateChangeAt: observedAt } : {}),
        ...(statusClass === "failed" ? { errorCode: "provider_task_failed", errorMessage: isReferenceFetchRefusal({ text: failure }) ? failure : polledFailureMessage(failure) }
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
      providerStatus, raw: settled.lastPoll?.raw,
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
      // 这一单账上已落的产物（按落账顺序）。一次出几张就落几份；第 k 份就是上游交回的第 k 份。
      const readyArtifacts = (current: ProductionRun) => current.artifacts.filter((artifact) => artifact.jobId === jobId && ["image", "video", "audio"].includes(artifact.kind) && artifact.status === "ready" && artifact.contentHash);
      const resultFor = (artifacts: readonly ProductionArtifact[]): GenerationSubmissionMaterializeResult => ({ operationId: run.runId, runId: run.runId, jobId, providerTaskId, artifactId: artifacts[0]!.artifactId, contentHash: artifacts[0]!.contentHash!, nextAction: "completed" });
      /**
       * 已有 ready 产物的唯一出口。一次落地要写好几份记录（产物、job、信封），崩在任何两步之间都会留下半状态，
       * 所以产物一旦在账上，来的人就负责把 job 和信封补齐，再回话：不管崩在哪，下一次查都能收尾。
       */
      const settleWithArtifacts = (artifacts: readonly ProductionArtifact[], complete: () => void): GenerationSubmissionMaterializeResult => {
        catchUpJobToArtifact(requiredRun(deps.repository, input.projectId, input.operationId), jobId, command);
        complete();
        return resultFor(artifacts);
      };
      const existing = readyArtifacts(run);
      if (observed?.state === "materialized" && existing.length) return settleWithArtifacts(existing, () => undefined);
      if (!observed?.providerTaskId || observed.state !== "provider_accepted") throw new GenerationMaterializationError("Provider acceptance is required before materialization");
      const polled = observed.lastPoll;
      if (!polled || isPendingProviderStatus(polled.status)) throw new GenerationMaterializationError("The provider task is still processing");
      if (isFailedProviderStatus(polled.status)) throw new GenerationMaterializationError("The provider task did not complete successfully");
      if (!isSuccessfulProviderStatus(polled.status)) throw new GenerationMaterializationError("The provider returned an unknown status; reconcile before materialization");
      // 账上已有几份也照样读一遍上游交回了几份：崩在两份之间时，按序号补齐没落的那几份（已落的不再取、不再落盘）。
      let extraction: { outputs: readonly GenerationProviderOutput[] } | undefined;
      let extractionError: unknown;
      try { extraction = await adapter.materialize({ providerId: job.provider, providerTaskId, raw: polled.raw, context: { acceptance: observed.acceptance, modelId: contract.modelId, mode: contract.mode, parameters: contract.parameters } }); }
      catch (error) { extractionError = error; }
      const settled = await store.withMaterialization(observed, async (currentEnvelope, complete, assertOwned) => {
        let current = requiredRun(deps.repository, input.projectId, input.operationId);
        const ready = readyArtifacts(current);
        // 账上已有的份数够了（或读不出更多）：收尾。读不出更多时已落的照收，和只有一份时「产物在账上就收尾」同一条。
        if (ready.length && (currentEnvelope.state === "materialized" || !extraction || ready.length >= extraction.outputs.length)) return settleWithArtifacts(ready, complete);
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
        if (!extraction || extraction.outputs.length === 0) return failed("Provider did not expose a materializable output");
        if (!deps.materializeOutput) return unsupported();
        const outputs = extraction.outputs;
        for (let outputIndex = ready.length; outputIndex < outputs.length; outputIndex += 1) {
          let receipt: Awaited<ReturnType<NonNullable<typeof deps.materializeOutput>>>;
          try {
            assertOwned();
            receipt = await deps.materializeOutput({ projectId: input.projectId, operationId: run.runId, run: current, job: current.jobs.find((candidate) => candidate.jobId === jobId)!, contract, providerTaskId, output: outputs[outputIndex]!, outputIndex });
          } catch (error) {
            const readyAfterWait = readyArtifacts(requiredRun(deps.repository, input.projectId, input.operationId));
            if (readyAfterWait.length >= outputs.length) return settleWithArtifacts(readyAfterWait, complete);
            if (!deterministicRetrievalFailure(error)) throw error;
            return failed(error.message);
          }
          assertOwned();
          current = requiredRun(deps.repository, input.projectId, input.operationId);
          const readyAfterWait = readyArtifacts(current);
          if (readyAfterWait.length >= outputs.length) return settleWithArtifacts(readyAfterWait, complete);
          if (readyAfterWait.length > outputIndex) continue;
          const artifact = artifactFromMaterializationReceipt(receipt, jobId, now());
          // 同一份文件（上游回了两条同一地址）只落一份账。
          if (readyAfterWait.some((landed) => landed.artifactId === artifact.artifactId)) continue;
          current = command(current, "artifact.add", { artifact }, `materialize-artifact:${artifact.artifactId}`);
        }
        return settleWithArtifacts(readyArtifacts(requiredRun(deps.repository, input.projectId, input.operationId)), complete);
      });
      if (settled.kind === "result") return settled.value;
      // Observation changed while extracting: read the existing task's newest raw, never submit again.
    }
  }

  return { start, observeAccepted, poll, materialize };
}

export type ProductionGenerationSubmission = ReturnType<typeof createProductionGenerationSubmission>;
