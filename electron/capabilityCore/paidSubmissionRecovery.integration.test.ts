import { canvasTestRequest } from "./canvasShotTestUtils";
import { matchNomiErrorCode } from "../shared/nomiErrorCodes";
import { buildWorld } from "../../tests/world";
import { canvasRunIdFor } from "../productionRun/canvasShotRunIndex";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectId = "project-1";
const nodeId = "receipt-node";
const runRecordId = "first-click";
const output = Buffer.from("paid-result-of-first-click");
const settingsHandlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
const senderFrame = { routingId: 3, url: "https://nomi.test/" };
const sender = { mainFrame: senderFrame, isDestroyed: () => false, getURL: () => senderFrame.url };
const settingsWindow = { id: 7, isDestroyed: () => false, webContents: sender };
let root = "";
let project = "";
let restartedProject = "";
let baseUrl = "";
let server: http.Server;
let calls: string[];
let scenario: "async" | "sync" | "comfy" | "custom" | "script-only" | "unknown" | "settings" | "journal-gap" = "async";
let interrupted = false;

// Capture exactly the bytes an abruptly terminated process would leave behind.
// The first process may unwind normally. Recovery only sees this earlier copy.
function crashSnapshot(): void {
  if (interrupted) return;
  fs.cpSync(project, restartedProject, { recursive: true });
  interrupted = true;
}

vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => settingsHandlers.set(channel, handler) },
  BrowserWindow: { fromWebContents: () => settingsWindow },
  app: { getPath: (key: string) => path.join(root, key), getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  webContents: { getAllWebContents: () => [] },
}));

vi.mock("../tasks/responseTransforms", async (load) => {
  const original = await load<typeof import("../tasks/responseTransforms")>();
  return { ...original, applyResponseTransform: (...args: Parameters<typeof original.applyResponseTransform>) => {
    if ((scenario === "async" || scenario === "comfy") && args[1] && typeof args[1] === "object" && "receiptNonce" in args[1]) crashSnapshot();
    return original.applyResponseTransform(...args);
  } };
});

// Isolate project asset indexing and media decoding. Download the fixture bytes over
// loopback and put them in the project. An unrelated previous image cannot pass.
vi.mock("../assets/projectAssetStore", async (load) => {
  const original = await load<typeof import("../assets/projectAssetStore")>();
  return { ...original, importRemoteAsset: async ({ projectId: id, url }: { projectId: string; url: string }) => {
    if (scenario === "sync" && !interrupted) {
      crashSnapshot();
      throw new Error("download interrupted");
    }
    const address = new URL(url);
    expect(address.origin).toBe(baseUrl);
    const response = await fetch(address);
    if (!response.ok) throw new Error("fixture media missing");
    fs.writeFileSync(path.join(project, "assets", "receipt.png"), Buffer.from(await response.arrayBuffer()));
    return { id: "receipt-asset", data: { url: `nomi-local://asset/${id}/assets/receipt.png` } };
  } };
});

