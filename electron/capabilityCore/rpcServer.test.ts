import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startRpcServer, type RpcServerHandle } from "./rpcServer";
import { ensureToken, signMcpClient, type AuthenticatedMcpClient } from "./security";
import { createProjectSessionRuntime } from "./projectSessionRuntime";
import { createMcpGenerationPolicy } from "./mcpGenerationPolicy";
import { createMcpConnectionContext, getMcpConnectionAttestation } from "./mcpConnectionContext";
import { getWorkspaceRepositoryDeps } from "../runtimePaths";
import { readWorkspaceProject, resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";
import { ensureWorkspaceProjectIdentity } from "../workspace/workspaceProjectIdentity";
import { createMainCapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import { createProjectAgentProposalReceiptService } from "../projectAgentHost/projectAgentProposalReceiptStore";
import { projectAgentProposalReceiptPath } from "../projectAgentHost/projectAgentProposalReceiptStore";

function canvasReadRuntime(nodeId: string) {
  return Object.freeze({
    executor: createMainCapabilityExecutorRegistry({
      resolveCanvasReadPort: async () => ({
        read: async () => ({
          nodes: [{ id: nodeId, kind: "text", title: "from executor", prompt: "safe", position: { x: 1, y: 2 } }],
          edges: [],
          groups: [],
          selectedNodeIds: [],
        }),
      }),
    }),
  });
}

const tempRoots: string[] = [];
let mockedDocumentsRoot = "";
let mockedUserDataRoot = "";
let server: RpcServerHandle | null = null;
let token = "";
let openProjectId = "";
// 模拟渲染层在线 + 付费确认应答（测 hybrid 网关：窗口活着但项目没在前台）。
let rendererUp = false;
let spendReply: { confirmed?: boolean } = { confirmed: true };
let planReply: { confirmed?: boolean } = { confirmed: true };
let rendererOps: string[] = [];
let documentReply: { applied: true; revision: number; contentHash: string } = { applied: true, revision: 7, contentHash: "document-hash" };
// 捕获最后一次 runTask 请求,断言 grantId 是否随请求下传(=付费确认是否真路由+铸令牌)。
let lastRunTaskReq: { extras?: Record<string, unknown> } | null = null;

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "documents" ? mockedDocumentsRoot : mockedUserDataRoot),
    getAppPath: () => process.cwd(),
  },
}));

vi.mock("./rendererBridge", () => ({
  isRendererAvailable: () => rendererUp,
  requestRenderer: async (op: string) => {
    rendererOps.push(op);
    if (op === "spend.confirm") return spendReply;
    if (op === "plan.confirm") return planReply;
    if (op === "document.write") return documentReply;
    if (op === "timeline.read") return { timeline: [] };
    if (op === "asset.read") return { assets: [] };
    // hybrid 网关读写应走盘,绝不该把 canvas.* 转给渲染层——命中即测试失败。
    throw new Error(`hybrid 不应调用渲染层 op: ${op}`);
  },
}));

