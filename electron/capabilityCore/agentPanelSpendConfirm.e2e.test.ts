import { currentPresentation, presentationIsOpen } from '../shared/productionGenerationPresentation';
import { spendAuthorizationGates } from "../shared/productionSpendAuthority";
import { createPendingSpendActions } from './appIntegrationSpendConfirm';
import { withdrawStalePresentations } from '../productionRun/stalePresentationSweep';
import { createProductionRunService } from '../productionRun/productionRunService';
import { createProductionGenerationOperationStore } from '../productionRun/productionGenerationOperationStore';
import { afterEach, describe, expect, it } from "vitest";
import { verbToTransportCall } from "../agentLane/laneVerbTransport";
import { createPiGenerationTransportAdapter } from "./generationTransportAdapters";
import type { ProjectAgentApprovalPolicy } from "../shared/agentCapabilities/capabilityApprovalPolicy";
import { canvasLandingOperationId } from "../productionRun/multiShotCanvasLanding";
import { PROJECT_ID, OPERATION_ID, lease, now, PRICING, candidate, startLoopbackVendor, harness, buildActions, callTool, draft, resetSpendFixture, advanceClock, registry, watchCardForTurn, settleMicrotasks } from "./agentPanelSpendConfirmTestUtils";
import { resolvePlanPatch } from "./generationPlanPatch";

afterEach(resetSpendFixture);

