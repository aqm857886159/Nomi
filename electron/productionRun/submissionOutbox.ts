import { dedupeSubmission } from "../submissionLedger";
import { providerExplicitlyRejected, type NotDispatchedReason } from "../outboundDispatchEvidence";
import { matchNomiErrorCode, tagNomiError } from "../shared/nomiErrorCodes";
import { authorizeSubmission } from "./approvalPolicy";
import type { ProductionRunRepository } from "./productionRunRepository";
import type { ProductionRunIntentLog } from "./productionRunIntentLog";
import type { ProductionRunLock, ProductionRunLockLease } from "./productionRunLock";
import type { ProductionJob, ProductionRun, RunCommand } from "./productionRunTypes";

/**
 * 「这次提交确定没离开本机」——判据只在 `outboundDispatchEvidence.observeSubmissionHandoffs`，这里只是它的带类型结论。
 * `code` / `reason` 穿 IPC（`taskIpcGuard` 把带 code + reason 的错误编成结构化标记），渲染层按它说「没发出去」和为什么，
 * 不靠猜文案。`reason` 区分在本机被拦（`never_reached_network`）和连不上（`connect_failed`）：前者重发一次也一样，不自动重发。
 */
export class SubmissionNotDispatchedError extends Error {
  readonly code = "submission_not_sent" as const;
  readonly reason: NotDispatchedReason;

  constructor(message: string, reason: NotDispatchedReason) {
    super(message);
    this.name = "SubmissionNotDispatchedError";
    this.reason = reason;
  }
}

export class SubmissionReceiptUnknownError extends Error {
  constructor(message = "Provider submission receipt is unknown; reconciliation is required") {
    // 机器码标记让渲染层按「结果未知」说话，而不是按原始网络报错字面归成「连不上服务商 / 请求没发到」。
    super(matchNomiErrorCode(message) === "submission-unknown" ? message : tagNomiError("submission-unknown", message));
    this.name = "SubmissionReceiptUnknownError";
  }
}

export class SubmissionReconciliationRequiredError extends Error {
  constructor(message = "Submission reconciliation is required before another provider call") {
    super(message);
    this.name = "SubmissionReconciliationRequiredError";
  }
}

export class SubmissionAuthorizationError extends Error {
  constructor(reason: string) {
    super(`Production submission is not authorized: ${reason}`);
    this.name = "SubmissionAuthorizationError";
  }
}

export type SubmissionOutboxRequest = {
  projectId: string;
  runId: string;
  jobId: string;
  approvalId: string;
  planHash: string;
  costCeiling: number | null;
  currency: string;
  /** 要和预留一起、在交给供应商之前落盘的命令（这次执行的绑定）。 */
  leadingCommands?: ReadonlyArray<Omit<RunCommand, "expectedRevision">>;
  /** 供应商受理之后、和「已受理」同一次落盘的收尾命令（计划记成已交、单镜 Run 记成进行中），按受理前那一刻的 Run 算。 */
  acceptedCommands?: (run: ProductionRun) => ReadonlyArray<Omit<RunCommand, "expectedRevision">>;
};

export type ProviderDispatchInput = {
  run: ProductionRun;
  job: ProductionJob;
  idempotencyKey: string;
  /** `null` = 目录算不出价。绝不是 0 元。 */
  costCeiling: number | null;
};

export type ProviderDispatchResult = {
  providerTaskId: string;
};

export type SubmissionOutboxDependencies = {
  repository: ProductionRunRepository;
  dispatch: (input: ProviderDispatchInput) => Promise<ProviderDispatchResult>;
  /** Optional Run-owned durable claim. Legacy callers without it retain their existing behavior. */
  intentLog?: ProductionRunIntentLog;
  /** Optional cross-process fencing lease. The durable claim carries its epoch. */
  lock?: ProductionRunLock;
  /** Reuse an already-held Run lock; prevents nested acquisition in one-shot orchestration. */
  lockLease?: ProductionRunLockLease;
  now?: () => string;
  /**
   * 派发准入闸：在这次尝试的**第一笔耐久写**（预算预留 / 提交意向）之前调用，拿到的是还没落盘的 Run 与 job。
   * 抛错 = 这一镜这次不提交：什么都没写，job 原样停在原状态，没有要释放或对账的东西。
   * 生产里接的是镜头认领闸 `createProductionShotDispatchGuard`（画布接手 / 删节点 / 急停）。
   */
  beforeDispatch?: (input: ProviderDispatchInput) => void | Promise<void>;
  afterDispatch?: (result: ProviderDispatchResult, input: ProviderDispatchInput) => void | Promise<void>;
  /**
   * 「结果未知」的失败（请求可能已被收下）能不能用**同一个幂等键**重发一次。缺省 = 不能。
   * 只有供应商档案声明了 `submitIdempotency: true`、并且这类错误确实是连接层错误时才返回 true；
   * 供应商不认幂等键就重发，等于下第二张单。
   */
  canResendAfterUnknown?: (error: unknown, input: ProviderDispatchInput) => boolean;
};

