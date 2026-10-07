import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 2026-09-21：测试不许读写用户真实目录。这份文件此前经默认路径读到了**用户本人的**
// `~/.nomi/capability-core`（token / 签名密钥 / 接入会话 / handoff 队列都住那里）——
// 读到的是真人数据，写下去就是改真人数据，而且一台机器一个结果：`mcpOnboardingLoopback`
// 就是这么在这台机器上红、在别处绿的。给它一个本轮独有的空目录。
const capabilityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-rpc-server-cap-"));
vi.stubEnv("NOMI_CAPABILITY_DIR", capabilityRoot);

import { startRpcServer, type RpcServerHandle } from "./rpcServer";
import { ensureToken, signMcpClient, type AuthenticatedMcpClient } from "./security";
import { createProjectSessionRuntime } from "./projectSessionRuntime";
import { createMcpConnectionContext, getMcpConnectionAttestation } from "./mcpConnectionContext";
import { getWorkspaceRepositoryDeps } from "../runtimePaths";
import { readWorkspaceProject, resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";
import { ensureWorkspaceProjectIdentity } from "../workspace/workspaceProjectIdentity";
import { createMainCapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import { createProjectAgentProposalReceiptService } from "./projectAgentProposalReceiptStore";
import { projectAgentProposalReceiptPath } from "./projectAgentProposalReceiptStore";

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
    if (op === "document.write") return documentReply;
    if (op === "timeline.read") return { timeline: [] };
    if (op === "asset.read") return { assets: [] };
    // 确认卡等的是人，必须走 requestRendererDecision——走到这里就是把墙钟期限放回了审批路径。
    if (op === "spend.confirm" || op === "plan.confirm") throw new Error(`确认卡不得走带超时的桥: ${op}`);
    // hybrid 网关读写应走盘,绝不该把 canvas.* 转给渲染层——命中即测试失败。
    throw new Error(`hybrid 不应调用渲染层 op: ${op}`);
  },
  // 2026-09-11：等真人作答的那条没有 timeoutMs 参数，活性靠「渲染层还在不在」。
  requestRendererDecision: async (op: string) => {
    rendererOps.push(op);
    if (op === "spend.confirm") return spendReply;
    if (op === "plan.confirm") return planReply;
    throw new Error(`不该用等人的桥发这个 op: ${op}`);
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
async function rpcRaw(
  body: Record<string, unknown>,
  identity?: { client: AuthenticatedMcpClient; proof: string; connectionAttestation?: string },
) {
  const res = await fetch(`http://127.0.0.1:${server!.port}/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(identity
        ? {
            "x-nomi-mcp-client": identity.client,
            "x-nomi-mcp-client-proof": identity.proof,
            ...(identity.connectionAttestation
              ? { "x-nomi-mcp-connection-attestation": identity.connectionAttestation }
              : {}),
          }
        : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { ok: boolean; result?: unknown; error?: string } };
}

/**
 * 画布写要租约（2026-09-21 删掉 legacy `canvas.addNodes/connect/setPrompt/deleteNodes` 之后，
 * 裸 bearer 一条写路都没有）。这个夹具给一份已验证的会话 + 连接证明，让断言落在被测的那件事上。
 */
async function leasedCanvasWriteFixture(projectId: string, randomSecret: string) {
  await server!.close();
  server = await startRpcServer({
    runTask: async (req) => {
      lastRunTaskReq = req.request as { extras?: Record<string, unknown> };
      return { id: "t", status: "succeeded", assets: [] };
    },
    isProjectOpen: (id) => Boolean(openProjectId) && id === openProjectId,
    projectSessionAuthority: {
      verifyLease: vi.fn(async () => ({
        projectId,
        immutableProjectUuid: "33333333-3333-4333-8333-333333333333",
        projectGeneration: 1,
        canonicalRootDigest: "root-digest",
      })),
    } as never,
  });
  const proof = signMcpClient("codex")!;
  const context = createMcpConnectionContext({ client: "codex", proof, randomSecret: () => randomSecret });
  return {
    connection: { client: "codex" as const, proof, connectionAttestation: getMcpConnectionAttestation(context) },
    params: (extra: Record<string, unknown>) => ({ leaseHandle: "verified-lease", projectId, ...extra }),
  };
}

beforeEach(async () => {
  mockedDocumentsRoot = makeTempDir("nomi-rpc-documents-");
  mockedUserDataRoot = makeTempDir("nomi-rpc-user-data-");
  vi.stubEnv("NOMI_PROJECTS_DIR", undefined);
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
  vi.stubEnv("NOMI_PROJECTS_DIR", undefined);
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
    expect(forged).toMatchObject({ status: 403, body: { ok: false, error: { code: "mcp_connection_unauthenticated" } } });
  });

  it("preserves one transport-owned connection across RPC create → selection → session and rejects replay on another connection", async () => {
    await server!.close();
    const authorityDir = makeTempDir("nomi-rpc-project-session-");
    const repositoryDeps = getWorkspaceRepositoryDeps();
    const runtime = createProjectSessionRuntime({
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
    const runtime = createProjectSessionRuntime({
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
    expect(forged).toMatchObject({ status: 403, body: { ok: false, error: { code: "mcp_connection_unauthenticated" } } });
    for (const method of ["skills.list", "project.list"]) {
      const missingAttestation = await rpc(method, {}, token, { ...base, proof: "invalid-proof" });
      expect(missingAttestation).toMatchObject({ status: 403, body: { ok: false, error: { code: "mcp_connection_unauthenticated" } } });
    }
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

    // 2026-09-21：这一格原来拿 legacy `canvas.addNodes` 当脚手架播个节点。那条路已删——
    // 裸 bearer 写画布现在是 404（方法不存在），走语义面是 403（要会话）。两条一起钉住。
    const legacyWrite = await rpc("canvas.addNodes", { projectId, nodes: [{ kind: "text", prompt: "hi" }] });
    expect(legacyWrite.status).toBe(404);
    const semanticWrite = await rpc("canvas.write", {
      projectId,
      operation: "create_canvas_nodes",
      summary: "创建画布节点",
      nodes: [{ clientId: "c-1", kind: "text", title: "镜 1", prompt: "hi" }],
    });
    expect(semanticWrite.status).toBe(403);

    const read = await rpc("canvas.read", { projectId });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ ok: true, result: { nodes: [{ id: "internal-executor-node" }] } });

    const forged = await rpc("canvas.read", { projectId, caller: { kind: "internal", principal: "forged" } });
    expect(forged.status).toBe(403);
    expect(forged.body).toMatchObject({ ok: false, error: { code: "capability_authority_invalid" } });
  });

  it("a refusal is not a fault: 自报更松的信任档 → 403 + human_approval_required，不是 500", async () => {
    // 2026-09-21 真机探针先拿到的是 HTTP 500——调用方读到「Nomi 崩了」，真相是「Nomi 在等你点头」。
    // 领域层抛的授权拒绝有公开码，状态码要跟着它走。
    const created = await rpc("project.create", { name: "信任档自报" });
    const projectId = (created.body.result as { id: string }).id;
    const denied = await rpc("production.start", {
      projectId, playbook: "brand.promo", brief: { goal: "probe" }, trustLevel: "budget_only",
    });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ ok: false, error: { code: "human_approval_required" } });
    // 非法值仍是 400（这条分支还在跑，阳性对照）。
    const invalid = await rpc("production.start", {
      projectId, playbook: "brand.promo", brief: { goal: "probe" }, trustLevel: "anything",
    });
    expect(invalid.status).toBe(400);
    // 收紧照收。
    const tightened = await rpc("production.start", {
      projectId, playbook: "brand.promo", brief: { goal: "probe tighten" }, trustLevel: "confirm_all",
    });
    expect(tightened.status).toBe(200);
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
    const fixture = await leasedCanvasWriteFixture(projectId, "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE");
    const added = await rpc(
      "canvas.write",
      fixture.params({
        operation: "create_canvas_nodes",
        summary: "创建画布节点",
        nodes: [{ clientId: "c-1", kind: "text", title: "镜 1", prompt: "live" }],
      }),
      token,
      fixture.connection,
    );
    expect(added.status).toBe(200);
    expect(added.body.ok).toBe(true);
    expect((added.body.result as { affectedNodeIds: string[] }).affectedNodeIds).toHaveLength(1);
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

  it("客户端自报 spendConfirmed 不再是付费通路（retired alias 照样 404）", async () => {
    // 2026-09-11 删第二扇门后：请求体顶层那个自报位已不在协议里，塞了也什么都不发生。
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

  it("安全：塞 spendConfirmed 也不顺手预批方案门(confirmPlan 仍要真人)", async () => {
    // 防「一个 flag 顺走一串权限」：这个自报位已被删，方案门必须照旧问真人。
    rendererUp = true;
    openProjectId = "";
    const created = await rpc("project.create", { name: "预批范围" });
    const projectId = (created.body.result as { id: string }).id;
    const fixture = await leasedCanvasWriteFixture(projectId, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
    rendererUp = true;
    const added = await rpcRaw(
      {
        method: "canvas.write",
        params: fixture.params({
          operation: "create_canvas_nodes",
          summary: "创建画布节点",
          nodes: [
            { clientId: "c-1", kind: "text", title: "镜 1", prompt: "a" },
            { clientId: "c-2", kind: "text", title: "镜 2", prompt: "b" },
          ],
        }),
        spendConfirmed: true,
      },
      fixture.connection,
    );
    expect(added.body.ok).toBe(true);
    // hybrid 网关的 confirmPlan 仍走渲染层问真人。
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
    // 2026-09-21：`feature_disabled` 与 `phase` 随 env flag 一起删除。语义路现在一路走到真正
    // 该停的地方——缺一张有效的项目租约——而结构化细节（码 / 下一步 / 能力名）照常带出来。
    const res = await rpc("nomi_operation_create", {});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({
      code: "lease_required",
      nextAction: expect.any(String),
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
    expect(forged).toMatchObject({ status: 403, body: { ok: false, error: { code: "mcp_connection_unauthenticated" } } });
    expect(confirmGenerationInNomi).toHaveBeenCalledTimes(1);
  });
});
