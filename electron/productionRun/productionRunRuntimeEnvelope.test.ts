import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RuntimeEnvelopeConflictError,
  createProductionRunRuntimeEnvelope,
} from "./productionRunRuntimeEnvelope";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("ProductionRunRuntimeEnvelope", () => {
  it("seals a provider-neutral request durably and returns the same envelope after restart", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-runtime-envelope-"));
    tempDirs.push(dir);
    const input = {
      runId: "run-1",
      jobId: "job-1",
      runtimeTaskId: "task-1",
      contractHash: "a".repeat(64),
      providerIdempotencyKey: "run-1:job-1:attempt-1",
      requestFingerprint: "b".repeat(64),
      request: { providerId: "provider.image", modelId: "model.image.v1", prompt: "fox" },
    };
    const first = createProductionRunRuntimeEnvelope({ filePath: path.join(dir, "envelope.json"), now: () => "2026-08-23T00:00:00.000Z" });
    const sealed = first.seal(input);
    expect(sealed).toMatchObject({ state: "sealed", contractHash: input.contractHash, request: input.request });
    const restarted = createProductionRunRuntimeEnvelope({ filePath: path.join(dir, "envelope.json"), now: () => "2026-08-23T00:01:00.000Z" });
    expect(restarted.read()).toEqual(sealed);
    expect(restarted.seal(input)).toEqual(sealed);
    expect(restarted.seal({ ...input, request: { modelId: "model.image.v1", prompt: "fox", providerId: "provider.image" } })).toEqual(sealed);
  });

  it("rejects replacing a sealed contract and records provider acceptance before polling", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-runtime-envelope-"));
    tempDirs.push(dir);
    const envelope = createProductionRunRuntimeEnvelope({ filePath: path.join(dir, "envelope.json") });
    envelope.seal({
      runId: "run-1", jobId: "job-1", runtimeTaskId: "task-1", contractHash: "a".repeat(64),
      providerIdempotencyKey: "key-1", requestFingerprint: "b".repeat(64), request: { prompt: "fox" },
    });
    expect(() => envelope.seal({
      runId: "run-1", jobId: "job-1", runtimeTaskId: "task-1", contractHash: "c".repeat(64),
      providerIdempotencyKey: "key-1", requestFingerprint: "d".repeat(64), request: { prompt: "cat" },
    })).toThrow(RuntimeEnvelopeConflictError);
    const accepted = envelope.markProviderAccepted({ providerTaskId: "provider-task-1", rawReceipt: { id: "provider-task-1" } });
    expect(accepted).toMatchObject({ state: "provider_accepted", providerTaskId: "provider-task-1" });
    expect(envelope.read()).toEqual(accepted);
  });

  it("persists the latest provider observation without changing the sealed request", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-runtime-envelope-"));
    tempDirs.push(dir);
    const envelope = createProductionRunRuntimeEnvelope({ filePath: path.join(dir, "envelope.json"), now: () => "2026-08-23T00:02:00.000Z" });
    envelope.seal({
      runId: "run-1", jobId: "job-1", runtimeTaskId: "task-1", contractHash: "a".repeat(64),
      providerIdempotencyKey: "key-1", requestFingerprint: "b".repeat(64), request: { prompt: "fox" },
    });
    envelope.markProviderAccepted({ providerTaskId: "provider-task-1" });

    const observed = envelope.markPolled({ status: "processing", raw: { status: "processing", progress: 42 } });
    expect(observed).toMatchObject({
      state: "provider_accepted",
      providerTaskId: "provider-task-1",
      lastPoll: { status: "processing", raw: { progress: 42 }, observedAt: "2026-08-23T00:02:00.000Z" },
      request: { prompt: "fox" },
    });
    const restarted = createProductionRunRuntimeEnvelope({ filePath: path.join(dir, "envelope.json") });
    expect(restarted.read()).toEqual(observed);
  });
});

it("does not rewrite an unchanged pending observation but preserves terminal raw", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-idle-envelope-")); tempDirs.push(dir);
  let tick = 0;
  const filePath = path.join(dir, "envelope.json");
  const envelope = createProductionRunRuntimeEnvelope({ filePath, now: () => String(++tick) });
  envelope.seal({ runId: "run", jobId: "job", runtimeTaskId: "task", contractHash: "a", providerIdempotencyKey: "key", requestFingerprint: "b", request: {} });
  envelope.markProviderAccepted({ providerTaskId: "task" });
  envelope.markPolled({ status: "processing", raw: { percent: 1 } });
  const before = fs.readFileSync(filePath, "utf8");
  const writes = vi.spyOn(fs, "renameSync");
  try {
    for (let i = 0; i < 5; i++) envelope.markPolled({ status: "processing", raw: { percent: i } });
    expect(fs.readFileSync(filePath, "utf8")).toBe(before);
    expect(writes).not.toHaveBeenCalled();
    envelope.markPolled({ status: "succeeded", raw: { result: "first" } });
    envelope.markPolled({ status: "succeeded", raw: { result: "final" } });
    expect(envelope.read()?.lastPoll?.raw).toEqual({ result: "final" });
  } finally { writes.mockRestore(); }
});