describe("Agent 面板付费卡：确认 → 真的开始生成（零额度 loopback）", () => {
  it("卡上改参数 → 按主按钮 → 重新封印/铸收据/决门/开跑 → 供应商收到的就是改后那份，产物落回同一个画布节点", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow } = buildActions(base, vendor.origin, submits);
    try {
      await draft(base);

      // ── 卡出现了，印的是草稿此刻的样子 ──
      const before = withWindow.listPendingSpend(PROJECT_ID);
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({ operationId: OPERATION_ID, candidateRevision: 1, unknownShotCount: 0 });
      expect(before[0].shots[0]).toMatchObject({ modelId: "image-model", parameters: { size: "1024x1024" } });
      expect(before[0].knownSubtotal).toBeCloseTo(0.3, 6);
      // 草稿一建就落了画布（用户当场看得见 agent 要生成什么），一个节点。
      expect(base.renderer.nodes.size).toBe(1);
      const nodeId = [...base.renderer.nodes.values()][0];

      // ── 用户在卡上换模型 + 改尺寸，然后按主按钮 ──
      // `confirm` 之前的 `revise` 是面板 hook 在按下那一刻做的同一件事（useAgentPanelSpendConfirm.confirm）。
      advanceClock(1000);
      const revised = await withWindow.revisePendingSpend({ quoteId: withWindow.listPendingSpend(PROJECT_ID)[0].quoteId,
        projectId: PROJECT_ID, operationId: OPERATION_ID,
        patch: { parameters: { size: "1536x1024" } },
      });
      expect(revised).toMatchObject({ ok: true, code: "revised" });
      await base.canvasLanding.settleCanvasLanding(PROJECT_ID);

      const afterEdit = withWindow.listPendingSpend(PROJECT_ID)[0];
      // 改参数把候选推了一版，价格按目录重算（0.30 基价 + 0.20 规格加价）。数只有宿主一个产地。
      expect(afterEdit.candidateRevision).toBe(2);
      expect(afterEdit.shots[0]).toMatchObject({ modelId: "image-model", parameters: { size: "1536x1024" } });
      expect(afterEdit.knownSubtotal).toBeCloseTo(0.5, 6);

      advanceClock(1000);
      const confirmed = await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: withWindow.listPendingSpend(PROJECT_ID)[0]?.quoteId ?? "stale" });
      expect(confirmed).toMatchObject({ ok: true, code: "spend_confirmed" });
      await base.canvasLanding.settleCanvasLanding(PROJECT_ID);

      // ── ① 供应商真正收到的就是卡上改后那一份 ──
      expect(submits).toHaveLength(1);
      expect(vendor.bodies).toHaveLength(1);
      expect(vendor.bodies[0]).toMatchObject({ model: "image-model", parameters: { size: "1536x1024" } });

      const run = base.repository.read(PROJECT_ID, OPERATION_ID)!;
      const plan = run.generationPlan!;
      expect(plan.state).toBe("submitted");

      // ── ② 收据绑定的候选版本 = 执行时的候选版本 ──
      // 门是在**改完之后**才开的，所以信封里冻着的 candidateRevision 只可能是改后那一版；
      // 决门的那张收据就绑在这个 gateId + digest 上（对不上批不动）。
      // 信封住在批它的那道门上（每点一次一份）。
      const gate = spendAuthorizationGates(run).at(-1)!;
      const envelopeTargets = gate.authorizationEnvelope.jobs.map((job) => job.target as { candidateRevision?: number });
      expect(envelopeTargets).toHaveLength(1);
      expect(envelopeTargets[0].candidateRevision).toBe(2);
      expect(plan.candidate.revision).toBe(2);
      expect(gate.status).toBe("approved");
      expect(gate.receiptId).toBeTruthy();
      expect(plan, "授权不挂在计划上").not.toHaveProperty("authorizationDigest");
      // 执行出来的那个 job 也绑在同一份合同上（收据 = 实际执行，不是注释保证的）。
      const job = run.jobs[0]!;
      expect(job.status === "ready" || job.status === "adopted").toBe(true);
      expect(run.artifacts.filter((artifact) => artifact.status === "ready" && artifact.jobId === job.jobId)).toHaveLength(1);

      // ── ③ 画布落地幂等 + 产物回到**同一个**节点 ──
      // 建草稿 / 改参数 / start 后各落了一次，三次共用 `canvas-landing:{runId}` 一个章 → 仍然一个节点。
      expect(base.renderer.payloads.length).toBeGreaterThanOrEqual(3);
      expect(new Set(base.renderer.payloads.map((entry) => entry.materializationOperationId))).toEqual(
        new Set([canvasLandingOperationId(OPERATION_ID)]),
      );
      expect(base.renderer.nodes.size).toBe(1);
      expect([...base.renderer.nodes.values()][0]).toBe(nodeId);
      expect(base.renderer.resultsByNode.get(nodeId)?.url).toMatch(/^nomi-local:\/\//);
    } finally {
      await vendor.close();
    }
  });

  it("没有窗口代表真人时，确认 fail-closed：一次供应商请求都不发生", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withoutWindow } = buildActions(base, vendor.origin, submits);
    try {
      await draft(base);
      const result = await withoutWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: withoutWindow.listPendingSpend(PROJECT_ID)[0]!.quoteId });
      expect(result).toMatchObject({ ok: false, code: "unavailable" });
      expect(submits).toHaveLength(0);
      expect(vendor.bodies).toHaveLength(0);
      expect(base.repository.read(PROJECT_ID, OPERATION_ID)!.generationPlan!.state).toBe("draft");
    } finally {
      await vendor.close();
    }
  });

  it("确认过一次之后卡就不再出现，重复按也不会再发一次生成（幂等，不重复扣费）", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow } = buildActions(base, vendor.origin, submits);
    try {
      await draft(base);
      advanceClock(1000);
      expect(await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: withWindow.listPendingSpend(PROJECT_ID)[0]?.quoteId ?? "stale" })).toMatchObject({ ok: true });
      await base.canvasLanding.settleCanvasLanding(PROJECT_ID);
      expect(submits).toHaveLength(1);

      // 卡消失了：`submitted` 不再投影成「等你点头」（已经答过的问题不再问第二遍）。
      expect(withWindow.listPendingSpend(PROJECT_ID)).toHaveLength(0);
      advanceClock(1000);
      const again = await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: withWindow.listPendingSpend(PROJECT_ID)[0]?.quoteId ?? "stale" });
      expect(again.ok).toBe(false);
      expect(submits).toHaveLength(1);
      expect(vendor.bodies).toHaveLength(1);
    } finally {
      await vendor.close();
    }
  });
  /**
   * #748 记下的已知缺口，本轮修好，断言随之翻成正面（不是删掉它）。
   *
   * 缺口是什么：Run 的 policy `allowedModels` 在**建草稿那一刻**从候选身份冻下来，
   * 于是用户在卡上换个模型再确认，会撞上一句「模型未加入白名单」——而他做的只是
   * 在下拉里选了另一个模型。冻它本是为了拦 **agent** 偷换模型（agent 走
   * `generation.patch`，那条路一个字没改）；`generation.revise` 只有付费卡这一个入口。
   *
   * 现在放行的边界是**同一个任务类别**（`candidate.mode`）。跨类别仍然 fail-closed。
   */
  it("卡上换模型 → 确认 → 供应商收到的就是换后那个模型（#748 缺口已修）", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow } = buildActions(base, vendor.origin, submits);
    try {
      await draft(base);
      const nodeId = [...base.renderer.nodes.values()][0];

      advanceClock(1000);
      expect(await withWindow.revisePendingSpend({ quoteId: withWindow.listPendingSpend(PROJECT_ID)[0].quoteId,
        projectId: PROJECT_ID, operationId: OPERATION_ID, patch: { modelId: "image-model-pro" },
      })).toMatchObject({ ok: true, code: "revised" });
      await base.canvasLanding.settleCanvasLanding(PROJECT_ID);

      // 卡上印的已经是换后那个模型，价格按同一条算式重算（这个模型同价：0.30）。
      const afterEdit = withWindow.listPendingSpend(PROJECT_ID)[0];
      expect(afterEdit.shots[0]).toMatchObject({ modelId: "image-model-pro" });
      expect(afterEdit.knownSubtotal).toBeCloseTo(0.3, 6);

      advanceClock(1000);
      expect(await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: withWindow.listPendingSpend(PROJECT_ID)[0]?.quoteId ?? "stale" }))
        .toMatchObject({ ok: true, code: "spend_confirmed" });
      await base.canvasLanding.settleCanvasLanding(PROJECT_ID);

      // 供应商真正收到的是换后那个模型——不是「没被拒」而已。
      expect(submits).toHaveLength(1);
      expect(vendor.bodies).toHaveLength(1);
      expect(vendor.bodies[0]).toMatchObject({ model: "image-model-pro" });

      const run = base.repository.read(PROJECT_ID, OPERATION_ID)!;
      expect(run.generationPlan!.state).toBe("submitted");
      // 白名单认下了新模型，**旧的没被顶掉**（用户还能换回去），而那笔钱的闸一个都没松。
      expect(run.policy.allowedModels).toContain("image-model-pro");
      expect(run.policy.allowedModels).toContain("image-model");
      // 换模型没有多开一个画布节点：还是草稿一建就落的那一个。
      expect(base.renderer.nodes.size).toBe(1);
      expect([...base.renderer.nodes.values()][0]).toBe(nodeId);
    } finally {
      await vendor.close();
    }
  });

  it("跨任务类别换模型：卡上改一下也过并入规则，目录里没有这一对就当场拒——那换掉的是整个花钱量级，不叫「改一下」", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow } = buildActions(base, vendor.origin, submits);
    try {
      await draft(base);
      advanceClock(1000);
      // 以前卡这一条把补丁原样并进候选，要等到确认那一下才被白名单挡下；现在和 Agent 改草稿同一条规则，改的那一下就拒。
      expect(await withWindow.revisePendingSpend({ quoteId: withWindow.listPendingSpend(PROJECT_ID)[0].quoteId,
        projectId: PROJECT_ID, operationId: OPERATION_ID,
        patch: { modelId: "video-model", mode: "image-to-video" },
      })).toMatchObject({ ok: false, message: "generation_not_started" });
      // 被拒得干净：没花钱，草稿还在、还是原来那个模型，用户还能接着改。
      expect(submits).toHaveLength(0);
      expect(vendor.bodies).toHaveLength(0);
      expect(withWindow.listPendingSpend(PROJECT_ID)).toHaveLength(1);
      expect(withWindow.listPendingSpend(PROJECT_ID)[0].shots[0]?.modelId).toBe("image-model");
    } finally {
      await vendor.close();
    }
  });
});

