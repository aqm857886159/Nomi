import { describe, expect, it, vi } from "vitest";
import { GenerationOperationNotFoundError } from '../productionRun/productionRunErrors';
import { z } from "zod";

import type { RuntimeToolCall } from "../shared/agentCapabilities/transportContracts";
import type { ProjectBinding } from "../shared/projectBinding";
import type { ProjectLeaseV2 } from "./projectLease";
import { createPiGenerationTransportAdapter, legacyMethodSchemaForTest } from "./generationTransportAdapters";
import { generationPlanInputSchema } from "../shared/agentCapabilities/generationPlanSchemas";
import { GENERATION_METHODS } from "../shared/agentCapabilities/generation";
import { GENERATION_RESOLVE_CAPABILITY } from "../shared/agentCapabilities/generation";
import type { ApprovalReceiptAuthority } from "./approvalReceipt";

const binding: ProjectBinding = {
  projectId: "project-1",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
};

const lease = {
  ...binding,
  version: 2,
  keyId: "test",
  algorithm: "HMAC-SHA256",
  issuer: "nomi-main",
  canonicalRootDigest: "root-digest",
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
  it('C18: only typed owner absence is exposed as missing', async () => {
    const adapter = createPiGenerationTransportAdapter(binding, {
      planning: async () => { throw new GenerationOperationNotFoundError(); }, leaseFor: () => lease,
    });
    expect(await adapter.tryExecute(call('nomi_generation_status', { operation: 'read', operationId: 'missing' }), new AbortController().signal))
      .toMatchObject({ ok: false, code: 'generation_operation_not_found', message: 'generation_operation_not_found' });
  });
  it('C18: provider forged absence and synthetic secrets never become public failures', async () => {
    const adapter = createPiGenerationTransportAdapter(binding, {
      planning: async () => { throw Object.assign(new Error('synthetic-secret-token /private/project/prompt'), { code: 'generation_operation_not_found' }); },
      leaseFor: () => lease,
    });
    const result = await adapter.tryExecute(call('nomi_generation_status', { operation: 'read', operationId: 'same-id' }), new AbortController().signal);
    expect(result).toMatchObject({ ok: false, code: 'generation_execution_failed' });
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    expect(JSON.stringify(result)).not.toContain('/private/project');
  });
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

  it("marks the durable presentation when a full-auto policy decision fails", async () => {
    const planning = vi.fn(async () => ({ operation: { operationId: "op-1" } }));
    const markPolicyDecisionFailed = vi.fn();
    const adapter = createPiGenerationTransportAdapter(binding, {
      planning,
      leaseFor: () => lease,
      approvalPolicy: () => ({ mode: "direct" }),
      requestGenerationGate: vi.fn(async () => { throw new Error("gate unavailable"); }),
      authorizeGeneration: vi.fn(),
      approvalReceiptAuthority: authority(),
      markPolicyDecisionFailed,
    });

    await expect(adapter.tryExecute(
      call("nomi_generation_plan", { operation: "create", prompt: "a small cat avatar" }),
      new AbortController().signal,
    )).resolves.toMatchObject({ ok: false });
    expect(markPolicyDecisionFailed).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ operationId: "op-1" }),
      lease,
    }));
  });

  // 2026-10-12：「直接生成」档的刹车只放在策略代批这一个点。成立 = 这一次不代答（不交给画布、不铸收据、不开跑），
  // 把出价标成「要人工决定」，卡立刻摆出来；不成立 = 策略把出价里还没决定的镜交给画布（D2 第③步：和卡上点「生成」同一台）。
  describe("direct 档刹车：策略代批点退回确认卡", () => {
    const job = (shotId: string, attempt: number, status: string) => ({ stageId: "generate", attempt, status, createdAt: `2026-10-12T00:00:0${attempt}Z`, metadata: { shotId } });
    const run = (jobs: unknown[], ids: string[]) => ({
      generationPlan: { shots: ids.map((shotId) => ({ shotId })), presentations: [{ shotIds: ids, openedAt: "2026-10-12T00:00:10Z", fromGate: 0, policySnapshot: { mode: "direct" }, policyDecisionState: "pending" }] },
      gates: [], jobs, status: "running",
    }) as never;
    const make = (readRun: () => never, mode: "direct" | "request" = "direct", settled: { accepted: string[]; pending: string[]; failed: string[] } = { accepted: [], pending: [], failed: [] }) => {
      const markPolicyDecisionFailed = vi.fn();
      const requestGenerationGate = vi.fn(async () => { throw new Error("gate must not be requested"); });
      const handOverToCanvas = { handOver: vi.fn(async () => undefined), waitForSettlement: vi.fn(async () => settled) };
      const adapter = createPiGenerationTransportAdapter(binding, {
        planning: vi.fn(async () => ({ operation: { operationId: "op-1" } })),
        leaseFor: () => lease,
        approvalPolicy: () => ({ mode }),
        readRun,
        requestGenerationGate,
        authorizeGeneration: vi.fn(),
        approvalReceiptAuthority: authority(),
        markPolicyDecisionFailed,
        handOverToCanvas: handOverToCanvas as never,
      });
      return { adapter, markPolicyDecisionFailed, requestGenerationGate, handOverToCanvas };
    };
    const create = (adapter: ReturnType<typeof make>["adapter"]) => adapter.tryExecute(call("nomi_generation_plan", { operation: "create", prompt: "a small cat avatar" }), new AbortController().signal);

    it("同一镜连续失败 3 次：不交给画布、不铸收据，出价标成要人工决定，草稿照常返回", async () => {
      const { adapter, markPolicyDecisionFailed, handOverToCanvas } = make(() => run([job("s1", 1, "needs_attention"), job("s1", 2, "needs_attention"), job("s1", 3, "needs_attention")], ["s1"]));
      await expect(create(adapter)).resolves.toMatchObject({ ok: true });
      expect(handOverToCanvas.handOver).not.toHaveBeenCalled();
      expect(markPolicyDecisionFailed).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ operationId: "op-1" }) }));
    });
    it("计划外的新镜：同样退回确认卡", async () => {
      const { adapter, markPolicyDecisionFailed, handOverToCanvas } = make(() => run([job("s1", 1, "ready"), job("s2", 1, "ready")], ["s1", "s2", "s3"]));
      await expect(create(adapter)).resolves.toMatchObject({ ok: true });
      expect(handOverToCanvas.handOver).not.toHaveBeenCalled();
      expect(markPolicyDecisionFailed).toHaveBeenCalledTimes(1);
    });
    it("V-1203 F1：去掉的旧镜仍算说好的计划——同一 Run 补的新镜不交出去、出价标成要人工决定", async () => {
      const removedThenNew = () => ({
        generationPlan: {
          shots: [{ shotId: "s1", included: false }, { shotId: "s2" }],
          presentations: [{ presentationId: "p2", shotIds: ["s2"], fromGate: 1, openedAt: "2026-10-12T00:00:11Z", policySnapshot: { mode: "direct" }, policyDecisionState: "pending" }],
        },
        jobs: [job("s1", 1, "needs_attention"), job("s1", 2, "needs_attention"), job("s1", 3, "needs_attention")],
        status: "running",
      }) as never;
      const { adapter, markPolicyDecisionFailed, handOverToCanvas } = make(removedThenNew);
      await expect(create(adapter)).resolves.toMatchObject({ ok: true });
      expect(handOverToCanvas.handOver).not.toHaveBeenCalled();
      expect(markPolicyDecisionFailed).toHaveBeenCalledTimes(1);
    });
    it("刹车不成立：策略把还没决定的镜交给画布（不开制作流程自己的门），全交到 → 回「已开始」", async () => {
      const { adapter, markPolicyDecisionFailed, requestGenerationGate, handOverToCanvas } = make(() => run([], ["s1", "s2"]), "direct", { accepted: ["s1"], pending: ["s2"], failed: [] });
      await expect(create(adapter)).resolves.toMatchObject({ ok: true, result: { spendDecision: { decidedBy: "policy:full_auto" }, started: { handedToCanvas: ["s1", "s2"] } } });
      expect(handOverToCanvas.handOver).toHaveBeenCalledWith({ projectId: "project-1", runId: "op-1", shotIds: ["s1", "s2"], by: "policy", hostingAllowed: false });
      expect(requestGenerationGate).not.toHaveBeenCalled();
      expect(markPolicyDecisionFailed).not.toHaveBeenCalled();
    });
    it("交出去有一镜没交到：不报「已开始」，草稿结果照常返回（账本已把出价退回给人，回合等卡）", async () => {
      const { adapter, markPolicyDecisionFailed, handOverToCanvas } = make(() => run([], ["s1", "s2"]), "direct", { accepted: ["s1"], pending: [], failed: ["s2"] });
      const result = await create(adapter);
      expect(result).toMatchObject({ ok: true });
      expect((result as { result?: { spendDecision?: unknown } }).result?.spendDecision).toBeUndefined();
      expect(handOverToCanvas.waitForSettlement).toHaveBeenCalledTimes(1);
      expect(markPolicyDecisionFailed).not.toHaveBeenCalled();
    });
    it("刹车成立但「要人工决定」标记写失败：结论不变（不交出去），草稿结果照常返回，不变成失败", async () => {
      const { adapter, markPolicyDecisionFailed, handOverToCanvas } = make(() => run([job("s1", 1, "needs_attention"), job("s1", 2, "needs_attention"), job("s1", 3, "needs_attention")], ["s1"]));
      markPolicyDecisionFailed.mockImplementation(async () => { throw Object.assign(new Error("revision conflict"), { code: "revision_conflict" }); });
      await expect(create(adapter)).resolves.toMatchObject({ ok: true });
      expect(handOverToCanvas.handOver).not.toHaveBeenCalled();
      expect(markPolicyDecisionFailed).toHaveBeenCalledTimes(1);
    });
    it("请求批准档：连读都不读 Run，不代答，也不重复打断", async () => {
      const readRun = vi.fn(() => run([], ["s1"]));
      const { adapter, markPolicyDecisionFailed, handOverToCanvas } = make(readRun as never, "request");
      await expect(create(adapter)).resolves.toMatchObject({ ok: true });
      expect(readRun).not.toHaveBeenCalled();
      expect(handOverToCanvas.handOver).not.toHaveBeenCalled();
      expect(markPolicyDecisionFailed).not.toHaveBeenCalled();
    });
  });

  it("keeps the generation failure result when the failure marker hits a revision conflict", async () => {
    const planning = vi.fn(async () => ({ operation: { operationId: "op-1" } }));
    const markPolicyDecisionFailed = vi.fn(async () => {
      throw Object.assign(new Error("revision_conflict"), { code: "revision_conflict" });
    });
    const adapter = createPiGenerationTransportAdapter(binding, {
      planning,
      leaseFor: () => lease,
      approvalPolicy: () => ({ mode: "direct" }),
      readRun: () => ({ generationPlan: { shots: [{ shotId: "s1" }], presentations: [{ shotIds: ["s1"], openedAt: "2026-10-12T00:00:10Z", fromGate: 0 }] }, gates: [], jobs: [], status: "running" }) as never,
      handOverToCanvas: { handOver: vi.fn(async () => { throw new Error("renderer unavailable"); }), waitForSettlement: vi.fn() } as never,
      authorizeGeneration: vi.fn(),
      approvalReceiptAuthority: authority(),
      markPolicyDecisionFailed,
    });

    await expect(adapter.tryExecute(
      call("nomi_generation_plan", { operation: "create", prompt: "a small cat avatar" }),
      new AbortController().signal,
    )).resolves.toMatchObject({ ok: false, code: "generation_execution_failed" });
    expect(markPolicyDecisionFailed).toHaveBeenCalledTimes(1);
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

  // 内部模型面的 resolve **不在这条旧 manifest 通路上**（P1：不往要删的壳里加新东西）。
  // 它的 schema 只有一个生成点 = GENERATION_RESOLVE_CAPABILITY.inputSchema，内部面由阶段 2 的
  // toolProjection 从契约层投影。这里钉住「旧通路 fail-closed，而不是悄悄当成 preview 放行」。
  it("legacy generation_plan manifest fails closed on resolve instead of silently routing it as preview", async () => {
    const planning = vi.fn(async () => ({}));
    const adapter = createPiGenerationTransportAdapter(binding, { planning, leaseFor: () => lease });

    const result = await adapter.tryExecute(
      call("nomi_generation_plan", { operation: "resolve", shots: [{ id: "s1", durationSec: 6, sceneAnchorId: "hall" }] }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ ok: false, code: "generation_input_invalid" });
    expect(planning).not.toHaveBeenCalled();
  });

  // 2026-09-18 根因合同：只抛一个裸码，模型（和人）都看不到是**哪一项**不合法，于是同一份载荷
  // 被原样重试三次、回合挂到超时。zod 的 path 是我们自己契约里的字段名，不是供应商文本——
  // 收敛成码该挡的是后者。把理由删掉，下面两条会同时变绿，那正是缺陷的样子。
  it("says which field was rejected and why, without leaking anything but our own contract", async () => {
    const planning = vi.fn(async () => ({}));
    const adapter = createPiGenerationTransportAdapter(binding, { planning, leaseFor: () => lease });

    const result = await adapter.tryExecute(
      call("nomi_generation_plan", { operation: "create", shots: [{ prompt: 42 }] }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ ok: false, code: "generation_input_invalid" });
    const message = (result as { message: string }).message;
    expect(message).toMatch(/^generation_input_invalid — /);
    expect(message).toContain("shots");
    expect(message.length).toBeGreaterThan("generation_input_invalid".length + 8);
    expect(planning).not.toHaveBeenCalled();
  });

  it("the resolve capability contract is the single generation point for its input schema", () => {
    // 反向断言：契约在（能解析同一份输入），旧 manifest 不在（上一条已证）——避免两处都有的并行版。
    expect(GENERATION_RESOLVE_CAPABILITY.inputSchema.safeParse({
      shots: [{ id: "s1", durationSec: 6, sceneAnchorId: "hall" }],
    }).success).toBe(true);
    expect(GENERATION_RESOLVE_CAPABILITY.inputSchema.safeParse({ shots: [] }).success).toBe(false);
    expect(generationPlanInputSchema.safeParse({ operation: "resolve", shots: [{ id: "s1", durationSec: 6 }] }).success).toBe(false);
  });
});

