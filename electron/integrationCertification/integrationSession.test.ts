import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { IntegrationSessionService } from "./integrationSession";
import { createRuntimeIntegrationSessionService } from "./integrationSession";
import { createApprovalReceiptAuthority } from "../capabilityCore/approvalReceipt";

describe("IntegrationSessionService", () => {
  async function proposeHttp(service: IntegrationSessionService, sessionId: string, revision: number, owner: "codex" | "claude", modelKey = "text-1", kind = "text") {
    return service.propose(sessionId, revision, owner, {
      candidates: [{ modelKey, kind }],
      selections: [{ modelKey }],
    });
  }

  function make() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-integration-session-"));
    const filePath = path.join(dir, "sessions.json");
    return {
      filePath,
      service: new IntegrationSessionService({
        filePath,
        now: () => "2026-08-28T00:00:00.000Z",
        save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
      }),
    };
  }
  it("rejects unsigned clients and redacts workflow and credential values", () => {
    const { service } = make();
    expect(() =>
      service.begin({ kind: "http-api-provider", name: "Banana", baseUrl: "https://api.example/v1/" }, "external"),
    ).toThrow(/Signed/);
    const session = service.begin({ kind: "comfyui-workflow", name: "Local" }, "codex");
    const updated = service.submitWorkflow(
      session.id,
      session.revision,
      "codex",
      JSON.stringify({ secret: "do-not-return" }),
      {
        outputNodeId: "9",
        outputKind: "video",
        params: [{
          nodeId: "4", inputKey: "frame_rate", paramKey: "comfy_fps", label: "FPS", type: "number", default: 24,
        }],
      },
      {
        enumOptions: [{ classType: "CheckpointLoader", inputKey: "ckpt_name", options: ["model.safetensors"] }],
        uiWorkflow: JSON.stringify({ secret: "ui-workflow-secret" }),
      },
    );
    expect(updated.config.workflow).toEqual({ present: true, bytes: expect.any(Number) });
    expect(updated.config.uiWorkflow).toEqual({ present: true, bytes: expect.any(Number) });
    expect(updated.config.workflowBinding?.params?.[0]?.default).toBe(24);
    expect(typeof updated.config.workflowBinding?.params?.[0]?.default).toBe("number");
    expect(JSON.stringify(updated)).not.toContain("do-not-return");
    expect(JSON.stringify(updated)).not.toContain("ui-workflow-secret");
    expect(() => service.submitWorkflow(
      session.id,
      updated.revision,
      "codex",
      "{}",
      { images: [{ nodeId: "1", inputKey: "image", paramKey: "image", label: "Image", mediaKind: "image", constructor: "bad" }] },
    )).toThrow(/unexpected/i);
    const ready = service.markCredentialReady(session.id, "cred-ref-only", "codex");
    expect(ready.credentialRef).toEqual({ status: "ready", scope: "session" });
    expect(JSON.stringify(ready)).not.toContain("cred-ref-only");
  });
  it("persists and enforces the proposal CAS boundary", async () => {
    const { service, filePath } = make();
    const started = service.begin(
      { kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example/v1", clientRequestId: "req-1" },
      "claude",
    );
    const same = service.begin(
      { kind: "http-api-provider", name: "Other", baseUrl: "https://other.example", clientRequestId: "req-1" },
      "claude",
    );
    expect(same.id).toBe(started.id);
    const ready = service.markCredentialReady(started.id, "ref", "claude");
    await expect(service.propose(started.id, ready.revision, "claude", {
      candidates: [{ modelKey: "text-1", kind: "text" }], selections: [{ modelKey: "text-1" }],
    })).resolves.toMatchObject({ stage: "needs_spend_confirmation" });
    await expect(service.propose(started.id, ready.revision, "claude", {
      candidates: [{ modelKey: "text-1", kind: "text" }], selections: [{ modelKey: "text-1" }],
    })).rejects.toThrow(/stale/);
    expect(fs.existsSync(filePath)).toBe(true);
    const reloaded = new IntegrationSessionService({ filePath });
    expect(reloaded.get(started.id, "claude").id).toBe(started.id);
  });
  it("delegates HTTP certification only after spend stage and stores child run ref", async () => {
    const { service } = make();
    const cert = {
      startHttp: vi.fn(async () => ({
        id: "run-1",
        stage: "completed",
        childRunRef: { runId: "run-1", revisionDigest: "a".repeat(64) },
      })),
    };
    const withCert = new IntegrationSessionService({
      filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-cert-")), "sessions.json"),
      certification: cert as never,
      credentialResolver: () => "secret",
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = withCert.begin(
      { kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example" },
      "codex",
    );
    const ready = withCert.markCredentialReady(session.id, "ref", "codex");
    const selected = await proposeHttp(withCert, session.id, ready.revision, "codex");
    await expect(withCert.start(session.id, selected.revision, "codex", "idem")).rejects.toThrow(/receipt/i);
    const result = await withCert.start(session.id, selected.revision, "codex", "idem", "receipt-1");
    expect(result.childRunRef?.runId).toBe("run-1");
    expect(cert.startHttp).toHaveBeenCalledTimes(1);
    expect(service).toBeDefined();
  });

  it("keeps an asynchronous HTTP child run certifying and converges through integration get", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-async-http-"));
    let childStage = "queued" as "queued" | "testing" | "completed";
    const childRun = () => ({
      id: "run-async",
      stage: childStage,
      childRunRef: { runId: "run-async", revisionDigest: "e".repeat(64) },
    });
    const certification = {
      startHttp: vi.fn(async () => childRun()),
      get: vi.fn(() => childRun()),
    };
    const service = new IntegrationSessionService({
      filePath: path.join(dir, "sessions.json"),
      certification: certification as never,
      credentialResolver: () => "secret",
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = service.begin(
      { kind: "http-api-provider", name: "Audio Provider", baseUrl: "https://api.example" },
      "codex",
    );
    const ready = service.markCredentialReady(session.id, "ref", "codex");
    const selected = await proposeHttp(service, session.id, ready.revision, "codex", "audio-flagship", "audio");

    const started = await service.start(session.id, selected.revision, "codex", "async-http", "receipt-1");
    expect(started).toMatchObject({ stage: "certifying", childRunRef: { runId: "run-async" } });
    childStage = "testing";
    expect(service.get(session.id, "codex").stage).toBe("certifying");
    childStage = "completed";
    const completed = service.get(session.id, "codex");
    expect(completed.stage).toBe("completed");
    expect(completed.blockingReason).toBeUndefined();
  });

  it("returns the completed child run for a repeated idempotency key without a second create", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-idem-"));
    const cert = {
      startHttp: vi.fn(async () => ({
        id: "run-1",
        stage: "completed",
        childRunRef: { runId: "run-1", revisionDigest: "b".repeat(64) },
      })),
    };
    const service = new IntegrationSessionService({
      filePath: path.join(dir, "sessions.json"),
      certification: cert as never,
      credentialResolver: () => "secret",
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = service.begin(
      { kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example" },
      "codex",
    );
    const ready = service.markCredentialReady(session.id, "ref", "codex");
    const selected = await proposeHttp(service, session.id, ready.revision, "codex");
    const first = await service.start(session.id, selected.revision, "codex", "same-key", "receipt-1");
    const second = await service.start(session.id, first.revision, "codex", "same-key", "receipt-1");
    expect(second.childRunRef).toEqual(first.childRunRef);
    expect(cert.startHttp).toHaveBeenCalledTimes(1);
  });

  it("settles a consumed start as a diagnosable failure when the credential cannot be reloaded", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-missing-credential-"));
    const cert = { startHttp: vi.fn() };
    const service = new IntegrationSessionService({
      filePath: path.join(dir, "sessions.json"),
      certification: cert as never,
      credentialResolver: () => undefined,
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = service.begin({ kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example" }, "codex");
    const ready = service.markCredentialReady(session.id, "ref", "codex");
    const selected = await proposeHttp(service, session.id, ready.revision, "codex");
    const result = await service.start(session.id, selected.revision, "codex", "missing-key", "receipt-1");
    expect(result.stage).toBe("failed");
    expect(result.blockingReason).toEqual({ code: "credential_unavailable" });
    expect(cert.startHttp).not.toHaveBeenCalled();
  });

  it("certifies ComfyUI sessions through the injected connector and rejects cancellation while certifying", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-comfy-"));
    let release!: (value: { runId: string; revisionDigest: string }) => void;
    const certifyComfy = vi.fn(
      () =>
        new Promise<{ runId: string; revisionDigest: string }>((resolve) => {
          release = resolve;
        }),
    );
    const service = new IntegrationSessionService({
      filePath: path.join(dir, "sessions.json"),
      certifyComfy,
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = service.begin({ kind: "comfyui-workflow", name: "Local" }, "codex");
    const workflow = service.submitWorkflow(session.id, session.revision, "codex", '{"nodes":{}}');
    const ready = service.resolveInput(session.id, workflow.revision, "codex", {});
    const starting = service.start(session.id, ready.revision, "codex", "comfy-key", "receipt-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const certifying = service.get(session.id, "codex");
    expect(certifying.stage).toBe("certifying");
    expect(() => service.cancel(session.id, certifying.revision, "codex")).toThrow(/certifying|cancel/i);
    release({ runId: "comfy-run", revisionDigest: "c".repeat(64) });
    await expect(starting).resolves.toMatchObject({ childRunRef: { runId: "comfy-run" }, stage: "completed" });
    expect(certifyComfy).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ workflow: '{"nodes":{}}' }) }),
      "comfy-key",
    );
  });

  it("deep-validates persisted session records instead of accepting malformed state", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-corrupt-"));
    const filePath = path.join(dir, "sessions.json");
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, revision: 1, sessions: [{ id: "bad", stage: "wat" }] }));
    expect(() => new IntegrationSessionService({ filePath })).toThrow(/invalid/i);
  });

  it("requires a registered authority receipt when the runtime wires one", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-receipt-"));
    const verifyReceipt = vi.fn(() => {
      throw new Error("Receipt is not registered");
    });
    const service = new IntegrationSessionService({
      filePath: path.join(dir, "sessions.json"),
      certification: { startHttp: vi.fn() } as never,
      credentialResolver: () => "secret",
      approvalReceiptAuthority: {
        resolveReceiptToken: vi.fn(() => {
          throw new Error("unknown receipt id");
        }),
        verifyReceipt,
      } as never,
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = service.begin(
      { kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example" },
      "codex",
    );
    const ready = service.markCredentialReady(session.id, "ref", "codex");
    const selected = await proposeHttp(service, session.id, ready.revision, "codex");
    await expect(service.start(session.id, selected.revision, "codex", "idem", "forged-receipt")).rejects.toThrow(
      /receipt/i,
    );
    expect(verifyReceipt).toHaveBeenCalledTimes(1);
  });

  it("runtime factory wires the supplied receipt authority and durable handoff sink", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-runtime-"));
    const authority = {
      resolveReceiptToken: vi.fn((value: string) => value),
      verifyReceipt: vi.fn(() => {
        throw new Error("Receipt is not registered");
      }),
    };
    const enqueue = vi.fn();
    const service = createRuntimeIntegrationSessionService({
      filePath: path.join(dir, "sessions.json"),
      approvalReceiptAuthority: authority as never,
      enqueueHandoff: enqueue,
      save: undefined,
    });
    const session = service.begin(
      { kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example/v1" },
      "codex",
    );
    service.openCredentials(session.id, session.revision, "codex");
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ sessionId: session.id, target: "credential" }));
    expect(authority.verifyReceipt).not.toHaveBeenCalled();
  });

  it("enqueues a safe credential handoff after opening the credential page", () => {
    const { filePath } = make();
    const enqueueHandoff = vi.fn();
    const service = new IntegrationSessionService({
      filePath,
      enqueueHandoff,
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = service.begin(
      { kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example/v1" },
      "codex",
    );
    const updated = service.openCredentials(session.id, session.revision, "codex");
    expect(enqueueHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "credential",
        sessionId: session.id,
        revision: updated.revision,
        ownerClientId: "codex",
        display: { name: "Provider", origin: "https://api.example" },
      }),
    );
    const payload = JSON.stringify(enqueueHandoff.mock.calls[0]?.[0]);
    expect(payload).not.toContain("api.example/v1");
  });

  it("creates a safe verification request and queues a verification handoff without exposing its token", async () => {
    const { filePath } = make();
    const requestChallenge = vi.fn((input: Record<string, unknown>) => ({
      token: "challenge-token",
      challenge: input,
    }));
    const enqueueHandoff = vi.fn();
    const service = new IntegrationSessionService({
      filePath,
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
      approvalReceiptAuthority: {
        requestChallenge: requestChallenge as never,
        resolveReceiptToken: vi.fn(),
        verifyReceipt: vi.fn(),
        verifyChallenge: vi.fn(),
      } as never,
      enqueueHandoff,
    });
    const session = service.begin(
      { kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example" },
      "codex",
    );
    const ready = service.markCredentialReady(session.id, "ref", "codex");
    const selected = await proposeHttp(service, session.id, ready.revision, "codex");
    const challenge = service.requestConfirmation(selected.id, selected.revision, "codex", "idem");
    expect(JSON.stringify(challenge)).not.toContain("challenge-token");
    expect(requestChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: session.id,
        runId: session.id,
        gateId: `integration-certification:${session.id}`,
      }),
    );
    expect(enqueueHandoff).toHaveBeenCalledWith(expect.objectContaining({
      target: "verification",
      sessionId: session.id,
      display: expect.objectContaining({ challengeId: challenge.challengeId }),
    }));
  });

  it("uses the workflow name for ComfyUI approval display when no model selections exist", () => {
    const { filePath } = make();
    const requestChallenge = vi.fn((input: Record<string, unknown>) => ({
      token: "challenge-token",
      challenge: input,
    }));
    const enqueueHandoff = vi.fn();
    const service = new IntegrationSessionService({
      filePath,
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
      approvalReceiptAuthority: {
        requestChallenge: requestChallenge as never,
        resolveReceiptToken: vi.fn(),
        verifyReceipt: vi.fn(),
        verifyChallenge: vi.fn(),
      } as never,
      enqueueHandoff,
    });
    const session = service.begin({ kind: "comfyui-workflow", name: "Three input workflow" }, "codex");
    const submitted = service.submitWorkflow(
      session.id,
      session.revision,
      "codex",
      JSON.stringify({ "1": { class_type: "LoadImage", inputs: { image: "a.png" } } }),
      { outputNodeId: "1", outputKind: "image", images: [] },
    );
    const ready = service.resolveInput(submitted.id, submitted.revision, "codex", {});
    // The test double only validates that the request is formed; the real
    // authority additionally signs and persists the challenge.
    service.requestConfirmation(ready.id, ready.revision, "codex", "comfy-display");
    expect(requestChallenge).toHaveBeenCalledWith(expect.objectContaining({
      display: expect.objectContaining({ model: "Three input workflow" }),
    }));
  });

  it("completes request-confirmation through trusted UI and consumes one opaque receipt", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-confirm-"));
    const authority = createApprovalReceiptAuthority({
      filePath: path.join(dir, "receipts.json"),
      macKey: "integration-test-key",
      now: () => "2026-08-28T00:00:00.000Z",
    });
    const certification = {
      startHttp: vi.fn(async () => ({
        id: "run-confirmed",
        stage: "completed",
        childRunRef: { runId: "run-confirmed", revisionDigest: "d".repeat(64) },
      })),
    };
    const service = new IntegrationSessionService({
      filePath: path.join(dir, "sessions.json"),
      certification: certification as never,
      approvalReceiptAuthority: authority,
      credentialResolver: () => "secret-is-main-only",
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
      enqueueHandoff: () => undefined,
    });
    const session = service.begin(
      { kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example/v1" },
      "codex",
    );
    const ready = service.markCredentialReady(session.id, "opaque", "codex");
    const selected = await proposeHttp(service, session.id, ready.revision, "codex");
    const requested = service.requestConfirmation(selected.id, selected.revision, "codex", "confirm-once");
    const afterRequest = service.get(selected.id, "codex");
    const confirmed = service.confirmFromTrustedUi({
      sessionId: selected.id,
      expectedRevision: afterRequest.revision,
      challengeId: requested.challengeId,
      webContentsId: 1,
      frameId: 1,
      origin: "file://",
    });
    expect(confirmed.pendingReceiptId).toEqual(expect.any(String));
    expect(JSON.stringify(confirmed)).not.toContain("secret-is-main-only");
    const started = await service.start(
      session.id,
      confirmed.revision,
      "codex",
      "confirm-once",
      confirmed.pendingReceiptId,
    );
    expect(started.stage).toBe("completed");
    const replay = await service.start(
      session.id,
      started.revision,
      "codex",
      "confirm-once",
      confirmed.pendingReceiptId,
    );
    expect(replay.childRunRef).toEqual(started.childRunRef);
    expect(certification.startHttp).toHaveBeenCalledTimes(1);
  });
});
