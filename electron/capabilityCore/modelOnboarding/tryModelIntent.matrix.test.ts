/** Class census, not one incident: every row, action, model and window comes from the fixture registry.
 * Real tryModel -> money gate -> runtime -> loopback POST; restart and race rows spawn fresh Node hosts.
 * Confirming and cancelling use the real renderer reply channel. Only Electron storage/UI and the provider are fixtures.
 * The oracle is what the loopback provider received, never what the tool says about itself.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, fork } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../dispatcher";
import { setRendererTarget, CAPABILITY_APPLY_REPLY_CHANNEL } from "../rendererBridge";
import { fetchTaskResult, runTask } from "../../runtime";
import { createSubmissionIntent } from "../../productionRun/submissionIntent";
import { SubmissionNotDispatchedError } from "../../productionRun/submissionOutbox";
import { UNCERTAIN_PRIOR_TRIAL_SPEND_INTENT } from "../../shared/contracts/modelTrialSpend";
import { tryModel, type TryModelDeps } from "./tryModel";

const ipc = vi.hoisted(() => new Map<string, (event: unknown, payload: unknown) => void>());
vi.mock("electron", async (original) => ({
  ...await original<Record<string, unknown>>(),
  ipcMain: { on: (channel: string, handler: (event: unknown, payload: unknown) => void) => ipc.set(channel, handler), handle() {}, removeHandler() {} },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^enc:/, "") },
}));

type Arguments = { modelKey: string; taskKind: string; prompt: string; params: Record<string, unknown>; vendorKey: string; newAttemptOf?: string };
type Submission = { intentId: string; attemptId: string; accepted: string; phase: string; allowedActions: string[]; newAttemptRequiresUserConfirmation: boolean; recordDamage?: string };
type Result = { ok: boolean; code?: string; submission: Submission; taskId?: string; nextAction?: unknown; message?: string; state?: { assets: unknown[] } };
type ProviderMode = "queued" | "unknown" | "succeeded" | "cancelled" | "rejected";
type Scenario = { id: string; label: string; initial: ProviderMode;
  repeat: Partial<Arguments>; host: "same" | "restart"; codes: string[]; creates: number; confirmations: number; sameOrder: boolean };
type RecordRow = { id: string; label: string; damage: Array<{ target: string; how: string }>; recordDamage: string | null; attemptId: string; newAttemptId: string;
  actions: "core" | "extended"; initial?: ProviderMode; code?: string; card?: "generic" };
type PolicyFlip = { id: string; label: string; first: "direct" | "request"; second: "direct" | "request"; windowOpen: boolean; cards: number; creates: number; code: string; decidedBy: string };
type HostOut = { owned: boolean; receipt: Submission & { request?: unknown }; jobId?: string; busy?: boolean; durableSteps?: number };
const registry = JSON.parse(fs.readFileSync(path.resolve("tests/fixtures/try-model-intent-matrix.json"), "utf8")) as {
  models: Array<{ modelKey: string; kind: string; taskKind: string; mediaField: string; mediaPath: string }>; cases: Scenario[];
  recordActions: Record<RecordRow["actions"], string[]>; records: RecordRow[];
  sharedClaims: Array<{ phase: string; host: "same-instance" | "new-instance" | "new-process" }>;
  windows: Array<{ id: string; label: string }>; actionWalk: string[]; policyFlips: PolicyFlip[];
};
const exec = promisify(execFile);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const code = (result: Result) => result.ok ? "succeeded" : result.code;
const sha = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");
function assertTrialResult(value: unknown): asserts value is Result {
  expect(value).toMatchObject({ ok: expect.any(Boolean), submission: {
    protocol: "try-model-intent-lock", intentId: expect.any(String), attemptId: expect.any(String),
    accepted: expect.stringMatching(/^(unknown|accepted|not_sent)$/), allowedActions: expect.any(Array),
    newAttemptRequiresUserConfirmation: true,
  } });
  if (value && typeof value === "object" && "ok" in value && value.ok === true) {
    expect(value).toMatchObject({ state: { assets: expect.any(Array) } });
    expect(value).toHaveProperty("state.assets.0");
  }
}

describe("model trial intent class matrix", () => {
  let server: http.Server;
  let origin: string;
  let root: string;
  let settings: string;
  let initial: ProviderMode;
  let pollStatus: "queued" | "completed";
  let creates = 0;
  let queries = 0;
  let confirmations = 0;
  /** The intent of every money card the real gate asked the renderer to show, in order. */
  let cards: string[] = [];
  let vendorKey: string;

  const appRoot = () => path.join(settings, "app-executions");
  const runDir = (intentId: string) => path.join(appRoot(), ".nomi/runs", intentId);
  const claimDir = (intentId: string) => path.join(appRoot(), ".nomi/intent-claims", intentId);
  const quarantine = (intentId: string, generation = 1) => path.join(claimDir(intentId), "quarantine", `r${generation}`);
  const argsFor = (): Arguments => ({ vendorKey, modelKey: registry.models[0].modelKey, taskKind: registry.models[0].taskKind, prompt: "apple", params: {} });
  const scope = () => ["model-trial", vendorKey, registry.models[0].modelKey];
  const deps = (extra: Partial<TryModelDeps> = {}): TryModelDeps => ({ runTask, pollTimeoutMs: 2000, approvalPolicy: () => ({ mode: "direct" }), ...extra });
  async function trial(input: Arguments, extra: Partial<TryModelDeps> = {}): Promise<Result> {
    const result: unknown = await tryModel(deps(extra), input);
    assertTrialResult(result);
    return result;
  }
  async function restartedTrial(input: Arguments): Promise<Result> {
    const result: unknown = JSON.parse((await exec(process.execPath, [path.resolve("tests/fixtures/try-model-intent-restart.mjs"), settings, JSON.stringify(input)])).stdout);
    assertTrialResult(result);
    return result;
  }
  function answerCards(confirmed: boolean) {
    setRendererTarget({ id: 42, mainFrame: { routingId: 1 }, isDestroyed: () => false,
      getURL: () => "http://127.0.0.1:5273/index.html", send: (_channel: string, message: { id: number; payload: { intent?: string } }) => {
        confirmations += 1;
        cards.push(message.payload.intent ?? "");
        queueMicrotask(() => ipc.get(CAPABILITY_APPLY_REPLY_CHANNEL)?.(
          { sender: { id: 42 }, senderFrame: { routingId: 1, url: "http://127.0.0.1:5273/index.html" } },
          { id: message.id, ok: true, result: { confirmed } }));
      } } as never);
  }
  function treeOf(target: string): Record<string, string> {
    if (!fs.existsSync(target)) return {};
    if (fs.statSync(target).isFile()) return { "": sha(fs.readFileSync(target)) };
    const out: Record<string, string> = {};
    for (const name of fs.readdirSync(target)) {
      for (const [relative, digest] of Object.entries(treeOf(path.join(target, name)))) out[path.join(name, relative)] = digest;
    }
    return out;
  }
  const frozenRequest = (intentId: string, attemptId: string) =>
    (JSON.parse(fs.readFileSync(path.join(runDir(intentId), "jobs", attemptId, "runtime.json"), "utf8")) as { request: { spendDecidedBy?: string; priorOutcomeUnknown?: boolean } }).request;
  /** A file nobody has touched for a whole lease, so no writer can be in the middle of it. */
  const ageOut = (file: string) => { const longAgo = new Date(Date.now() - 3_600_000); fs.utimesSync(file, longAgo, longAgo); };
  function liveLease(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, ownerId: "another-process", pid: 1, acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(), fencingEpoch: 1, nonce: "held" }));
  }
  /** What another boot finds once a crashed owner's lease ran out. */
  function expireLease(file: string) {
    if (!fs.existsSync(file)) return;
    try {
      const lease = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      if (typeof lease !== "object" || !lease) throw new Error("not a lease");
      fs.writeFileSync(file, JSON.stringify({ ...lease, expiresAt: new Date(Date.now() - 1000).toISOString() }));
    } catch { ageOut(file); }
  }
  function damage(intentId: string, target: string, how: string) {
    const dir = runDir(intentId);
    const file = ({ snapshot: path.join(dir, "run.json"), events: path.join(dir, "events.ndjson"), runtime: path.join(dir, "jobs/attempt-1/runtime.json"),
      jobs: path.join(dir, "jobs"), approvals: path.join(dir, "approvals.ndjson"), budget: path.join(dir, "budget-ledger.ndjson"), commands: path.join(dir, "commands.ndjson"),
      repositoryLock: path.join(dir, "repository.lock"), claimLock: path.join(claimDir(intentId), "claim.lock"), claimEpoch: path.join(claimDir(intentId), "claim.lock.epoch"),
      runDir: dir } as Record<string, string>)[target];
    const lines = () => fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const rewriteLines = (edit: (row: Record<string, unknown>) => unknown) =>
      fs.writeFileSync(file, `${lines().map((line) => JSON.stringify(edit(JSON.parse(line) as Record<string, unknown>))).join("\n")}\n`);
    const withoutVersion = ({ schemaVersion: _gone, ...rest }: Record<string, unknown>) => rest;
    switch (how) {
      case "missing": fs.rmSync(file, { recursive: true, force: true }); return;
      case "truncated": { const bytes = fs.readFileSync(file); fs.writeFileSync(file, bytes.subarray(0, bytes.length - 20)); return; }
      case "garbled": fs.writeFileSync(file, "\u0000garbled{{{\n"); return;
      case "emptied": fs.writeFileSync(file, ""); return;
      case "lost-tail": fs.writeFileSync(file, `${lines().slice(0, -1).join("\n")}\n`); return;
      case "draft-only": fs.writeFileSync(file, `${lines()[0]}\n`); return;
      case "dead-lock": fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "garbled"); ageOut(file); return;
      case "file-instead": fs.rmSync(file, { recursive: true, force: true }); fs.writeFileSync(file, "garbled"); return;
      case "old-shape":
        if (file.endsWith(".ndjson")) rewriteLines(withoutVersion);
        else fs.writeFileSync(file, JSON.stringify(withoutVersion(JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>)));
        return;
      case "future-shape":
        if (file.endsWith(".ndjson")) { rewriteLines((row) => ({ ...row, schemaVersion: 99 })); return; }
        {
          const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { snapshotCursor: number; run: unknown };
          const value = { schemaVersion: 99, snapshotCursor: raw.snapshotCursor, run: raw.run };
          fs.writeFileSync(file, JSON.stringify({ ...value, checksum: sha(JSON.stringify(value)) }));
        }
        return;
      default: throw new Error(`Unknown damage: ${how}`);
    }
  }
  /** A new process claims through the shared layer. It can be released at a barrier, or told to die mid-claim. */
  function hostProcess(hostRoot: string, options: Record<string, unknown>) {
    const child = fork(path.resolve("tests/fixtures/submission-intent-host.mjs"), [hostRoot, "another host", JSON.stringify(options)], { silent: true, execArgv: [] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    const ready = new Promise<void>((resolve) => child.once("message", () => resolve()));
    const done = new Promise<{ exitCode: number | null; out?: HostOut; stderr: string }>((resolve) => child.once("close", (exitCode) =>
      resolve({ exitCode, out: stdout ? JSON.parse(stdout) as HostOut : undefined, stderr })));
    return { ready, done, go: () => child.send("go") };
  }
  async function raceTwoHosts(hostRoot: string, options: Record<string, unknown>) {
    const hosts = [hostProcess(hostRoot, { ...options, barrier: true, waitBusyMs: 15_000 }), hostProcess(hostRoot, { ...options, barrier: true, waitBusyMs: 15_000 })];
    await Promise.all(hosts.map((host) => host.ready));
    for (const host of hosts) host.go();
    const results = await Promise.all(hosts.map((host) => host.done));
    for (const result of results) expect(result.exitCode, result.stderr).toBe(0);
    return results.map((result) => result.out!);
  }
  async function freshSettings() {
    settings = fs.mkdtempSync(path.join(root, "case-"));
    vi.stubEnv("NOMI_SETTINGS_DIR", settings);
    creates = 0; queries = 0; confirmations = 0; cards = []; pollStatus = "queued";
    setRendererTarget(null);
    const docs = "https://example.invalid/trial-contract";
    const configured = await dispatch("model.onboarding.setup", { action: "submit_declaration", name: "Intent matrix",
      declaration: JSON.stringify({ provider: { baseUrl: origin, authType: "bearer", authHeader: "Authorization", authScheme: "Bearer" },
        sources: [{ url: docs, evidence: "One POST creates one job; completed jobs contain image.url." }], assetIngestion: { strategy: "none", sourceUrl: docs },
        models: registry.models.map((model) => ({ modelKey: model.modelKey, labelZh: model.modelKey, kind: model.kind,
          modes: [{ taskKind: model.taskKind, delivery: "asynchronous", create: { method: "POST", path: "/jobs",
            body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}" }, response_mapping: { task_id: "id", status: "status", [model.mediaField]: model.mediaPath },
            provider_meta_mapping: { task_id: "id" } },
            query: { method: "GET", path: "/jobs/{{providerMeta.task_id}}", response_mapping: { task_id: "id", status: "status", [model.mediaField]: model.mediaPath } },
            statusMapping: { succeeded: ["completed"], failed: ["failed"] }, sourceUrls: [docs] }] })) }),
    }, { origin: { host: "claude" } } as never) as { ok: boolean; vendorKey: string };
    expect(configured.ok, JSON.stringify(configured)).toBe(true);
    vendorKey = configured.vendorKey;
    const keyed = await dispatch("model.onboarding.setup", { action: "set_key", vendorKey, apiKey: "matrix-fake-key" }, { origin: { host: "claude" } } as never) as { ok: boolean };
    expect(keyed.ok).toBe(true);
  }

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "try-intent-class-"));
    server = http.createServer((request, response) => {
      if (request.url === "/image.png") { response.writeHead(200, { "content-type": "image/png" }); response.end(PNG); return; }
      if (request.method === "POST" && request.url === "/jobs") {
        let body = "";
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
          creates += 1;
          if (initial === "unknown" && JSON.parse(body).model === registry.models[0].modelKey) { request.socket.destroy(); return; }
          if (initial === "rejected") { response.writeHead(400, { "content-type": "application/json" }); response.end(JSON.stringify({ error: { message: "bad parameter" } })); return; }
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ id: `job-${creates}`, status: initial === "succeeded" ? "completed" : "queued",
            ...(initial === "succeeded" ? { image: { url: `${origin}/image.png` } } : {}) }));
        });
        return;
      }
      if (request.method === "GET" && request.url?.startsWith("/jobs/")) {
        queries += 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: request.url.slice("/jobs/".length), status: pollStatus,
          ...(pollStatus === "completed" ? { image: { url: `${origin}/image.png` } } : {}) }));
        return;
      }
      response.writeHead(404).end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  beforeEach(async () => { await freshSettings(); });
  afterEach(() => { setRendererTarget(null); });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(registry.cases)("$id: $label", async (scenario) => {
    initial = scenario.initial;
    const args = argsFor();
    if (initial === "cancelled") answerCards(false);
    const first = await trial(args, { approvalPolicy: () => ({ mode: initial === "cancelled" ? "request" : "direct" }) });
    expect(code(first), JSON.stringify(first)).toBe(scenario.codes[0]);
    const repeated: Result[] = [];
    for (const expected of scenario.codes.slice(1)) {
      const input = { ...args, ...scenario.repeat };
      const result = scenario.host === "restart" ? await restartedTrial(input) : await trial(input);
      repeated.push(result);
      expect(code(result), JSON.stringify(result)).toBe(expected);
    }
    expect(creates, `${scenario.id}: actual provider orders`).toBe(scenario.creates);
    expect(confirmations, `${scenario.id}: real money-gate decisions`).toBe(scenario.confirmations);
    for (const result of repeated) {
      if (scenario.sameOrder) {
        expect(result.submission).toEqual(first.submission);
        if (first.ok) expect(result.state?.assets).toEqual(first.state?.assets);
      } else if (scenario.initial === "cancelled") {
        expect(result.submission.intentId).toBe(first.submission.intentId);
        expect(result.submission.attemptId).toBe("attempt-2");
        expect(result.submission.accepted).toBe("not_sent");
      } else {
        expect(result.submission.intentId).not.toBe(first.submission.intentId);
      }
    }
    if (initial === "cancelled") expect(repeated.at(-1)?.submission.allowedActions).not.toContain("retry");
  });

  describe("a record that cannot be read: records x actions", () => {
    const CELLS = registry.records.flatMap((row) => registry.recordActions[row.actions].map((action) => ({ ...row, action })));
    const nextAttempt = (attemptId: string) => attemptId.replace(/\d+$/, (n) => String(Number(n) + 1));

    async function recordFor(row: RecordRow) {
      initial = row.initial ?? "unknown";
      const first = await trial(argsFor());
      const intentId = first.submission.intentId;
      for (const { target, how } of row.damage) damage(intentId, target, how);
      // From here on the provider answers, so a confirmed new order reaches a real result.
      initial = "queued";
      return { intentId, before: treeOf(runDir(intentId)), orders: creates };
    }
    function expectObserved(row: RecordRow, result: Result) {
      expect(code(result), JSON.stringify(result)).toBe(row.code ?? "submission_unknown");
      expect(result.submission.attemptId).toBe(row.attemptId);
      expect(result.submission.newAttemptRequiresUserConfirmation).toBe(true);
      if (!row.recordDamage) { expect(result.submission.recordDamage).toBeUndefined(); return; }
      expect(result.submission).toMatchObject({ accepted: "unknown", phase: "submission_unknown", recordDamage: row.recordDamage,
        allowedActions: ["inspect_provider", "request_new_attempt"] });
      expect(result.nextAction).toContain(`newAttemptOf=${row.attemptId}`);
      // What can still be read stays visible: the task number goes to the user even though Nomi can no longer query it.
      if (row.initial === "queued" && row.attemptId.startsWith("attempt-")) expect(result.taskId).toMatch(/^job-/);
    }
    const expectedCard = (row: RecordRow) => row.card === "generic" ? "generation" : UNCERTAIN_PRIOR_TRIAL_SPEND_INTENT;
    function expectFrozenAsHumanDecision(row: RecordRow, intentId: string, attemptId: string) {
      const request = frozenRequest(intentId, attemptId);
      expect(request.spendDecidedBy).toBe("user");
      if (row.card === "generic") expect(request.priorOutcomeUnknown).toBeUndefined();
      else expect(request.priorOutcomeUnknown).toBe(true);
    }
    function expectBadRecordKept(row: RecordRow, intentId: string, before: Record<string, string>) {
      if (row.recordDamage) expect(treeOf(quarantine(intentId)), "the moved record is byte for byte the bad one").toEqual(before);
      else expect(fs.existsSync(path.join(claimDir(intentId), "quarantine")), "a readable record stays in place").toBe(false);
    }

    it.each(CELLS)("$id x $action: $label", async (cell) => {
      const { intentId, before, orders } = await recordFor(cell);
      const args = argsFor();
      // Observing an accepted order may record a poll on it; the bad bytes are what must not move.
      const expectUntouched = () => { if (cell.recordDamage || !cell.initial) expect(treeOf(runDir(intentId))).toEqual(before); };
      const observe = async (input: Arguments = args) => {
        const result = await trial(input);
        expectObserved(cell, result);
        expect(creates, "a plain call never places an order, including in full-auto").toBe(orders);
        expect(cards, "a plain call asks nobody").toEqual([]);
        return result;
      };
      switch (cell.action) {
        case "plain":
          await observe();
          expectUntouched();
          return;
        case "changed-arguments":
          await observe({ ...args, prompt: "a different apple", params: { seed: 17 } });
          expectUntouched();
          return;
        case "restart": {
          const result = await restartedTrial(args);
          expectObserved(cell, result);
          expect(creates).toBe(orders);
          expectUntouched();
          return;
        }
        case "new-confirmed":
        case "new-full-auto": {
          const plain = await observe();
          answerCards(true);
          const opened = await trial({ ...args, newAttemptOf: plain.submission.attemptId },
            cell.action === "new-confirmed" ? { approvalPolicy: () => ({ mode: "request" }) } : {});
          expect(code(opened), JSON.stringify(opened)).toBe("still_processing");
          expect(opened.submission.attemptId).toBe(cell.newAttemptId);
          expect(opened.submission.recordDamage).toBeUndefined();
          expect(creates, "exactly one more order").toBe(orders + 1);
          expect(cards, "a person confirmed it, on the card that says what is uncertain").toEqual([expectedCard(cell)]);
          expectFrozenAsHumanDecision(cell, intentId, cell.newAttemptId);
          expectBadRecordKept(cell, intentId, before);
          return;
        }
        case "new-rejected": {
          const plain = await observe();
          answerCards(false);
          const declined = await trial({ ...args, newAttemptOf: plain.submission.attemptId });
          expect(code(declined), JSON.stringify(declined)).toBe("needs_input");
          expect(declined.submission.attemptId).toBe(cell.newAttemptId);
          expect(declined.submission.accepted).toBe("not_sent");
          expect(creates).toBe(orders);
          expect(cards).toEqual([expectedCard(cell)]);
          expectBadRecordKept(cell, intentId, before);
          // Full-auto does not get to answer what the person just declined; the safe retry asks them again.
          const retried = await trial(args);
          expect(code(retried), JSON.stringify(retried)).toBe("needs_input");
          expect(retried.submission.attemptId).toBe(nextAttempt(cell.newAttemptId));
          expect(cards).toEqual([expectedCard(cell), expectedCard(cell)]);
          expectFrozenAsHumanDecision(cell, intentId, retried.submission.attemptId);
          const exhausted = await trial(args);
          expect(code(exhausted)).toBe("provider_failed");
          expect(exhausted.submission.allowedActions).not.toContain("retry");
          expect(cards).toHaveLength(2);
          expect(creates).toBe(orders);
          return;
        }
        case "new-window-closed": {
          const plain = await observe();
          setRendererTarget(null);
          const unanswered = await trial({ ...args, newAttemptOf: plain.submission.attemptId });
          expect(code(unanswered), JSON.stringify(unanswered)).toBe("needs_input");
          expect(unanswered.submission.attemptId).toBe(cell.newAttemptId);
          expect(creates).toBe(orders);
          expectBadRecordKept(cell, intentId, before);
          return;
        }
        default: throw new Error(`Unregistered action: ${cell.action}`);
      }
    }, 60_000);
  });

  describe("shared claim: one order, whichever host asks", () => {
    const request = { vendor: "example", model: "model", kind: "text_to_image", prompt: "apple", params: {}, spendDecidedBy: "policy:full_auto" };
    const changed = { ...request, prompt: "different", kind: "image_to_video", params: { seed: 22 } };

    it.each(registry.sharedClaims)("$phase x $host", async ({ phase, host }) => {
      const hostScope = ["model-trial", "example", "model"];
      const open = () => createSubmissionIntent({ root: settings, scope: hostScope });
      const intent = open();
      const first = intent.claim(request);
      if (!first.owned) throw new Error("fixture did not own the initial claim");
      let answer!: (value: { id: string; status: string; assets: unknown[] }) => void;
      const dispatchOrder = vi.fn(() => new Promise<{ id: string; status: string; assets: unknown[] }>((done) => { answer = done; }));
      let submission: Promise<unknown> | undefined;
      if (phase !== "authorized") {
        submission = intent.submit(first, phase === "unknown" ? async () => { throw new Error("response lost"); } : dispatchOrder);
        if (phase === "unknown") await expect(submission).rejects.toThrow(/unknown/i);
        else {
          // submitOnce yields at its admission boundary before dispatch.
          await Promise.resolve(); await Promise.resolve();
          if (["accepted", "retrieving", "materialized"].includes(phase)) {
            answer({ id: "remote-job", status: "queued", assets: [] });
            await submission;
            if (phase === "retrieving") await intent.recordResult(first.job.jobId, { id: "remote-job", status: "running", assets: [] });
            if (phase === "materialized") await intent.recordResult(first.job.jobId, { id: "remote-job", status: "succeeded", assets: [{ type: "image", url: "file://fixture" }] });
          }
        }
      }
      const original = intent.read()!;
      // recordResult swallows its own failures, so only the record itself can show the write happened.
      if (phase === "retrieving") expect(original.result?.status).toBe("running");
      if (phase === "materialized") expect(original.phase).toBe("succeeded");
      const repeated = host === "same-instance" ? intent.claim(changed)
        : host === "new-instance" ? open().claim(changed)
        : (await hostProcess(settings, { scope: hostScope }).done).out!;
      expect(repeated.owned).toBe(false);
      expect(repeated.receipt?.attemptId).toBe(original.attemptId);
      expect(repeated.receipt?.allowedActions).toEqual(original.allowedActions);
      expect(open().read()?.attemptId).toBe(original.attemptId);
      expect(open().read()?.request).toEqual(request);
      expect(dispatchOrder.mock.calls.length).toBeLessThanOrEqual(1);
      expect(treeOf(path.join(settings, ".nomi/runs", original.intentId, "jobs")), "still exactly one job").toSatisfy(
        (jobs: Record<string, string>) => Object.keys(jobs).every((name) => name.startsWith("attempt-1")));
      if (phase === "submitting") {
        answer({ id: "late-job", status: "queued", assets: [] });
        await submission;
        expect(open().read()?.taskId, "a late answer lands on the original order").toBe("late-job");
      }
    }, 60_000);
  });

  describe("every action a receipt offers can actually be taken", () => {
    async function reach(state: string): Promise<{ result: Result; args: Arguments }> {
      const args = argsFor();
      switch (state) {
        case "unknown": initial = "unknown"; return { result: await trial(args), args };
        case "accepted": initial = "queued"; return { result: await trial(args), args };
        case "succeeded": initial = "succeeded"; return { result: await trial(args), args };
        case "provider-rejected": initial = "rejected"; return { result: await trial(args), args };
        case "declined": case "declined-exhausted": {
          initial = "queued";
          answerCards(false);
          let result = await trial(args, { approvalPolicy: () => ({ mode: "request" }) });
          if (state === "declined-exhausted") { await trial(args); result = await trial(args); }
          setRendererTarget(null);
          return { result, args };
        }
        case "damaged": case "awaiting-new-order": {
          initial = "unknown";
          const first = await trial(args);
          const intentId = first.submission.intentId;
          if (state === "damaged") damage(intentId, "events", "garbled");
          else {
            // The disk exactly as a crash leaves it between moving the record and opening the new order.
            fs.mkdirSync(path.dirname(quarantine(intentId)), { recursive: true });
            fs.renameSync(runDir(intentId), quarantine(intentId));
          }
          return { result: await trial(args), args };
        }
        case "new-order-unavailable": {
          initial = "unknown";
          const first = await trial(args);
          const lock = path.join(claimDir(first.submission.intentId), "claim.lock");
          liveLease(lock);
          const result = await trial({ ...args, newAttemptOf: first.submission.attemptId }, { pollTimeoutMs: 100 });
          expect(result.code).toBe("claim_unavailable");
          expireLease(lock);
          return { result, args };
        }
        default: throw new Error(`Unregistered state: ${state}`);
      }
    }
    async function take(action: string, { result, args }: { result: Result; args: Arguments }) {
      const orders = creates;
      initial = "queued";
      switch (action) {
        case "inspect_provider":
          // Nothing to call in Nomi: the words next to the action are the whole way there.
          expect(JSON.stringify(result)).toMatch(/provider's own console/);
          return;
        case "query": {
          pollStatus = "completed";
          const asked = queries;
          const read = await dispatch("task.read", { taskId: result.taskId }, { origin: { host: "claude" }, fetchTaskResult } as never) as { state: string };
          expect(read.state, JSON.stringify(read)).toBe("succeeded");
          // A finished order is already known; only one still running has anything to ask.
          if (!result.ok) expect(queries, "the query really asked the provider").toBeGreaterThan(asked);
          const observed = await trial(args, { fetchTaskResult, pollIntervalMs: 10 });
          expect(code(observed), JSON.stringify(observed)).toBe("succeeded");
          expect(code(await restartedTrial(args)), "the same query after a restart").toBe("succeeded");
          expect(creates, "querying never creates").toBe(orders);
          return;
        }
        case "retry": {
          answerCards(true);
          const retried = await trial(args);
          expect(retried.submission.attemptId).not.toBe(result.submission.attemptId);
          expect(creates).toBe(orders + 1);
          return;
        }
        case "request_new_attempt": {
          answerCards(true);
          const opened = await trial({ ...args, newAttemptOf: result.submission.attemptId });
          expect(opened.submission.attemptId).not.toBe(result.submission.attemptId);
          expect(opened.submission.recordDamage).toBeUndefined();
          expect(creates).toBe(orders + 1);
          return;
        }
        default: throw new Error(`A receipt offered an action nobody can take: ${action}`);
      }
    }

    it.each(registry.actionWalk)("%s", async (state) => {
      const { result } = await reach(state);
      const offered = result.submission.allowedActions;
      expect(offered.length).toBeGreaterThan(0);
      for (const action of offered) {
        // Each action starts from its own copy of the state: taking one changes what the next would see.
        await freshSettings();
        await take(action, await reach(state));
      }
    }, 120_000);
  });

  describe("windows", () => {
    async function badRecord() {
      initial = "unknown";
      const first = await trial(argsFor());
      const intentId = first.submission.intentId;
      damage(intentId, "events", "garbled");
      initial = "queued";
      return { intentId, before: treeOf(runDir(intentId)), orders: creates };
    }
    const moved = (intentId: string) => fs.existsSync(path.join(claimDir(intentId), "quarantine")) ? fs.readdirSync(path.join(claimDir(intentId), "quarantine")).sort() : [];

    /** Kill a real process right after each durable step of the same claim, on its own copy of the disk. */
    async function crashSweep(prepare: () => Promise<{ intentId: string; reference?: string; assertKept?: (intentId: string) => void }>) {
      const { intentId, reference, assertKept } = await prepare();
      const base = settings;
      const options = { scope: scope(), ...(reference ? { newAttemptOf: reference } : {}) };
      const copyOf = (name: string) => {
        const dir = path.join(root, `${path.basename(base)}-${name}`);
        fs.cpSync(base, dir, { recursive: true });
        return dir;
      };
      const total = (await hostProcess(path.join(copyOf("count"), "app-executions"), { ...options, countOps: true }).done).out!.durableSteps!;
      expect(total, "the sweep has steps to walk").toBeGreaterThan(10);
      const steps = Array.from({ length: total }, (_, index) => index + 1);
      const copies = new Map(steps.map((step) => [step, copyOf(`step-${step}`)]));
      const queue = [...steps];
      await Promise.all(Array.from({ length: 6 }, async () => {
        for (let step = queue.shift(); step !== undefined; step = queue.shift()) {
          const died = await hostProcess(path.join(copies.get(step)!, "app-executions"), { ...options, crashAfterOps: step }).done;
          expect(died.exitCode, `step ${step}: ${died.stderr}`).toBe(137);
        }
      }));
      for (const step of steps) {
        settings = copies.get(step)!;
        vi.stubEnv("NOMI_SETTINGS_DIR", settings);
        expireLease(path.join(claimDir(intentId), "claim.lock"));
        expireLease(path.join(runDir(intentId), "repository.lock"));
        expireLease(path.join(quarantine(intentId), "repository.lock"));
        creates = 0; cards = [];
        setRendererTarget(null);
        const plain = await trial(argsFor());
        // Died before any order could exist: this is still the first trial, so it goes ahead. Only then.
        const stillFirstTrial = !reference && code(plain) === "still_processing";
        if (stillFirstTrial) expect(plain.submission.attemptId, `step ${step}`).toMatch(/^attempt-1$/);
        else expect(code(plain), `step ${step}: ${JSON.stringify(plain)}`).toBe("submission_unknown");
        expect(creates, `step ${step}: a plain call places nothing, even in full-auto`).toBe(stillFirstTrial ? 1 : 0);
        answerCards(true);
        const opened = stillFirstTrial ? plain : await trial({ ...argsFor(), newAttemptOf: plain.submission.attemptId });
        expect(code(opened), `step ${step}: ${JSON.stringify(opened)}`).toBe("still_processing");
        expect(creates, `step ${step}: the new order completes, once`).toBe(1);
        expect(cards, `step ${step}`).toEqual(stillFirstTrial ? [] : [UNCERTAIN_PRIOR_TRIAL_SPEND_INTENT]);
        setRendererTarget(null);
        const after = await trial(argsFor());
        expect(after.submission.attemptId, `step ${step}`).toBe(opened.submission.attemptId);
        expect(creates, `step ${step}`).toBe(1);
        assertKept?.(intentId);
      }
    }
    const withoutWriterLease = (tree: Record<string, string>) =>
      Object.fromEntries(Object.entries(tree).filter(([name]) => !name.startsWith("repository.lock")));

    const CELLS: Record<string, () => Promise<void>> = {
      "concurrent-first-trial-in-process": async () => {
        initial = "queued";
        const [left, right] = await Promise.all([trial(argsFor()), trial(argsFor())]);
        expect(left.submission.attemptId).toBe(right.submission.attemptId);
        expect(creates).toBe(1);
      },
      "concurrent-first-claim-two-processes": async () => {
        const results = await raceTwoHosts(settings, { scope: ["model-trial", "example", "model"] });
        expect(results.filter((row) => row.owned)).toHaveLength(1);
        expect(results.map((row) => row.receipt.attemptId)).toEqual(["attempt-1", "attempt-1"]);
      },
      "concurrent-new-order-on-bad-record": async () => {
        const { intentId, before } = await badRecord();
        const results = await raceTwoHosts(appRoot(), { scope: scope(), newAttemptOf: "unreadable-r0" });
        expect(results.filter((row) => row.owned)).toHaveLength(1);
        expect(results.map((row) => row.receipt.attemptId)).toEqual(["attempt-r1-1", "attempt-r1-1"]);
        expect(moved(intentId)).toEqual(["r1"]);
        expect(treeOf(quarantine(intentId))).toEqual(before);
      },
      "crash-sweep-first-trial": () => crashSweep(async () => {
        // The identity is the digest of the scope; nothing is on disk yet, so read it from a throwaway claim's receipt.
        const probe = fs.mkdtempSync(path.join(root, "identity-"));
        const intentId = createSubmissionIntent({ root: probe, scope: scope() }).claim({ vendor: "x", model: "y", kind: "z", prompt: "", params: {} }).receipt.intentId;
        initial = "queued";
        return { intentId };
      }),
      "crash-sweep-bad-record": () => crashSweep(async () => {
        const { intentId, before } = await badRecord();
        return { intentId, reference: "unreadable-r0", assertKept: (id) => {
          expect(withoutWriterLease(treeOf(quarantine(id)))).toEqual(withoutWriterLease(before));
          // A crash at the very first append leaves an empty journal, which moves too. It never held an order.
          for (const extra of moved(id).slice(1)) {
            expect(Object.keys(treeOf(path.join(claimDir(id), "quarantine", extra))).filter((name) => name.startsWith("jobs"))).toEqual([]);
          }
        } };
      }),
      "crash-sweep-intact-unknown": () => crashSweep(async () => {
        initial = "unknown";
        const first = await trial(argsFor());
        initial = "queued";
        const intentId = first.submission.intentId;
        const original = treeOf(path.join(runDir(intentId), "jobs/attempt-1"));
        return { intentId, reference: first.submission.attemptId, assertKept: (id) => {
          expect(moved(id), "a readable record stays in place").toEqual([]);
          expect(treeOf(path.join(runDir(id), "jobs/attempt-1"))).toEqual(original);
        } };
      }),
      "live-claim-lease-reports-unavailable": async () => {
        const { intentId, before, orders } = await badRecord();
        const lock = path.join(claimDir(intentId), "claim.lock");
        liveLease(lock);
        const unavailable = await tryModel(deps({ pollTimeoutMs: 100 }), { ...argsFor(), newAttemptOf: "unreadable-r0" }) as unknown as Result;
        expect(unavailable.code, JSON.stringify(unavailable)).toBe("claim_unavailable");
        expect(unavailable.message).toMatch(/sent nothing/);
        expect(creates).toBe(orders);
        expect(treeOf(runDir(intentId))).toEqual(before);
        expireLease(lock);
        answerCards(true);
        expect((await trial({ ...argsFor(), newAttemptOf: "unreadable-r0" })).submission.attemptId).toBe("attempt-r1-1");
        expect(creates).toBe(orders + 1);
      },
      "live-writer-lock-reports-unavailable": async () => {
        const { intentId, before, orders } = await badRecord();
        const lock = path.join(runDir(intentId), "repository.lock");
        liveLease(lock);
        const held = treeOf(runDir(intentId));
        const unavailable = await trial({ ...argsFor(), newAttemptOf: "unreadable-r0" }, { pollTimeoutMs: 100 });
        expect(unavailable.code, JSON.stringify(unavailable)).toBe("claim_unavailable");
        expect(unavailable.submission.recordDamage, "the old receipt comes along, it does not stand in for this failure").toBe("journal_unreadable");
        expect(creates).toBe(orders);
        expect(moved(intentId)).toEqual([]);
        expect(treeOf(runDir(intentId))).toEqual(held);
        expireLease(lock);
        answerCards(true);
        expect((await trial({ ...argsFor(), newAttemptOf: "unreadable-r0" })).submission.attemptId).toBe("attempt-r1-1");
        expect(withoutWriterLease(treeOf(quarantine(intentId)))).toEqual(withoutWriterLease(before));
      },
      "claim-storage-blocked-first-trial": async () => {
        initial = "queued";
        const blocked = path.join(appRoot(), ".nomi/intent-claims");
        fs.mkdirSync(path.dirname(blocked), { recursive: true });
        fs.writeFileSync(blocked, "not a directory");
        const unavailable = await tryModel(deps(), argsFor()) as unknown as Result;
        expect(unavailable.code, JSON.stringify(unavailable)).toBe("claim_unavailable");
        expect(unavailable.submission, "no order exists, so no order is reported").toBeUndefined();
        expect(creates).toBe(0);
        fs.rmSync(blocked);
        expect((await trial(argsFor())).submission.attemptId).toBe("attempt-1");
        expect(creates).toBe(1);
      },
      "claim-storage-blocked-on-bad-record": async () => {
        const { intentId, before, orders } = await badRecord();
        const claims = path.join(appRoot(), ".nomi/intent-claims");
        fs.rmSync(claims, { recursive: true });
        fs.writeFileSync(claims, "not a directory");
        expect(code(await trial(argsFor()))).toBe("submission_unknown");
        const unavailable = await trial({ ...argsFor(), newAttemptOf: "unreadable-r0" });
        expect(code(unavailable), JSON.stringify(unavailable)).toBe("claim_unavailable");
        expect(creates).toBe(orders);
        expect(treeOf(runDir(intentId))).toEqual(before);
        fs.rmSync(claims);
        answerCards(true);
        expect((await trial({ ...argsFor(), newAttemptOf: "unreadable-r0" })).submission.attemptId).toBe("attempt-r1-1");
      },
      "set-aside-blocked": async () => {
        const { intentId, before, orders } = await badRecord();
        const blocked = path.join(claimDir(intentId), "quarantine");
        fs.writeFileSync(blocked, "not a directory");
        const unavailable = await trial({ ...argsFor(), newAttemptOf: "unreadable-r0" });
        expect(code(unavailable), JSON.stringify(unavailable)).toBe("claim_unavailable");
        expect(creates).toBe(orders);
        expect(treeOf(runDir(intentId))).toEqual(before);
        fs.rmSync(blocked);
        answerCards(true);
        expect((await trial({ ...argsFor(), newAttemptOf: "unreadable-r0" })).submission.attemptId).toBe("attempt-r1-1");
        expect(treeOf(quarantine(intentId))).toEqual(before);
      },
      "moved-record-is-never-read": async () => {
        const { intentId, orders } = await badRecord();
        answerCards(true);
        await trial({ ...argsFor(), newAttemptOf: "unreadable-r0" });
        for (const relative of Object.keys(treeOf(quarantine(intentId)))) fs.writeFileSync(path.join(quarantine(intentId), relative), "\u0000garbled");
        const current = await trial(argsFor());
        expect(code(current), JSON.stringify(current)).toBe("still_processing");
        expect(current.submission).toMatchObject({ attemptId: "attempt-r1-1", accepted: "accepted" });
        expect(current.submission.recordDamage).toBeUndefined();
        expect((await trial({ ...argsFor(), newAttemptOf: "attempt-r1-1" })).submission.attemptId).toBe("attempt-r1-2");
        expect(creates).toBe(orders + 2);
      },
      "second-damage-moves-again": async () => {
        const { intentId, before, orders } = await badRecord();
        answerCards(true);
        await trial({ ...argsFor(), newAttemptOf: "unreadable-r0" });
        damage(intentId, "events", "garbled");
        const second = treeOf(runDir(intentId));
        const plain = await trial(argsFor());
        expect(plain.submission).toMatchObject({ attemptId: "unreadable-r1", recordDamage: "journal_unreadable" });
        expect(creates).toBe(orders + 1);
        const opened = await trial({ ...argsFor(), newAttemptOf: plain.submission.attemptId });
        expect(opened.submission.attemptId).toBe("attempt-r2-1");
        expect(creates).toBe(orders + 2);
        expect(moved(intentId)).toEqual(["r1", "r2"]);
        expect(treeOf(quarantine(intentId, 1))).toEqual(before);
        expect(treeOf(quarantine(intentId, 2))).toEqual(second);
      },
      "stale-reference-replay": async () => {
        const { orders } = await badRecord();
        answerCards(true);
        expect((await trial({ ...argsFor(), newAttemptOf: "unreadable-r0" })).submission.attemptId).toBe("attempt-r1-1");
        for (const stale of ["unreadable-r0", "attempt-1", "attempt-2"]) {
          expect((await trial({ ...argsFor(), newAttemptOf: stale })).submission.attemptId, stale).toBe("attempt-r1-1");
        }
        expect(creates).toBe(orders + 1);
        expect(cards).toHaveLength(1);
      },
      "uncertain-warning-survives-decline-chain": async () => {
        initial = "unknown";
        const first = await trial(argsFor());
        const intentId = first.submission.intentId;
        initial = "queued";
        answerCards(false);
        await trial({ ...argsFor(), newAttemptOf: "attempt-1" });
        await trial(argsFor());
        const exhausted = await trial(argsFor());
        expect(exhausted.submission.attemptId).toBe("attempt-3");
        answerCards(true);
        const opened = await trial({ ...argsFor(), newAttemptOf: "attempt-3" });
        expect(opened.submission.attemptId).toBe("attempt-4");
        expect(cards).toEqual(Array(3).fill(UNCERTAIN_PRIOR_TRIAL_SPEND_INTENT));
        expect(frozenRequest(intentId, "attempt-4").priorOutcomeUnknown).toBe(true);
        expect(creates).toBe(2);
        // Control: an order that was only ever declined leaves nothing uncertain, so the card has nothing to warn about.
        await freshSettings();
        initial = "queued";
        answerCards(false);
        await trial(argsFor(), { approvalPolicy: () => ({ mode: "request" }) });
        await trial({ ...argsFor(), newAttemptOf: "attempt-1" });
        expect(cards).toEqual(["generation", "generation"]);
      },
      "awaiting-new-order-stays-closed": async () => {
        initial = "unknown";
        const first = await trial(argsFor());
        const intentId = first.submission.intentId;
        const before = treeOf(runDir(intentId));
        fs.mkdirSync(path.dirname(quarantine(intentId)), { recursive: true });
        fs.renameSync(runDir(intentId), quarantine(intentId));
        initial = "queued";
        const plain = await trial(argsFor());
        expect(plain.submission).toMatchObject({ attemptId: "unreadable-r1", recordDamage: "awaiting_new_order", accepted: "unknown" });
        expect(creates).toBe(1);
        answerCards(true);
        const opened = await trial({ ...argsFor(), newAttemptOf: plain.submission.attemptId });
        expect(opened.submission.attemptId).toBe("attempt-r1-1");
        expect(creates).toBe(2);
        expect(cards).toEqual([UNCERTAIN_PRIOR_TRIAL_SPEND_INTENT]);
        expect(moved(intentId), "nothing new to move").toEqual(["r1"]);
        expect(treeOf(quarantine(intentId))).toEqual(before);
      },
      "whole-root-deleted-is-a-first-trial": async () => {
        initial = "unknown";
        await trial(argsFor());
        fs.rmSync(appRoot(), { recursive: true });
        initial = "queued";
        const again = await trial(argsFor());
        expect(again.submission.attemptId).toBe("attempt-1");
        expect(creates, "known gap: with every trace gone there is no evidence left to refuse on").toBe(2);
      },
    };

    it("the registry and the cells list the same windows", () => {
      expect(registry.windows.map((row) => row.id).sort()).toEqual(Object.keys(CELLS).sort());
    });
    it.each(registry.windows)("$id: $label", async ({ id }) => { await CELLS[id](); }, 300_000);
  });

  // The mode is read at every attempt, so it can change between an order the provider refused and its safe retry.
  it.each(registry.policyFlips)("policy flip $id: $label", async (row) => {
    initial = "rejected";
    if (row.first === "request") answerCards(true);
    const refused = await trial(argsFor(), { approvalPolicy: () => ({ mode: row.first }) });
    expect(code(refused), JSON.stringify(refused)).toBe("provider_failed");
    expect(creates, "the provider refused the one order").toBe(1);
    initial = "queued";
    setRendererTarget(null);
    if (row.windowOpen) answerCards(false);
    confirmations = 0;
    const retried = await trial(argsFor(), { approvalPolicy: () => ({ mode: row.second }), pollTimeoutMs: 100 });
    expect(code(retried), JSON.stringify(retried)).toBe(row.code);
    expect({ cards: confirmations, creates }).toEqual({ cards: row.cards, creates: row.creates });
    expect(frozenRequest(retried.submission.intentId, "attempt-2").spendDecidedBy).toBe(row.decidedBy);
  }, 30_000);

  it("the shared layer's own refusal needs no provider: a safe-failure budget is durable across processes", async () => {
    const hostScope = ["model-trial", "example", "model"];
    const request = { vendor: "example", model: "model", kind: "text_to_image", prompt: "apple", params: {} };
    const intent = createSubmissionIntent({ root: settings, scope: hostScope });
    const first = intent.claim(request);
    if (!first.owned) throw new Error("fixture did not own the initial claim");
    await expect(intent.submit(first, async () => { throw new SubmissionNotDispatchedError("never sent", "never_reached_network"); })).rejects.toThrow();
    const retry = createSubmissionIntent({ root: settings, scope: hostScope }).claim(request);
    expect(retry.owned).toBe(true);
    if (!retry.owned) return;
    await expect(intent.submit(retry, async () => { throw new SubmissionNotDispatchedError("never sent", "never_reached_network"); })).rejects.toThrow();
    expect((await hostProcess(settings, { scope: hostScope }).done).out?.owned).toBe(false);
  }, 30_000);
});