describe('方法别名的入参形状从语义联合现取，不手抄', () => {
  // 2026-09-18 根因：这里原本手写了一份 create 的形状，**比真契约窄**——
  // 少了 taskKind/providerId/modelId/mode/modeId/variantId/parameters/references。
  // 手抄那份是 .strict()，所以模型写对了真契约的字段，走这条别名路反而被拒。
  // 今天没爆只是因为常驻 lane 只路由 plan/status，走不到这几支——是埋着的地雷不是无害重复。
  // 与生产同款的收窄（generationTransportAdapters.ts 的 branchByOperation）：
  // 联合成员的静态类型里没有 .omit，要先收到 ZodObject 才拿得到。
  const createBranch = (generationPlanInputSchema.options as ReadonlyArray<z.ZodObject<z.ZodRawShape>>).find(
    (option) => (option.shape.operation as unknown as { _def: { value: string } })._def.value === 'create',
  )! as unknown as z.ZodObject<z.ZodRawShape>

  it('create 别名收得下真契约 create 分支的每一个字段（这条红 = 有人又手抄了一份更窄的）', () => {
    // 被替掉的那份手抄只有 5 个键（prompt/candidate/shots/scriptText/cardHidden），
    // 而真契约有 14 个——少掉的 9 个正是模型最常写的那几个（模型、模式、参数、参考图）。
    // 把 create 分支的字段全填满：任何一个被别名那支漏掉，.strict() 就会拒。
    const saturated = {
      prompt: '黄昏天台',
      taskKind: 'text_to_video' as const,
      providerId: 'apimart', modelId: 'image-1', mode: 'text-to-image', modeId: 'm1', variantId: 'v1',
      parameters: { resolution: '768P' },
      references: [{ assetId: 'asset-1', contentHash: 'h1', version: 1 }],
      shots: [{ prompt: '镜一', title: '开场' }],
      scriptText: '一段剧本',
      cardHidden: true,
      moduleId: 'generation.single-shot',
    }
    // 前提断言：这份载荷确实是真契约认的（否则下面那条证明不了什么）。
    expect(createBranch.omit({ operation: true }).safeParse(saturated).success).toBe(true)

    // 逐字段核对：别名那支的键集合不得小于真契约分支。
    {
      const canonical = Object.keys(createBranch.omit({ operation: true }).shape).sort()
      const viaAlias = Object.keys(
        (legacyMethodSchemaForTest(GENERATION_METHODS.create) as unknown as { shape: Record<string, unknown> }).shape,
      ).sort()
      expect(viaAlias).toEqual(canonical)
    }
  })

  it('按 operation 字面量取分支，不按下标——联合重排不该静默指到别的分支', () => {
    const present = legacyMethodSchemaForTest(GENERATION_METHODS.present) as unknown as { shape: Record<string, unknown> }
    expect(Object.keys(present.shape).sort()).toEqual(['operationId', 'shotIds'])
    const patch = legacyMethodSchemaForTest(GENERATION_METHODS.patch) as unknown as { shape: Record<string, unknown> }
    expect(Object.keys(patch.shape).sort()).toEqual(['operationId', 'patch', 'shotId'])
  })
})

