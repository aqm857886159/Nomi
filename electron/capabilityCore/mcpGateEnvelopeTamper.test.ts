// 外部 MCP 付费门放宽「比信封封好时的版本」之后的反向保护（V-1049 独立验收写的 12 条）：卡开着时改提示词 / 模型 / 参数 / 参考图 / 撤回计划 / 放弃授权，两个确认面各一遍——确认一律被拒，start 与供应商 submit 都是 0 次。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApprovalReceiptAuthority } from "./approvalReceipt";
import { dispatch } from "./dispatcher";
import type { McpConnectionContext } from "./mcpConnectionContext";
import { createMcpProtocol, type McpTransport } from "./mcpProtocol";
import { createGenerationPlanningHandler } from "./mcpGenerationTools";
import { createModuleRegistry } from "./moduleRegistry";
import { createProjectLeaseAuthority } from "./projectLease";
import { createProjectLeaseStore } from "./projectLeaseStore";
import { createProjectSessionAuthority } from "./projectSessionAuthority";
import { createRunOwnedGenerationGateAuthority } from "./runOwnedGenerationGateAuthority";
import type { GenerationProvider } from "./generationRuntimeAdapter";
import { createProductionGenerationOperationStore } from "../productionRun/productionGenerationOperationStore";
import { createProductionRunRepository } from "../productionRun/productionRunRepository";
import { prepareProductionGenerationAuthorization } from "../productionRun/prepareProductionGenerationAuthorization";

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


type ConfirmationSurface = "client" | "nomi";

/**
 * One real semantic MCP gate journey: real protocol, real dispatcher, real Run-owned gate authority,
 * real receipts and a real durable Run repository. Only the provider start and the human click are stubs.
 * `whileCardOpen` runs after the challenge was sealed and the receipt minted, before the decide step —
 * the window in which a real confirmation card sits on screen.
 */
async function semanticGateJourney(options: { surface?: ConfirmationSurface; whileCardOpen?: (state: any) => unknown } = {}) {
  const surface = options.surface ?? "client";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-semantic-confirmation-"));
  roots.push(root);
  const receipts = authority(root);
  const leases = leaseAuthority(root);
  const selection = leases.issueSelectionHandle({ ...projectIdentity, manifestDigest: "manifest", scopeSet: ["context:read", "generation:create", "generation:plan", "generation:preview", "generation:gate", "generation:read"] }, connection);
  const lease = (await leases.issueLease(selection.token, connection)).token;
  // The project document revision is live state: every project save (canvas landing, another shot's
  // result, the user nudging a node) moves it. The sealed envelope copies it once, at gate_request.
  let projectRevision = 1;
  const bumpProjectRevision = () => { projectRevision += 1; };
  // The semantic gate is run-owned: use the durable ProductionRun operation
  // store and the same request/authorize authority as appIntegration.  The
  // previous fixture only supplied generationPlanning, so gate_decide was
  // correctly rejected by production code and the start mock never ran.
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => projectId === projectIdentity.projectId ? root : null,
    now: () => "2026-08-23T00:00:00.000Z",
  });
  const owner = {
    createGenerationDraft: repository.createGenerationDraft,
    readFull: (projectId: string, operationId: string) => {
      const run = repository.read(projectId, operationId);
      if (!run) throw new Error(`Run not found: ${operationId}`);
      return run;
    },
    command: (projectId: string, operationId: string, command: Parameters<typeof repository.execute>[2]) => repository.execute(projectId, operationId, command),
  };
  const operations = createProductionGenerationOperationStore(owner as never);
  let createdOperationId = "";
  const createOperation = operations.create.bind(operations);
  operations.create = (input) => {
    createdOperationId = input.operationId;
    return createOperation(input);
  };
  const start = vi.fn(async (operation: { operationId: string; authorization?: { status: string } }) => ({ operationId: operation.operationId, authorizationStatus: operation.authorization?.status, nextAction: "provider_not_configured" }));
  const provider: GenerationProvider = {
    providerId: "fixture-provider",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
    buildRequest: (input) => structuredClone(input),
    submit: vi.fn(async () => ({ providerTaskId: "fixture-task-1" })),
  };
  const planning = createGenerationPlanningHandler({
    registry,
    operations,
    start,
    now: () => "2026-08-23T00:00:00.000Z",
    resolveModelPricing: () => ({ cost: 0, enabled: true, specCosts: [] }),
    prepareAuthorization: ({ lease: projectLease, operation, contract, multiShot }) => prepareProductionGenerationAuthorization({
      lease: projectLease,
      projectRevision,
      operation,
      contract,
      // 授权站在真实 Run 上（`run` 必填）：不传曾经让这台 harness 恒停在 attempt=1。
      run: repository.read(operation.projectId, operation.operationId)!,
      ...(multiShot ? { multiShot } : {}),
      providers: [provider],
      resolveShotPrice: () => ({ known: true, amount: 0 }),
      now: "2026-08-23T00:00:00.000Z",
    }),
  });
  const generationAuthority = createRunOwnedGenerationGateAuthority({
    owner: owner as never,
    operations,
    planning,
    receipts,
    now: () => "2026-08-23T00:00:00.000Z",
  });
  const runTask = vi.fn(async () => ({ status: "succeeded" }));
  const context = {
    runTask,
    makeGateway: vi.fn(() => { throw new Error("semantic confirmation must not create a gateway"); }),
    productionRuns: { createDraft: vi.fn(), readProjection: vi.fn(), readEvents: vi.fn(), readArtifactProjection: vi.fn(), readFull: vi.fn(), command: vi.fn() },
    origin: { host: "codex" as const },
    generationPlanning: planning,
    requestGenerationGate: generationAuthority.requestGenerationGate,
    authorizeGeneration: generationAuthority.authorizeGeneration,
    projectSession: {
      authority: createProjectSessionAuthority({
        leaseAuthority: leases,
        resolveProjectSelection: async () => ({ ...projectIdentity, manifestDigest: "manifest" }),
      }),
      connection,
    },
    approvalReceiptAuthority: receipts,
    projectRevisionResolver: () => projectRevision,
  };

  // The human click on either confirmation surface: the main process mints the receipt for the
  // exact challenge it was shown, then the card stays open for a moment before the decide lands.
  const cancelOperation = async () => operations.cancel(projectIdentity.projectId, createdOperationId, "2026-08-23T00:00:00.000Z");
  const humanConfirms = async (challenge: { handoff?: Record<string, unknown> }, origin: string) => {
    const token = typeof challenge.handoff?.challengeToken === "string" ? challenge.handoff.challengeToken : "";
    const gesture = receipts.createMainProcessGestureAttestation(token, { webContentsId: 1, frameId: 1, origin, decision: "accept" });
    const receipt = receipts.mintReceipt(token, gesture);
    await options.whileCardOpen?.({ bumpProjectRevision, cancelOperation, operations, owner, operationId: () => createdOperationId });
    return { confirmed: true, receiptId: receipt.receipt.receiptId, receiptToken: receipt.token };
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
    isAppOpen: () => surface === "nomi",
    getAuthenticatedClient: () => "codex",
    verifyClientGenerationConfirmation: vi.fn(async (challenge: { handoff?: Record<string, unknown> }, attestation: unknown) => {
      expect(attestation).toBe("signed-client-attestation");
      return humanConfirms(challenge, "mcp://codex");
    }),
    confirmGenerationInNomi: vi.fn(async (challenge: { handoff?: Record<string, unknown> }) => humanConfirms(challenge, "app://nomi")),
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

  await call(1, "initialize", { protocolVersion: "2025-11-25", capabilities: surface === "client" ? { elicitation: {} } : {}, clientInfo: { name: "Codex", version: "1" } });
  const created = await call(2, "tools/call", { name: "nomi_operation_plan", arguments: { leaseHandle: lease, candidate: candidate() } });
  expect(created.result).toBeTruthy();
  const operationId = createdOperationId;
  expect(operationId).toMatch(/^op-/);
  await call(3, "tools/call", { name: "nomi_operation_preview", arguments: { leaseHandle: lease, operationId } });
  const gate = await call(4, "tools/call", { name: "nomi_operation_gate", arguments: { phase: "request", leaseHandle: lease, operationId } });
  return { gate, operationId, repository, start, provider, runTask, transport, projectRevision: () => projectRevision };
}


