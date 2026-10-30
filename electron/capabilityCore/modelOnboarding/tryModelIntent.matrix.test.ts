/** Class census, not one incident: every row and declared model comes from the fixture registry.
 * Real tryModel -> money gate -> runtime -> loopback POST; restart rows spawn a fresh Node host.
 * Cancelling uses the real renderer reply channel. Only Electron storage/UI and the provider are fixtures.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../dispatcher";
import { setRendererTarget, CAPABILITY_APPLY_REPLY_CHANNEL } from "../rendererBridge";
import { runTask } from "../../runtime";
import { tryModel } from "./tryModel";

const ipc = vi.hoisted(() => new Map<string, (event: unknown, payload: unknown) => void>());
vi.mock("electron", async (original) => ({
  ...await original<Record<string, unknown>>(),
  ipcMain: { on: (channel: string, handler: (event: unknown, payload: unknown) => void) => ipc.set(channel, handler), handle() {}, removeHandler() {} },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^enc:/, "") },
}));

type Arguments = { modelKey: string; taskKind: string; prompt: string; params: Record<string, unknown>; vendorKey: string };
type Result = { ok: boolean; code?: string; submission: { intentId: string; attemptId: string; accepted: string; allowedActions: string[] }; state?: { assets: unknown[] } };
type Scenario = { id: string; label: string; initial: "queued" | "unknown" | "succeeded" | "cancelled";
  repeat: Partial<Arguments>; host: "same" | "restart"; codes: string[]; creates: number; confirmations: number; sameOrder: boolean };
const registry = JSON.parse(fs.readFileSync(path.resolve("tests/fixtures/try-model-intent-matrix.json"), "utf8")) as {
  models: Array<{ modelKey: string; kind: string; taskKind: string; mediaField: string; mediaPath: string }>; cases: Scenario[];
};
const exec = promisify(execFile);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const code = (result: Result) => result.ok ? "succeeded" : result.code;
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
  let initial: Scenario["initial"];
  let creates = 0;
  let confirmations = 0;
  let vendorKey: string;

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
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ id: `job-${creates}`, status: initial === "succeeded" ? "completed" : "queued",
            ...(initial === "succeeded" ? { image: { url: `${origin}/image.png` } } : {}) }));
        });
        return;
      }
      response.writeHead(404).end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  beforeEach(async () => {
    settings = fs.mkdtempSync(path.join(root, "case-"));
    vi.stubEnv("NOMI_SETTINGS_DIR", settings);
    creates = 0; confirmations = 0;
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
  });
  afterEach(() => { setRendererTarget(null); });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(registry.cases)("$id: $label", async (scenario) => {
    initial = scenario.initial;
    const args: Arguments = { vendorKey, modelKey: registry.models[0].modelKey, taskKind: registry.models[0].taskKind, prompt: "apple", params: {} };
    if (initial === "cancelled") setRendererTarget({ id: 42, mainFrame: { routingId: 1 }, isDestroyed: () => false,
      getURL: () => "http://127.0.0.1:5273/index.html", send: (_channel: string, payload: { id: number }) => {
        confirmations += 1;
        queueMicrotask(() => ipc.get(CAPABILITY_APPLY_REPLY_CHANNEL)?.(
          { sender: { id: 42 }, senderFrame: { routingId: 1, url: "http://127.0.0.1:5273/index.html" } },
          { id: payload.id, ok: true, result: { confirmed: false } }));
      } } as never);
    const first = await tryModel({ runTask, pollTimeoutMs: 2000, approvalPolicy: () => ({ mode: initial === "cancelled" ? "request" : "direct" }) }, args);
    assertTrialResult(first);
    expect(code(first), JSON.stringify(first)).toBe(scenario.codes[0]);
    const repeated: Result[] = [];
    for (const expected of scenario.codes.slice(1)) {
      const input = { ...args, ...scenario.repeat };
      const result: unknown = scenario.host === "restart"
        ? JSON.parse((await exec(process.execPath, [path.resolve("tests/fixtures/try-model-intent-restart.mjs"), settings, JSON.stringify(input)])).stdout)
        : await tryModel({ runTask, pollTimeoutMs: 2000, approvalPolicy: () => ({ mode: "direct" }) }, input);
      assertTrialResult(result);
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
});