describe("plan patch addressed to one shot survives the canonical seam", () => {
  it("forwards shotId with the patch (the transport's only way to edit one shot of a multi-shot draft)", async () => {
    const planning = vi.fn(async ({ capability, params }) => ({ capability, params }));
    const adapter = createPiGenerationTransportAdapter(binding, { planning, leaseFor: () => lease });
    const result = await adapter.tryExecute(
      call("nomi_generation_plan", { operation: "patch", operationId: "op-1", shotId: "shot-2", patch: { prompt: "逆光侧脸" } }),
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: true, result: { capability: "plan", params: { operationId: "op-1", shotId: "shot-2", patch: { prompt: "逆光侧脸" } } } });
  });

  it("the canonical method name accepts shotId too (the semantic and canonical doors are the same seam)", async () => {
    const planning = vi.fn(async ({ capability, params }) => ({ capability, params }));
    const adapter = createPiGenerationTransportAdapter(binding, { planning, leaseFor: () => lease });
    const result = await adapter.tryExecute(
      call("nomi_submit_generation_plan", { operationId: "op-1", shotId: "shot-2", patch: { prompt: "逆光侧脸" } }),
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: true, result: { capability: "plan", params: { operationId: "op-1", shotId: "shot-2" } } });
  });
});


describe('creation request target enforcement', () => {
  const target = { projectId: binding.projectId, sourceDocumentId: 'doc-a', sourceDocumentRevision: 3,
    sourceDocumentContentHash: 'hash-a', targetKind: 'storyboard' as const, requestId: 'request-a',
    plans: [{ id: 'op-existing', title: 'Existing plan' }] };
  it('lets the model create a new plan or name an existing one, and never rewrites its choice', async () => {
    const planning = vi.fn().mockResolvedValue({ operation: { operationId: 'op-existing', runRevision: 0 } });
    const adapter = createPiGenerationTransportAdapter(binding, { planning, leaseFor: () => lease });
    const signal = new AbortController().signal;
    const context = { storyboardTarget: target };
    expect(await adapter.tryExecute(call('nomi_generation_plan', { operation: 'create', prompt: 'first' }), signal, context)).toMatchObject({ ok: true });
    // A create without an id stays without one: the host assigns it, and it never inherits a plan the user did not name.
    expect(planning.mock.calls[0][0].params.operationId).toBeUndefined();
    expect(await adapter.tryExecute(call('nomi_generation_plan', { operation: 'patch', operationId: 'op-existing', shotId: 's', patch: { prompt: 'second' } }), signal, context)).toMatchObject({ ok: true });
    expect(planning.mock.calls[1][0]).toMatchObject({ params: { operationId: 'op-existing' }, storyboardTarget: target });
  });
  // 2026-09-22 · run2 的 A10 逐字：`draft_shots` 成功返回 op-9b2c…，用户在反问卡上答了「现在生成」，
  // 紧接着对**同一个 id** 调 `generate`，被回「That plan is not one of the storyboard plans this
  // request covers」。请求清单是发送那一刻拍下来的，本轮新起草的方案不可能在上面。
  it('lets the model generate the plan it just drafted from this document, in the same turn', async () => {
    const planning = vi.fn()
      .mockResolvedValueOnce({ operation: { operationId: 'op-drafted-this-turn', runRevision: 0, cardHidden: true } })
      .mockResolvedValueOnce({ operation: { operationId: 'op-drafted-this-turn', runRevision: 1 }, shots: [] });
    const adapter = createPiGenerationTransportAdapter(binding, { planning, leaseFor: () => lease });
    const signal = new AbortController().signal;
    const context = { storyboardTarget: target };
    expect(await adapter.tryExecute(call('nomi_generation_plan', { operation: 'create', prompt: 'first', cardHidden: true }), signal, context)).toMatchObject({ ok: true });
    const presented = await adapter.tryExecute(call('nomi_generation_plan', { operation: 'present', operationId: 'op-drafted-this-turn' }), signal, context);
    expect(presented, '刚起草的方案在同一轮里生成不了 = 从文稿面起草再生成这条路在结构上走不通').toMatchObject({ ok: true });
    expect(planning).toHaveBeenCalledTimes(2);
  });
  it('a plan drafted from ANOTHER document is still refused — the door was widened by one fact, not opened', async () => {
    const planning = vi.fn().mockResolvedValue({ operation: { operationId: 'op-from-doc-b', runRevision: 0, cardHidden: true } });
    const adapter = createPiGenerationTransportAdapter(binding, { planning, leaseFor: () => lease });
    const signal = new AbortController().signal;
    const otherDocument = { storyboardTarget: { ...target, sourceDocumentId: 'doc-b', plans: [] } };
    expect(await adapter.tryExecute(call('nomi_generation_plan', { operation: 'create', prompt: 'x', cardHidden: true }), signal, otherDocument)).toMatchObject({ ok: true });
    // 同一条 lane、同一个 id，但这一次的请求属于 doc-a：doc-b 起草的方案不算它的。
    expect(await adapter.tryExecute(call('nomi_generation_plan', { operation: 'present', operationId: 'op-from-doc-b' }), signal, { storyboardTarget: target }))
      .toMatchObject({ ok: false, code: 'generation_input_invalid' });
  });
  it('rejects a plan this document does not own, or a foreign project, before planning', async () => {
    const planning = vi.fn();
    const adapter = createPiGenerationTransportAdapter(binding, { planning, leaseFor: () => lease });
    const signal = new AbortController().signal;
    expect(await adapter.tryExecute(call('nomi_generation_plan', { operation: 'patch', operationId: 'foreign', shotId: 's', patch: { prompt: 'first' } }), signal, { storyboardTarget: target })).toMatchObject({ ok: false });
    expect(await adapter.tryExecute(call('nomi_generation_plan', { operation: 'create', prompt: 'first' }), signal, { storyboardTarget: { ...target, projectId: 'foreign-project' } })).toMatchObject({ ok: false });
    expect(planning).not.toHaveBeenCalled();
  });
});

