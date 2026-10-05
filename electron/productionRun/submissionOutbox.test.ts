import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProductionRunRepository } from "./productionRunRepository";
import { productionRunPaths } from "./productionRunPaths";
import { createProductionRunIntentLog } from "./productionRunIntentLog";
import { createProductionRunLock } from "./productionRunLock";
import type { RunCommand } from "./productionRunTypes";
import {
  SubmissionNotDispatchedError,
  SubmissionReceiptUnknownError,
  SubmissionReconciliationRequiredError,
  createSubmissionOutbox,
} from "./submissionOutbox";

let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-submission-outbox-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function setup() {
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => (projectId === "project-1" ? root : null),
    now: () => "2026-08-08T08:00:00.000Z",
    randomId: (() => {
      let id = 0;
      return () => `id-${++id}`;
    })(),
  });
  repository.create({
    runId: "run-1",
    projectId: "project-1",
    playbook: { name: "brand.promo", version: "1.0.0" },
    origin: { host: "codex" },
    brief: { goal: "submission outbox fixture" },
    policy: {
      trustedHosts: ["codex"],
      allowedProviders: ["tapcanvas"],
      allowedModels: ["seedance-1.0"],
      maxSpend: 20,
      maxAttemptsPerJob: 2,
    },
  });
  repository.execute("project-1", "run-1", {
    commandId: "setup-job",
    expectedRevision: 0,
    type: "job.add",
    payload: {
      job: {
        jobId: "job-1",
        stageId: "production",
        status: "authorized",
        attempt: 1,
        provider: "tapcanvas",
        model: "seedance-1.0",
        idempotencyKey: "run-1:job-1:1",
        createdAt: "2026-08-08T08:00:00.000Z",
        updatedAt: "2026-08-08T08:00:00.000Z",
      },
    },
    issuedAt: "2026-08-08T08:00:00.000Z",
  });
  repository.execute("project-1", "run-1", {
    commandId: "setup-approval",
    expectedRevision: 1,
    type: "approval.record",
    payload: {
      approval: {
        approvalId: "approval-1",
        runId: "run-1",
        scope: "job_set",
        planHash: "plan-1",
        jobIds: ["job-1"],
        allowedProviders: ["tapcanvas"],
        allowedModels: ["seedance-1.0"],
        currency: "CNY",
        maxSpend: 10,
        maxAttemptsPerJob: 2,
        decidedAt: "2026-08-08T08:00:00.000Z",
        expiresAt: "2026-08-08T09:00:00.000Z",
      },
    },
    issuedAt: "2026-08-08T08:00:00.000Z",
  });
  repository.execute("project-1", "run-1", {
    commandId: "setup-budget",
    expectedRevision: 2,
    type: "budget.entry",
    payload: {
      entry: {
        billingEntryId: "setup-budget",
        kind: "authorize",
        amount: 10,
        occurredAt: "2026-08-08T08:00:00.000Z",
      },
    },
    issuedAt: "2026-08-08T08:00:00.000Z",
  });
  return repository;
}

const request = {
  projectId: "project-1",
  runId: "run-1",
  jobId: "job-1",
  approvalId: "approval-1",
  planHash: "plan-1",
  costCeiling: 5,
  currency: "CNY",
};

function outbox(deps: Omit<Parameters<typeof createSubmissionOutbox>[0], "now">) {
  return createSubmissionOutbox({ ...deps, now: () => "2026-08-08T08:00:00.000Z" });
}

