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
      approvalPolicy: () => ({ mode: "project", spend: "confirm" }),
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

// generate 失败时说真话（付费卡① 23:30 第 3 点）：「结果可能未知、去供应商后台核对」只在账本说「可能到过供应商」时才是真的。
// 账本那一句由宿主现算（operation 视图的 submissionStarted ← productionShotJobs.anySubmissionMayHaveReachedProvider）。
describe("generate failure tells the truth about whether anything reached the provider", () => {
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

  it("nothing may have reached the provider: generation_not_started (not sent, nothing spent)", async () => {
    const result = await adapterWith(failingPlanning(false))
      .tryExecute(call("nomi_generation_plan", { operation: "present", operationId: "op-1" }), new AbortController().signal);
    expect(result).toMatchObject({ ok: false, code: "generation_not_started" });
  });

  it("something may have reached the provider: the outcome stays unknown, so the model asks the user to check (row 18)", async () => {
    const result = await adapterWith(failingPlanning(true))
      .tryExecute(call("nomi_generation_plan", { operation: "present", operationId: "op-1" }), new AbortController().signal);
    expect(result).toMatchObject({ ok: false, code: "generation_execution_failed" });
  });
});