export type SubmissionOutboxResult = ProviderDispatchResult & {
  run: ProductionRun;
};

function requiredRun(repository: ProductionRunRepository, projectId: string, runId: string): ProductionRun {
  const run = repository.read(projectId, runId);
  if (!run) throw new Error(`Production run not found: ${runId}`);
  return run;
}

function requiredJob(run: ProductionRun, jobId: string): ProductionJob {
  const job = run.jobs.find((value) => value.jobId === jobId);
  if (!job) throw new Error(`Production job not found: ${jobId}`);
  return job;
}

export function createSubmissionOutbox(deps: SubmissionOutboxDependencies) {
  const now = deps.now ?? (() => new Date().toISOString());
  const inflight = new Map();

  function jobCommand(
    request: SubmissionOutboxRequest,
    suffix: string,
    status: ProductionJob["status"],
    patch: Partial<ProductionJob> = {},
  ): ProductionRun {
    const run = requiredRun(deps.repository, request.projectId, request.runId);
    return deps.repository.execute(request.projectId, request.runId, {
      commandId: `${request.runId}:${request.jobId}:${requiredJob(run, request.jobId).attempt}:${suffix}`,
      expectedRevision: run.revision,
      type: "job.status",
      payload: { jobId: request.jobId, status, patch },
      issuedAt: now(),
    }).run;
  }

  function budgetCommand(request: SubmissionOutboxRequest, suffix: string, entry: Record<string, unknown>): ProductionRun {
    const run = requiredRun(deps.repository, request.projectId, request.runId);
    return deps.repository.execute(request.projectId, request.runId, {
      commandId: `${request.runId}:${request.jobId}:${requiredJob(run, request.jobId).attempt}:budget:${suffix}`,
      expectedRevision: run.revision,
      type: "budget.entry",
      payload: { entry },
      issuedAt: now(),
    }).run;
  }

  function markSubmissionUnknown(request: SubmissionOutboxRequest): ProductionRun {
    let run = requiredRun(deps.repository, request.projectId, request.runId);
    const job = requiredJob(run, request.jobId);
    if (job.status === "submitting") run = jobCommand(request, "submission-unknown", "submission_unknown");
    const reservationId = `${request.runId}:${request.jobId}:${job.attempt}`;
    const ledger = deps.repository.readBudgetLedger(request.projectId, request.runId);
    if (ledger.reservations[reservationId]?.status === "reserved") {
      run = budgetCommand(request, "mark-unsettled", {
        billingEntryId: `${reservationId}:mark-unsettled`,
        kind: "mark_unsettled",
        reservationId,
        occurredAt: now(),
      });
    }
    return run;
  }

  /**
   * 「供应商当场明确拒绝了这次提交」——和「没写出去」同属**确定**态：对方亲口说了不收，没有任务号，
   * 所以预留 provider-safe 地释放、job 落确定的 `needs_attention`（errorCode `provider_rejected`），可以正常重来，
   * 不交给人去供应商核对（2026-10-05 用户拍板，F3）。判据只在 `outboundDispatchEvidence.providerExplicitlyRejected`。
   */
  function markProviderRejected(request: SubmissionOutboxRequest, reason: string): ProductionRun {
    let run = requiredRun(deps.repository, request.projectId, request.runId);
    const job = requiredJob(run, request.jobId);
    if (job.status === "submitting" || job.status === "submit_intent_persisted") {
      run = jobCommand(request, "provider-rejected", "needs_attention", {
        errorCode: "provider_rejected",
        errorMessage: reason.slice(0, 512),
      });
    }
    const reservationId = `${request.runId}:${request.jobId}:${job.attempt}`;
    const ledger = deps.repository.readBudgetLedger(request.projectId, request.runId);
    if (ledger.reservations[reservationId]?.status === "reserved") {
      run = budgetCommand(request, "release-provider-rejected", {
        billingEntryId: `${reservationId}:release-provider-rejected`,
        kind: "release",
        reservationId,
        providerSafe: true,
        occurredAt: now(),
      });
    }
    return run;
  }

  /**
   * 「这次提交**一个字节都没写出去**」——确定态，不是未知态。
   *
   * 与 `markSubmissionUnknown` 的区别就是这条轴上的全部意义：unknown 说的是
   * 「供应商可能已经收下并开始扣费」，所以它把预留改成 `unsettled`（钱悬着）、
   * 把这一镜交给人工对账；而这里说的是「供应商那边什么都没发生」，
   * 所以预留可以 **provider-safe 地释放**（钱一分没花），job 落在 `needs_attention`
   * 这个**确定**的失败态上——它可以被正常重试路径重新授权，不需要任何人去供应商核对。
   *
   * 判据不在这里：它由 `outboundDispatchEvidence.ts` 一个人答，而且拿不出证据就算 unknown。
   */
  function markNotDispatched(request: SubmissionOutboxRequest, reason: string): ProductionRun {
    let run = requiredRun(deps.repository, request.projectId, request.runId);
    const job = requiredJob(run, request.jobId);
    if (job.status === "submitting" || job.status === "submit_intent_persisted") {
      run = jobCommand(request, "not-dispatched", "needs_attention", {
        errorCode: "provider_not_reached",
        errorMessage: reason,
      });
    }
    const reservationId = `${request.runId}:${request.jobId}:${job.attempt}`;
    const ledger = deps.repository.readBudgetLedger(request.projectId, request.runId);
    if (ledger.reservations[reservationId]?.status === "reserved") {
      run = budgetCommand(request, "release-not-dispatched", {
        billingEntryId: `${reservationId}:release-not-dispatched`,
        kind: "release",
        reservationId,
        providerSafe: true,
        occurredAt: now(),
      });
    }
    return run;
  }

  async function submitOnce(request: SubmissionOutboxRequest, fencingEpoch = 0): Promise<SubmissionOutboxResult> {
    let run = requiredRun(deps.repository, request.projectId, request.runId);
    const job = requiredJob(run, request.jobId);
    if (job.status === "provider_accepted" && job.providerTaskId) {
      return { providerTaskId: job.providerTaskId, run };
    }
    if (["submission_unknown", "reconciling", "needs_attention", "cancel_requested"].includes(job.status)) {
      throw new SubmissionReconciliationRequiredError();
    }
    if (job.status === "submitting") {
      markSubmissionUnknown(request);
      throw new SubmissionReconciliationRequiredError();
    }
    if (job.status !== "authorized" && job.status !== "submit_intent_persisted") {
      throw new Error(`Production job cannot be submitted from status: ${job.status}`);
    }

    const intentKey = `${request.runId}:${request.jobId}:${job.attempt}`;
    const committedIntent = deps.intentLog?.list().find((intent) => intent.key === intentKey && intent.status === "committed");
    if (committedIntent) {
      markSubmissionUnknown(request);
      throw new SubmissionReconciliationRequiredError();
    }

    const approval = deps.repository.readApprovals(request.projectId, request.runId)
      .find((value) => value.approvalId === request.approvalId);
    if (!approval) throw new SubmissionAuthorizationError("approval-not-found");
    const authorization = authorizeSubmission({
      approval,
      job,
      policy: run.policy,
      now: now(),
      planHash: request.planHash,
      originHost: run.origin.host,
      estimatedCost: request.costCeiling,
      currency: request.currency,
      runId: request.runId,
    });
    if (!authorization.ok) throw new SubmissionAuthorizationError(authorization.reason);
    // 2026-09-21：`costCeiling === null`（目录算不出价）不再是拒绝的理由。它当初存在是因为
    // 账本只收金额，未知只能落成 0 —— 那才是真正要防的事。现在预留自己带「未知」这一档
    // （`amount: null`），于是「不当 0」和「能生成」同时成立，这道拒绝没有剩余的合法用途。
    // 已知价那条硬上限由 `authorizeSubmission` + 账本 reserve 原样守着。

    // 准入闸排在**第一笔耐久写之前**：它看到的是这一镜还没被写成「提交中」的真实状态，一拒就什么都没写。
    // 以前它排在 submit_intent_persisted 之后，看到的永远是「制作已经在提交」（认领判据里的 in_flight），
    // 于是从来拒不了：急停之后同一轮里剩下的镜照样派发扣费（2026-09-29 #921 真额度验收）。
    await deps.beforeDispatch?.({ run, job, idempotencyKey: intentKey, costCeiling: request.costCeiling });

    // 预留 → 提交意向 → 提交中：三条命令、同样的命令号、同样的先后，**一次落盘**（发动机收敛第一刀第 3 步的性能尾巴；
    // 以前是三次完整落盘）。顺序与崩溃语义不变：这一批要么整体在盘上、要么整体不在，都发生在交给供应商之前。
    const reservationId = `${request.runId}:${request.jobId}:${job.attempt}`;
    const ledger = deps.repository.readBudgetLedger(request.projectId, request.runId);
    const commandPrefix = `${request.runId}:${request.jobId}:${job.attempt}`;
    // 准入闸是异步的：落这一批之前重读一次（别的写手可能刚落了一条，修订号以盘上为准）。
    run = requiredRun(deps.repository, request.projectId, request.runId);
    const current = requiredJob(run, request.jobId);
    const issuedAt = now();
    const preDispatch: Array<Omit<RunCommand, "expectedRevision">> = [...(request.leadingCommands ?? [])];
    if (!ledger.reservations[reservationId]) {
      preDispatch.push({ commandId: `${commandPrefix}:budget:reserve`, type: "budget.entry", issuedAt, payload: { entry: {
        billingEntryId: `${reservationId}:reserve`,
        kind: "reserve",
        reservationId,
        jobId: request.jobId,
        amount: request.costCeiling,
        occurredAt: issuedAt,
      } } });
    }
    if (current.status === "authorized") {
      preDispatch.push({ commandId: `${commandPrefix}:submit-intent`, type: "job.status", issuedAt, payload: { jobId: request.jobId, status: "submit_intent_persisted", patch: {} } });
    }
    preDispatch.push({ commandId: `${commandPrefix}:submitting`, type: "job.status", issuedAt, payload: { jobId: request.jobId, status: "submitting", patch: {} } });
    run = deps.repository.executeBatch(request.projectId, request.runId, run.revision, preDispatch).at(-1)!.run;
    const dispatchInput: ProviderDispatchInput = {
      run,
      job: requiredJob(run, request.jobId),
      idempotencyKey: intentKey,
      costCeiling: request.costCeiling,
    };

    const submitIntent = deps.intentLog?.prepare({
      runId: request.runId,
      kind: "provider.submit",
      key: intentKey,
      payload: {
        projectId: request.projectId,
        runId: request.runId,
        jobId: request.jobId,
        attempt: dispatchInput.job.attempt,
        provider: dispatchInput.job.provider,
        model: dispatchInput.job.model,
        idempotencyKey: dispatchInput.idempotencyKey,
      },
      fencingEpoch,
    });
    if (submitIntent) deps.intentLog!.commit(submitIntent.intentId, { fencingEpoch });

    let response: ProviderDispatchResult;
    // 所有尝试里**最不确定**的那一次说了算：只要有一次可能已被收下，最终就是「未知」，
    // 哪怕最后一次是「连不上」——那只说明第二次没发出去，第一次的下落仍然不明。
    let anyAttemptMayHaveReached = false;
    try {
      try {
        response = await deps.dispatch(dispatchInput);
      } catch (error) {
        // ── 自动重发只有两种情形，且合计最多一次（2026-10-02 修：此前连接被重置也算「没写出去」，重复下单）──
        //
        // ① **确定没写出去**（`SubmissionNotDispatchedError`：只认连上之前的失败，判据在
        //    `outboundDispatchEvidence.ts`）：供应商那边什么都没发生，重发一次不会变成第二张单。
        // ② **结果未知但供应商真支持幂等**（`canResendAfterUnknown`）：同一个键重发，供应商负责去重。
        // 其余一律不重发：连上之后的错误、超时、被掐断，供应商可能已经收下并扣费。
        // 不碰意图日志：这一次尝试的 `provider.submit` 意图已经 committed，它覆盖的正是
        // 「同一个 attempt、同一个幂等键」的这两次调用；崩溃恢复看到它仍然正确地说「未知」。
        const neverWritten = error instanceof SubmissionNotDispatchedError;
        // 在本机就被拦下的（出网策略、本机检查、密钥缺失……）是确定性的：原样再派一次只会再被拦一次。
        if (neverWritten && error.reason === "never_reached_network") throw error;
        if (!neverWritten && !deps.canResendAfterUnknown?.(error, dispatchInput)) throw error;
        if (!neverWritten) anyAttemptMayHaveReached = true;
        try {
          response = await deps.dispatch(dispatchInput);
        } catch (second) {
          if (anyAttemptMayHaveReached && second instanceof SubmissionNotDispatchedError) {
            throw new SubmissionReceiptUnknownError(error instanceof Error ? error.message : undefined);
          }
          throw second;
        }
      }
      if (!response.providerTaskId.trim()) throw new Error("Provider returned an empty task id");
      await deps.afterDispatch?.(response, dispatchInput);
      // 已受理 + 收尾一次落盘（发动机收敛第一刀第 3 步的性能尾巴：受理之后原来是三次整份落盘）。
      const accepting = requiredRun(deps.repository, request.projectId, request.runId);
      const accepted = deps.repository.executeBatch(request.projectId, request.runId, accepting.revision, [{
        commandId: `${request.runId}:${request.jobId}:${requiredJob(accepting, request.jobId).attempt}:provider-accepted`,
        type: "job.status",
        payload: { jobId: request.jobId, status: "provider_accepted", patch: { providerTaskId: response.providerTaskId } },
        issuedAt: now(),
      }, ...(request.acceptedCommands?.(accepting) ?? [])]);
      run = accepted.at(-1)!.run;
      return { ...response, run };
    } catch (error) {
      const recovered = requiredRun(deps.repository, request.projectId, request.runId);
      const recoveredJob = requiredJob(recovered, request.jobId);
      if (recoveredJob.status === "provider_accepted" && recoveredJob.providerTaskId) {
        return { providerTaskId: recoveredJob.providerTaskId, run: recovered };
      }
      // 能证明「一个字节都没写出去」的失败是**确定态**，不是未知态。此前这里是一个
      // catch-all：连不上、DNS 解不出、从池里取到一条对面已关的 keep-alive 连接，
      // 统统被记成「供应商可能已经接受任务，Nomi 不会自动重提」，于是一次根本没发生过的
      // 提交把这一镜永久冻在人工对账里（2026-09-18 C9 间歇红的根因第二层）。
      if (error instanceof SubmissionNotDispatchedError) {
        markNotDispatched(request, error.message);
        throw error;
      }
      // 只有**最后一次**尝试是明确拒绝、而且之前没有哪一次可能已被收下，才算确定没受理。
      if (!anyAttemptMayHaveReached && providerExplicitlyRejected(error)) {
        markProviderRejected(request, error instanceof Error ? error.message : String(error));
        throw error;
      }
      markSubmissionUnknown(request);
      throw new SubmissionReceiptUnknownError(error instanceof Error ? error.message : undefined);
    }
  }

  function submit(request: SubmissionOutboxRequest): Promise<SubmissionOutboxResult> {
    const key = `${request.projectId}:${request.runId}:${request.jobId}`;
    const execute = () => deps.lockLease
      ? (deps.lock?.assertOwned(deps.lockLease), submitOnce(request, deps.lockLease.fencingEpoch))
      : deps.lock
        ? deps.lock.withLock((lease) => submitOnce(request, lease.fencingEpoch))
        : submitOnce(request);
    return dedupeSubmission(inflight, key, execute, { ttlMs: 0 });
  }

  return { submit };
}

export type SubmissionOutbox = ReturnType<typeof createSubmissionOutbox>;