it('selected stable shot scope refuses unrelated patches and narrows generate before the owner',async()=>{
  const planning=vi.fn().mockResolvedValue({operation:{runRevision:1}})
  const adapter=createPiGenerationTransportAdapter(binding,{planning,leaseFor:()=>lease})
  const context={storyboardTarget:{projectId:binding.projectId,sourceDocumentId:'doc',sourceDocumentRevision:1,sourceDocumentContentHash:'hash',targetKind:'storyboard' as const,requestId:'selected',plans:[{id:'run',title:'Plan'}],designId:'run',shotIds:['stable-b']}}
  const signal=new AbortController().signal
  expect(await adapter.tryExecute(call('nomi_generation_plan',{operation:'patch',operationId:'run',shotId:'stable-a',patch:{prompt:'wrong'}}),signal,context)).toMatchObject({ok:false})
  expect(planning).not.toHaveBeenCalled()
  expect(await adapter.tryExecute(call('nomi_generation_plan',{operation:'patch',operationId:'run',shotId:'stable-b',patch:{prompt:'right'}}),signal,context)).toMatchObject({ok:true})
  expect(await adapter.tryExecute(call('nomi_generation_plan',{operation:'present',operationId:'run'}),signal,context)).toMatchObject({ok:true})
  expect(planning.mock.calls[1][0].params.shotIds).toEqual(['stable-b'])
})

