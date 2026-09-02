import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CANVAS_READ_CAPABILITY,
  projectCanvasRead,
  type CanvasReadResult,
} from "../shared/agentCapabilities/canvasRead";
import { formatCanvasForAgent } from "../shared/agentCapabilities/canvasReadCompact";
import type { WorkspaceProjectIdentity } from "../workspace/workspaceProjectIdentity";
import { createMainCapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import {
  createInternalCanvasReadTransportAdapter,
  createMcpCanvasReadTransportAdapter,
  createPiCanvasReadTransportAdapter,
} from "./canvasReadTransportAdapters";
import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from "./canvasReadSurfaceRegistry";
import { MCP_CAPABILITY_RESOLVER } from "./mcpCapabilityProjection";
import { createMcpConnectionContext } from "./mcpConnectionContext";
import { createMcpGenerationPolicy } from "./mcpGenerationPolicy";
import { createMcpProtocol, type McpInvokeOptions, type McpTransport } from "./mcpProtocol";
import { createMcpStdioProjectSessionRouter } from "./mcpStdioProjectSessionRouter";
import { createProjectSessionRuntime, createVerifiedProjectSessionBinding } from "./projectSessionRuntime";
import { CAPABILITY_DIR_ENV, ensureToken, signMcpClient, verifyToken } from "./security";
import {
  assertVerifiedCapabilityInvocation,
  createInternalCanvasReadVerifiedInvocationFactory,
} from "./verifiedCapabilityInvocation";

const tempDirs: string[] = [];
const previousCapabilityDir = process.env[CAPABILITY_DIR_ENV];

const IDENTITY: WorkspaceProjectIdentity = Object.freeze({
  projectId: "project-b6",
  immutableProjectUuid: "00000000-0000-4000-8000-0000000000b6",
  projectGeneration: 6,
  canonicalRootPath: "/real/project-b6",
  canonicalRootDigest: "root-b6",
});

const RAW_CANVAS = Object.freeze({
  nodes: [
    {
      id: "node-b6",
      kind: "image",
      title: "B6 parity",
      prompt: "draw one blue frame",
      status: "success",
      position: { x: 12, y: 34 },
      result: {
        id: "result-b6",
        url: "https://provider.invalid/private-b6.png",
        providerTaskId: "private-task-b6",
        raw: { credential: "must-not-cross" },
      },
    },
  ],
  edges: [],
  groups: [],
  selectedNodeIds: ["node-b6"],
});

type ProtocolMessage = Readonly<{
  id?: unknown;
  result?: unknown;
  error?: unknown;
}>;

function makeAuthorityHarness(now: () => string = () => "2026-08-28T00:00:00.000Z") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-canvas-read-b6-"));
  tempDirs.push(dir);
  process.env[CAPABILITY_DIR_ENV] = path.join(dir, "capability");
  const bearer = ensureToken();
  const proof = signMcpClient("codex")!;
  const connection = createMcpConnectionContext({
    client: "codex",
    proof,
    randomSecret: () => "B".repeat(43),
  });
  const committedSelection = Object.freeze({
    projectId: IDENTITY.projectId,
    immutableProjectUuid: IDENTITY.immutableProjectUuid,
    projectGeneration: IDENTITY.projectGeneration,
    canonicalRootDigest: IDENTITY.canonicalRootDigest,
  });
  const runtime = createProjectSessionRuntime({
    generationPolicy: createMcpGenerationPolicy({ env: {} }),
    leaseFilePath: path.join(dir, "project-leases-v2"),
    leaseMacKey: "b6-parity-lease-key",
    leaseStoreMacKey: "b6-parity-store-key",
    leaseNow: now,
    getOpenProjectSelection: () => committedSelection,
    resolveProjectRoot: (projectId) => (projectId === IDENTITY.projectId ? IDENTITY.canonicalRootPath : null),
    ensureProjectIdentity: async () => ({ ...IDENTITY }),
    readProject: (projectId) =>
      projectId === IDENTITY.projectId
        ? {
            id: IDENTITY.projectId,
            name: "B6 project",
            version: 2,
            createdAt: 1,
            updatedAt: 1,
            savedAt: 1,
            revision: 0,
            immutableProjectUuid: IDENTITY.immutableProjectUuid,
            projectGeneration: IDENTITY.projectGeneration,
            payload: {},
          }
        : null,
    isServerAllowlisted: () => false,
  });
  const projectSession = createVerifiedProjectSessionBinding(runtime, connection);
  return { bearer, connection, projectSession, runtime };
}