/**
 * 「全自动」档：付费生成不再出报价卡（2026-09-12 用户拍板）。
 *
 * 三条断言构成这一档的全部含义，缺一条它就变味：
 *   ① **没有卡**——面板上一张待确认都不该有（否则「全自动」只是换了个说法的「自动改」）；
 *   ② **真的跑了**——供应商收到了那一次请求（否则它是「全自动地什么都不做」）；
 *   ③ **闸一步没少**——门被批准、收据存在，而且收据上写着是**策略**批的，不是编了一个人出来。
 *
 * 另外两档拿同一个夹具跑一遍：它们必须**一个字都没变**——卡在、供应商没被碰。
 * 只测「全自动能跑」不够：这一改真正的风险是它顺手把另外两档也放行了。
 */
describe("三档 × 付费报价卡（2026-09-12 拍板）", () => {
  /**
   * 模型那一侧真正走得到的一轮：**建草稿**。
   *
   * 桌面 lane 上这就是模型的最后一步——付费门不在它的工具表里，连 preview 都不在这个宿主的
   * schema 里。草稿一建好，报价卡就该出现；「全自动」档的免卡放行正发生在同一刻。
   */
  async function modelTurn(base: ReturnType<typeof harness>, vendorOrigin: string, submits: string[], mode: ProjectAgentApprovalPolicy["mode"]) {
    const built = buildActions(base, vendorOrigin, submits);
    const transport = built.transport(mode);
    const created = await callTool(transport, "nomi_generation_plan", {
      operation: "create", taskKind: "text_to_image", candidate: candidate("image-model", { size: "1024x1024" }),
    });
    await base.canvasLanding.settleCanvasLanding(PROJECT_ID);
    const operationId = ((created as { result?: { drafted?: { operation?: { operationId?: string } }; operation?: { operationId?: string } } }).result);
    const resolved = operationId?.drafted?.operation?.operationId ?? operationId?.operation?.operationId ?? "";
    return { ...built, created, operationId: resolved };
  }

  it("回执说真话：画布来源草稿当场落成节点 → 建草稿的结果点名那个节点（真实路径：传输 → 草稿账本 → 落地宿主 → 读回账本）", async () => {
    const base = harness();
    const { created, operationId } = await modelTurn(base, "http://127.0.0.1:1", [], "step");
    const landing = (created as { result?: { canvasLanding?: unknown } }).result?.canvasLanding;
    expect(operationId).toBeTruthy();
    expect(base.renderer.nodes.size).toBe(1);
    expect(landing).toEqual({ state: "placed", shotCount: 1, nodes: [{ shotId: expect.any(String), nodeId: [...base.renderer.nodes.values()][0] }] });
  });

  it("全自动：草稿一建好宿主就自己决门 → 没有报价卡、生成真的开始了、收据写着 policy:full_auto", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    try {
      const { withWindow, operationId, created, receipts } = await modelTurn(base, vendor.origin, submits, "project");
      expect(operationId, "建草稿必须成功——后面每一条断言都以它为前提").toBeTruthy();

      // ① 没有卡：等用户点头的那一笔不存在了，因为已经决过了。
      expect(withWindow.listPendingSpend(PROJECT_ID)).toHaveLength(0);

      // ② 真的跑了：供应商收到一次，且只有一次。
      expect(submits).toHaveLength(1);
      expect(vendor.bodies).toHaveLength(1);

      // ③ 闸一步没少，而且账本上说得出是谁批的。
      const run = base.repository.read(PROJECT_ID, operationId)!;
      const plan = run.generationPlan!;
      expect(plan.state).toBe("submitted");
      const gate = spendAuthorizationGates(run).at(-1)!;
      expect(gate.status).toBe("approved");
      expect(gate.receiptId).toBeTruthy();
      const receipt = receipts.verifyReceipt(receipts.resolveReceiptToken(gate.receiptId!));
      expect(receipt.decidedBy).toBe("policy:full_auto");
      expect(receipt.gestureAttestation.kind).toBe("policy_decision");
      // 没有人点，所以 humanActor 记的是那条策略——不是编一个 web_contents 出来。
      expect(receipt.humanActor).toBe("policy:project:agent-lane");

      // 工具结果里也说得出这一笔是策略批的（模型据此知道「已经开跑」，不会再去催用户点卡）。
      expect(created).toMatchObject({ ok: true, result: { spendDecision: { decidedBy: "policy:full_auto" } } });
    } finally {
      await vendor.close();
    }
  });

  /**
   * T-AG-04：**代答进行中的那一段**，面板上也不许有卡。
   *
   * 上面那条只看得见「决完之后没有卡」——而用户撞到的恰恰是决完之前那一段：草稿一落盘投影就出卡，
   * 面板每 1.5s 读一次，于是他刚在切档卡上答应过「不再逐笔问」，转头又被问了一遍。
   *
   * 观察点选在 `requestGenerationGate`：它是代答链的第一步，跑在草稿已经落盘之后。
   * 阳性对照就在同一次观察里——那一刻 Run 确实存在且还没封印（`draftedAtGate`），
   * 所以「0 张卡」不是因为我们看了个空项目。
   */
  it("全自动：从草稿落盘到封印的那一段也不出卡（用户刚授权过的事不该被再问一遍）", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    try {
      const built = buildActions(base, vendor.origin, submits);
      const observed: { cards: number; state: string | undefined }[] = [];
      const transport = createPiGenerationTransportAdapter(
        { projectId: PROJECT_ID, immutableProjectUuid: "project-uuid-1", projectGeneration: 1 },
        {
          planning: built.handler,
          requestGenerationGate: async (input) => {
            const runId = String((input.params as { operationId?: unknown }).operationId ?? "");
            const current = runId ? base.repository.read(PROJECT_ID, runId) : null;
            observed.push({
              cards: built.withWindow.listPendingSpend(PROJECT_ID).length,
              state: current?.generationPlan?.state,
            });
            return built.authority.requestGenerationGate(input);
          },
          authorizeGeneration: built.authority.authorizeGeneration,
          approvalReceiptAuthority: built.receipts,
          leaseFor: () => lease,
          approvalPolicy: () => ({ mode: "project", spend: "confirm" }),
        },
      );
      await callTool(transport, "nomi_generation_plan", {
        operation: "create", taskKind: "text_to_image", candidate: candidate("image-model", { size: "1024x1024" }),
      });
      await base.canvasLanding.settleCanvasLanding(PROJECT_ID);

      expect(observed, "观察点没被走到 = 这条测试什么都没验").toHaveLength(1);
      // 阳性对照：那一刻草稿真的在盘上、还没封印——也就是旧代码会出卡的那一刻。
      expect(observed[0].state).toBe("draft");
      expect(observed[0].cards).toBe(0);
      expect(submits).toHaveLength(1);
    } finally {
      await vendor.close();
    }
  });

  for (const mode of ["step", "safe-auto"] as const) {
    it(`${mode}：一个字都没变——报价卡照常出现，供应商一次都没被碰`, async () => {
      const vendor = await startLoopbackVendor();
      const base = harness();
      const submits: string[] = [];
      try {
        const { withWindow, operationId } = await modelTurn(base, vendor.origin, submits, mode);

        const pending = withWindow.listPendingSpend(PROJECT_ID);
        expect(pending).toHaveLength(1);
        expect(pending[0].operationId).toBe(operationId);
        expect(submits).toHaveLength(0);
        expect(vendor.bodies).toHaveLength(0);
        expect(base.repository.read(PROJECT_ID, operationId)!.generationPlan!.state).not.toBe("submitted");
      } finally {
        await vendor.close();
      }
    });
  }

  it("档位读不到时按默认档走：不许替用户花钱", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    try {
      const built = buildActions(base, vendor.origin, submits);
      // 没有 `approvalPolicy` 这一项的适配器 = 这条路没有档位可读（MCP 那一侧就是这样）。
      const transport = createPiGenerationTransportAdapter(
        { projectId: PROJECT_ID, immutableProjectUuid: "project-uuid-1", projectGeneration: 1 },
        {
          planning: built.handler,
          requestGenerationGate: built.authority.requestGenerationGate,
          authorizeGeneration: built.authority.authorizeGeneration,
          approvalReceiptAuthority: built.receipts,
          leaseFor: () => lease,
        },
      );
      await callTool(transport, "nomi_generation_plan", {
        operation: "create", taskKind: "text_to_image", candidate: candidate("image-model", { size: "1024x1024" }),
      });
      await base.canvasLanding.settleCanvasLanding(PROJECT_ID);
      // 不知道档位时**不许**替用户花钱：供应商一次都没被碰，卡还在原处等人。
      expect(submits).toHaveLength(0);
      expect(built.withWindow.listPendingSpend(PROJECT_ID)).toHaveLength(1);
    } finally {
      await vendor.close();
    }
  });
});

