import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmissionIntent } from "./submissionIntent";
import { SubmissionNotDispatchedError } from "./submissionOutbox";
import { handOffToNetwork, withResultLandingEvidence } from "../outboundDispatchEvidence";

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

  it("an unreadable receipt fails closed without a bare error; only an explicit new order moves it aside, untouched", () => {
    const first = claim();
    const dir = path.join(root, ".nomi/runs", first.receipt.intentId);
    const base = path.join(dir, "jobs", first.job.jobId, "runtime.json");
    fs.writeFileSync(base, "broken");
    const plain = open().claim(request);
    expect(plain.owned).toBe(false);
    expect(plain.receipt).toMatchObject({ attemptId: first.job.jobId, accepted: "unknown", recordDamage: "receipt_unreadable",
      allowedActions: ["inspect_provider", "request_new_attempt"], newAttemptRequiresUserConfirmation: true });
    expect(fs.readFileSync(base, "utf8")).toBe("broken");
    const next = open().claim(request, first.job.jobId);
    if (!next.owned) throw new Error("the new order did not open");
    expect(next.job.jobId).toBe("attempt-r1-1");
    expect(next.receipt.request).toMatchObject({ spendDecidedBy: "user", priorOutcomeUnknown: true });
    expect(fs.readFileSync(path.join(root, ".nomi/intent-claims", first.receipt.intentId, "quarantine/r1/jobs", first.job.jobId, "runtime.json"), "utf8")).toBe("broken");
    expect(open().read()?.recordDamage).toBeUndefined();
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
    await expect(intent.submit(first, async () => { throw withResultLandingEvidence(new Error("disk write failed", { cause: Object.assign(new Error("download connection failed"), { code: "ECONNREFUSED" }) })); })).rejects.toThrow();
    expect(intent.read()?.accepted).toBe("accepted");
    expect(intent.read()?.allowedActions).not.toContain("retry");
    expect(open().claim(request).owned).toBe(false);
  });
  it("an accepted POST followed by a renderer-like message cannot prove that nothing was sent", async () => {
    const intent = createSubmissionIntent({ root, scope, networkTransport: "app-fetch" });
    const first = claim();
    await expect(intent.submit(first, async () => {
      await handOffToNetwork("https://example.invalid/create", { method: "POST" }, async () => undefined);
      throw new Error("RendererUnavailableError: Nomi 窗口");
    })).rejects.toThrow();
    expect(intent.read()?.accepted).toBe("unknown");
    expect(intent.read()?.allowedActions).not.toContain("retry");
    expect(open().claim(request).owned).toBe(false);
  });

});
