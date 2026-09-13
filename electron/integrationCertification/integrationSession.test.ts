import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { IntegrationSessionService } from "./integrationSession";
import { createRuntimeIntegrationSessionService } from "./integrationSession";

describe("IntegrationSessionService", () => {
  async function proposeHttp(service: IntegrationSessionService, sessionId: string, revision: number, owner: "codex" | "claude", modelKey = "text-1", kind = "text") {
    return service.propose(sessionId, revision, owner, {
      candidates: [{ modelKey, kind }],
      selections: [{ modelKey }],
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
    })).resolves.toMatchObject({ stage: "ready_to_certify" });
    await expect(service.propose(started.id, ready.revision, "claude", {
      candidates: [{ modelKey: "text-1", kind: "text" }], selections: [{ modelKey: "text-1" }],
    })).rejects.toThrow(/behind the session/);
    expect(fs.existsSync(filePath)).toBe(true);
    const reloaded = new IntegrationSessionService({ filePath });
    expect(reloaded.get(started.id, "claude").id).toBe(started.id);
  });
  it("delegates HTTP certification only once the proposal is ready and stores child run ref", async () => {
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
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    });
    const session = withCert.begin(
      { kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example" },
      "codex",
    );
    const ready = withCert.markCredentialReady(session.id, "ref", "codex");
    const selected = await proposeHttp(withCert, session.id, ready.revision, "codex");
    // 提完方案就该能自己开跑：这一步没有花费确认，外部宿主不必等任何人点（P0-1 的回归）。
    expect(selected.stage).toBe("ready_to_certify");
    const result = await withCert.start(session.id, selected.revision, "codex", "idem");
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
      compilerAvailable: () => true,
    });
    const session = service.begin(
      { kind: "http-api-provider", name: "Audio Provider", baseUrl: "https://api.example" },
      "codex",
    );
    const ready = service.markCredentialReady(session.id, "ref", "codex");
    await proposeHttp(service, session.id, ready.revision, "codex", "audio-flagship", "audio");
    const approved = service.get(session.id, "codex");

    const started = await service.start(session.id, approved.revision, "codex", "async-http");
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
    await proposeHttp(service, session.id, ready.revision, "codex");
    const approved = service.get(session.id, "codex");
    const first = await service.start(session.id, approved.revision, "codex", "same-key");
    const second = await service.start(session.id, first.revision, "codex", "same-key");
    expect(second.childRunRef).toEqual(first.childRunRef);
    expect(cert.startHttp).toHaveBeenCalledTimes(1);
  });

  it("settles a started self-check as a diagnosable failure when the credential cannot be reloaded", async () => {
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
    await proposeHttp(service, session.id, ready.revision, "codex");
    const approved = service.get(session.id, "codex");
    const result = await service.start(session.id, approved.revision, "codex", "missing-key");
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
    service.resolveInput(session.id, workflow.revision, "codex", {});
    const approved = service.get(session.id, "codex");
    const starting = service.start(session.id, approved.revision, "codex", "comfy-key");
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

  it("runtime factory wires the durable handoff sink", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-runtime-"));
    const enqueue = vi.fn();
    const service = createRuntimeIntegrationSessionService({
      filePath: path.join(dir, "sessions.json"),
      // 认证运行时是必填依赖（缺席即静默失败的那一族，见 ComfyCertificationRuntime）。
      // 本例不走 ComfyUI 认证，注入会抛的桩：被调用到就说明用例走错了路。
      runTask: () => { throw new Error("runTask must not be reached in this case"); },
      fetchTaskResult: () => { throw new Error("fetchTaskResult must not be reached in this case"); },
      mintSpendGrant: () => { throw new Error("mintSpendGrant must not be reached in this case"); },
      enqueueHandoff: enqueue,
      save: undefined,
    });
    const session = service.begin(
      { kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example/v1" },
      "codex",
    );
    service.openCredentials(session.id, session.revision, "codex");
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ sessionId: session.id, target: "credential" }));
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

  it("queues the self-check handoff for a Nomi-owned session and never for an external one", async () => {
    // 交接单驱动模型页那张「开始自检」卡，而那张卡按下去会以 owner=nomi 调 start。
    // 给 codex 拥有的会话也发一张，就是在 Nomi 里放一个按下去必然 owner_mismatch 的按钮。
    const { filePath } = make();
    const enqueueHandoff = vi.fn();
    const service = new IntegrationSessionService({
      filePath,
      save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
      enqueueHandoff,
    });
    const external = service.begin(
      { kind: "http-api-provider", name: "Provider", baseUrl: "https://api.example" },
      "codex",
    );
    const externalReady = service.markCredentialReady(external.id, "ref", "codex");
    const proposed = await proposeHttp(service, external.id, externalReady.revision, "codex");
    expect(proposed.stage).toBe("ready_to_certify");
    expect(enqueueHandoff).not.toHaveBeenCalledWith(expect.objectContaining({ target: "verification" }));

    const mine = service.begin(
      { kind: "http-api-provider", name: "Mine", baseUrl: "https://mine.example" },
      "nomi",
    );
    const mineReady = service.markCredentialReady(mine.id, "ref", "nomi");
    await service.propose(mine.id, mineReady.revision, "nomi", {
      candidates: [{ modelKey: "text-1", kind: "text" }],
      selections: [{ modelKey: "text-1" }],
    });
    expect(enqueueHandoff).toHaveBeenCalledWith(expect.objectContaining({
      target: "verification",
      sessionId: mine.id,
      display: expect.objectContaining({ name: "Mine", origin: "https://mine.example" }),
    }));
    // 交接单只带安全摘要：没有挑战号、没有收据、没有密钥。
    const verification = enqueueHandoff.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((entry) => entry.target === "verification");
    expect(JSON.stringify(verification)).not.toMatch(/challenge|receipt/i);
  });

  it("runs the free self-check straight from the proposal and replays one idempotent start", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-session-selfcheck-"));
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
    expect(JSON.stringify(selected)).not.toContain("secret-is-main-only");
    const started = await service.start(session.id, selected.revision, "codex", "start-once");
    expect(started.stage).toBe("completed");
    const replay = await service.start(session.id, started.revision, "codex", "start-once");
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

    expect(accepted.stage).toBe("ready_to_certify");
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

    expect(proposed.stage).toBe("ready_to_certify");
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

    expect(proposed.stage).toBe("ready_to_certify");
    expect(proposed.compileRequest).toBeUndefined();
  });
});
