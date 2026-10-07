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
async function semanticGateJourney(options: { surface?: ConfirmationSurface; whileCardOpen?: (state: { bumpProjectRevision: () => void; cancelOperation: () => Promise<unknown> }) => unknown } = {}) {
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
    await options.whileCardOpen?.({ bumpProjectRevision, cancelOperation });
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

describe("semantic MCP one-confirmation journey", () => {
  it("confirms in the current MCP client once, records a receipt, and starts the same operation", async () => {
    const { gate, operationId, repository, start, provider, runTask, transport } = await semanticGateJourney();
    expect(gate.result).toBeTruthy();
    expect((gate.result as { isError?: boolean }).isError).not.toBe(true);
    // 批准住在「批这一份的那道门」上：start 读到的是那道门已批（operationFromRun 的 authorization 投影）。
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ operationId, authorization: expect.objectContaining({ status: "approved" }) }), expect.anything());
    const persisted = repository.read(projectIdentity.projectId, operationId);
    expect(persisted?.generationPlan).toMatchObject({ state: "sealed" });
    expect(persisted?.gates.at(-1)).toMatchObject({ status: "approved", receiptId: expect.stringMatching(/^receipt-/) });
    expect(persisted?.gates.find((item) => Boolean(item.authorizationDigest))?.status).toBe("approved");
    expect(persisted?.budget).toMatchObject({ authorized: 0, reserved: 0, actual: 0, unsettled: 0 });
    expect(provider.submit).not.toHaveBeenCalled();
    expect(runTask).not.toHaveBeenCalled();
    expect(transport.verifyClientGenerationConfirmation).toHaveBeenCalledTimes(1);
  });

  // CI C9（#1042 合并提交、#1002 首跑）时红时绿的那一下：封信封之后、决门之前，项目被保存了一次
  // （Nomi 自己落画布 / 别的镜出片 / 用户挪了一下节点）。卡上批的东西一个字没变——合同哈希、线上报文哈希、
  // 幂等键都封在信封里——所以这次确认必须照样算数（付费卡① 第 14 条：付费门的收据比的是信封封好时的版本）。
  // 两个确认面都走同一扇决门（generationDispatcher → authorizeGeneration），两个都钉住。
  for (const surface of ["client", "nomi"] as const) {
    it(`keeps a ${surface}-surface approval valid when the project is saved while the card is open`, async () => {
      const { gate, operationId, repository, start, provider, projectRevision } = await semanticGateJourney({
        surface,
        whileCardOpen: ({ bumpProjectRevision }) => bumpProjectRevision(),
      });
      const result = gate.result as { isError?: boolean; structuredContent?: { nomiOutcome?: { errorCode?: string; message?: string } } };
      expect(result.structuredContent?.nomiOutcome?.errorCode).toBeUndefined();
      expect(result.isError).not.toBe(true);
      expect(projectRevision()).toBe(2);
      const persisted = repository.read(projectIdentity.projectId, operationId);
      const spendGate = persisted?.gates.find((item) => Boolean(item.authorizationDigest));
      // 批准记的是信封封好时的版本（1），不是确认那一刻的版本（2）：发出去的东西由信封钉死。
      expect(spendGate).toMatchObject({ status: "approved", receiptId: expect.stringMatching(/^receipt-/) });
      expect(spendGate?.authorizationEnvelope?.projectRevision).toBe(1);
      expect(start).toHaveBeenCalledWith(expect.objectContaining({ operationId, authorization: expect.objectContaining({ status: "approved" }) }), expect.anything());
      expect(provider.submit).not.toHaveBeenCalled();
    });
  }

  // 反面：放松的只是「项目此刻的版本」这一项，不是整张收据。卡开着时这个 Run 被取消了——收据批的那道门
  // 已经不在等批准——决门照样拒，且一步都碰不到供应商。
  it("still refuses an approval once the gate it was minted for stopped waiting", async () => {
    const { gate, start, provider } = await semanticGateJourney({
      whileCardOpen: ({ cancelOperation }) => cancelOperation(),
    });
    const result = gate.result as { isError?: boolean; structuredContent?: { nomiOutcome?: { errorCode?: string } } };
    expect(result.isError).toBe(true);
    expect(start).not.toHaveBeenCalled();
    expect(provider.submit).not.toHaveBeenCalled();
  });
});