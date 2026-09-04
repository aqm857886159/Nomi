import { afterEach, describe, expect, it, vi } from "vitest";

import { MCP_CAPABILITY_RESOLVER } from "./mcpCapabilityProjection";
import { modelToolSurfaceManifest } from "../harness/tools/modelToolSurfaceManifest";
import { createMcpProtocol } from "./mcpProtocol";

describe("M2 semantic editing surface", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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
    await Promise.resolve();
    const listed = frames.find((frame) => (frame as { id?: number }).id === 2) as { result?: { tools?: Array<{ name: string }> } } | undefined;
    expect(listed?.result?.tools?.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "nomi_timeline_read", "nomi_timeline_edit", "nomi_export_job", "nomi_media_query",
    ]));
  });

  it("requires a real user confirmation before routing nomi_document_edit", async () => {
    const frames: unknown[] = [];
    const invoke = vi.fn(async () => ({ applied: true, revision: 2, contentHash: "hash" }));
    const protocol = createMcpProtocol({
      send: (frame) => frames.push(frame),
      isAppOpen: () => true,
      invoke,
    });
    protocol.handleIncoming({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: { elicitation: {} },
        clientInfo: { name: "Claude Code" },
      },
    });
    protocol.handleIncoming({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "nomi_document_edit",
        arguments: {
          leaseHandle: "lease-a",
          projectId: "project-a",
          operation: "append",
          content: "approved document content",
        },
      },
    });

    await vi.waitFor(() => {
      expect(frames).toContainEqual(expect.objectContaining({ method: "elicitation/create" }));
    });
    const elicitation = frames.find((frame) => (frame as { method?: string }).method === "elicitation/create") as { id: unknown };
    protocol.handleIncoming({
      jsonrpc: "2.0",
      id: elicitation.id,
      result: { action: "accept", content: { confirm: true } },
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "document.write",
      expect.objectContaining({ operation: "append", content: "approved document content" }),
      { documentConfirmed: true },
    ));
  });

  it("publishes document execution failures as typed tool errors", async () => {
    const frames: unknown[] = [];
    const invoke = vi.fn(async () => { throw new Error("document write failed"); });
    const protocol = createMcpProtocol({ send: (frame) => frames.push(frame), isAppOpen: () => true, invoke });
    protocol.handleIncoming({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: { elicitation: {} }, clientInfo: { name: "Claude Code" } },
    });
    protocol.handleIncoming({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "nomi_document_edit", arguments: { leaseHandle: "lease-a", projectId: "project-a", operation: "append", content: "失败也要是工具结果" } },
    });
    await vi.waitFor(() => expect(frames).toContainEqual(expect.objectContaining({ method: "elicitation/create" })));
    const request = frames.find((frame) => (frame as { method?: string }).method === "elicitation/create") as { id: unknown };
    protocol.handleIncoming({ jsonrpc: "2.0", id: request.id, result: { action: "accept", content: { confirm: true } } });
    await vi.waitFor(() => expect(frames).toContainEqual(expect.objectContaining({ id: 2, result: expect.objectContaining({ isError: true }) })));
    expect(frames.find((frame) => (frame as { id?: number }).id === 2)).not.toHaveProperty("error");
    expect(invoke).toHaveBeenCalledWith("document.write", expect.anything(), { documentConfirmed: true });
    protocol.dispose();
  });

  it("returns a typed denial and never routes document.write when the user refuses", async () => {
    const frames: unknown[] = [];
    const invoke = vi.fn(async () => ({ applied: true }));
    const protocol = createMcpProtocol({ send: (frame) => frames.push(frame), isAppOpen: () => true, invoke, getLocale: () => "en" });
    protocol.handleIncoming({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: { elicitation: {} }, clientInfo: { name: "Claude Code" } },
    });
    protocol.handleIncoming({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "nomi_document_edit", arguments: { leaseHandle: "lease-a", projectId: "project-a", operation: "append", content: "拒绝写入" } },
    });
    await vi.waitFor(() => expect(frames).toContainEqual(expect.objectContaining({ method: "elicitation/create" })));
    const request = frames.find((frame) => (frame as { method?: string }).method === "elicitation/create") as { id: unknown };
    protocol.handleIncoming({ jsonrpc: "2.0", id: request.id, result: { action: "decline", content: { confirm: false } } });
    await vi.waitFor(() => expect(frames).toContainEqual(expect.objectContaining({ id: 2, result: expect.objectContaining({ isError: true }) })));
    const response = frames.find((frame) => (frame as { id?: number }).id === 2) as { result?: { structuredContent?: { nomiOutcome?: Record<string, unknown> } } };
    expect(response.result?.structuredContent?.nomiOutcome).toMatchObject({ operation: "document.write", applied: false, denied: true, reason: "declined" });
    expect(frames.find((frame) => (frame as { id?: number }).id === 2)).toMatchObject({
      result: { content: [{ text: "Not applied: the document change was not approved." }] },
    });
    expect(invoke).not.toHaveBeenCalled();
    protocol.dispose();
  });

  it("keeps the existing non-document MCP tool path outside the document confirmation branch", async () => {
    const frames: unknown[] = [];
    const invoke = vi.fn(async () => ({ projects: [] }));
    const protocol = createMcpProtocol({ send: (frame) => frames.push(frame), isAppOpen: () => true, invoke });
    protocol.handleIncoming({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Codex" } },
    });
    protocol.handleIncoming({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "nomi_read", arguments: { target: "projects" } },
    });
    await vi.waitFor(() => expect(frames).toContainEqual(expect.objectContaining({ id: 2, result: expect.anything() })));
    expect(invoke).toHaveBeenCalledWith("project.list", {});
    protocol.dispose();
  });

  it("fails closed with a timeout outcome when the MCP confirmation request expires", async () => {
    vi.useFakeTimers();
    const frames: unknown[] = [];
    const invoke = vi.fn(async () => ({ applied: true }));
    const protocol = createMcpProtocol({ send: (frame) => frames.push(frame), isAppOpen: () => true, invoke });
    protocol.handleIncoming({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: { elicitation: {} }, clientInfo: { name: "Claude Code" } },
    });
    protocol.handleIncoming({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "nomi_document_edit", arguments: { leaseHandle: "lease-a", projectId: "project-a", operation: "append", content: "超时不得写入" } },
    });
    await vi.advanceTimersByTimeAsync(300_001);
    await vi.waitFor(() => expect(frames).toContainEqual(expect.objectContaining({ id: 2, result: expect.objectContaining({ isError: true }) })));
    const response = frames.find((frame) => (frame as { id?: number }).id === 2) as { result?: { structuredContent?: { nomiOutcome?: Record<string, unknown> } } };
    expect(response.result?.structuredContent?.nomiOutcome).toMatchObject({ operation: "document.write", applied: false, denied: true, reason: "timeout" });
    expect(invoke).not.toHaveBeenCalled();
    protocol.dispose();
  });
});
