import { describe, expect, it } from "vitest";

import { MCP_CAPABILITY_RESOLVER } from "./mcpCapabilityProjection";
import { modelToolSurfaceManifest } from "../harness/tools/modelToolSurfaceManifest";
import { createMcpProtocol } from "./mcpProtocol";

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
    await Promise.resolve();
    const listed = frames.find((frame) => (frame as { id?: number }).id === 2) as { result?: { tools?: Array<{ name: string }> } } | undefined;
    expect(listed?.result?.tools?.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "nomi_timeline_read", "nomi_timeline_edit", "nomi_export_job", "nomi_media_query",
    ]));
  });
});
