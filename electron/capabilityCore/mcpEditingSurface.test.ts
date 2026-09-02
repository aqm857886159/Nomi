import { describe, expect, it } from "vitest";

import { MCP_CAPABILITY_RESOLVER } from "./mcpCapabilityProjection";
import { modelToolSurfaceManifest } from "../harness/tools/modelToolSurfaceManifest";
import { createMcpProtocol } from "./mcpProtocol";

const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

describe("M2 semantic editing surface", () => {
  it("advertises the four editing intents through the MCP resolver", () => {
    expect(MCP_CAPABILITY_RESOLVER.list().map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "nomi_timeline_read",
      "nomi_timeline_edit",
      "nomi_export_job",
      "nomi_media_query",
    ]));
  });

  it("projects the same four intent names to the model surface", () => {
    expect(modelToolSurfaceManifest.editing.map(({ name }) => name)).toEqual([
      "nomi_timeline_read",
      "nomi_timeline_edit",
      "nomi_export_job",
      "nomi_media_query",
    ]);
  });

  it("returns the semantic intents from the real tools/list handler", async () => {
    const frames: unknown[] = [];
    const protocol = createMcpProtocol({ send: (frame) => frames.push(frame), isAppOpen: () => true, invoke: async () => ({}) });
    protocol.handleIncoming({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test" } } });
    protocol.handleIncoming({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await flush();
    const listed = frames.find((frame) => (frame as { id?: number }).id === 2) as { result?: { tools?: Array<{ name: string }> } } | undefined;
    expect(listed?.result?.tools?.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "nomi_timeline_read", "nomi_timeline_edit", "nomi_export_job", "nomi_media_query",
    ]));
  });

  it("elicits Host approval before forwarding an apply edit", async () => {
    const frames: unknown[] = [];
    const invokes: Array<{ method: string; options?: unknown }> = [];
    let resolveInvoke!: (value: unknown) => void;
    const protocol = createMcpProtocol({
      send: (frame) => frames.push(frame), isAppOpen: () => true,
      invoke: async (method, _params, options) => {
        invokes.push({ method, options });
        return new Promise((resolve) => { resolveInvoke = resolve; });
      },
    });
    protocol.handleIncoming({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: { elicitation: {} }, clientInfo: { name: "codex" } } });
    protocol.handleIncoming({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {
      name: "nomi_timeline_edit",
      arguments: { leaseHandle: "lease-a", operation: "apply", plan: { planId: "plan-a", baseRevision: "rev-a", summary: "remove one clip", operations: [{ kind: "remove", clipId: "clip-a" }] } },
    } });
    await flush();
    const challenge = frames.find((frame) => (frame as { method?: string }).method === "elicitation/create") as { id?: string } | undefined;
    expect(challenge?.id).toBe("srv-1");
    protocol.handleIncoming({ jsonrpc: "2.0", id: challenge?.id, result: { action: "accept", content: { confirm: true } } });
    await flush();
    resolveInvoke({ operation: "apply_edit_plan", ok: true, revision: "rev-b" });
    await Promise.resolve();
    expect(invokes).toHaveLength(1);
    expect(invokes[0]).toMatchObject({ method: "timeline.write", options: { planConfirmed: true } });
  });
});