const mutations: Record<string, (st: any) => Promise<unknown>> = {
  "revise prompt": (st) => st.operations.revise(projectIdentity.projectId, st.operationId(), { patch: { prompt: "A red car" } }, "2026-08-23T00:00:00.000Z"),
  "revise model": (st) => st.operations.revise(projectIdentity.projectId, st.operationId(), { patch: { modelId: "other-model" } }, "2026-08-23T00:00:00.000Z"),
  "revise parameters": (st) => st.operations.revise(projectIdentity.projectId, st.operationId(), { patch: { parameters: { aspectRatio: "1:1" } } }, "2026-08-23T00:00:00.000Z"),
  "revise references": (st) => st.operations.revise(projectIdentity.projectId, st.operationId(), { patch: { references: [{ assetId: "x", kind: "image" }] } }, "2026-08-23T00:00:00.000Z"),
  "withdraw": (st) => st.owner.command(projectIdentity.projectId, st.operationId(), { commandId: "w1", expectedRevision: st.owner.readFull(projectIdentity.projectId, st.operationId()).revision, type: "generation.withdraw", payload: {}, issuedAt: "2026-08-23T00:00:00.000Z" }),
  "abandon": (st) => st.operations.abandonWaitingAuthorization(projectIdentity.projectId, st.operationId(), "2026-08-23T00:00:00.000Z"),
};
describe("v1049 tamper while card open", () => {
  for (const surface of ["client", "nomi"] as const) for (const [name, fn] of Object.entries(mutations)) {
    it(`${surface}: ${name} -> refused, provider untouched`, async () => {
      let mutErr: unknown;
      const { gate, start, provider, runTask, repository, operationId } = await semanticGateJourney({ surface, whileCardOpen: async (st: any) => { try { await fn(st) } catch (e) { mutErr = e } } });
      const result = gate.result as any;
      console.log(surface, name, "mutErr=", String(mutErr ?? "none").slice(0,80), "isError=", result.isError, "code=", result.structuredContent?.nomiOutcome?.errorCode, "gates=", JSON.stringify(repository.read(projectIdentity.projectId, operationId)?.gates.map((g: any) => g.status)));
      expect(result.isError).toBe(true);
      expect(start).not.toHaveBeenCalled();
      expect(provider.submit).not.toHaveBeenCalled();
      expect(runTask).not.toHaveBeenCalled();
    });
  }
});