it('C09: a delayed close cannot dismiss a newer displayed quote', async () => {
  const base = harness();
  const { withWindow } = buildActions(base, 'http://127.0.0.1:1', []);
  await draft(base);
  const displayed = withWindow.listPendingSpend(PROJECT_ID)[0];
  await withWindow.revisePendingSpend({ quoteId: withWindow.listPendingSpend(PROJECT_ID)[0].quoteId, projectId: PROJECT_ID, operationId: OPERATION_ID, patch: { prompt: 'new version' } });
  const before = base.repository.read(PROJECT_ID, OPERATION_ID);
  const action = { projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: displayed.quoteId };
  expect(await withWindow.discardPendingSpend(action)).toMatchObject({ ok: false });
  expect(base.repository.read(PROJECT_ID, OPERATION_ID)).toEqual(before);
});

// 逐镜（2026-09-30）：点一镜不再先收窄这一批（没有 present 那一步可插队），等价的风险是「卡摆出来之后、点下去之前
// 这一镜被改了」——确认带的是卡上那一份的报价指纹，对不上就拒，用户没看过的改动一个都不批。
it('C09: a per-shot confirmation never approves an edit made after the card was displayed', async () => {
  const base = harness();
  const submits: string[] = [];
  const { withWindow } = buildActions(base, 'http://127.0.0.1:1', submits);
  const shots = [1, 2].map(i => ({ shotId: `shot-${i}`, candidate: { ...candidate('image-model', {}), candidateId: `candidate-${i}` } }));
  await base.operations.create({ operationId: OPERATION_ID, projectId: PROJECT_ID, candidate: shots[0].candidate, shots, origin: { host: 'nomi' }, now: now() });
  const displayed = withWindow.listPendingSpend(PROJECT_ID)[0];
  await base.operations.patch(PROJECT_ID, OPERATION_ID, { prompt: 'unseen replacement' }, now(), 'shot-1');
  const result = await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID,
    quoteId: displayed.quoteId, shotId: 'shot-1' });
  expect(result).toMatchObject({ ok: false });
  expect(submits).toEqual([]);
  expect(base.repository.read(PROJECT_ID, OPERATION_ID)!.generationPlan!.state).toBe('draft');
});

