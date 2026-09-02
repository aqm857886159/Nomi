import { describe, expect, it, vi } from "vitest";

import type { RuntimeToolCall } from "../harness/runtime/runtimePort";
import type { ProjectBinding } from "../shared/projectBinding";
import type { ProjectLeaseV2 } from "./projectLease";
import { createPiGenerationTransportAdapter } from "./generationTransportAdapters";
import type { ApprovalReceiptAuthority } from "./approvalReceipt";

const binding: ProjectBinding = {
  projectId: "project-1",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
};

const lease = {
  ...binding,
  canonicalRootDigest: "test-digest",
  version: 2,
  keyId: "test",
  algorithm: "HMAC-SHA256",
  issuer: "nomi-main",
  leasePrincipal: "mcp:codex",
  sessionId: "mcp-session:test",
  connectionNonce: "nonce-test",
  manifestDigest: "manifest",
  audience: "nomi-mcp",
  issuedAt: "2026-08-31T00:00:00.000Z",
  expiresAt: "2099-08-31T00:00:00.000Z",
  nonce: "lease-nonce",
  scopeSet: ["generation:create", "generation:plan", "generation:preview", "generation:gate", "generation:submit"],
  scopeHash: "scope-hash",
  revocationEpoch: 0,
  mac: "mac",
} as ProjectLeaseV2;

const call = (toolName: string, args: unknown): RuntimeToolCall => ({
  toolCallId: `call-${toolName}`,
  toolName,
  args,
});

function authority() {
  const receipt = { receiptId: "receipt-1" } as never;
  // The adapter only exercises verify/resolve/consume; declare the full authority
  // type so the partial stub still satisfies the dependency contract.
  return {
    verifyReceipt: vi.fn(() => receipt),
    resolveReceiptToken: vi.fn(() => "receipt-token"),
    consumeReceipt: vi.fn(() => ({ receipt, replayed: false })),
  } as unknown as ApprovalReceiptAuthority;
}

describe("resident semantic generation transport", () => {
  it("keeps unrelated tools out of the generation adapter", async () => {
    const planning = vi.fn();
    const adapter = createPiGenerationTransportAdapter(binding, {
      planning,
      leaseFor: () => lease,
    });

    await expect(adapter.tryExecute(call("read_canvas_state", {}), new AbortController().signal)).resolves.toBeNull();
    expect(planning).not.toHaveBeenCalled();
  });

  it("injects the verified binding lease and keeps planning provider-free", async () => {
    const planning = vi.fn(async ({ capability, params, lease: received }) => ({ capability, params, projectId: received?.projectId }));
    const leaseFor = vi.fn(() => lease);
    const adapter = createPiGenerationTransportAdapter(binding, { planning, leaseFor });

    const result = await adapter.tryExecute(call("nomi_generation_plan", { operation: "create", prompt: "a small cat avatar" }), new AbortController().signal);

    expect(result).toMatchObject({ ok: true, result: { capability: "create", projectId: binding.projectId } });
    expect(leaseFor).toHaveBeenCalledWith(binding);
    expect(planning).toHaveBeenCalledWith(expect.objectContaining({ origin: { host: "nomi", actorId: "project-agent-host" } }));
  });

  it("maps the status intent operations to the same lease-bound canonical seam", async () => {
    const planning = vi.fn(async ({ capability, params }) => ({ capability, params }));
    const adapter = createPiGenerationTransportAdapter(binding, { planning, leaseFor: () => lease });

    const result = await adapter.tryExecute(
      call("nomi_generation_status", { operation: "reconcile", operationId: "op-1", outcome: "not_found" }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ ok: true, result: { capability: "reconcile", params: { operationId: "op-1", outcome: "not_found" } } });
    expect(planning).toHaveBeenCalledTimes(1);
  });

  it("runs one compact gate, verifies its receipt, authorizes, and starts exactly once", async () => {
    const planning = vi.fn()
      .mockResolvedValueOnce({ operationId: "op-1", model: "APIMart · image", handoff: { challengeToken: "challenge" } })
      .mockResolvedValueOnce({ operationId: "op-1", state: "submitted" });
    const requestGenerationGate = vi.fn(async () => ({ handoff: { challengeToken: "challenge" } }));
    const confirmGenerationInNomi = vi.fn(async () => ({ confirmed: true, receiptToken: "receipt-token" }));
    const authorizeGeneration = vi.fn(async () => ({ operationId: "op-1", nextAction: "start" }));
    const receipts = authority();
    const adapter = createPiGenerationTransportAdapter(binding, {
      planning,
      requestGenerationGate,
      confirmGenerationInNomi,
      authorizeGeneration,
      approvalReceiptAuthority: receipts,
      leaseFor: () => lease,
    });

    const result = await adapter.tryExecute(call("nomi_request_generation_gate", { operationId: "op-1" }), new AbortController().signal);

    expect(result).toMatchObject({ ok: true, silent: true });
    expect(requestGenerationGate).toHaveBeenCalledTimes(1);
    expect(confirmGenerationInNomi).toHaveBeenCalledWith({ challengeToken: "challenge" });
    expect(authorizeGeneration).toHaveBeenCalledTimes(1);
    expect(planning).toHaveBeenLastCalledWith(expect.objectContaining({ capability: "start" }));
    expect((receipts as unknown as { consumeReceipt: ReturnType<typeof vi.fn> }).consumeReceipt).toHaveBeenCalledWith("receipt-token");
  });

  it("rejects without starting when the user declines the gate", async () => {
    const planning = vi.fn().mockResolvedValue({ operationId: "op-1", handoff: { challengeToken: "challenge" } });
    const rejectGeneration = vi.fn();
    const adapter = createPiGenerationTransportAdapter(binding, {
      planning,
      requestGenerationGate: vi.fn(async () => ({ handoff: { challengeToken: "challenge" } })),
      confirmGenerationInNomi: vi.fn(async () => ({ confirmed: false })),
      authorizeGeneration: vi.fn(),
      approvalReceiptAuthority: authority(),
      rejectGeneration,
      leaseFor: () => lease,
    });

    const result = await adapter.tryExecute(call("nomi_request_generation_gate", { operationId: "op-1" }), new AbortController().signal);

    expect(result).toMatchObject({ ok: false, code: "generation_declined", denied: true });
    expect(rejectGeneration).toHaveBeenCalledTimes(1);
    expect(planning).not.toHaveBeenCalled();
  });
});
