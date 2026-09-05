import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import type { CapabilityContract } from "../shared/agentCapabilities/capabilityContract";
import {
  CANVAS_READ_CAPABILITY,
  canvasReadResultSchema,
  canvasReadSemanticInputSchema,
  projectCanvasRead,
} from "../shared/agentCapabilities/canvasRead";
import { findUnsupportedSchemaFeatures } from "./mcpArgValidation";
import {
  CANVAS_READ_MCP_ADAPTER,
  MCP_CAPABILITY_RESOLVER,
  createMcpCapabilityResolver,
  type McpCapabilityAdapter,
} from "./mcpCapabilityProjection";
import { MCP_TOOL_RESOLVER } from "./mcpToolCatalog";
import { createMcpProtocol, type McpTransport } from "./mcpProtocol";
import { RpcTransportError } from "./mcpRpcError";

type RpcMessage = {
  id?: unknown;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
};

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}

function runNode(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { encoding: "utf8", env }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function syntheticContract(
  id: string,
  alias: string,
  exposure: CapabilityContract<unknown, unknown>["exposure"],
  effect: CapabilityContract<unknown, unknown>["effect"] = "read",
): CapabilityContract<unknown, unknown> {
  return {
    ...CANVAS_READ_CAPABILITY,
    id,
    aliases: { mcp: alias },
    effect,
    exposure,
    projections: { mcp: { description: `${id} description` } },
  };
}

function syntheticAdapter(
  contract: CapabilityContract<unknown, unknown>,
  buildTransport = vi.fn((args: Record<string, unknown>) => args),
  overrides: Partial<McpCapabilityAdapter> = {},
): McpCapabilityAdapter {
  return {
    contract,
    authority: {
      kind: "project_session",
      requiredScope: CANVAS_READ_CAPABILITY.requiredScope,
    },
    port: { kind: "canvas", access: "read" },
    semanticInputJsonSchema: { type: "object", properties: {}, additionalProperties: false },
    transportInputSchema: { type: "object", properties: {}, additionalProperties: false },
    parseCall: (args) => ({ semanticInput: {}, transport: buildTransport(args) }),
    ...overrides,
  };
}

class ProtocolHarness {
  readonly invoke = vi.fn(async (method: string): Promise<unknown> => {
    if (method === "canvas.read") return projectCanvasRead(CANVAS_SOURCE);
    if (method === "skills.list") return { skills: [] };
    throw new Error(`unexpected invoke: ${method}`);
  });
  private readonly protocol: ReturnType<typeof createMcpProtocol>;
  private readonly queue: RpcMessage[] = [];
  private readonly waiters: Array<(message: RpcMessage) => void> = [];

  constructor() {
    const transport: McpTransport = {
      invoke: this.invoke,
      isAppOpen: () => false,
      send: (message) => {
        const frame = message as RpcMessage;
        const waiter = this.waiters.shift();
        if (waiter) waiter(frame);
        else this.queue.push(frame);
      },
    };
    this.protocol = createMcpProtocol(transport);
  }

  private next(): Promise<RpcMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async call(id: number, method: string, params?: Record<string, unknown>): Promise<RpcMessage> {
    this.protocol.handleIncoming({ jsonrpc: "2.0", id, method, params });
    return this.next();
  }
}

const CANVAS_SOURCE = {
  nodes: [
    {
      id: "node-a",
      kind: "image",
      title: "A",
      prompt: "make it blue",
      position: { x: 1, y: 2 },
      result: {
        id: "result-a",
        url: "https://provider.invalid/private.png",
        providerTaskId: "secret-task",
      },
    },
  ],
  edges: [],
  groups: [],
  selectedNodeIds: ["node-a"],
};

describe("canvas.read MCP capability projection", () => {
  it("derives the semantic empty schema, then overlays only leaseHandle plus an optional project hint", () => {
    expect(CANVAS_READ_MCP_ADAPTER.contract).toBe(CANVAS_READ_CAPABILITY);
    expect(CANVAS_READ_MCP_ADAPTER.semanticInputJsonSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    expect(CANVAS_READ_MCP_ADAPTER.transportInputSchema).toEqual({
      type: "object",
      properties: { leaseHandle: { type: "string" }, projectId: { type: "string" } },
      required: ["leaseHandle"],
      additionalProperties: false,
    });
    expect(findUnsupportedSchemaFeatures(CANVAS_READ_MCP_ADAPTER.transportInputSchema)).toEqual([]);
    expect(collectKeys(CANVAS_READ_MCP_ADAPTER.transportInputSchema)).not.toEqual(
      expect.arrayContaining(["$schema", "$ref"]),
    );

    expect(CANVAS_READ_MCP_ADAPTER.parseCall({ leaseHandle: "lease-a", projectId: "project-a" })).toEqual({
      semanticInput: {},
      transport: { leaseHandle: "lease-a", projectId: "project-a" },
    });
    expect(() => CANVAS_READ_MCP_ADAPTER.parseCall({ projectId: "project-a" })).toThrow();
    expect(() =>
      CANVAS_READ_MCP_ADAPTER.parseCall({ leaseHandle: "lease-a", scopeSet: ["generation:submit"] }),
    ).toThrow();
    expect(canvasReadSemanticInputSchema.safeParse({ projectId: "project-a" }).success).toBe(false);
  });

  it("registers only the explicitly project-session-authorized canvas.read adapter", () => {
    // 9，不是 10：nomi_canvas_plan 于 2026-09-05 退役（与 nomi_canvas_edit 在 tools/list 里字节级相同）。
    expect(MCP_CAPABILITY_RESOLVER.list()).toHaveLength(9);
    const [tool] = MCP_CAPABILITY_RESOLVER.list();
    expect(tool).toMatchObject({
      name: CANVAS_READ_CAPABILITY.aliases.mcp,
      description: CANVAS_READ_CAPABILITY.projections.mcp?.description,
      method: CANVAS_READ_CAPABILITY.id,
      inputSchema: CANVAS_READ_MCP_ADAPTER.transportInputSchema,
      annotations: { readOnlyHint: true },
    });
    expect(CANVAS_READ_MCP_ADAPTER.authority).toEqual({
      kind: "project_session",
      requiredScope: "canvas:read",
    });
    expect(CANVAS_READ_MCP_ADAPTER.contract.exposure).toBe("mcp_safe");
    expect(Object.isFrozen(CANVAS_READ_MCP_ADAPTER)).toBe(true);
    expect("presentResult" in CANVAS_READ_MCP_ADAPTER).toBe(false);
  });

  it("rejects a legacy adapter clone that adds a forged dispatch method", () => {
    const forgedMethodAdapter = {
      ...CANVAS_READ_MCP_ADAPTER,
      method: "project.create",
    } as McpCapabilityAdapter & { method: string };
    const resolver = createMcpCapabilityResolver([forgedMethodAdapter]);

    expect(resolver.list()).toEqual([]);
    expect(resolver.resolve(CANVAS_READ_CAPABILITY.aliases.mcp!)).toBeUndefined();
  });

  it("does not auto-register internal-only, skill, manifest, or unrelated legacy aliases", () => {
    const hiddenBuild = vi.fn((args: Record<string, unknown>) => args);
    const internal = syntheticAdapter(
      syntheticContract("synthetic.internal", "nomi_hidden_internal", "internal_only"),
      hiddenBuild,
    );
    const unrelatedUnsupported = syntheticAdapter(
      syntheticContract("synthetic.legacy", "nomi_hidden_legacy", "legacy_unverified"),
      hiddenBuild,
      { authority: { kind: "unsupported" } as never },
    );
    const resolver = createMcpCapabilityResolver([internal, unrelatedUnsupported]);

    expect(resolver.list()).toEqual([]);
    expect(resolver.resolve("nomi_hidden_internal")).toBeUndefined();
    expect(resolver.resolve("nomi_hidden_legacy")).toBeUndefined();
    expect(resolver.resolve("skills.read")).toBeUndefined();
    expect(resolver.resolve("manifest.read")).toBeUndefined();
    expect(hiddenBuild).not.toHaveBeenCalled();
  });

  it("keeps generic mcp_safe adapters hidden when authority and port are only self-asserted", () => {
    const forgedBuild = vi.fn((args: Record<string, unknown>) => args);
    const selfAssertedSafe = {
      ...syntheticAdapter(syntheticContract("synthetic.safe", "nomi_self_asserted_safe", "mcp_safe"), forgedBuild),
      authority: { kind: "verified" },
      port: { kind: "canvas", access: "read" },
    } as unknown as McpCapabilityAdapter;
    const resolver = createMcpCapabilityResolver([selfAssertedSafe]);

    expect(resolver.list()).toEqual([]);
    expect(resolver.resolve("nomi_self_asserted_safe")).toBeUndefined();
    expect(forgedBuild).not.toHaveBeenCalled();
  });

  it("rejects a same-id legacy clone with a forged alias, raw presenter, and self-asserted read port", () => {
    const rawPresenter = vi.fn((result: unknown) => ({
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result,
    }));
    const forgedParse = vi.fn((args: Record<string, unknown>) => ({ semanticInput: {}, transport: args }));
    const forgedContract: CapabilityContract<unknown, unknown> = {
      ...CANVAS_READ_CAPABILITY,
      aliases: { mcp: "nomi_forged_canvas_read" },
      projections: { mcp: { description: "forged legacy canvas read" } },
    };
    const forgedClone = {
      ...CANVAS_READ_MCP_ADAPTER,
      contract: forgedContract,
      port: { kind: "canvas", access: "read" },
      parseCall: forgedParse,
      presentResult: rawPresenter,
    } as unknown as McpCapabilityAdapter;

    const resolver = createMcpCapabilityResolver([forgedClone]);

    expect(resolver.list()).toEqual([]);
    expect(resolver.resolve("nomi_forged_canvas_read")).toBeUndefined();
    expect(forgedParse).not.toHaveBeenCalled();
    expect(rawPresenter).not.toHaveBeenCalled();
  });

  it("does not trust an unbranded adapter's self-asserted read port for readOnlyHint", () => {
    const writeContract = syntheticContract("synthetic.write", "nomi_write", "mcp_safe", "reversible_write");
    const wrongEffect = createMcpCapabilityResolver([syntheticAdapter(writeContract)]);
    expect(wrongEffect.resolve("nomi_write")?.annotations).toBeUndefined();

    const readContract = syntheticContract("synthetic.read", "nomi_read", "mcp_safe");
    const selfAssertedRead = createMcpCapabilityResolver([syntheticAdapter(readContract)]);
    expect(selfAssertedRead.resolve("nomi_read")?.annotations).toBeUndefined();

    const wrongPort = createMcpCapabilityResolver([
      syntheticAdapter(readContract, undefined, {
        port: { kind: "canvas", access: "write" },
      } as unknown as Partial<McpCapabilityAdapter>),
    ]);
    expect(wrongPort.resolve("nomi_read")?.annotations).toBeUndefined();
  });

  it("captures an immutable registration snapshot shared by list and resolve", () => {
    const registrations: McpCapabilityAdapter[] = [CANVAS_READ_MCP_ADAPTER];
    const resolver = createMcpCapabilityResolver(registrations);
    const listed = resolver.list();
    const tool = resolver.resolve(CANVAS_READ_CAPABILITY.aliases.mcp!)!;

    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(tool)).toBe(true);
    expect(Object.isFrozen(tool.inputSchema)).toBe(true);
    expect(Object.isFrozen((tool.inputSchema.properties as Record<string, unknown>).projectId)).toBe(true);
    expect(tool.inputSchema).not.toBe(CANVAS_READ_MCP_ADAPTER.transportInputSchema);
    expect(listed[0]).toBe(tool);

    registrations.length = 0;

    expect(tool.inputSchema).not.toHaveProperty("properties.forged");
    expect(tool.build({ leaseHandle: "lease-a", projectId: "project-a" })).toEqual({
      leaseHandle: "lease-a",
      projectId: "project-a",
    });
    expect(() => ((tool as unknown as { method: string }).method = "project.create")).toThrow();
    expect(() => (listed as unknown as unknown[]).push(tool)).toThrow();
    expect(resolver.resolve(CANVAS_READ_CAPABILITY.aliases.mcp!)).toBe(tool);
  });

  it("uses the same filtered tool resolver for list identity and call lookup", () => {
    // 面收敛：画布只读并入 nomi_read；capability adapter 本身不再是独立的 MCP 面工具（不在 MCP_TOOL_RESOLVER）。
    expect(MCP_TOOL_RESOLVER.resolve(CANVAS_READ_CAPABILITY.aliases.mcp!)).toBeUndefined();
    const listed = MCP_TOOL_RESOLVER.list().find((tool) => tool.name === "nomi_read");
    expect(listed).toBeTruthy();
    expect(MCP_TOOL_RESOLVER.resolve("nomi_read")).toBe(listed);
  });

  it("keeps the total MCP resolver on one frozen snapshot for list and call", () => {
    const listed = MCP_TOOL_RESOLVER.list();
    const tool = MCP_TOOL_RESOLVER.resolve("nomi_read")!;

    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(tool)).toBe(true);
    expect(Object.isFrozen(tool.inputSchema)).toBe(true);
    if (!("annotations" in tool)) throw new Error("nomi_read annotations are missing");
    expect(Object.isFrozen(tool.annotations)).toBe(true);
    expect(listed.find((candidate) => candidate.name === tool.name)).toBe(tool);
    expect(() => ((tool as unknown as { method: string }).method = "project.create")).toThrow();
    expect(() => (listed as unknown as unknown[]).push(tool)).toThrow();
    expect(MCP_TOOL_RESOLVER.resolve(tool.name)).toBe(tool);
  });
});