describe("SubmissionOutbox", () => {
  it("persists reservation and submit intent before provider dispatch", async () => {
    const repository = setup();
    const dispatch = vi.fn(async ({ idempotencyKey }: { idempotencyKey: string }) => {
      const run = repository.read("project-1", "run-1");
      expect(run?.jobs[0].status).toBe("submitting");
      expect(run?.budget.reserved).toBe(5);
      expect(idempotencyKey).toBe("run-1:job-1:1");
      return { providerTaskId: "provider-task-1" };
    });

    const result = await outbox({ repository, dispatch }).submit(request);

    expect(result.providerTaskId).toBe("provider-task-1");
    expect(repository.read("project-1", "run-1")?.jobs[0]).toMatchObject({
      status: "provider_accepted",
      providerTaskId: "provider-task-1",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  // 预留 → 提交意向 → 提交中是同一次落盘：进程在这一批写下之前倒下，盘上什么都没有（没有预留、没有提交意向），重来照常交一次。
  it("resumes safely when interrupted before the pre-dispatch batch is written", async () => {
    const repository = setup();
    const dispatch = vi.fn(async () => ({ providerTaskId: "provider-task-1" }));
    const crashing = {
      ...repository,
      executeBatch: (projectId: string, runId: string, expectedRevision: number, commands: ReadonlyArray<Omit<RunCommand, "expectedRevision">>) => {
        if (commands.some((command) => command.type === "job.status" && command.payload.status === "submitting")) throw new Error("crash before dispatch");
        return repository.executeBatch(projectId, runId, expectedRevision, commands);
      },
    };

    await expect(outbox({ repository: crashing, dispatch }).submit(request)).rejects.toThrow("crash before dispatch");
    expect(dispatch).not.toHaveBeenCalled();
    expect(repository.read("project-1", "run-1")?.jobs[0].status).toBe("authorized");
    expect(repository.readBudgetLedger("project-1", "run-1").reservations).toEqual({});

    await outbox({ repository, dispatch }).submit(request);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("the reservation, submit intent and submitting state land in one write before the provider is called; acceptance in one more", async () => {
    const repository = setup();
    const batches: string[][] = [];
    const observed = {
      ...repository,
      executeBatch: (projectId: string, runId: string, expectedRevision: number, commands: ReadonlyArray<Omit<RunCommand, "expectedRevision">>) => {
        batches.push(commands.map((command) => `${command.type}:${String(command.payload.status ?? (command.payload.entry as { kind?: string } | undefined)?.kind)}`));
        return repository.executeBatch(projectId, runId, expectedRevision, commands);
      },
    };
    const dispatch = vi.fn(async () => {
      expect(repository.read("project-1", "run-1")?.jobs[0].status).toBe("submitting");
      return { providerTaskId: "provider-task-1" };
    });
    await outbox({ repository: observed, dispatch }).submit(request);
    // 受理之后：「已受理」和收尾（这里没有收尾命令）也是一次落盘。
    expect(batches).toEqual([["budget.entry:reserve", "job.status:submit_intent_persisted", "job.status:submitting"], ["job.status:provider_accepted"]]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("asks the dispatch gate before anything is persisted; a refusal leaves no reservation and no submit intent", async () => {
    const repository = setup();
    const paths = productionRunPaths(root, "run-1");
    const intentLog = createProductionRunIntentLog({ filePath: paths.intents, macKey: "test-app-owned-key" });
    const dispatch = vi.fn(async () => ({ providerTaskId: "provider-task-1" }));
    const seen: Array<{ status: string | undefined; reservations: number; intents: number }> = [];
    let refuse = true;
    const beforeDispatch = () => {
      seen.push({
        status: repository.read("project-1", "run-1")?.jobs[0].status,
        reservations: Object.keys(repository.readBudgetLedger("project-1", "run-1").reservations).length,
        intents: intentLog.list().length,
      });
      if (refuse) throw Object.assign(new Error("production_shot_claimed: run_stopped"), { code: "production_shot_claimed" });
    };
    const gated = outbox({ repository, dispatch, intentLog, beforeDispatch });

    await expect(gated.submit(request)).rejects.toThrow("production_shot_claimed");
    expect(seen).toEqual([{ status: "authorized", reservations: 0, intents: 0 }]);
    const refused = repository.read("project-1", "run-1")!;
    expect(refused.jobs[0].status, "a refused attempt is never written as a submit intent").toBe("authorized");
    expect(refused.budget.reserved).toBe(0);
    expect(repository.readBudgetLedger("project-1", "run-1").reservations).toEqual({});
    expect(intentLog.list()).toHaveLength(0);
    expect(dispatch).not.toHaveBeenCalled();

    // 闸放行（例如用户点了「继续剩余」）：同一个 attempt 照常提交，只提交一次。
    refuse = false;
    await gated.submit(request);
    expect(seen[1]).toEqual({ status: "authorized", reservations: 0, intents: 0 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(repository.read("project-1", "run-1")?.jobs[0].status).toBe("provider_accepted");
  });

  it("确定没写出去 → 自动重发一次，幂等键逐字不变；用真实意图日志跑（生产形态）", async () => {
    const repository = setup();
    const paths = productionRunPaths(root, "run-1");
    const intentLog = createProductionRunIntentLog({ filePath: paths.intents, macKey: "test-app-owned-key" });
    const dispatch = vi.fn()
      .mockRejectedValueOnce(new SubmissionNotDispatchedError("socket failed before write"))
      .mockResolvedValueOnce({ providerTaskId: "provider-task-1" });

    await outbox({ repository, dispatch, intentLog }).submit(request);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0][0].idempotencyKey).toBe(dispatch.mock.calls[1][0].idempotencyKey);
    expect(repository.read("project-1", "run-1")?.jobs[0].status).toBe("provider_accepted");
    // 这一次尝试只有一条意图，且仍是 committed：它覆盖的就是同一个 attempt 的这两次调用。
    expect(intentLog.list()).toHaveLength(1);
    expect(intentLog.list()[0].status).toBe("committed");
  });

  it("重发也没写出去 → 落在确定态 needs_attention，预留被安全释放，且只重发一次", async () => {
    // 与下一条（收据丢了 → submission_unknown）是同一条轴的两端：
    // 「供应商那边什么都没发生」和「供应商可能已经收下」处置必须不同。
    const repository = setup();
    const dispatch = vi.fn().mockRejectedValue(new SubmissionNotDispatchedError("socket failed before write"));

    await expect(outbox({ repository, dispatch }).submit(request)).rejects.toBeInstanceOf(SubmissionNotDispatchedError);
    expect(dispatch).toHaveBeenCalledTimes(2);
    const run = repository.read("project-1", "run-1")!;
    expect(run.jobs[0].status).toBe("needs_attention");
    expect(run.jobs[0].errorCode).toBe("provider_not_reached");
    expect(run.budget).toMatchObject({ reserved: 0, unsettled: 0 });
  });

  it("turns a lost receipt into submission_unknown and never submits twice", async () => {
    const repository = setup();
    const dispatch = vi.fn(async () => ({ providerTaskId: "provider-task-1" }));
    const submissionOutbox = outbox({
      repository,
      dispatch,
      afterDispatch: () => {
        throw new Error("receipt persistence unavailable");
      },
    });

    await expect(submissionOutbox.submit(request)).rejects.toBeInstanceOf(SubmissionReceiptUnknownError);
    expect(repository.read("project-1", "run-1")?.jobs[0].status).toBe("submission_unknown");
    expect(repository.read("project-1", "run-1")?.budget).toMatchObject({ reserved: 0, unsettled: 5 });

    await expect(submissionOutbox.submit(request)).rejects.toBeInstanceOf(SubmissionReconciliationRequiredError);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("persists a Run-owned provider claim and refuses a restart resubmit after receipt loss", async () => {
    const repository = setup();
    const paths = productionRunPaths(root, "run-1");
    const intentLog = createProductionRunIntentLog({ filePath: paths.intents, macKey: "test-app-owned-key" });
    const firstDispatch = vi.fn(async () => ({ providerTaskId: "provider-task-1" }));
    const first = outbox({
      repository,
      dispatch: firstDispatch,
      intentLog,
      lock: createProductionRunLock({ filePath: paths.lock, epochPath: paths.lockEpoch, ownerId: "worker-a" }),
      afterDispatch: () => { throw new Error("crash after provider acceptance"); },
    });

    await expect(first.submit(request)).rejects.toBeInstanceOf(SubmissionReceiptUnknownError);
    expect(firstDispatch).toHaveBeenCalledTimes(1);
    expect(intentLog.list()).toHaveLength(1);
    expect(intentLog.list()[0].status).toBe("committed");

    const restartedDispatch = vi.fn(async () => ({ providerTaskId: "provider-task-2" }));
    const restarted = outbox({
      repository,
      dispatch: restartedDispatch,
      intentLog: createProductionRunIntentLog({ filePath: paths.intents, macKey: "test-app-owned-key" }),
      lock: createProductionRunLock({ filePath: paths.lock, epochPath: paths.lockEpoch, ownerId: "worker-b" }),
    });
    await expect(restarted.submit(request)).rejects.toBeInstanceOf(SubmissionReconciliationRequiredError);
    expect(restartedDispatch).not.toHaveBeenCalled();
  });

  it("coalesces concurrent process-local calls while durable state remains authoritative", async () => {
    const repository = setup();
    let release: (value: { providerTaskId: string }) => void = () => undefined;
    const dispatch = vi.fn(() => new Promise<{ providerTaskId: string }>((resolve) => { release = resolve; }));
    const submissionOutbox = outbox({ repository, dispatch });

    const first = submissionOutbox.submit(request);
    const second = submissionOutbox.submit(request);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    release({ providerTaskId: "provider-task-1" });

    await expect(first).resolves.toMatchObject({ providerTaskId: "provider-task-1" });
    await expect(second).resolves.toMatchObject({ providerTaskId: "provider-task-1" });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