beforeEach(async () => {
  vi.resetModules();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-paid-recovery-"));
  project = path.join(root, "before");
  restartedProject = path.join(root, "after");
  vi.stubEnv("NOMI_SETTINGS_DIR", path.join(root, "settings"));
  calls = [];
  interrupted = false;
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const route = new URL(req.url!, baseUrl).pathname;
      calls.push(`${req.method} ${route}`);
      const json = (value: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
      if (req.method === "POST" && ["/jobs", "/prompt"].includes(route)) {
        if (scenario === "unknown" && !interrupted) {
          crashSnapshot();
          req.socket.destroy();
          return;
        }
        if (scenario === "sync") return json({ receiptNonce: "accept-1", status: "succeeded", image_url: `${baseUrl}/media/paid.png` });
        if (scenario === "comfy") return json({ receiptNonce: "accept-1", prompt_id: "remote-13", number: 1 });
        if (scenario === "script-only") return json({ receiptNonce: "accept-1", request_id: "remote-13", status: "IN_QUEUE" });
        return json({ receiptNonce: "accept-1", task_id: "remote-13", status: "queued" });
      }
      if (route === "/history/remote-13") {
        return json({ "remote-13": { status: { status_str: "success", completed: true }, outputs: { "9": { images: [{ filename: "paid.png", type: "output", subfolder: "" }] } } } });
      }
      if (route === "/jobs/remote-13") {
        if ((scenario === "custom" || scenario === "script-only") && !interrupted) {
          crashSnapshot();
          req.socket.destroy();
          return;
        }
        return json({ status: "succeeded", image_url: `${baseUrl}/media/paid.png` });
      }
      if (route === "/media/paid.png" || route === "/view") return res.writeHead(200, { "content-type": "image/png" }).end(output);
      return res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const vendorKey = () => scenario === "comfy" ? "comfyui-local" : "acme";

async function seed() {
  const handle = scenario === "script-only" ? "request_id" : "task_id";
  const script = `const job = await http.post('/jobs', { prompt }); const result = await http.get('/jobs/' + job.${handle}); return result.image_url;`;
  buildWorld({ rootDir: root, projects: [], catalog: {
    vendors: [{ key: vendorKey(), name: "Fixture", authType: "none", baseUrlHint: baseUrl, enabled: true }],
    models: [{ vendorKey: vendorKey(), modelKey: "img-model", kind: "image", enabled: true, ...(["custom", "script-only"].includes(scenario) ? { customCall: { script } } : {}) }],
    mappings: scenario === "script-only" ? [] : [{
      vendorKey: vendorKey(), modelKey: "img-model", taskKind: "text_to_image", name: "paid-image",
      create: {
        method: "POST", path: scenario === "comfy" ? "/prompt" : "/jobs", body: { prompt: "{{request.prompt}}" },
        response_mapping: { task_id: scenario === "comfy" ? "prompt_id" : "task_id", status: "status", image_url: "image_url" },
      },
      ...(scenario !== "sync" ? { query: {
        method: "GET", path: scenario === "comfy" ? "/history/{{providerMeta.task_id}}" : "/jobs/{{providerMeta.task_id}}",
        response_mapping: { status: "status", image_url: "image_url" },
        ...(scenario === "comfy" ? { response_transform: "comfyui-history" } : {}),
      } } : {}),
    }],
  } });
}

async function boot() {
  const { setupCanvasShots } = await import("./canvasShotTestUtils");
  const { lazyCanvasTransport } = await import("./canvasTransportProvider");
  const { createProductionRunRepository } = await import("../productionRun/productionRunRepository");
  const repository = createProductionRunRepository({ projectDirResolver: (id) => id === projectId ? project : null });
  const executeBatch = repository.executeBatch;
  return setupCanvasShots({ vendorKey: vendorKey(), root: project, transport: lazyCanvasTransport(), repository: {
    ...repository,
    executeBatch: (...args) => {
      if (scenario === "journal-gap" && args[3].some((cmd) => cmd.type === "job.status" && cmd.payload.status === "provider_accepted")) crashSnapshot();
      return executeBatch(...args);
    },
  } });
}

async function changeModelPreferences() {
  const { setMainWindow } = await import("../appWindowRegistry");
  const { registerVendorPreferenceIpc } = await import("../settings/vendorPreferenceIpc");
  const { registerModelBoxPreferenceIpc } = await import("../settings/modelBoxPreferenceIpc");
  setMainWindow(settingsWindow as unknown as import("electron").BrowserWindow);
  registerVendorPreferenceIpc();
  registerModelBoxPreferenceIpc();
  const event = { sender, senderFrame };
  const vendorSettings = await settingsHandlers.get("nomi:settings:vendor-preference-set")!(event, { orderedVendorKeys: ["replacement", "acme"] });
  const modelSettings = await settingsHandlers.get("nomi:settings:model-box-preference-set")!(event, { modelOrder: ["new-image", "img-model"], preferredVendorByModel: { "img-model": "replacement" } });
  expect(vendorSettings).toMatchObject({ orderedVendorKeys: ["replacement", "acme"] });
  expect(modelSettings).toMatchObject({ modelOrder: ["new-image", "img-model"], preferredVendorByModel: { "img-model": "replacement" } });
}

async function restart() {
  expect(interrupted, `No interruption at the intended boundary. Requests: ${calls.join(", ")}`).toBe(true);
  vi.resetModules();
  project = restartedProject;
  const app = await boot();
  app.runs.recoverOrphans(projectId);
  return app;
}

const postCount = () => calls.filter((call) => call.startsWith("POST ")).length;

describe("paid generation across process loss", () => {
  it.each(["async", "sync", "comfy", "custom", "script-only", "journal-gap"] as const)("recovers the %s receipt from disk after one submission", async (kind) => {
    scenario = kind;
    await seed();
    const first = await boot();
    await first.submit(nodeId, runRecordId).catch(() => undefined);
    expect(postCount(), JSON.stringify(calls)).toBe(1);
    const next = await restart();
    expect(fs.existsSync(path.join(project, "assets", "receipt.png"))).toBe(false);
    expect(next.observed).toContainEqual([projectId, canvasRunIdFor(runRecordId)]);
    const job = next.repository.read(projectId, canvasRunIdFor(runRecordId))!.jobs[0];
    const receiptBytes = fs.readFileSync(path.join(project, job.executionBinding!.runtimeEnvelopeRef), "utf8");
    const result = await next.runs.poll({ projectId, runRecordId, senderId: 7 });
    expect(JSON.parse(receiptBytes)).toMatchObject({ acceptance: {
      vendorKey: vendorKey(), modelKey: "img-model", modeId: expect.stringMatching(/\S/), baseUrl,
      remoteTaskId: kind === "sync" ? null : "remote-13", acceptedAt: expect.stringMatching(/^\d{4}-/),
      rawAcceptance: { receiptNonce: "accept-1" },
    } });
    expect(result).toMatchObject({ status: "succeeded", assets: [{ url: expect.stringContaining("receipt.png") }] });
    expect(fs.readFileSync(path.join(project, "assets", "receipt.png"))).toEqual(output);
    expect(postCount()).toBe(1);
    if (kind === "comfy") expect(calls).toContain("GET /history/remote-13");
    if (kind === "sync") expect(calls).not.toContain("GET /jobs/remote-13");
  });

  it("polls the original endpoint after the saved connection changes", async () => {
    scenario = "settings";
    await seed();
    const first = await boot();
    await expect(first.submit(nodeId, runRecordId)).resolves.toMatchObject({ id: "remote-13" });
    crashSnapshot();
    expect(postCount()).toBe(1);
    buildWorld({ rootDir: root, projects: [], catalog: {
      vendors: [
        { key: "acme", name: "Edited", authType: "none", baseUrlHint: "http://localhost:1", enabled: true },
        { key: "replacement", name: "New choice", authType: "none", baseUrlHint: `${baseUrl}/different-server`, enabled: true },
      ],
      models: [
        { vendorKey: "acme", modelKey: "img-model", kind: "image", enabled: false },
        { vendorKey: "replacement", modelKey: "new-image", kind: "image", enabled: true, selectable: true },
      ],
    } });
    await changeModelPreferences();
    const next = await restart();
    const result = await next.runs.poll({ projectId, runRecordId, senderId: 7 });
    expect(result?.status).toBe("succeeded");
    expect(calls).toContain("GET /jobs/remote-13");
    expect(calls.some((call) => call.includes("different-server"))).toBe(false);
    expect(postCount()).toBe(1);
  });

  it("releases a proven local refusal without an upstream POST", async () => {
    scenario = "async";
    await seed();
    const first = await boot();
    await expect(first.submit(nodeId, runRecordId, "never sent", { modelKey: "absent-model" }))
      .rejects.toMatchObject({ code: "submission_not_sent", reason: "never_reached_network" });
    const run = first.repository.read(projectId, canvasRunIdFor(runRecordId));
    expect(run?.jobs[0]).toMatchObject({ status: "needs_attention", errorCode: "provider_not_reached" });
    expect(postCount()).toBe(0);
  });

  it("keeps an unanswered socket write unknown until a new human click", async () => {
    scenario = "unknown";
    await seed();
    const first = await boot();
    await expect(first.submit(nodeId, runRecordId)).rejects.toThrow();
    expect(postCount()).toBe(1);
    const next = await restart();
    expect(next.runs.canvasOpenRuns({ projectId, nodeId })).toMatchObject([{ reason: "needs_reconcile", hasTaskId: false }]);
    const replay = await next.submit(nodeId, runRecordId).catch((error: Error) => error);
    expect(replay).toBeInstanceOf(Error);
    expect(matchNomiErrorCode((replay as Error).message)).toBe("submission-unknown");
    expect(postCount()).toBe(1);
    const decision = next.runs.resend.decideResend({ projectId, nodeId, initiator: "user", resend: true, senderId: next.senderId });
    if (decision.action !== "ask") throw new Error("Missing explicit resend decision");
    expect(decision.release).toHaveLength(1);
    const [release] = decision.release;
    const previous = next.repository.read(projectId, release.runId)!;
    await next.service.command(projectId, release.runId, { commandId: "user-releases-unknown", expectedRevision: previous.revision,
      type: "job.reconcile", payload: { jobId: release.jobId, outcome: "user_checked_abandon", resendDecisionId: decision.decisionId },
      humanGesture: true, issuedAt: new Date().toISOString() });
    await expect(next.runs.submit({ projectId, nodeId, runRecordId: "explicit-second-click", vendor: "acme", request: canvasTestRequest(nodeId),
      gesture: next.gesture, senderId: next.senderId, resendDecisionId: decision.decisionId })).resolves.toMatchObject({ id: "remote-13" });
    expect(postCount()).toBe(2);
  });
});
