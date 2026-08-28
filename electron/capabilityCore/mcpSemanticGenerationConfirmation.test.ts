import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApprovalReceiptAuthority } from "./approvalReceipt";
import { dispatch } from "./dispatcher";
import type { McpConnectionContext } from "./mcpConnectionContext";
import { createMcpGenerationPolicy } from "./mcpGenerationPolicy";
import { createMcpProtocol, type McpTransport } from "./mcpProtocol";
import { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } from "./mcpGenerationTools";
import { createModuleRegistry } from "./moduleRegistry";
import { createProjectLeaseAuthority } from "./projectLease";
import { createProjectLeaseStore } from "./projectLeaseStore";
import { createProjectSessionAuthority } from "./projectSessionAuthority";

const roots: string[] = [];
const connection: McpConnectionContext = Object.freeze({
  authenticatedClient: "codex",
  principal: "mcp:codex",
  sessionId: "mcp-session:test",
  connectionNonce: "nonce-test",
});
const projectIdentity = Object.freeze({
  projectId: "project-1",
  immutableProjectUuid: "project-uuid",
  projectGeneration: 1,
  canonicalRootDigest: "root",
});
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["image"],
  modes: ["text-to-image"],
  parameterSchema: { aspectRatio: { type: "enum", enum: ["1:1", "16:9"] } },
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{
    providerId: "fixture-provider",
    models: [{ modelId: "fixture-model", modes: ["text-to-image"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }],
  }],
}]);

function authority(root: string) {
  return createApprovalReceiptAuthority({
    filePath: path.join(root, "receipts.json"),
    macKey: "receipt-key",
    storeMacKey: "receipt-store-key",
    keyId: "receipt-v1",
    now: () => "2026-08-23T00:00:00.000Z",
    randomId: (() => { let n = 0; return () => `receipt-${++n}`; })(),
  });
}

function leaseAuthority(root: string) {
  return createProjectLeaseAuthority({
    macKey: "lease-key",
    keyId: "lease-v1",
    store: createProjectLeaseStore({ filePath: path.join(root, "leases.json"), macKey: "lease-store-key", keyId: "lease-store-v1", now: () => "2026-08-23T00:00:00.000Z" }),
    verifyProjectIdentity: async (projectId) => {
      if (projectId !== projectIdentity.projectId) throw new Error("project identity unavailable");
      return projectIdentity;
    },
    now: () => "2026-08-23T00:00:00.000Z",
    randomId: (() => { let n = 0; return () => `lease-${++n}`; })(),
  });
}