// Taskbook F2: the real adapter, durable Run and pending read model share one scope.
describe('reliability: scoped presentation and dismissal', () => {
  async function mixedDraft(base: ReturnType<typeof harness>) {
    const shots = Array.from({ length: 33 }, (_, i) => ({
      shotId: `shot-${i + 1}`,
      role: i < 6 ? 'anchor' as const : 'shot' as const,
      candidate: { ...candidate('image-model', { size: '1024x1024' }), candidateId: `candidate-${i + 1}` },
    }));
    await base.operations.create({ operationId: OPERATION_ID, projectId: PROJECT_ID,
      candidate: shots[0].candidate, shots, cardHidden: true, origin: { host: 'nomi' }, now: now() });
    await base.canvasLanding.settleCanvasLanding(PROJECT_ID);
  }

  it('S01: presents only three requested roles in plan order, retaining all 33 draft shots', async () => {
    const base = harness();
    await mixedDraft(base);
    const { transport, withWindow } = buildActions(base, 'http://127.0.0.1:1', []);
    const result = await callTool(transport('safe-auto'), 'nomi_generation_plan',
      { operation: 'present', operationId: OPERATION_ID, shotIds: ['shot-3', 'shot-1', 'shot-2'] });
    expect(result).toMatchObject({ ok: true });
    const pending = withWindow.listPendingSpend(PROJECT_ID)[0];
    expect(pending.shots.map((shot) => shot.shotId)).toEqual(['shot-1', 'shot-2', 'shot-3']);
    expect(pending.knownSubtotal).toBeCloseTo(0.9);
    expect(base.repository.read(PROJECT_ID, OPERATION_ID)!.generationPlan!.shots).toHaveLength(33);
  });

  it.each([[], ['shot-1', 'shot-1'], ['foreign-shot'], ['shot-1', 'foreign-shot']].map((shotIds) => ({ shotIds })))(
    'S03: rejects invalid scope $shotIds atomically', async ({ shotIds }) => {
      const base = harness();
      await mixedDraft(base);
      const { handler } = buildActions(base, 'http://127.0.0.1:1', []);
      const before = base.repository.read(PROJECT_ID, OPERATION_ID);
      await expect(handler({ capability: 'present', params: { operationId: OPERATION_ID, shotIds }, lease }))
        .rejects.toThrow(/shot|scope/i);
      expect(base.repository.read(PROJECT_ID, OPERATION_ID)).toEqual(before);
    });

  it('one presented shot revises and saves only that shot, then survives dismissal', async () => {
    const base = harness();
    await mixedDraft(base);
    const { handler, withWindow } = buildActions(base, 'http://127.0.0.1:1', []);
    await handler({ capability: 'present', params: { operationId: OPERATION_ID, shotIds: ['shot-17'] }, lease });
    const before = base.repository.read(PROJECT_ID, OPERATION_ID)!.generationPlan!;
    expect(withWindow.listPendingSpend(PROJECT_ID)[0].shots).toHaveLength(1);
    expect(await withWindow.revisePendingSpend({ quoteId: withWindow.listPendingSpend(PROJECT_ID)[0].quoteId,projectId:PROJECT_ID, operationId:OPERATION_ID,
      shotId:'shot-17', patch:{prompt:'edited seventeenth'}})).toMatchObject({ok:true});
    const after = base.repository.read(PROJECT_ID, OPERATION_ID)!.generationPlan!;
    expect(after.candidate).toEqual(before.candidate);
    expect(after.shots?.filter(shot => shot.shotId !== 'shot-17')).toEqual(before.shots?.filter(shot => shot.shotId !== 'shot-17'));
    expect(after.shots?.find(shot => shot.shotId === 'shot-17')?.candidate.prompt).toBe('edited seventeenth');
    const pending = withWindow.listPendingSpend(PROJECT_ID)[0];
    expect(await withWindow.discardPendingSpend({projectId:PROJECT_ID,operationId:OPERATION_ID,quoteId:pending.quoteId})).toMatchObject({ok:true});
    expect(base.repository.read(PROJECT_ID, OPERATION_ID)!.generationPlan!.shots).toEqual(after.shots);
    expect(base.repository.read(PROJECT_ID, OPERATION_ID)!.jobs).toEqual([]);
  });

  // 2026-09-22 下午用户拍板改窄裁决 D：× **只关这次请求，节点和草稿都留着**。所以这条钉的是
  // 「收回这一次出价」那条边（与裁决 C 同一条）：卡没了，计划回到 draft / 未 present，镜头一个字不丢、
  // 节点一个不动，同一个 operationId 还能再出价。
  //
  // 当天上午那一版把 × 落成 `cancelled + declined` 的计划级终态，这里钉的是「不许再 present」。
  // 它在 33 镜的计划上说不通（卡上摆 3 镜，× 终结整份计划，另外 30 个占位成孤儿），已被推翻。
  it('S02: × withdraws only this quote; the draft, its shots and the canvas nodes all survive and it can be presented again', async () => {
    const base = harness();
    await mixedDraft(base);
    const { handler, withWindow } = buildActions(base, 'http://127.0.0.1:1', []);
    await handler({ capability: 'present', params: { operationId: OPERATION_ID }, lease });
    const before = base.repository.read(PROJECT_ID, OPERATION_ID)!.generationPlan!.shots;
    const nodes = [...base.renderer.nodes.entries()];
    expect(await withWindow.discardPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID,
      quoteId: withWindow.listPendingSpend(PROJECT_ID)[0].quoteId })).toMatchObject({ ok: true });
    expect(withWindow.listPendingSpend(PROJECT_ID)).toEqual([]);
    const after = base.repository.read(PROJECT_ID, OPERATION_ID)!.generationPlan!;
    expect(after.state, '没有人说「不要这份草稿」：计划还是 draft').toBe('draft');
    expect(currentPresentation(after)?.closed?.by, '只是不再摆在用户面前：这一次出价按 × 关了').toBe('user_closed');
    expect(after.shots).toEqual(before);
    expect([...base.renderer.nodes.entries()]).toEqual(nodes);
    // 对同一份草稿再 generate = 重新出价，同一个 operationId 再出一张卡。
    await handler({ capability: 'present', params: { operationId: OPERATION_ID, shotIds: ['shot-1'] }, lease });
    expect(withWindow.listPendingSpend(PROJECT_ID)[0].shots.map((shot) => shot.shotId)).toEqual(['shot-1']);
  });

  // ── 裁决 C（2026-09-22 二次裁决）：重启作废的是「那一次出价」，不是「那份计划」──
  // 2026-09-22 下午起 × 走的也是这条边（用户拍板「× 只关这次请求」），所以这条同时是 × 的下半身。
  it('C: 收回出价——卡没了，计划、镜头、节点都在，同一个 operationId 还能再出价', async () => {
    const base = harness();
    await mixedDraft(base);
    const { handler, withWindow } = buildActions(base, 'http://127.0.0.1:1', []);
    await handler({ capability: 'present', params: { operationId: OPERATION_ID, shotIds: ['shot-1', 'shot-2'] }, lease });
    expect(withWindow.listPendingSpend(PROJECT_ID)).toHaveLength(1);
    const nodes = [...base.renderer.nodes.entries()];
    await handler({ capability: 'withdraw', params: { operationId: OPERATION_ID }, lease });
    expect(withWindow.listPendingSpend(PROJECT_ID), '收回之后面板上不许再有那张卡').toEqual([]);
    const plan = base.repository.read(PROJECT_ID, OPERATION_ID)!.generationPlan!;
    expect(plan.state, '不是 cancelled：没有人说过「不要这份草稿」').toBe('draft');
    expect(presentationIsOpen(plan)).toBe(false);
    expect(plan.shots).toHaveLength(33);
    expect([...base.renderer.nodes.entries()]).toEqual(nodes);
    // 幂等：再收一次什么都不变（重启清扫与「按停止」可能先后各来一次）。
    const revision = base.repository.read(PROJECT_ID, OPERATION_ID)!.revision;
    await handler({ capability: 'withdraw', params: { operationId: OPERATION_ID }, lease });
    expect(presentationIsOpen(base.repository.read(PROJECT_ID, OPERATION_ID)!.generationPlan)).toBe(false);
    expect(base.repository.read(PROJECT_ID, OPERATION_ID)!.revision).toBeGreaterThanOrEqual(revision);
    // 用户再说一句「生成」= 对同一份草稿重新出价。
    await handler({ capability: 'present', params: { operationId: OPERATION_ID, shotIds: ['shot-1'] }, lease });
    expect(withWindow.listPendingSpend(PROJECT_ID)).toHaveLength(1);
  });

  it('C: 启动清扫只收「早于本进程」的出价；本进程里摆出去的卡有人在等，不许抽走；× 过的不在范围里', async () => {
    const base = harness();
    await mixedDraft(base);
    const { handler, withWindow } = buildActions(base, 'http://127.0.0.1:1', []);
    await handler({ capability: 'present', params: { operationId: OPERATION_ID, shotIds: ['shot-1'] }, lease });
    const runs = () => [base.repository.read(PROJECT_ID, OPERATION_ID)!];
    const withdraw = (projectId: string, operationId: string, at: string, reason: "stopped") => base.operations.withdraw(projectId, operationId, at, reason);
    const presentedAt = runs()[0].generationPlan!.updatedAt;
    // 本进程启动早于这次出价 → 有人在等 → 不动。
    expect(await withdrawStalePresentations({ listRuns: runs, withdraw, processStartedAt: '2000-01-01T00:00:00.000Z' }, PROJECT_ID)).toEqual([]);
    expect(withWindow.listPendingSpend(PROJECT_ID)).toHaveLength(1);
    // 本进程启动晚于这次出价（= 上一个进程摆的）→ 收回。
    const later = new Date(Date.parse(presentedAt) + 1000).toISOString();
    expect(await withdrawStalePresentations({ listRuns: runs, withdraw, processStartedAt: later, now }, PROJECT_ID)).toEqual([OPERATION_ID]);
    expect(withWindow.listPendingSpend(PROJECT_ID)).toEqual([]);
    expect(runs()[0].generationPlan!.state).toBe('draft');
    // 关的原因是「被停」（问这句话的那个回合随上一个进程没了），不是「用户关了卡」：回执据此说真话。
    expect(runs()[0].generationPlan!.presentations?.at(-1)?.closed?.by).toBe('stopped');
    // 已经收回的 / × 过的：再扫一遍是 no-op。
    expect(await withdrawStalePresentations({ listRuns: runs, withdraw, processStartedAt: later, now }, PROJECT_ID)).toEqual([]);
  });

  // ── 回合怎么知道卡关了：只看账本里**这一次出价**开没开着（2026-10-05 删掉进程内转接表）──
  it('回合醒在这一次出价关掉那一刻：旧报价确认失败 → 卡还开着、回合接着等；改参数换了报价仍是同一次出价；确认成功 → 关', async () => {
    const vendor = await startLoopbackVendor();
    try {
      const base = harness();
      const { withWindow } = buildActions(base, vendor.origin, []);
      await draft(base);
      const turn = watchCardForTurn(base);
      const shown = withWindow.listPendingSpend(PROJECT_ID)[0];
      expect(await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: 'stale-quote' })).toMatchObject({ ok: false });
      await settleMicrotasks();
      expect(turn.closed(), '旧报价被挡回去：卡还在等，回合也接着等').toBe(false);
      const revised = await withWindow.revisePendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: shown.quoteId, patch: { prompt: '改一下' } });
      expect(revised).toMatchObject({ ok: true, code: 'revised' });
      expect(revised.quoteId, '改参数换了报价').not.toBe(shown.quoteId);
      expect(revised.pending?.quoteId, '回包带的就是宿主现算的那张卡').toBe(revised.quoteId);
      await settleMicrotasks();
      expect(turn.closed(), '换报价不是关卡：同一次出价').toBe(false);
      expect(await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: revised.quoteId! })).toMatchObject({ ok: true });
      await settleMicrotasks();
      expect(turn.closed(), '这一次出价关了，回合醒来').toBe(true);
      turn.dispose();
    } finally { await vendor.close(); }
  });

  // 类级：关卡的不只是卡上那四个动作。转接表时代只有它们会「递一句」，别的路把出价关掉（这里是计划被取消），
  // 等这张卡的回合就一直挂着，直到用户打字或按停。现在回合看账本，哪条路关的都一样醒。
  it('卡上动作以外的路关掉这一次出价（计划被取消）：回合同样醒来', async () => {
    const vendor = await startLoopbackVendor();
    try {
      const base = harness();
      const { withWindow } = buildActions(base, vendor.origin, []);
      await draft(base);
      expect(withWindow.listPendingSpend(PROJECT_ID), '卡开着').toHaveLength(1);
      const turn = watchCardForTurn(base);
      await base.operations.cancel(PROJECT_ID, OPERATION_ID, now());
      await settleMicrotasks();
      expect(withWindow.listPendingSpend(PROJECT_ID), '卡没了').toEqual([]);
      expect(turn.closed(), '回合醒来去读结局，不再挂着').toBe(true);
      turn.dispose();
    } finally { await vendor.close(); }
  });
});

