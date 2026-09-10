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

  /**
   * 走完真实的人证关卡：Agent 请求挑战 → 可信 UI 侧真人手势 → 铸收据。
   *
   * 为什么用例里必须走它：`start` 现在只在 `human_confirmed` 放行。旧用例直接从
   * `needs_spend_confirmation` 跳到 `start` 并塞一个字符串 "receipt-1"，等于把这一关整个测没了——
   * 正是 R30 点名的盲区（夹具用变量直传，真实模型在回路里的那一段从没被测过）。
   */
  function approveSpend(service: IntegrationSessionService, sessionId: string, owner: "codex" | "claude", key: string) {
    const current = service.get(sessionId, owner);
    const requested = service.requestConfirmation(sessionId, current.revision, owner, key);
    const afterRequest = service.get(sessionId, owner);
    expect(afterRequest.stage).toBe("awaiting_human_confirmation");
    return service.confirmFromTrustedUi({
      sessionId,
      expectedRevision: afterRequest.revision,
      challengeId: requested.challengeId,
      webContentsId: 1,
      frameId: 1,
      origin: "file://",
    });
  }

  function testAuthority(dir: string) {
    return createApprovalReceiptAuthority({
      filePath: path.join(dir, "receipts.json"),
      macKey: "integration-test-key",
    });
  }

  // compilerAvailable 默认注 true = 「这台机器上已经有能读文档的文本模型」，也就是这些既有用例
  // 一直隐含的处境。为 false 的那条路（鸡生蛋）由本文件末尾的专门用例覆盖。
  function make(overrides: { compilerAvailable?: () => boolean } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-integration-session-"));
    const filePath = path.join(dir, "sessions.json");
    return {
      filePath,
      service: new IntegrationSessionService({
        filePath,
        now: () => "2026-08-28T00:00:00.000Z",
        save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
        compilerAvailable: overrides.compilerAvailable || (() => true),
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
    })).rejects.toThrow(/behind the session/);
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
    const certDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-cert-"));
    const withCert = new IntegrationSessionService({
      filePath: path.join(certDir, "sessions.json"),
      certification: cert as never,
      credentialResolver: () => "secret",
      approvalReceiptAuthority: testAuthority(certDir),
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = withCert.begin(
      { kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example" },
      "codex",
    );
    const ready = withCert.markCredentialReady(session.id, "ref", "codex");
    const selected = await proposeHttp(withCert, session.id, ready.revision, "codex");
    // 人还没批：start 必须明说「等人批」，而不是含糊地报收据问题（这正是实测里 agent 读错的那一跳）。
    await expect(withCert.start(session.id, selected.revision, "codex", "idem")).rejects.toThrow(/not ready to start|approved/i);
    const approved = approveSpend(withCert, session.id, "codex", "idem");
    expect(approved.stage).toBe("human_confirmed");
    const result = await withCert.start(session.id, approved.revision, "codex", "idem", approved.pendingReceiptId);
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
      approvalReceiptAuthority: testAuthority(dir),
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
      compilerAvailable: () => true,
    });
    const session = service.begin(
      { kind: "http-api-provider", name: "Audio Provider", baseUrl: "https://api.example" },
      "codex",
    );
    const ready = service.markCredentialReady(session.id, "ref", "codex");
    await proposeHttp(service, session.id, ready.revision, "codex", "audio-flagship", "audio");
    const approved = approveSpend(service, session.id, "codex", "async-http");

    const started = await service.start(session.id, approved.revision, "codex", "async-http", approved.pendingReceiptId);
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
      approvalReceiptAuthority: testAuthority(dir),
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = service.begin(
      { kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example" },
      "codex",
    );
    const ready = service.markCredentialReady(session.id, "ref", "codex");
    await proposeHttp(service, session.id, ready.revision, "codex");
    const approved = approveSpend(service, session.id, "codex", "same-key");
    const first = await service.start(session.id, approved.revision, "codex", "same-key", approved.pendingReceiptId);
    const second = await service.start(session.id, first.revision, "codex", "same-key", approved.pendingReceiptId);
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
      approvalReceiptAuthority: testAuthority(dir),
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = service.begin({ kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example" }, "codex");
    const ready = service.markCredentialReady(session.id, "ref", "codex");
    await proposeHttp(service, session.id, ready.revision, "codex");
    const approved = approveSpend(service, session.id, "codex", "missing-key");
    const result = await service.start(session.id, approved.revision, "codex", "missing-key", approved.pendingReceiptId);
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
      approvalReceiptAuthority: testAuthority(dir),
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = service.begin({ kind: "comfyui-workflow", name: "Local" }, "codex");
    const workflow = service.submitWorkflow(session.id, session.revision, "codex", '{"nodes":{}}');
    service.resolveInput(session.id, workflow.revision, "codex", {});
    const approved = approveSpend(service, session.id, "codex", "comfy-key");
    const starting = service.start(session.id, approved.revision, "codex", "comfy-key", approved.pendingReceiptId);
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
    // 伪造收据在人证之前就被拒：收据校验先于阶段判断，所以这条断言仍然测的是「收据必须注册过」。
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

  it("retires the queued credential handoff once the key lands through the MCP loopback page", () => {
    // The GUI wizard used to be the only thing that retired this request, by acking after its own
    // save. A key typed into the loopback page in the user's AI client therefore left the "type a
    // key" handoff queued forever, and the model settings drawer kept yanking the user onto a
    // stale add-a-model page for a provider that is already connected.
    const { filePath } = make();
    const retireHandoff = vi.fn();
    const service = new IntegrationSessionService({
      filePath,
      enqueueHandoff: vi.fn(),
      retireHandoff,
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = service.begin(
      { kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example/v1" },
      "codex",
    );
    const opened = service.openCredentials(session.id, session.revision, "codex");
    expect(retireHandoff).not.toHaveBeenCalled();
    const ready = service.markCredentialReady(opened.id, "ref", "codex");
    expect(ready.credentialStatus).toBe("ready");
    expect(retireHandoff).toHaveBeenCalledWith(session.id, "credential");
  });

  it("keeps the credential handoff queued when the GUI credential write fails", () => {
    // The retirement sits after the durable write on purpose. Retiring first would delete the
    // user's only route back to the page on a save that then threw. Two real rejections, one per
    // layer: a stale revision (validation) and an unavailable keychain (catalog write).
    const { filePath } = make();
    const retireHandoff = vi.fn();
    const service = new IntegrationSessionService({
      filePath,
      enqueueHandoff: vi.fn(),
      retireHandoff,
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = service.begin(
      { kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example/v1" },
      "codex",
    );
    const opened = service.openCredentials(session.id, session.revision, "codex");
    expect(() => service.saveCredential(opened.id, opened.revision - 1, "nomi", "sk-stale")).toThrow(/behind the session/);
    expect(() => service.saveCredential(opened.id, opened.revision, "nomi", "sk-no-keychain")).toThrow(/secure storage/);
    expect(retireHandoff).not.toHaveBeenCalled();
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
  // ── 鸡生蛋（2026-09-10）：本机没有可读文档的文本模型时，编译交给驱动 Agent ─────────
  //
  // 旧行为是 start 之后在认证里抛 AdapterNeedsAiError：「想接模型，先接一个模型」。
  // 新行为把「待编译的输入」在 propose 阶段就交回去，收回来的东西照样过 validateProviderAdapterDraft。

  function mediaProposal() {
    return { candidates: [{ modelKey: "paint-v2", kind: "image" }], selections: [{ modelKey: "paint-v2" }] };
  }
  function suppliedContract(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      sources: [{ url: "https://docs.example/api", evidence: "POST /images returns data[0].url" }],
      models: [
        {
          modelKey: "paint-v2",
          labelZh: "ignored - Nomi locks the label",
          kind: "image",
          modes: [
            {
              taskKind: "text_to_image",
              create: {
                method: "POST",
                path: "/images",
                body: { prompt: "{{request.prompt}}" },
                response_mapping: { image_url: "data.0.url" },
              },
              sourceUrls: ["https://docs.example/api"],
            },
          ],
        },
      ],
      ...overrides,
    });
  }

  it("hands the compile job to the driving agent when no text model can read the documentation", async () => {
    const { service } = make({ compilerAvailable: () => false });
    const session = service.begin(
      { kind: "http-api-provider", name: "Relay", baseUrl: "https://api.example/v1", docs: "POST /images -> data[0].url" },
      "codex",
    );
    const ready = service.markCredentialReady(session.id, "ref", "codex");

    const proposed = await service.propose(session.id, ready.revision, "codex", mediaProposal());

    expect(proposed.stage).toBe("needs_input");
    expect(proposed.unresolvedFields).toEqual([
      { key: "proposal.adapterDraft", reasonCode: "adapter_contract_required" },
    ]);
    expect(proposed.compileRequest).toMatchObject({
      field: "proposal.adapterDraft",
      provider: { baseUrl: "https://api.example/v1", authType: "bearer" },
      models: [{ modelKey: "paint-v2", kind: "image" }],
      docs: { provided: true, bytes: 27 },
    });
    // 交底必须自足：目标 schema + 撰写规则都在返回值里，Agent 不需要读 Nomi 的仓库。
    expect(String(proposed.compileRequest?.instructions)).toContain("declarative provider adapter schema");
    const schema = JSON.stringify(proposed.compileRequest?.contractSchema);
    expect(schema).toContain("sourceUrls");
    expect(schema).toContain("referenceParam");
  });

  it("accepts an agent-compiled contract, locks identity, and advances to spend confirmation", async () => {
    const { service } = make({ compilerAvailable: () => false });
    const session = service.begin(
      { kind: "http-api-provider", name: "Relay", baseUrl: "https://api.example/v1" },
      "codex",
    );
    const ready = service.markCredentialReady(session.id, "ref", "codex");
    const blocked = await service.propose(session.id, ready.revision, "codex", mediaProposal());

    const accepted = await service.propose(session.id, blocked.revision, "codex", {
      ...mediaProposal(),
      adapterDraft: suppliedContract(),
    });

    expect(accepted.stage).toBe("needs_spend_confirmation");
    expect(accepted.unresolvedFields).toEqual([]);
    expect(accepted.compileRequest).toBeUndefined();
    expect(accepted.adapterDraft).toEqual({ present: true, modelKeys: ["paint-v2"] });
  });

  it("rejects an agent-compiled contract that does not pass the adapter validator, without moving the session", async () => {
    const { service } = make({ compilerAvailable: () => false });
    const session = service.begin(
      { kind: "http-api-provider", name: "Relay", baseUrl: "https://api.example/v1" },
      "codex",
    );
    const ready = service.markCredentialReady(session.id, "ref", "codex");
    const blocked = await service.propose(session.id, ready.revision, "codex", mediaProposal());

    await expect(service.propose(session.id, blocked.revision, "codex", {
      ...mediaProposal(),
      // 媒体模式没有任何产物映射 —— 认证跑起来必然拿不到图，必须在收件处就被打回。
      adapterDraft: suppliedContract({
        models: [
          {
            modelKey: "paint-v2",
            labelZh: "Paint",
            kind: "image",
            modes: [
              {
                taskKind: "text_to_image",
                create: { method: "POST", path: "/images" },
                sourceUrls: ["https://docs.example/api"],
              },
            ],
          },
        ],
      }),
    })).rejects.toThrow(/propose rejected: proposal\.adapterDraft/);
    // 拒绝不改 revision：Agent 拿同一个 expectedRevision 修好再交。
    expect(service.get(session.id, "codex").revision).toBe(blocked.revision);
    expect(service.get(session.id, "codex").stage).toBe("needs_input");
  });

  it("still goes straight to spend confirmation for a text-only proposal on a machine with no text model", async () => {
    const { service } = make({ compilerAvailable: () => false });
    const session = service.begin(
      { kind: "http-api-provider", name: "Relay", baseUrl: "https://api.example/v1" },
      "codex",
    );
    const ready = service.markCredentialReady(session.id, "ref", "codex");

    const proposed = await proposeHttp(service, session.id, ready.revision, "codex");

    expect(proposed.stage).toBe("needs_spend_confirmation");
    expect(proposed.compileRequest).toBeUndefined();
  });

  it("does not ask the agent to compile for a self-hosted endpoint that uses the built-in contract", async () => {
    const { service } = make({ compilerAvailable: () => false });
    const session = service.begin(
      { kind: "http-api-provider", name: "Local", baseUrl: "http://192.168.1.20:8000/v1" },
      "codex",
    );
    const ready = service.markCredentialReady(session.id, "ref", "codex");

    const proposed = await service.propose(session.id, ready.revision, "codex", mediaProposal());

    expect(proposed.stage).toBe("needs_spend_confirmation");
    expect(proposed.compileRequest).toBeUndefined();
  });
});
