import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmissionIntent } from "./submissionIntent";
import { SubmissionNotDispatchedError } from "./submissionOutbox";
import { withResultLandingEvidence } from "../outboundDispatchEvidence";

vi.mock("electron", () => ({ app: { getPath: () => os.tmpdir(), getName: () => "Nomi" }, ipcMain: { on() {}, handle() {} } }));
const exec = promisify(execFile);
const scope = ["model-trial", "example", "model"];
const request = { vendor: "example", model: "model", kind: "text_to_image", prompt: "apple", params: {}, spendDecidedBy: "policy:full_auto" };
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "intent-matrix-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
const open = () => createSubmissionIntent({ root, scope });
const claim = () => {
  const claimed = open().claim(request);
  if (!claimed.owned) throw new Error("fixture did not own initial claim");
  return claimed;
};
async function anotherHost(prompt = "changed") {
  const { stdout } = await exec(process.execPath, [path.resolve("tests/fixtures/submission-intent-host.mjs"), root, prompt]);
  return JSON.parse(stdout);
}

describe("shared durable submission intent", () => {
  it.each(["authorized", "submitting", "unknown", "accepted", "retrieving", "materialized"])("%s: repeat, changed mode/params, another host and restart all return the original order", async (phase) => {
    const intent = open();
    const first = claim();
    let resolve!: (value: { id: string; status: string; assets: unknown[] }) => void;
    const dispatch = vi.fn(() => new Promise<{ id: string; status: string; assets: unknown[] }>((done) => { resolve = done; }));
    let submission: Promise<unknown> | undefined;
    if (phase !== "authorized") {
      submission = intent.submit(first, phase === "unknown" ? async () => { throw new Error("response lost"); } : dispatch);
      if (phase === "unknown") await expect(submission).rejects.toThrow(/unknown/i);
      else {
        // submitOnce yields at its admission boundary before dispatch.
        await Promise.resolve(); await Promise.resolve();
        if (["accepted", "retrieving", "materialized"].includes(phase)) {
          resolve({ id: "remote-job", status: "queued", assets: [] });
          await submission;
          if (phase === "retrieving") intent.recordResult(first.job.jobId, { id: "remote-job", status: "running", assets: [] });
          if (phase === "materialized") intent.recordResult(first.job.jobId, { id: "remote-job", status: "succeeded", assets: [{ type: "image", url: "file://fixture" }] });
        }
      }
    }
    const original = intent.read()!;
    const repeated = open().claim({ ...request, prompt: "different", kind: "image_to_video", params: { seed: 22 } });
    const restarted = open().read();
    const hosts = await Promise.all([anotherHost("codex"), anotherHost("claude"), anotherHost("restart")]);
    for (const host of hosts) {
      expect(host.owned).toBe(false);
      expect(host.receipt.intentId).toBe(original.intentId);
      expect(host.receipt.attemptId).toBe(original.attemptId);
      expect(host.receipt.allowedActions).toEqual(original.allowedActions);
    }
    expect(repeated.owned).toBe(false);
    expect(restarted?.attemptId).toBe(original.attemptId);
    expect(dispatch.mock.calls.length).toBeLessThanOrEqual(1);
    if (phase === "submitting") { resolve({ id: "late-job", status: "queued", assets: [] }); await submission; expect(open().read()?.taskId).toBe("late-job"); }
  });

  it("only a durable bounded safe-failure budget can retry; a third call cannot allocate", async () => {
    const intent = open();
    const first = claim();
    await expect(intent.submit(first, async () => { throw new SubmissionNotDispatchedError("never sent", "never_reached_network"); })).rejects.toThrow();
    const retry = open().claim(request);
    expect(retry.owned).toBe(true);
    if (!retry.owned) return;
    await expect(open().submit(retry, async () => { throw new SubmissionNotDispatchedError("never sent", "never_reached_network"); })).rejects.toThrow();
    expect(open().claim(request).owned).toBe(false);
    expect((await anotherHost()).owned).toBe(false);
    expect(open().read()?.allowedActions).not.toContain("retry");
  });

  it("a new-order request references the current attempt, forces human authorization, and replays idempotently", async () => {
    const intent = open();
    const first = claim();
    await expect(intent.submit(first, async () => { throw new Error("unknown"); })).rejects.toThrow();
    const next = open().claim({ ...request, spendDecidedBy: "user" }, first.job.jobId);
    expect(next.owned).toBe(true);
    if (!next.owned) return;
    expect(next.job.jobId).not.toBe(first.job.jobId);
    expect(open().claim(request, first.job.jobId).owned).toBe(false);
    await expect(intent.submit(next, async () => { throw new SubmissionNotDispatchedError("not authorized", "never_reached_network"); })).rejects.toThrow();
    const retry = open().claim(request);
    expect(retry.receipt.request?.spendDecidedBy).toBe("user");
    expect(open().read(first.job.jobId)?.accepted).toBe("unknown");
  });

  it("missing/corrupt persisted receipt fails closed; no new identity is inferred", () => {
    const first = claim();
    const base = path.join(root, ".nomi/runs", first.receipt.intentId, "jobs", first.job.jobId, "runtime.json");
    fs.writeFileSync(base, "broken");
    expect(() => open().claim(request)).toThrow(/corrupt/i);
  });

  it.each([
    { httpStatus: 400, taskIdReturned: false, envelopeFailure: false, retry: true },
    { httpStatus: 503, taskIdReturned: false, envelopeFailure: false, retry: false },
    { httpStatus: 409, taskIdReturned: false, envelopeFailure: false, retry: false },
    { httpStatus: 400, taskIdReturned: true, envelopeFailure: false, retry: false },
    { httpStatus: 200, taskIdReturned: false, envelopeFailure: true, retry: true },
  ])("only evidence of explicit rejection unlocks retry: $httpStatus / task=$taskIdReturned", async ({ retry, ...providerAnswer }) => {
    const intent = open();
    const first = claim();
    const error = Object.assign(new Error("provider response"), { providerAnswer });
    await expect(intent.submit(first, async () => { throw error; })).rejects.toThrow();
    expect(intent.read()?.allowedActions.includes("retry")).toBe(retry);
    expect(open().claim(request).owned).toBe(retry);
  });

  it("answered but landing failed is accepted evidence, never permission to resubmit", async () => {
    const intent = open();
    const first = claim();
    await expect(intent.submit(first, async () => { throw withResultLandingEvidence(new Error("disk write failed")); })).rejects.toThrow();
    expect(intent.read()?.accepted).toBe("accepted");
    expect(intent.read()?.allowedActions).not.toContain("retry");
    expect(open().claim(request).owned).toBe(false);
  });
});