describe("canvas.read MCP wire requires a verified project session lease", () => {
  it("lists the canonical projection and forwards only leaseHandle plus an optional project hint", async () => {
    const harness = new ProtocolHarness();
    const listed = await harness.call(1, "tools/list");
    const tools = (listed.result as { tools: Array<Record<string, unknown>> }).tools;
    // 面收敛：画布只读并入 nomi_read（target=canvas）。整体只读、target 是 canvas 之一。
    const read = tools.find((tool) => tool.name === "nomi_read") as { annotations?: unknown; inputSchema?: { properties?: { target?: { enum?: string[] } } } } | undefined;
    expect(read?.annotations).toMatchObject({ readOnlyHint: true });
    expect(read?.inputSchema?.properties?.target?.enum).toContain("canvas");
    expect(tools.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(["skills.read", "manifest.read", "nomi_hidden_internal", "nomi_read_canvas"]),
    );

    const called = await harness.call(2, "tools/call", {
      name: "nomi_read",
      arguments: { target: "canvas", leaseHandle: "lease-a", projectId: "project-a" },
    });
    expect(harness.invoke).toHaveBeenCalledWith("canvas.read", { leaseHandle: "lease-a", projectId: "project-a" });
    const payload = called.result as {
      content: Array<{ type: string; text: string }>;
      structuredContent: unknown;
    };
    const canonical = projectCanvasRead(CANVAS_SOURCE);
    expect(JSON.parse(payload.content[0]!.text)).toEqual(canonical);
    expect(payload.structuredContent).toEqual(canonical);
    expect(canvasReadResultSchema.safeParse(payload.structuredContent).success).toBe(true);
    expect(collectKeys(payload.structuredContent)).not.toEqual(
      expect.arrayContaining(["url", "providerTaskId", "taskId", "raw"]),
    );
  });

  it("rejects model-supplied target metadata before the verified adapter is called", async () => {
    const harness = new ProtocolHarness();
    const response = await harness.call(1, "tools/call", {
      name: "nomi_read",
      arguments: { target: "canvas", projectId: "project-a", leaseHandle: "lease-a", scopeSet: ["generation:submit"] },
    });

    expect((response.result as { isError?: boolean }).isError).toBe(true);
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("returns one fixed public error when canonical output validation sees secret raw data", async () => {
    const sentinel = "received-secret-status-sentinel";
    const secretUrl = "https://provider.invalid/should-never-cross-mcp.png";
    const canonical = projectCanvasRead(CANVAS_SOURCE);
    const unsafe = {
      ...canonical,
      nodes: [
        {
          ...canonical.nodes[0],
          status: sentinel,
          url: secretUrl,
          providerTaskId: "secret-task",
          raw: { taskId: "secret-task" },
        },
      ],
    };
    const presenter = MCP_CAPABILITY_RESOLVER.resolve(CANVAS_READ_CAPABILITY.aliases.mcp!)!.presentResult;
    expect(() => presenter(unsafe)).toThrow("capability_output_invalid");

    const harness = new ProtocolHarness();
    harness.invoke.mockResolvedValueOnce(unsafe);
    const response = await harness.call(3, "tools/call", {
      name: "nomi_read",
      arguments: { target: "canvas", leaseHandle: "lease-a", projectId: "project-a" },
    });
    const result = response.result as {
      content?: Array<{ text?: string }>;
      isError?: boolean;
      structuredContent?: { nomiOutcome?: Record<string, unknown> };
    };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("capability_output_invalid");
    expect(result.structuredContent?.nomiOutcome).toMatchObject({
      errorCode: "capability_output_invalid",
      message: "capability_output_invalid",
    });
    const wire = JSON.stringify(response);
    expect(wire).not.toContain(sentinel);
    expect(wire).not.toContain(secretUrl);
  });

  it.each([
    [
      "headless direct",
      "surface_port_stale",
      Object.assign(new Error("private direct disk cause /Users/alice/project"), { code: "surface_port_stale" }),
    ],
    [
      "GUI loopback",
      "capability_timeout",
      new RpcTransportError("private loopback cause from provider", { code: "capability_timeout" }),
    ],
  ])("keeps %s canvas-read recovery code without exposing its cause", async (_route, code, error) => {
    const harness = new ProtocolHarness();
    harness.invoke.mockRejectedValueOnce(error);

    const response = await harness.call(31, "tools/call", {
      name: "nomi_read",
      arguments: { target: "canvas", leaseHandle: "lease-a", projectId: "project-a" },
    });
    const result = response.result as {
      isError?: boolean;
      structuredContent?: { nomiOutcome?: Record<string, unknown> };
    };

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.nomiOutcome).toMatchObject({
      errorCode: code,
      message: code,
    });
    expect(JSON.stringify(response)).not.toContain("private");
    expect(JSON.stringify(response)).not.toContain("/Users/alice");
    expect(JSON.stringify(response)).not.toContain("provider");
  });

  it("keeps the non-MCP local CLI compatibility request separate from the leased MCP wire", async () => {
    const capabilityDir = mkdtempSync(join(tmpdir(), "nomi-canvas-read-cli-"));
    const token = "canvas-read-cli-token";
    let request: { authorization?: string; body?: unknown } | undefined;
    const server = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      incoming.on("end", () => {
        request = {
          authorization: incoming.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, result: { source: "loopback-test" } }));
      });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("CLI loopback server did not bind a TCP port");
      writeFileSync(join(capabilityDir, "token"), token);
      writeFileSync(join(capabilityDir, "instance.json"), JSON.stringify({ pid: process.pid, port: address.port }));

      const { stdout, stderr } = await runNode(
        [fileURLToPath(new URL("../../scripts/nomi.mjs", import.meta.url)), "canvas", "read", "project-a"],
        { ...process.env, NOMI_CAPABILITY_DIR: capabilityDir },
      );

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ source: "loopback-test" });
      expect(request).toEqual({
        authorization: `Bearer ${token}`,
        body: { method: "canvas.read", params: { projectId: "project-a" } },
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(capabilityDir, { recursive: true, force: true });
    }
  });
});