// 选择就是用户的点名（设计卡 2026-10-27 §三 适配器那一格）：模型点名选择之外的镜，拒绝说得出哪一镜、能点哪些，
// 而且在碰草稿账本之前（以前落进兜底码 generation_execution_failed，模型读到的是「可能已提交」）。
it('selected stable shot scope refuses a named shot outside the selection in words the model can act on, before planning',async()=>{
  const planning=vi.fn().mockResolvedValue({operation:{runRevision:1}})
  const adapter=createPiGenerationTransportAdapter(binding,{planning,leaseFor:()=>lease})
  const context={storyboardTarget:{projectId:binding.projectId,sourceDocumentId:'doc',sourceDocumentRevision:1,sourceDocumentContentHash:'hash',targetKind:'storyboard' as const,requestId:'selected',plans:[{id:'run',title:'Plan'}],designId:'run',shotIds:['stable-b']}}
  const signal=new AbortController().signal
  expect(await adapter.tryExecute(call('nomi_generation_plan',{operation:'present',operationId:'run',shotIds:['stable-a']}),signal,context)).toEqual({
    ok:false,code:'generation_input_invalid',message:'stable-a is not one of the shots you can name here. Shots you can name: stable-b.',
  })
  expect(await adapter.tryExecute(call('nomi_generation_plan',{operation:'present',operationId:'run',shotIds:['stable-b','stable-b']}),signal,context)).toMatchObject({
    ok:false,code:'generation_input_invalid',message:expect.stringContaining('names stable-b more than once'),
  })
  expect(planning).not.toHaveBeenCalled()
})