it('S05: an old displayed quote cannot approve a revised candidate or higher price', async () => {
  const vendor = await startLoopbackVendor();
  const base = harness();
  const submits: string[] = [];
  const { withWindow } = buildActions(base, vendor.origin, submits);
  try {
    await draft(base);
    const displayed = withWindow.listPendingSpend(PROJECT_ID)[0];
    await withWindow.revisePendingSpend({ quoteId: withWindow.listPendingSpend(PROJECT_ID)[0].quoteId, projectId: PROJECT_ID, operationId: OPERATION_ID,
      patch: { parameters: { size: '1536x1024' } } });
    const result = await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: displayed.quoteId });
    expect(result).toMatchObject({ ok: false, message: 'generation_quote_changed' });
    expect(submits).toEqual([]);
    expect(base.repository.read(PROJECT_ID, OPERATION_ID)!.generationPlan!.state).toBe('draft');
  } finally { await vendor.close(); }
});

it('rejects a revision from an older displayed quote before mutating the current batch', async () => {
  const base = harness();
  const { withWindow } = buildActions(base, 'http://127.0.0.1:1', []);
  await draft(base);
  const displayed = withWindow.listPendingSpend(PROJECT_ID)[0];
  await base.operations.revise!(PROJECT_ID, OPERATION_ID, { patch: { prompt: 'new batch' } }, new Date().toISOString());
  const before = base.repository.read(PROJECT_ID, OPERATION_ID);
  expect(await withWindow.revisePendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: displayed.quoteId, patch: { prompt: 'old edit' } })).toMatchObject({ ok: false });
  expect(base.repository.read(PROJECT_ID, OPERATION_ID)).toEqual(before);
});


