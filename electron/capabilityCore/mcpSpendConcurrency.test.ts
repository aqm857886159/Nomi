import { describe, expect, it } from "vitest";

import { createMcpProtocol, MCP_REQUEST_SIGNAL, type McpTransport } from "./mcpProtocol";
import { createConfirmationBinding } from "./mcpConfirmationBinding";

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("MCP paid confirmation binding", () => {
  it("elicits once for two concurrent first-time paid requests and mints two independent grants", async () => {
    const frames: Array<Record<string, unknown>> = [];
    const invokes: Array<{
      params: Record<PropertyKey, unknown>;
      options?: { spendConfirmed?: boolean };
      resolve: (value: unknown) => void;
    }> = [];
    const transport: McpTransport = {
      send: (frame) => frames.push(frame as Record<string, unknown>),
      isAppOpen: () => true,
      invoke: async (_method, params, options) =>
        new Promise((resolve) => {
          invokes.push({ params: params as Record<PropertyKey, unknown>, options, resolve });
        }),
    };
    const protocol = createMcpProtocol(transport);
    protocol.handleIncoming({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: { elicitation: {} } },
    });
    await flush();

    const args = {
      projectId: "project-concurrency",
      vendor: "apimart",
      modelKey: "image-model",
      intent: "image",
      prompt: "a blue square",
    };
    protocol.handleIncoming({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "nomi_generate", arguments: args },
    });
    protocol.handleIncoming({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "nomi_generate", arguments: args },
    });
    await flush();
    const elicitationFrames = frames.filter((frame) => frame.method === "elicitation/create");
    expect(elicitationFrames).toHaveLength(1);
    protocol.handleIncoming({
      jsonrpc: "2.0",
      id: elicitationFrames[0].id,
      result: { action: "accept", content: { confirm: true } },
    });
    await flush();
    expect(invokes).toHaveLength(2);
    expect(invokes.every(({ options }) => options?.spendConfirmed === true)).toBe(true);
    expect(invokes[0]?.params[MCP_REQUEST_SIGNAL]).not.toBe(invokes[1]?.params[MCP_REQUEST_SIGNAL]);
    invokes[0]?.resolve({ assets: [] });
    invokes[1]?.resolve({ assets: [] });
    await flush();
    expect(frames.filter((frame) => frame.id === 2)).toHaveLength(1);
    expect(frames.filter((frame) => frame.id === 3)).toHaveLength(1);
  });

  it("shares a decline without opening a second confirmation", async () => {
    const frames: Array<Record<string, unknown>> = [];
    const transport: McpTransport = {
      send: (frame) => frames.push(frame as Record<string, unknown>),
      isAppOpen: () => true,
      invoke: async () => ({ assets: [] }),
    };
    const protocol = createMcpProtocol(transport);
    protocol.handleIncoming({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: { elicitation: {} } },
    });
    await flush();
    const args = {
      projectId: "project-decline",
      vendor: "apimart",
      modelKey: "image-model",
      intent: "image",
      prompt: "a blue square",
    };
    protocol.handleIncoming({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "nomi_generate", arguments: args },
    });
    protocol.handleIncoming({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "nomi_generate", arguments: args },
    });
    await flush();
    const elicitation = frames.find((frame) => frame.method === "elicitation/create");
    expect(elicitation).toBeTruthy();
    protocol.handleIncoming({
      jsonrpc: "2.0",
      id: elicitation?.id,
      result: { action: "decline", content: { confirm: false } },
    });
    await flush();
    expect(frames.filter((frame) => frame.method === "elicitation/create")).toHaveLength(1);
    expect(frames.filter((frame) => frame.id === 2)).toHaveLength(1);
    expect(frames.filter((frame) => frame.id === 3)).toHaveLength(1);
  });

  it("keeps empty project ids in the binding ledger with per-request keys", async () => {
    const binding = createConfirmationBinding({ isConfirmed: () => true });
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = binding.run(
      "",
      () =>
        new Promise<boolean>((resolve) => {
          releaseFirst = () => resolve(true);
        }),
    );
    const second = binding.run(
      "",
      () =>
        new Promise<boolean>((resolve) => {
          releaseSecond = () => resolve(true);
        }),
    );
    await flush();

    // Empty project ids cannot identify a shared project, but they must still be
    // represented by distinct in-flight entries instead of bypassing the ledger.
    expect(binding.size()).toBe(2);
    releaseFirst();
    releaseSecond();
    await Promise.all([first, second]);
    expect(binding.size()).toBe(0);
  });

  it("does not share confirmation between concurrent paid requests with empty project ids", async () => {
    const frames: Array<Record<string, unknown>> = [];
    const invokes: Array<{ resolve: (value: unknown) => void }> = [];
    const transport: McpTransport = {
      send: (frame) => frames.push(frame as Record<string, unknown>),
      isAppOpen: () => true,
      invoke: async () =>
        new Promise((resolve) => {
          invokes.push({ resolve });
        }),
    };
    const protocol = createMcpProtocol(transport);
    protocol.handleIncoming({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: { elicitation: {} } },
    });
    await flush();
    const args = {
      projectId: "",
      vendor: "apimart",
      modelKey: "image-model",
      intent: "image",
      prompt: "a blue square",
    };
    protocol.handleIncoming({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "nomi_generate", arguments: args },
    });
    protocol.handleIncoming({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "nomi_generate", arguments: args },
    });
    await flush();
    const elicitations = frames.filter((frame) => frame.method === "elicitation/create");
    expect(elicitations).toHaveLength(2);
    for (const frame of elicitations) {
      protocol.handleIncoming({
        jsonrpc: "2.0",
        id: frame.id,
        result: { action: "accept", content: { confirm: true } },
      });
    }
    await flush();
    expect(invokes).toHaveLength(2);
    invokes.forEach(({ resolve }) => resolve({ assets: [] }));
    await flush();
    expect(frames.filter((frame) => frame.id === 2)).toHaveLength(1);
    expect(frames.filter((frame) => frame.id === 3)).toHaveLength(1);
  });
});
