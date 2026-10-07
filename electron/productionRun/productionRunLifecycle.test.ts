import { describe, expect, it } from "vitest";

import { hasWorkToWatch, runWantsDriver, settleRunLifecycle } from "./productionRunLifecycle";
import type { ProductionJob, ProductionJobStatus, ProductionRun, ProductionRunStatus } from "./productionRunTypes";

// 生命周期 owner 的两条判据，按全部 Run 状态 × 全部 job 状态穷举（新加一个状态不表态，类型检查就红）：
//   · runWantsDriver：停稳了（已暂停 / 已取消 / 已完成）只在手上还有交给供应商、能去问的活时要人驱动；没停稳的都要。
//   · settleRunLifecycle：暂停中而手上已经没有交给供应商的活 → 落到 paused；别的状态从不自己挪。

const RUN_STATUSES: Record<ProductionRunStatus, "rest" | "moving"> = {
  draft: "moving", awaiting_direction: "moving", awaiting_script_review: "moving", awaiting_storyboard_review: "moving",
  awaiting_contract: "moving", ready: "moving", running: "moving", pausing: "moving", needs_attention: "moving",
  awaiting_rough_cut_review: "moving", awaiting_export: "moving", exporting: "moving",
  paused: "rest", cancelled: "rest", completed: "rest",
};

/** 交给了供应商、拿着任务号能去问的 job 状态；其余（没派 / 到了终态 / 结果待核对）都不算在飞。 */
const JOB_AT_PROVIDER: Record<ProductionJobStatus, boolean> = {
  planned: false, authorization_required: false, authorized: false, submit_intent_persisted: false,
  submitting: true, provider_accepted: true, polling: true, retry_wait: true, downloading: true,
  validating_technical: true, validating_content: true,
  ready: false, adopted: false, submission_unknown: false, reconciling: false, needs_attention: false,
  cancel_requested: false, cancelled_remote: false, detached: false, too_late: false,
};

const AT = "2026-10-07T00:00:00.000Z";

function job(status: ProductionJobStatus, providerTaskId?: string): ProductionJob {
  return { jobId: `job-${status}`, stageId: "generate", status, attempt: 1, provider: "apimart", model: "m", idempotencyKey: "k", ...(providerTaskId ? { providerTaskId } : {}), createdAt: AT, updatedAt: AT };
}

function run(status: ProductionRunStatus, jobs: ProductionJob[]): ProductionRun {
  return {
    schemaVersion: 1, runId: "run-1", projectId: "p", revision: 1, status, stageId: "generate",
    playbook: { name: "generation.single-shot", version: "1.0.0" }, origin: { host: "nomi" },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
    planVersion: 1, snapshotCursor: 0, stages: [], gates: [], artifacts: [], jobs,
    ...(status === "pausing" || status === "paused" || status === "cancelled" ? { stop: { reason: status === "cancelled" ? "user_cancelled" as const : "user_paused" as const, at: AT } } : {}),
    createdAt: AT, updatedAt: AT,
  };
}

describe("run lifecycle owner: who must keep watching, and when pausing settles", () => {
  it("runWantsDriver: every run status × every job status (with and without a provider task id)", () => {
    for (const status of Object.keys(RUN_STATUSES) as ProductionRunStatus[]) {
      expect(runWantsDriver(run(status, [])), `${status} with no jobs`).toBe(RUN_STATUSES[status] === "moving");
      for (const jobStatus of Object.keys(JOB_AT_PROVIDER) as ProductionJobStatus[]) {
        // 拿着任务号才能去问：没有任务号的同一状态不算（只能等重启恢复去核对）。
        const watched = JOB_AT_PROVIDER[jobStatus];
        expect(hasWorkToWatch(run(status, [job(jobStatus, "task-1")])), `${status}/${jobStatus}+task`).toBe(watched);
        expect(hasWorkToWatch(run(status, [job(jobStatus)])), `${status}/${jobStatus} no task`).toBe(false);
        expect(runWantsDriver(run(status, [job(jobStatus, "task-1")])), `${status}/${jobStatus}+task`).toBe(RUN_STATUSES[status] === "moving" || watched);
      }
    }
  });

  it("settleRunLifecycle: only pausing with nothing still at the provider settles, to paused, keeping the stop reason", () => {
    for (const status of Object.keys(RUN_STATUSES) as ProductionRunStatus[]) {
      for (const jobStatus of Object.keys(JOB_AT_PROVIDER) as ProductionJobStatus[]) {
        const step = settleRunLifecycle(run(status, [job(jobStatus, "task-1")]), AT);
        if (status === "pausing" && !JOB_AT_PROVIDER[jobStatus]) {
          expect(step?.run, `${status}/${jobStatus}`).toMatchObject({ status: "paused", stop: { reason: "user_paused" } });
        } else {
          expect(step, `${status}/${jobStatus}`).toBeNull();
        }
      }
    }
  });
});