// 2026-09-22 下午用户拍板改窄裁决 D：× 收回的是**这一次出价**。所以这条钉回原来那件事
// （× 之后再 present，报价身份会变、候选一字不变），并把「第二次 × 不许变成错误」一起留着。
it('× withdraws the quote: the card is gone, nothing is submitted, and the same operation re-quotes the identical candidate', async () => {
  const base = harness(); const submits: string[] = [];
  const { withWindow, handler } = buildActions(base, 'http://127.0.0.1:1', submits);
  await draft(base);
  const displayed = withWindow.listPendingSpend(PROJECT_ID)[0];
  expect(await withWindow.discardPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: displayed.quoteId })).toMatchObject({ok:true});
  expect(withWindow.listPendingSpend(PROJECT_ID)).toEqual([]);
  // × 第二次（用户连点、或面板晚到一拍）不许变成一个错误弹给他：那张卡已经不在了。
  expect(await withWindow.discardPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: displayed.quoteId }))
    .toMatchObject({ ok: false });
  await handler({capability:'present', params:{operationId:OPERATION_ID}, lease});
  const reopened = withWindow.listPendingSpend(PROJECT_ID)[0];
  expect(reopened.quoteId, '重新出价 = 新的报价身份（旧卡上那个数不许批这一张）').not.toBe(displayed.quoteId);
  expect(reopened.planVersion).toBeGreaterThan(displayed.planVersion);
  expect(reopened.shots, '候选一个字不变').toEqual(displayed.shots);
  expect(submits).toEqual([]);
});