// generate 失败时说真话（付费卡① 23:30 第 3 点）：「结果可能未知、去供应商后台核对」只在账本说「可能到过供应商」时才是真的。
// 账本那一句由宿主现算（operation 视图的 submissionStarted ← 制作作业 + 交给画布的那几镜），传输层只把这条事实随失败带出去；
// 措辞（`generation_not_started` 还是结果未知）只在 lane 的 `laneFailureFromDecision` 定一次（两个出口同一处，D2 第③步还的债 c）。
describe("generate failure carries the ledger fact about whether anything reached the provider", () => {
  const failingPlanning = (submissionStarted: boolean) => vi.fn(async (request: { capability: string }) => {
    if (request.capability === "read") return { operation: { operationId: "op-1", submissionStarted } };
    throw new Error("socket hang up");
  });
  const adapterWith = (planning: ReturnType<typeof failingPlanning>) => createPiGenerationTransportAdapter(binding, {
    planning,
    requestGenerationGate: vi.fn(),
    confirmGenerationInNomi: vi.fn(),
    authorizeGeneration: vi.fn(),
    approvalReceiptAuthority: authority(),
    leaseFor: () => lease,
  });

  it("nothing may have reached the provider: the failure says so as a fact (submissionStarted: false), the lane words it", async () => {
    const result = await adapterWith(failingPlanning(false))
      .tryExecute(call("nomi_generation_plan", { operation: "present", operationId: "op-1" }), new AbortController().signal);
    expect(result).toMatchObject({ ok: false, code: "generation_execution_failed", submissionStarted: false });
  });

  it("something may have reached the provider: the outcome stays unknown, so the model asks the user to check (row 18)", async () => {
    const result = await adapterWith(failingPlanning(true))
      .tryExecute(call("nomi_generation_plan", { operation: "present", operationId: "op-1" }), new AbortController().signal);
    expect(result).toMatchObject({ ok: false, code: "generation_execution_failed", submissionStarted: true });
  });
});