function makeTempDir(name = "nomi-rpc-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

async function rpc(
  method: string,
  params: Record<string, unknown> = {},
  auth = token,
  identity?: {
    client: AuthenticatedMcpClient;
    proof: string;
    sessionId?: string;
    connectionNonce?: string;
    connectionAttestation?: string;
  },
  flags: { documentConfirmed?: boolean } = {},
) {
  const res = await fetch(`http://127.0.0.1:${server!.port}/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(identity
        ? {
            "x-nomi-mcp-client": identity.client,
            "x-nomi-mcp-client-proof": identity.proof,
            ...(identity.sessionId ? { "x-nomi-mcp-session-id": identity.sessionId } : {}),
            ...(identity.connectionNonce ? { "x-nomi-mcp-connection-nonce": identity.connectionNonce } : {}),
            ...(identity.connectionAttestation
              ? { "x-nomi-mcp-connection-attestation": identity.connectionAttestation }
              : {}),
          }
        : {}),
    },
    body: JSON.stringify({ method, params, ...(flags.documentConfirmed ? { documentConfirmed: true } : {}) }),
  });
  return { status: res.status, body: (await res.json()) as { ok: boolean; result?: unknown; error?: unknown } };
}

/** 发原始请求体：用于测顶层旁路标志（planConfirmed / spendConfirmed），它们不在 params 里。 */
async function rpcRaw(body: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${server!.port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { ok: boolean; result?: unknown; error?: string } };
}

beforeEach(async () => {
  mockedDocumentsRoot = makeTempDir("nomi-rpc-documents-");
  mockedUserDataRoot = makeTempDir("nomi-rpc-user-data-");
  delete process.env.NOMI_PROJECTS_DIR;
  openProjectId = "";
  rendererUp = false;
  spendReply = { confirmed: true };
  planReply = { confirmed: true };
  rendererOps = [];
  documentReply = { applied: true, revision: 7, contentHash: "document-hash" };
  lastRunTaskReq = null;
  token = ensureToken();
  server = await startRpcServer({
    runTask: async (req) => {
      lastRunTaskReq = req.request as { extras?: Record<string, unknown> };
      return { id: "t", status: "succeeded", assets: [{ type: "image", url: "nomi-local://x" }] };
    },
    isProjectOpen: (id) => Boolean(openProjectId) && id === openProjectId,
  });
});

afterEach(async () => {
  if (server) await server.close();
  server = null;
  delete process.env.NOMI_PROJECTS_DIR;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("capabilityCore/rpcServer", () => {
  it("无 token / 错 token → 401", async () => {
    const noAuth = await rpc("ping", {}, "");
    expect(noAuth.status).toBe(401);
    const badAuth = await rpc("ping", {}, "deadbeef");
    expect(badAuth.status).toBe(401);
  });

  it("对 token → ping ok", async () => {
    const res = await rpc("ping");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns the current desktop locale only to a registered MCP client", async () => {
    const denied = await rpc("nomi_get_locale");
    expect(denied).toMatchObject({ status: 403, body: { ok: false } });
    const proof = signMcpClient("codex")!;
    const allowed = await rpc("nomi_get_locale", {}, token, { client: "codex", proof });
    expect(allowed).toMatchObject({ status: 200, body: { ok: true, result: { locale: expect.any(String) } } });
  });

  it("owns an approved MCP document.write receipt in the main RPC boundary", async () => {
    await server!.close();
    const root = makeTempDir("nomi-rpc-document-receipt-");
    fs.mkdirSync(path.join(root, ".nomi"), { recursive: true });
    const binding = {
      projectId: "project-document-receipt",
      immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
      projectGeneration: 1,
    } as const;
    const receiptService = createProjectAgentProposalReceiptService({ projectRoot: root, binding });
    let resolvedReceiptService: typeof receiptService | undefined = receiptService;
    const mismatchRoot = makeTempDir("nomi-rpc-document-receipt-mismatch-");
    fs.mkdirSync(path.join(mismatchRoot, ".nomi"), { recursive: true });
    const mismatchedReceiptService = createProjectAgentProposalReceiptService({
      projectRoot: mismatchRoot,
      binding: { ...binding, immutableProjectUuid: "22222222-2222-4222-8222-222222222222" },
    });
    const proof = signMcpClient("codex")!;
    const context = createMcpConnectionContext({
      client: "codex",
      proof,
      randomSecret: () => "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
    });
    rendererUp = true;
    openProjectId = binding.projectId;
    server = await startRpcServer({
      runTask: async () => ({ id: "t", status: "succeeded", assets: [] }),
      isProjectOpen: (id) => id === binding.projectId,
      projectSessionAuthority: {
        verifyLease: vi.fn(async () => ({
          projectId: binding.projectId,
          immutableProjectUuid: binding.immutableProjectUuid,
          projectGeneration: binding.projectGeneration,
          canonicalRootDigest: "root-digest",
        })),
      } as never,
      proposalReceiptFor: (candidate) => candidate.projectId === binding.projectId ? resolvedReceiptService : undefined,
    });

    const identity = { client: "codex" as const, proof, connectionAttestation: getMcpConnectionAttestation(context) };
    rendererOps = [];
    const unconfirmed = await rpc(
      "document.write",
      { leaseHandle: "verified-lease", projectId: binding.projectId, operation: "append", content: "must confirm" },
      token,
      identity,
    );
    expect(unconfirmed).toMatchObject({ status: 403, body: { ok: false, error: { code: "human_approval_required" } } });
    expect(rendererOps).not.toContain("document.write");

    resolvedReceiptService = undefined;
    const missingReceipt = await rpc(
      "document.write",
      { leaseHandle: "verified-lease", projectId: binding.projectId, operation: "append", content: "no receipt" },
      token,
      identity,
      { documentConfirmed: true },
    );
    expect(missingReceipt).toMatchObject({ status: 501, body: { ok: false } });

    resolvedReceiptService = mismatchedReceiptService;
    const mismatchedReceipt = await rpc(
      "document.write",
      { leaseHandle: "verified-lease", projectId: binding.projectId, operation: "append", content: "wrong binding" },
      token,
      identity,
      { documentConfirmed: true },
    );
    expect(mismatchedReceipt).toMatchObject({ status: 409, body: { ok: false } });

    resolvedReceiptService = receiptService;

    const result = await rpc(
      "document.write",
      { leaseHandle: "verified-lease", projectId: binding.projectId, operation: "append", content: "from MCP" },
      token,
      identity,
      { documentConfirmed: true },
    );

    expect(result).toMatchObject({ status: 200, body: { ok: true, result: documentReply } });
    expect(rendererOps).toContain("document.write");
    expect(fs.existsSync(projectAgentProposalReceiptPath(root))).toBe(true);
    expect(receiptService.read()).toMatchObject({
      revision: 2,
      lifecycle: "committed",
      proposal: { proposalId: expect.stringMatching(/^mcp-document-/) },
    });

    const nonDocument = await rpc(
      "timeline.read",
      { leaseHandle: "verified-lease", projectId: binding.projectId },
      token,
      identity,
    );
    expect(nonDocument).toMatchObject({ status: 200, body: { ok: true, result: { timeline: [] } } });
    expect(rendererOps).toContain("timeline.read");

    const assetRead = await rpc(
      "asset.read",
      { leaseHandle: "verified-lease", projectId: binding.projectId },
      token,
      identity,
    );
    expect(assetRead).toMatchObject({ status: 200, body: { ok: true, result: { assets: [] } } });
    expect(rendererOps).toContain("asset.read");
  });

  it("accepts only a Nomi-signed MCP client as Production Run authority", async () => {
    const created = await rpc("project.create", { name: "signed-origin" });
    const projectId = (created.body.result as { id: string }).id;
    const codexProof = signMcpClient("codex")!;
    const signed = await rpc(
      "production.start",
      {
        projectId,
        playbook: "brand.promo",
        host: "cursor",
        brief: { goal: "signed origin" },
      },
      token,
      { client: "codex", proof: codexProof },
    );
    expect((signed.body.result as { origin: { host: string } }).origin.host).toBe("codex");

    const forged = await rpc(
      "production.start",
      {
        projectId,
        playbook: "brand.promo",
        host: "codex",
        brief: { goal: "forged origin" },
      },
      token,
      { client: "cursor", proof: codexProof },
    );
    expect((forged.body.result as { origin: { host: string } }).origin.host).toBe("external");
  });

  it("preserves one transport-owned connection across RPC create → selection → session and rejects replay on another connection", async () => {
    await server!.close();
    const authorityDir = makeTempDir("nomi-rpc-project-session-");
    const repositoryDeps = getWorkspaceRepositoryDeps();
    const generationPolicy = createMcpGenerationPolicy({ env: {} });
    const runtime = createProjectSessionRuntime({
      generationPolicy,
      leaseFilePath: path.join(authorityDir, "project-leases-v2"),
      leaseMacKey: "rpc-project-session-key",
      leaseStoreMacKey: "rpc-project-session-store-key",
      getOpenProjectSelection: () => null,
      resolveProjectRoot: (projectId) => resolveWorkspaceProjectDir(projectId, repositoryDeps),
      ensureProjectIdentity: (actualRootPath) => ensureWorkspaceProjectIdentity(actualRootPath),
      readProject: (projectId) => readWorkspaceProject(projectId, repositoryDeps),
      isServerAllowlisted: () => false,
    });
    server = await startRpcServer({
      runTask: async () => ({ id: "t", status: "succeeded", assets: [] }),
      generationPolicy,
      projectSessionAuthority: runtime.authority,
      canvasReadExecutionRuntime: canvasReadRuntime("mcp-executor-node"),
    });
    const proof = signMcpClient("codex")!;
    const context = createMcpConnectionContext({
      client: "codex",
      proof,
      randomSecret: () => "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    const connection = {
      client: "codex" as const,
      proof,
      connectionAttestation: getMcpConnectionAttestation(context),
    };

    const created = await rpc("project.create", { name: "RPC connection project" }, token, connection);
    const createdResult = created.body.result as { id: string; projectSelectionHandle: string };
    expect(createdResult.projectSelectionHandle).toEqual(expect.any(String));

    const opened = await rpc(
      "nomi_session_open",
      {
        projectSelectionHandle: createdResult.projectSelectionHandle,
      },
      token,
      connection,
    );
    expect(opened.body.result).toMatchObject({
      protocolVersion: 2,
      projectId: createdResult.id,
      sessionId: context.sessionId,
      effectiveScope: expect.arrayContaining([
        "asset:read",
        "canvas:read",
        "canvas:write",
        "document:read",
        "document:write",
        "export:read",
        "timeline:read",
      ]),
    });
    const canonicalRead = await rpc(
      "canvas.read",
      {
        projectId: createdResult.id,
        leaseHandle: (opened.body.result as { leaseHandle: string }).leaseHandle,
      },
      token,
      connection,
    );
    expect(canonicalRead).toMatchObject({
      status: 200,
      body: { ok: true, result: { nodes: [{ id: "mcp-executor-node" }], edges: [], groups: [], selectedNodeIds: [] } },
    });

    const otherContext = createMcpConnectionContext({
      client: "codex",
      proof,
      randomSecret: () => "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    });
    const replay = await rpc(
      "nomi_session_open",
      {
        projectSelectionHandle: createdResult.projectSelectionHandle,
      },
      token,
      {
        ...connection,
        connectionAttestation: getMcpConnectionAttestation(otherContext),
      },
    );
    expect(replay.status).toBe(403);
    expect(replay.body.ok).toBe(false);
  });

  it("rejects a stolen lease replayed by a second same-client transport over the whole RPC boundary", async () => {
    await server!.close();
    const authorityDir = makeTempDir("nomi-rpc-project-session-replay-");
    const repositoryDeps = getWorkspaceRepositoryDeps();
    const generationPolicy = createMcpGenerationPolicy({ env: {} });
    const runtime = createProjectSessionRuntime({
      generationPolicy,
      leaseFilePath: path.join(authorityDir, "project-leases-v2"),
      leaseMacKey: "rpc-project-session-replay-key",
      leaseStoreMacKey: "rpc-project-session-replay-store-key",
      getOpenProjectSelection: () => null,
      resolveProjectRoot: (projectId) => resolveWorkspaceProjectDir(projectId, repositoryDeps),
      ensureProjectIdentity: (actualRootPath) => ensureWorkspaceProjectIdentity(actualRootPath),
      readProject: (projectId) => readWorkspaceProject(projectId, repositoryDeps),
      isServerAllowlisted: () => false,
    });
    server = await startRpcServer({
      runTask: async () => ({ id: "t", status: "succeeded", assets: [] }),
      generationPolicy,
      projectSessionAuthority: runtime.authority,
      canvasReadExecutionRuntime: canvasReadRuntime("must-not-read-stolen-lease"),
    });
    const proof = signMcpClient("codex")!;
    const originalContext = createMcpConnectionContext({
      client: "codex",
      proof,
      randomSecret: () => "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    const original = {
      client: "codex" as const,
      proof,
      connectionAttestation: getMcpConnectionAttestation(originalContext),
    };
    const created = await rpc("project.create", { name: "RPC replay project" }, token, original);
    const createdResult = created.body.result as { id: string; projectSelectionHandle: string };
    const opened = await rpc(
      "nomi_session_open",
      {
        projectSelectionHandle: createdResult.projectSelectionHandle,
      },
      token,
      original,
    );
    const leaseHandle = (opened.body.result as { leaseHandle: string }).leaseHandle;
    const leakedClaims = JSON.parse(Buffer.from(leaseHandle, "base64url").toString("utf8")) as {
      sessionId: string;
      connectionNonce: string;
    };
    expect(leakedClaims).toMatchObject({
      sessionId: originalContext.sessionId,
      connectionNonce: originalContext.connectionNonce,
    });

    const replayedOldHeaders = await rpc(
      "canvas.read",
      {
        projectId: createdResult.id,
        leaseHandle,
      },
      token,
      {
        client: "codex",
        proof,
        sessionId: leakedClaims.sessionId,
        connectionNonce: leakedClaims.connectionNonce,
      },
    );
    const secondContext = createMcpConnectionContext({
      client: "codex",
      proof,
      randomSecret: () => "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    });
    expect(secondContext.sessionId).not.toBe(originalContext.sessionId);
    expect(secondContext.connectionNonce).not.toBe(originalContext.connectionNonce);
    const secondTransportSecret = await rpc(
      "canvas.read",
      {
        projectId: createdResult.id,
        leaseHandle,
      },
      token,
      {
        client: "codex",
        proof,
        sessionId: leakedClaims.sessionId,
        connectionNonce: leakedClaims.connectionNonce,
        connectionAttestation: getMcpConnectionAttestation(secondContext),
      },
    );

    expect(replayedOldHeaders.status).toBe(403);
    expect(secondTransportSecret.status).toBe(403);
  });

  it("rejects partial transport identity and forged proof before project-session dispatch", async () => {
    const proof = signMcpClient("codex")!;
    const base = { client: "codex" as const, proof };
    const context = createMcpConnectionContext({
      ...base,
      randomSecret: () => "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    });

    const sessionOnly = await rpc("nomi_session_open", {}, token, {
      ...base,
      sessionId: "mcp-session:partial-session",
    });
    const nonceOnly = await rpc("nomi_session_open", {}, token, {
      ...base,
      connectionNonce: "partial-nonce",
    });
    const forged = await rpc("nomi_session_open", {}, token, {
      ...base,
      proof: `${proof}x`,
      connectionAttestation: getMcpConnectionAttestation(context),
    });

    expect(sessionOnly.status).toBe(403);
    expect(nonceOnly.status).toBe(403);
    expect(forged.status).toBe(403);
  });

  it("executes local bearer canvas read only through the verified internal adapter", async () => {
    await server!.close();
    server = await startRpcServer({
      runTask: async () => ({ id: "t", status: "succeeded", assets: [] }),
      canvasReadExecutionRuntime: canvasReadRuntime("internal-executor-node"),
    });
    const created = await rpc("project.create", { name: "RPC 项目" });
    const projectId = (created.body.result as { id: string }).id;
    expect(projectId).toBeTruthy();

    const added = await rpc("canvas.addNodes", { projectId, nodes: [{ kind: "text", prompt: "hi" }] });
    expect(added.body.ok).toBe(true);
    const ids = (added.body.result as { ids: string[] }).ids;
    expect(ids).toHaveLength(1);

    const read = await rpc("canvas.read", { projectId });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ ok: true, result: { nodes: [{ id: "internal-executor-node" }] } });

    const forged = await rpc("canvas.read", { projectId, caller: { kind: "internal", principal: "forged" } });
    expect(forged.status).toBe(403);
    expect(forged.body).toMatchObject({ ok: false, error: { code: "capability_authority_invalid" } });
  });

  it("never downgrades MCP-looking canvas traffic without exact connection proof to internal bearer", async () => {
    await server!.close();
    server = await startRpcServer({
      runTask: async () => ({ id: "t", status: "succeeded", assets: [] }),
      canvasReadExecutionRuntime: canvasReadRuntime("must-not-run"),
    });
    const created = await rpc("project.create", { name: "No MCP fallback" });
    const projectId = (created.body.result as { id: string }).id;
    const proof = signMcpClient("codex")!;
    const read = await rpc("canvas.read", { projectId }, token, { client: "codex", proof });
    expect(read.status).toBe(403);
    expect(read.body).toMatchObject({ ok: false, error: { code: "lease_required" } });
  });

  it("propagates a closed HTTP request into the selected canvas read port and drops the late reply", async () => {
    await server!.close();
    let markStarted!: () => void;
    let markAborted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const portAborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    const executionRuntime = Object.freeze({
      executor: createMainCapabilityExecutorRegistry({
        resolveCanvasReadPort: async () => ({
          read: ({ signal }) =>
            new Promise((_resolve, reject) => {
              markStarted();
              signal.addEventListener(
                "abort",
                () => {
                  markAborted();
                  reject(new Error("/private/late-reply"));
                },
                { once: true },
              );
            }),
        }),
      }),
    });
    server = await startRpcServer({
      runTask: async () => ({ id: "t", status: "succeeded", assets: [] }),
      canvasReadExecutionRuntime: executionRuntime,
    });
    const created = await rpc("project.create", { name: "Abort read" });
    const projectId = (created.body.result as { id: string }).id;
    const controller = new AbortController();
    const request = fetch(`http://127.0.0.1:${server.port}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ method: "canvas.read", params: { projectId } }),
      signal: controller.signal,
    });
    await started;
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    await portAborted;
  });

  it("retired generate route → 404 且不触发 runTask", async () => {
    const created = await rpc("project.create", { name: "gen" });
    const projectId = (created.body.result as { id: string }).id;
    const gen = await rpc("generate", { projectId, intent: "image", prompt: "cat", vendor: "v", modelKey: "m" });
    expect(gen.status).toBe(404);
    expect(gen.body).toMatchObject({ ok: false, error: "未知方法: generate" });
    expect(lastRunTaskReq).toBeNull();
    expect(rendererOps).toEqual([]);
  });

  it("A 模式无渲染层（测试环境）：改打开中的项目 → 降级磁盘网关，照常落盘（不再硬 409）", async () => {
    // 新路由：app 开着 + 项目打开 → 本应走渲染层网关实时应用；测试环境无渲染层可达，
    // 降级到磁盘网关直写盘（isRendererAvailable=false）。证明不再有「打开即拒绝」的死路。
    const created = await rpc("project.create", { name: "打开中的项目" });
    const projectId = (created.body.result as { id: string }).id;
    openProjectId = projectId;
    const added = await rpc("canvas.addNodes", { projectId, nodes: [{ kind: "text", prompt: "live" }] });
    expect(added.status).toBe(200);
    expect(added.body.ok).toBe(true);
    expect((added.body.result as { ids: string[] }).ids).toHaveLength(1);
    const saved = readWorkspaceProject(projectId, getWorkspaceRepositoryDeps());
    const payload = saved?.payload;
    const generationCanvas =
      payload && typeof payload === "object" && "generationCanvas" in payload
        ? (payload.generationCanvas as { nodes?: unknown[] })
        : undefined;
    expect(generationCanvas?.nodes).toHaveLength(1);
  });

  it("retired generate route → 不因 hybrid 窗口状态绕过语义生成入口", async () => {
    // `generate` 已从 dispatcher retirement；窗口状态和网关选择不能把它复活成旧付费路径。
    rendererUp = true;
    spendReply = { confirmed: true };
    const created = await rpc("project.create", { name: "后台项目" });
    const projectId = (created.body.result as { id: string }).id;
    // 不设 openProjectId → 目标项目不在前台，命中 hybrid 条件。
    const gen = await rpc("generate", { projectId, intent: "image", prompt: "robot", vendor: "v", modelKey: "m" });
    expect(gen.status).toBe(404);
    expect(gen.body).toMatchObject({ ok: false, error: "未知方法: generate" });
    expect(rendererOps).toEqual([]);
    expect(lastRunTaskReq).toBeNull();
  });

  it("retired generate route → spendConfirmed 也不能复活旧付费入口", async () => {
    // 客户端预确认只作用于仍存在的 canonical route；不能把 retired alias 变成静默付费调用。
    rendererUp = true;
    spendReply = { confirmed: false };
    const created = await rpc("project.create", { name: "已在客户端确认" });
    const projectId = (created.body.result as { id: string }).id;
    const gen = await rpcRaw({
      method: "generate",
      params: { projectId, intent: "image", prompt: "robot", vendor: "v", modelKey: "m" },
      spendConfirmed: true,
    });
    expect(gen.status).toBe(404);
    expect(gen.body).toMatchObject({ ok: false, error: "未知方法: generate" });
    expect(rendererOps).not.toContain("spend.confirm");
    expect(lastRunTaskReq).toBeNull();
  });

  it("安全：spendConfirmed 只预批付费,不顺手预批方案门(confirmPlan 仍要真人)", async () => {
    // 防「一个 flag 顺走一串权限」：预批范围必须恰好是付费确认本身。
    rendererUp = true;
    openProjectId = "";
    const created = await rpc("project.create", { name: "预批范围" });
    const projectId = (created.body.result as { id: string }).id;
    const added = await rpcRaw({
      method: "canvas.addNodes",
      params: {
        projectId,
        nodes: [
          { kind: "text", prompt: "a" },
          { kind: "text", prompt: "b" },
        ],
      },
      spendConfirmed: true,
    });
    expect(added.body.ok).toBe(true);
    // hybrid 网关的 confirmPlan 仍走渲染层问真人——没被 spendConfirmed 带着一起放行。
    expect(rendererOps).toContain("plan.confirm");
  });

  it("retired generate route → 即使付费确认被拒也不触发旧网关", async () => {
    rendererUp = true;
    spendReply = { confirmed: false };
    const created = await rpc("project.create", { name: "后台项目-拒绝" });
    const projectId = (created.body.result as { id: string }).id;
    const gen = await rpc("generate", { projectId, intent: "image", prompt: "robot", vendor: "v", modelKey: "m" });
    expect(gen.status).toBe(404);
    expect(gen.body).toMatchObject({ ok: false, error: "未知方法: generate" });
    expect(rendererOps).toEqual([]);
    expect(lastRunTaskReq).toBeNull();
  });

  it("未知方法 → 404", async () => {
    const res = await rpc("nope");
    expect(res.status).toBe(404);
  });

  it("keeps typed generation policy details in the local RPC error payload", async () => {
    const res = await rpc("nomi_operation_create", {});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({
      code: "feature_disabled",
      nextAction: expect.any(String),
      phase: "schema_only",
      capability: "create",
    });
  });

  it("allows only a signed MCP client to request the GUI fallback for one challenge", async () => {
    await server!.close();
    const confirmGenerationInNomi = vi.fn(async (input: { challengeToken: string }) => ({
      confirmed: true,
      challengeToken: input.challengeToken,
      receiptId: "receipt-1",
    }));
    server = await startRpcServer({
      runTask: async () => ({ id: "t", status: "succeeded", assets: [] }),
      confirmGenerationInNomi,
    });
    const proof = signMcpClient("codex")!;
    const accepted = await rpc("nomi_confirm_generation_gate", { challengeToken: "signed-challenge-token" }, token, {
      client: "codex",
      proof,
    });
    expect(accepted.body).toMatchObject({ ok: true, result: { confirmed: true, receiptId: "receipt-1" } });
    const forged = await rpc("nomi_confirm_generation_gate", { challengeToken: "signed-challenge-token" });
    expect(forged.status).toBe(403);
    expect(confirmGenerationInNomi).toHaveBeenCalledTimes(1);
  });
});