it('C12/C15: a real node id is not a task; a draft taskRef reports not_started without creating or cancelling execution', async () => {
  const base = harness(); const submits: string[] = [];
  const service = createProductionRunService({ repository: base.repository, projectRootResolver: () => base.root, previewSecret: 'test', requestRenderer: base.renderer.requestRenderer });
  base.operations = createProductionGenerationOperationStore(service, { onPlanChanged: (projectId, operationId) => base.canvasLanding.landDraftOnCanvas(projectId, operationId) });
  const { transport } = buildActions(base, 'http://127.0.0.1:1', submits);
  await draft(base);
  const nodeId = [...base.renderer.nodes.values()][0];
  expect(nodeId).toBeTruthy(); expect(nodeId).not.toBe(OPERATION_ID);
  const before = base.repository.read(PROJECT_ID, OPERATION_ID)!;
  const adapter = transport('step');
  for (const toolName of ['check_job', 'cancel_job']) {
    const wrong = verbToTransportCall({ toolCallId: toolName, toolName, args: {domain:'generation', jobId:nodeId} })!;
    expect(await adapter.tryExecute(wrong.call, new AbortController().signal)).toMatchObject({ok:false,code:'generation_operation_not_found'});
    expect(base.repository.read(PROJECT_ID, OPERATION_ID)).toEqual(before);
  }
  const correct = verbToTransportCall({ toolCallId:'correct', toolName:'check_job', args:{domain:'generation',jobId:OPERATION_ID} })!;
  const result = await adapter.tryExecute(correct.call,new AbortController().signal);
  expect(result).toMatchObject({ok:true,result:{executionState:'not_started',taskRef:{domain:'generation',jobId:OPERATION_ID},operation:{operationId:OPERATION_ID,state:'draft'}}});
  expect(before.jobs).toEqual([]);
  expect(base.repository.read(PROJECT_ID, OPERATION_ID)).toEqual(before);
  expect(submits).toEqual([]);
});


for (const pauseAt of ['lease','gate'] as const) it(`project replacement during ${pauseAt} cannot authorize a pending card`,async()=>{
  const base=harness(); const submits:string[]=[];const built=buildActions(base,'http://127.0.0.1:1',submits);await draft(base);
  let binding={projectId:PROJECT_ID,immutableProjectUuid:'project-uuid-1',projectGeneration:1};
  let resume!:()=>void;let entered!:()=>void;
  const blocked=new Promise<void>(r=>{resume=r});const reached=new Promise<void>(r=>{entered=r});let authorized=0;
  const pause=async()=>{entered();await blocked};
  const actions=createPendingSpendActions({isProjectOpen:()=>true,runs:{read:base.repository.read,list:base.repository.list},operations:base.operations,
    planning:built.handler,receipts:built.receipts,rendererTarget:()=>({webContentsId:1,frameId:0,origin:'app://nomi'}),
    committedBinding:()=>binding,leaseFor:async()=>{if(pauseAt==='lease')await pause();return lease},resolvePricing:()=>PRICING,now,
    normalizePatch:(baseCandidate,patch)=>resolvePlanPatch({baseCandidate,userPatch:patch,registry}).normalizedPatch,
    requestGenerationGate:async input=>{const gate=await built.authority.requestGenerationGate(input);if(pauseAt==='gate')await pause();return gate},
    authorizeGeneration:async()=>{authorized++;throw new Error('authorization must not be reached')},
  });
  const quote=actions.listPendingSpend(PROJECT_ID)[0];const confirming=actions.confirmPendingSpend({projectId:PROJECT_ID,operationId:OPERATION_ID,quoteId:quote.quoteId});
  await reached;binding={...binding,projectGeneration:2};resume();expect(await confirming).toMatchObject({ok:false});
  expect(authorized).toBe(0);expect(submits).toEqual([]);
});