async function openProjectSession(harness: ReturnType<typeof makeAuthorityHarness>) {
  return harness.runtime.authority.open({ bootstrap: { mode: "current_project" } }, harness.connection);
}

async function capturePiAuthority() {
  const ownerAuthority = createSurfaceOwnerAuthority();
  const owner = ownerAuthority.capture({
    contents: {},
    frame: {},
    webContentsId: 16,
    processId: 26,
    frameRoutingId: 36,
    origin: "file://",
    isLive: () => true,
  });
  const registry = createCanvasReadSurfaceRegistry({
    ownerAuthority,
    resolveProjectIdentity: async () => ({ ...IDENTITY }),
    randomId: () => "surface-b6",
  });
  const suspension = registry.suspend(owner, { surfaceInstanceId: "surface-instance-b6" });
  const binding = await registry.commitCanvasRead(owner, {
    projectId: IDENTITY.projectId,
    suspension,
  });
  return { registry, capturedPort: registry.captureCanvasReadPort(owner, binding) };
}

function protocolClient(transport: McpTransport) {
  const protocol = createMcpProtocol(transport);
  const queue: ProtocolMessage[] = [];
  const waiters: Array<(message: ProtocolMessage) => void> = [];
  const receive = (message: unknown) => {
    const typed = message as ProtocolMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(typed);
    else queue.push(typed);
  };
  const next = () => {
    const queued = queue.shift();
    return queued ? Promise.resolve(queued) : new Promise<ProtocolMessage>((resolve) => waiters.push(resolve));
  };
  return {
    receive,
    async call(id: number, method: string, params?: Record<string, unknown>) {
      protocol.handleIncoming({ jsonrpc: "2.0", id, method, params });
      return next();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (previousCapabilityDir === undefined) delete process.env[CAPABILITY_DIR_ENV];
  else process.env[CAPABILITY_DIR_ENV] = previousCapabilityDir;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("B6 canvas.read transport acceptance", () => {
  it("keeps Pi, MCP, and internal transports on one canonical result, target, action hash, and executor", async () => {
    const authority = makeAuthorityHarness();
    const opened = await openProjectSession(authority);
    const piAuthority = await capturePiAuthority();
    const read = vi.fn(async () => structuredClone(RAW_CANVAS));
    const executor = createMainCapabilityExecutorRegistry({
      resolveCanvasReadPort: async () => ({ read }),
    });
    const execute = vi.spyOn(executor, "execute");
    const pi = createPiCanvasReadTransportAdapter({
      registry: piAuthority.registry,
      capturedPort: piAuthority.capturedPort,
      requestId: "request-b6",
      executor,
    });
    const mcp = createMcpCanvasReadTransportAdapter({
      projectSession: authority.projectSession,
      executor,
    });
    const internal = createInternalCanvasReadTransportAdapter({
      factory: createInternalCanvasReadVerifiedInvocationFactory({
        verifyBearer: (bearer) => verifyToken(bearer),
        resolveProjectIdentity: async () => ({ ...IDENTITY }),
        randomId: () => "internal-operation-b6",
      }),
      executor,
    });
    const expected: CanvasReadResult = projectCanvasRead(RAW_CANVAS);

    const piResult = await pi.tryExecute(
      {
        toolCallId: "tool-b6",
        toolName: CANVAS_READ_CAPABILITY.aliases.pi,
        args: {},
      },
      new AbortController().signal,
    );
    const mcpResult = await mcp.execute({
      leaseHandle: opened.leaseHandle,
      projectId: IDENTITY.projectId,
    });
    const internalResult = await internal.execute({
      bearer: authority.bearer,
      requestBody: { projectId: IDENTITY.projectId },
    });

    const invocations = execute.mock.calls.map(([value]) => {
      assertVerifiedCapabilityInvocation(value);
      return value;
    });
    const canonicalResults = await Promise.all(
      execute.mock.results.map((result) => {
        if (result.type !== "return") throw new Error("canvas.read executor did not return");
        return result.value;
      }),
    );
    expect(invocations).toHaveLength(3);
    expect(invocations.map((invocation) => invocation.binding)).toEqual([
      expectedBinding(),
      expectedBinding(),
      expectedBinding(),
    ]);
    expect(invocations.map((invocation) => invocation.target)).toEqual([
      { kind: "project" },
      { kind: "project" },
      { kind: "project" },
    ]);
    expect(invocations.map((invocation) => invocation.caller.kind)).toEqual(["embedded-agent", "mcp", "internal"]);
    expect(new Set(invocations.map((invocation) => invocation.actionHash)).size).toBe(1);
    expect(canonicalResults).toEqual([expected, expected, expected]);
    expect(read).toHaveBeenCalledTimes(3);
    expect(mcpResult).toEqual(expected);
    expect(internalResult).toEqual(expected);
    expect(piResult).toEqual({ ok: true, result: formatCanvasForAgent(expected), silent: true });

    const mcpPresenter = MCP_CAPABILITY_RESOLVER.resolve(CANVAS_READ_CAPABILITY.aliases.mcp!)!.presentResult;
    const presented = mcpPresenter(mcpResult);
    expect(presented.structuredContent).toEqual(expected);
    expect(JSON.parse(presented.content[0]!.text)).toEqual(expected);
    expect(JSON.stringify(presented)).not.toContain("provider.invalid");
    expect(JSON.stringify(presented)).not.toContain("private-task-b6");
  });

  it("projects an expired real route as an open-new-session action and never as an empty canvas", async () => {
    let nowMs = Date.parse("2026-08-28T00:00:00.000Z");
    const authority = makeAuthorityHarness(() => new Date(nowMs).toISOString());
    const opened = await openProjectSession(authority);
    const read = vi.fn(async () => structuredClone(RAW_CANVAS));
    const executor = createMainCapabilityExecutorRegistry({
      resolveCanvasReadPort: async () => ({ read }),
    });
    const directRoute = createMcpStdioProjectSessionRouter<null, McpInvokeOptions>({
      projectSession: authority.projectSession,
      readLiveInstance: () => null,
      invokeViaRpc: async () => {
        throw new Error("unexpected loopback route");
      },
      invokeDirect: async (method, params, projectSession, options) => {
        const match = await createMcpCanvasReadTransportAdapter({ projectSession, executor }).tryExecute(
          method,
          params,
          options,
        );
        if (!match.handled) throw new Error(`unexpected method: ${method}`);
        return match.result;
      },
    });
    let receive: (message: unknown) => void = () => undefined;
    const client = protocolClient({
      send: (message) => receive(message),
      invoke: (method, params, options) => directRoute(method, params, options),
      isAppOpen: () => false,
    });
    receive = client.receive;
    nowMs = Date.parse(opened.expiresAt);

    const response = await client.call(1, "tools/call", {
      // 面收敛：画布只读并入 nomi_read（target=canvas）；内部仍路由到 canvas.read 传输适配器。
      name: "nomi_read",
      arguments: { target: "canvas", leaseHandle: opened.leaseHandle, projectId: IDENTITY.projectId },
    });
    const result = response.result as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
      structuredContent?: { nomiOutcome?: Record<string, unknown> };
    };
    const outcome = result.structuredContent?.nomiOutcome;

    expect(result.isError).toBe(true);
    expect(outcome).toMatchObject({ errorCode: "lease_expired" });
    expect(String(outcome?.nextAction)).toMatch(/open a new project session/i);
    expect(result.content?.[0]?.text).not.toContain("画布当前为空");
    expect(JSON.stringify(result)).not.toContain('"nodes":[]');
    expect(read).not.toHaveBeenCalled();
  });
});

function expectedBinding() {
  return {
    projectId: IDENTITY.projectId,
    immutableProjectUuid: IDENTITY.immutableProjectUuid,
    projectGeneration: IDENTITY.projectGeneration,
  };
}
