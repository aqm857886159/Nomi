/**
 * 端到端：**外部 AI 登记的自定义供应商，能不能走进正式生成**（issue #975）。
 *
 * 用户的现场（v0.23.0，外部宿主经 Nomi MCP）：`submit_declaration` 成功、key 存了、`nomi_try_model`
 * 真打到本地适配器拿到 task_id、`nomi_operation_plan` 建得出 operation——一进正式生成就报
 * `Provider local-52931 lacks required recovery capabilities: configured_provider`。
 * 卡登记写的 `meta.adapter`（declaration-card）让整条非内置连接被判成「归认证适配器管」，
 * 正式生成的 provider 装配让出了这条连接，而非内置连接根本没有别的执行器来接（docs/plan/2026-10-04-declared-provider-production.md）。
 *
 * 这一条走用户走过的那几跳，全部用真实生产函数：
 *   MCP `submit_declaration` → `set_key` → `nomi_try_model`（画布那台发动机）→
 *   正式生成就绪（宿主读的同一个 `createLiveGenerationRuntime().readBootstrap()`）→
 *   授权封存 → 派发 → 轮询 → 取产物描述。
 * 供应商是本机起的一个 HTTP 假适配器（127.0.0.1，随机端口），不碰任何真实付费服务。
 * 「重启后的旧连接」= 丢掉全部模块缓存、从盘上重新读同一份目录再问一次就绪。
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ipcMain: { on: () => undefined, handle: () => undefined, removeHandler: () => undefined },
    // 同 acceptanceLoopback：可逆但不是明文的替身，让存 key 这扇写门真走一遍。
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`enc:${value}`, "utf8"),
      decryptString: (buffer: Buffer) => buffer.toString("utf8").replace(/^enc:/, ""),
    },
  };
});

const MP4 = Buffer.from("00000018667479706d703432000000006d703432", "hex");
const DOCS = "https://docs.example-local-adapter.test/api";
const MODEL_KEY = "local-video-fast";
const API_KEY = "local-adapter-test-key";

type Seen = { method: string; url: string; auth: string; body: string };

describe("issue #975 · 声明登记的自定义供应商进入正式生成", () => {
  let server: http.Server;
  let origin = "";
  let root = "";
  let vendorKey = "";
  const seen: Seen[] = [];

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-975-declared-production-"));
    vi.stubEnv("NOMI_SETTINGS_DIR", root);
    let nextTask = 0;
    server = http.createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        seen.push({ method: request.method || "", url: request.url || "", auth: String(request.headers.authorization || ""), body });
        if (String(request.headers.authorization || "") !== `Bearer ${API_KEY}` && request.url !== "/out.mp4") {
          response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "missing credentials" }));
          return;
        }
        if (request.method === "POST" && request.url === "/v1/videos") {
          nextTask += 1;
          response.writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ task_id: `h3-${nextTask}`, status: "queued" }));
          return;
        }
        const poll = /^\/v1\/videos\/(h3-\d+)$/.exec(request.url || "");
        if (request.method === "GET" && poll) {
          response.writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ task_id: poll[1], status: "succeeded", video_url: `${origin}/out.mp4` }));
          return;
        }
        if (request.url === "/out.mp4") {
          response.writeHead(200, { "content-type": "video/mp4" }).end(MP4);
          return;
        }
        response.writeHead(404).end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  beforeEach(() => {
    vi.stubEnv("NOMI_SETTINGS_DIR", root);
  });

  afterAll(async () => {
    vi.stubEnv("NOMI_SETTINGS_DIR", undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function mcp(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { MCP_TOOL_RESOLVER } = await import("../mcpToolCatalog");
    const { validateToolArguments } = await import("../mcpProtocol");
    const { dispatch } = await import("../dispatcher");
    const { runTask } = await import("../../runtime");
    const tool = MCP_TOOL_RESOLVER.resolve(name)!;
    const invalid = validateToolArguments(tool.name, tool.inputSchema, args);
    if (invalid) throw invalid;
    const method = typeof (tool as { resolveMethod?: unknown }).resolveMethod === "function"
      ? (tool as { resolveMethod: (a: Record<string, unknown>) => string }).resolveMethod(args)
      : tool.method;
    // 「全自动」档：试跑的钱由档位代答（同 acceptanceLoopback 第二条），不需要一个 Nomi 窗口。
    return await dispatch(method, tool.build(args) as Record<string, unknown>, {
      origin: { host: "codex" }, runTask, approvalPolicy: () => ({ mode: "project", spend: "confirm" }),
    } as never) as Record<string, unknown>;
  }

  async function readiness() {
    const { createLiveGenerationRuntime } = await import("../liveGenerationRuntime");
    return createLiveGenerationRuntime().readBootstrap();
  }

  it("登记 → 填 key → 试跑：画布那台发动机跑得通（用户现场的前三跳）", async () => {
    const submitted = await mcp("nomi_model_setup", {
      action: "submit_declaration",
      name: "Local Adapter",
      declaration: JSON.stringify({
        provider: { baseUrl: origin, authType: "bearer", authHeader: "Authorization" },
        sources: [{ url: DOCS, evidence: "POST /v1/videos -> {task_id}; GET /v1/videos/{task_id} -> {status, video_url}" }],
        assetIngestion: { strategy: "none", sourceUrl: DOCS },
        models: [{
          modelKey: MODEL_KEY,
          labelZh: "Local Video Fast",
          kind: "video",
          modes: [{
            taskKind: "text_to_video",
            delivery: "asynchronous",
            create: {
              method: "POST",
              path: "/v1/videos",
              body: { prompt: "{{request.prompt}}" },
              response_mapping: { task_id: "task_id", status: "status" },
              provider_meta_mapping: { task_id: "task_id" },
            },
            query: {
              method: "GET",
              path: "/v1/videos/{{providerMeta.task_id}}",
              response_mapping: { task_id: "task_id", status: "status", video_url: "video_url" },
            },
            statusMapping: { failed: ["error"] },
            sourceUrls: [DOCS],
          }],
        }],
      }),
    }) as { ok: boolean; vendorKey: string };
    expect(submitted.ok, JSON.stringify(submitted)).toBe(true);
    vendorKey = submitted.vendorKey;

    const keyed = await mcp("nomi_model_setup", { action: "set_key", vendorKey, apiKey: API_KEY });
    expect(keyed.ok, JSON.stringify(keyed)).toBe(true);

    // 盘上就是 v0.23.0 写的那个形状：模型行带着声明卡的标记。
    const { readCatalog } = await import("../../catalog/catalogStore");
    const row = readCatalog().models.find((model) => model.vendorKey === vendorKey && model.modelKey === MODEL_KEY);
    expect(row?.meta).toMatchObject({ adapter: { state: "declared", source: "declaration-card" } });

    // 用户现场这一跳的证据是「真打到适配器、拿到 task_id」。异步供应商的试跑只看得到创建那一下的回包
    // （它判不判 ok 是试跑自己的事，不在 #975 范围，见设计卡「另外几件」）；这里只钉它真的发出去了、带着 key。
    const tried = await mcp("nomi_try_model", { vendorKey, modelKey: MODEL_KEY, prompt: "a red apple" });
    expect(JSON.stringify(tried)).toContain("h3-1");
    const create = seen.find((call) => call.method === "POST" && call.url === "/v1/videos");
    expect(create?.auth).toBe(`Bearer ${API_KEY}`);
  });

  it("正式生成就绪：宿主问到的就绪表里这家 providerReady，不再是 configured_provider", async () => {
    const boot = await readiness();
    expect(boot.readinessByProvider[vendorKey], JSON.stringify(boot.readinessByProvider[vendorKey])).toMatchObject({ providerReady: true });
    expect(boot.readinessByProvider[vendorKey]?.missingForSubmit).toBeUndefined();
    expect(boot.providers.map((provider) => provider.providerId)).toContain(vendorKey);
  });

  it("正式派发：授权封存 → 提交打到本机适配器（带 key）→ 轮询成功 → 取到产物描述", async () => {
    const boot = await readiness();
    const { createLiveGenerationRuntime } = await import("../liveGenerationRuntime");
    const { compileExecutionContract } = await import("../executionContract");
    const { createGenerationRuntimeAdapter } = await import("../generationRuntimeAdapter");
    const contract = compileExecutionContract({
      candidateId: "candidate-975", revision: 1, moduleId: "generation.single-shot",
      providerId: vendorKey, modelId: MODEL_KEY, mode: "text_to_video",
      prompt: "a red apple rolls across a white table", parameters: {}, references: [],
    }, createLiveGenerationRuntime().createDraftScope().registry);
    const adapter = createGenerationRuntimeAdapter({ providers: boot.providers });
    const sealed = adapter.prepareAuthorization({ contract, providerIdempotencyKey: "idem-975" });

    const before = seen.length;
    const submitted = await adapter.submit({
      contract,
      binding: {
        immutableProjectUuid: "project-975", projectGeneration: 1, runId: "run-975", shotId: "shot-1",
        contractHash: contract.contractHash, runtimeTaskId: "runtime-975", providerNamespace: vendorKey,
        providerIdempotencyKey: "idem-975", requestFingerprint: "f".repeat(64),
        runtimeEnvelopeRef: ".nomi/runs/run-975/runtime.json", fencingEpoch: 1,
      },
      expectedProviderRequestHash: sealed.providerRequestHash,
      preparedProviderRequest: sealed.providerRequest,
    });
    const create = seen.slice(before).find((call) => call.method === "POST" && call.url === "/v1/videos");
    expect(create?.auth).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(create!.body)).toMatchObject({ prompt: "a red apple rolls across a white table" });
    expect(submitted.providerTaskId).toMatch(/^h3-\d+$/);

    const polled = await adapter.query({ providerId: vendorKey, providerTaskId: submitted.providerTaskId });
    expect(polled.state).toBe("succeeded");
    const outputs = await adapter.materialize({ providerId: vendorKey, providerTaskId: submitted.providerTaskId, raw: polled.raw });
    expect(outputs.outputs).toEqual([expect.objectContaining({ kind: "video", url: `${origin}/out.mp4` })]);
  });

  it("产物落盘：这条连接自己的本机 origin 上的产物取得回来；同主机换个端口照旧拒（#975 A）", async () => {
    const { createGenerationOutputMaterializer } = await import("../generationOutputMaterializer");
    const writes: Buffer[] = [];
    const materializer = createGenerationOutputMaterializer({
      writeAsset: ((_projectId: string, bytes: Buffer) => { writes.push(bytes); return { id: "asset-975", data: { relativePath: "assets/generated/out.mp4" } }; }) as never,
    });
    // providerId 走真目录：连接地址就是 submit_declaration 登记的那个 origin。
    const receipt = await materializer.materialize({
      projectId: "project-975", providerTaskId: "h3-1", providerId: vendorKey,
      output: { kind: "video", url: `${origin}/out.mp4` },
    });
    expect(receipt).toMatchObject({ artifactId: "asset-975", kind: "video" });
    expect(writes[0]?.equals(MP4)).toBe(true);

    const otherPort = new URL(origin);
    otherPort.port = String(Number(otherPort.port) === 65535 ? 65534 : Number(otherPort.port) + 1);
    await expect(materializer.materialize({
      projectId: "project-975", providerTaskId: "h3-1", providerId: vendorKey,
      output: { kind: "video", url: `${otherPort.origin}/out.mp4` },
    })).rejects.toMatchObject({ code: "output_retrieval_failed", deterministic: true });
  });

  it("重启后的旧连接：丢掉模块缓存、从盘上重读同一份目录，仍然就绪", async () => {
    vi.resetModules();
    const { readCatalog } = await import("../../catalog/catalogStore");
    const onDisk = readCatalog();
    expect(onDisk.models.find((model) => model.vendorKey === vendorKey)?.meta).toMatchObject({ adapter: { source: "declaration-card" } });
    const boot = await readiness();
    expect(boot.readinessByProvider[vendorKey]).toMatchObject({ providerReady: true });
  });
});