function candidate() {
  return {
    candidateId: "candidate-1",
    revision: 1,
    moduleId: "generation.single-shot",
    providerId: "fixture-provider",
    modelId: "fixture-model",
    mode: "text-to-image",
    prompt: "A paper boat on a lake",
    parameters: { aspectRatio: "16:9" },
    references: [],
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("semantic MCP one-confirmation journey", () => {
  it("confirms in the current MCP client once, records a receipt, and starts the same operation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-semantic-confirmation-"));
    roots.push(root);
    const receipts = authority(root);
    const leases = leaseAuthority(root);
    const selection = leases.issueSelectionHandle({ ...projectIdentity, manifestDigest: "manifest", scopeSet: ["context:read", "generation:create", "generation:plan", "generation:preview", "generation:gate", "generation:read"] }, connection);
    const lease = (await leases.issueLease(selection.token, connection)).token;
    const baseOperations = createInMemoryGenerationOperationStore();
    let createdOperationId = "";
    const operations = {
      ...baseOperations,
      create(input: Parameters<typeof baseOperations.create>[0]) {
        createdOperationId = input.operationId;
        return baseOperations.create(input);
      },
    };
    const start = vi.fn(async (operation: { operationId: string; approvedReceiptId?: string }) => ({ operationId: operation.operationId, approvedReceiptId: operation.approvedReceiptId, nextAction: "provider_not_configured" }));
    const planning = createGenerationPlanningHandler({ registry, operations, start, now: () => "2026-08-23T00:00:00.000Z" });
    const runTask = vi.fn(async () => ({ status: "succeeded" }));
    const policy = createMcpGenerationPolicy({ env: { NOMI_MCP_GENERATION_SINGLE_SHOT_V1: "1" }, checkpoints: { p0Passed: true, p2Passed: true, p3Passed: true } });
    const context = {
      runTask,
      makeGateway: vi.fn(() => { throw new Error("semantic confirmation must not create a gateway"); }),
      productionRuns: { createDraft: vi.fn(), readProjection: vi.fn(), readEvents: vi.fn(), readArtifactProjection: vi.fn(), readFull: vi.fn(), command: vi.fn() },
      origin: { host: "codex" as const },
      generationPolicy: policy,
      generationPlanning: planning,
      projectSession: {
        authority: createProjectSessionAuthority({
          leaseAuthority: leases,
          generationPolicy: policy,
          resolveProjectSelection: async () => ({ ...projectIdentity, manifestDigest: "manifest" }),
        }),
        connection,
      },
      approvalReceiptAuthority: receipts,
      projectRevisionResolver: () => 1,
    };

    const protocolRef: { current?: ReturnType<typeof createMcpProtocol> } = {};
    const queue: Record<string, unknown>[] = [];
    const waiters: Array<(message: Record<string, unknown>) => void> = [];
    const transport: McpTransport = {
      send: (frame) => {
        const message = frame as Record<string, unknown>;
        if (message.method === "elicitation/create") {
          queue.push(message);
          setTimeout(() => protocolRef.current?.handleIncoming({ jsonrpc: "2.0", id: message.id, result: { action: "accept", content: { confirm: true, attestation: "signed-client-attestation" } } }), 0);
          return;
        }
        const waiter = waiters.shift();
        if (waiter) waiter(message); else queue.push(message);
      },
      invoke: vi.fn((method, params) => dispatch(method, params, context as never)),
      isAppOpen: () => false,
      getAuthenticatedClient: () => "codex",
      verifyClientGenerationConfirmation: vi.fn(async (challenge: { handoff?: Record<string, unknown> }, attestation: unknown) => {
        expect(attestation).toBe("signed-client-attestation");
        const token = typeof challenge.handoff?.challengeToken === "string" ? challenge.handoff.challengeToken : "";
        const gesture = receipts.createMainProcessGestureAttestation(token, { webContentsId: 1, frameId: 1, origin: "mcp://codex", decision: "accept" });
        const receipt = receipts.mintReceipt(token, gesture);
        return { confirmed: true, receiptId: receipt.receipt.receiptId, receiptToken: receipt.token };
      }),
    };
    const protocol = createMcpProtocol(transport);
    protocolRef.current = protocol;
    const next = () => {
      const value = queue.shift();
      if (value && value.method !== "elicitation/create") return Promise.resolve(value);
      return new Promise<Record<string, unknown>>((resolve) => waiters.push(resolve));
    };
    const call = async (id: number, method: string, params?: Record<string, unknown>) => {
      protocol.handleIncoming({ jsonrpc: "2.0", id, method, params });
      return next();
    };

    await call(1, "initialize", { capabilities: { elicitation: {} }, clientInfo: { name: "Codex" } });
    const created = await call(2, "tools/call", { name: "nomi_operation_create", arguments: { leaseHandle: lease, candidate: candidate() } });
    expect(created.result).toBeTruthy();
    const operationId = createdOperationId;
    expect(operationId).toMatch(/^op-/);
    await call(3, "tools/call", { name: "nomi_preview_execution", arguments: { leaseHandle: lease, operationId } });
    const gate = await call(4, "tools/call", { name: "nomi_request_generation_gate", arguments: { leaseHandle: lease, operationId } });
    expect(gate.result).toBeTruthy();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ operationId, approvedReceiptId: expect.stringMatching(/^receipt-/) }), expect.anything());
    expect(runTask).not.toHaveBeenCalled();
    expect(transport.verifyClientGenerationConfirmation).toHaveBeenCalledTimes(1);
  });
});
