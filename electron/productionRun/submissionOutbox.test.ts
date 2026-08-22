import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProductionRunRepository } from "./productionRunRepository";
import { productionRunPaths } from "./productionRunPaths";
import { createProductionRunIntentLog } from "./productionRunIntentLog";
import { createProductionRunLock } from "./productionRunLock";
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
      mode: "balanced",
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

  it("resumes safely when interrupted before dispatch", async () => {
    const repository = setup();
    const dispatch = vi.fn(async () => ({ providerTaskId: "provider-task-1" }));
    const interrupted = outbox({
      repository,
      dispatch,
      beforeDispatch: () => {
        throw new Error("crash before dispatch");
      },
    });

    await expect(interrupted.submit(request)).rejects.toThrow("crash before dispatch");
    expect(dispatch).not.toHaveBeenCalled();
    expect(repository.read("project-1", "run-1")?.jobs[0].status).toBe("submit_intent_persisted");

    await outbox({ repository, dispatch }).submit(request);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("retries only an explicitly known not-dispatched failure", async () => {
    const repository = setup();
    const dispatch = vi.fn()
      .mockRejectedValueOnce(new SubmissionNotDispatchedError("socket failed before write"))
      .mockResolvedValueOnce({ providerTaskId: "provider-task-1" });

    await outbox({ repository, dispatch }).submit(request);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0][0].idempotencyKey).toBe(dispatch.mock.calls[1][0].idempotencyKey);
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
