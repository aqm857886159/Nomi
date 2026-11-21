import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";

import { verbToTransportCall } from "../agentLane/laneVerbTransport";
import { currentPresentation, presentationIsOpen } from "../shared/productionGenerationPresentation";
import { GENERATION_METHODS } from "../shared/agentCapabilities/generation";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import { resolveProductionReferenceUrls } from "./productionReferenceUrls";
import { withdrawStalePresentations } from "../productionRun/stalePresentationSweep";
import type { SpendReferenceAssets } from "./pendingSpendReferences";
import {
  OPERATION_ID, PROJECT_ID, callTool, candidate, draft, lease, now, resetSpendFixture, shotsDraft, spendWorld, type DraftShot, type SpendWorld,
} from "./agentPanelSpendConfirmTestUtils";

const HELD_REFERENCE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function startHeldReferenceUpload() {
  const uploads: Array<{ bytes: number }> = [];
  let releaseUpload: (() => void) | undefined;
  let seenResolve!: () => void;
  const requestSeen = new Promise<void>((resolve) => { seenResolve = resolve; });
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/uploads/images") {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    uploads.push({ bytes: Buffer.concat(chunks).length });
    seenResolve();
    await new Promise<void>((resolve) => { releaseUpload = resolve; });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ url: "https://loopback.invalid/reference.png" }));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("held upload fixture did not bind");
  const endpoint = `http://127.0.0.1:${address.port}/v1/uploads/images`;
  const assets: SpendReferenceAssets = {
    list: () => [{ id: "a1", data: { url: "nomi-local://asset/project-1/cat.png", contentType: "image/png" } }],
    identity: (_projectId, assetId) => assetId === "a1" ? { contentHash: "h-a1", version: 1 } : undefined,
  };
  const resolveReferences = async (input: Parameters<typeof resolveProductionReferenceUrls>[0]) => {
    input.assertCurrent();
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(HELD_REFERENCE_PNG)], { type: "image/png" }), "cat.png");
    const response = await fetch(endpoint, { method: "POST", body: form });
    const body = await response.json() as { url: string };
    input.assertCurrent();
    return Object.fromEntries(input.references.map((reference) => [spendReferenceKey(reference), body.url]));
  };
  return {
    assets,
    resolveReferences,
    requestSeen,
    uploads,
    release: () => { releaseUpload?.(); releaseUpload = undefined; },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// 一次出价（D2 第③步）：卡摆的是 Agent 这一次 `generate` 点名的那几镜；「取消」/ Agent 收回 / 重启清扫关的都只是**这一次出价**，
// 草稿、镜头、画布节点一个不动，同一份草稿再 `generate` 就是重新出价（新的身份，旧卡上的动作一律挡回）。卡上没有参数：
// 一镜要发什么只住在节点上——起草钉住的参考也落在节点上，交的时候照节点发。

afterEach(resetSpendFixture);

const nodesSnapshot = (world: SpendWorld) => [...world.renderer.nodes.entries()].map(([nodeId, node]) => [nodeId, structuredClone(node)]);

/** 33 镜：前 6 镜是参考卡（定妆 / 场景），其余是镜头；起草好、卡藏着（等 `generate`）。 */
async function longPlan(world: SpendWorld): Promise<void> {
  const shots: DraftShot[] = Array.from({ length: 33 }, (_, offset) => ({ role: offset < 6 ? "anchor" : "shot" }));
  await shotsDraft(world, shots, false);
}

describe("这一次出价摆哪几镜", () => {
  it("建草稿的结果点名它落在画布上的那个节点（传输 → 草稿账本 → 落地宿主 → 读回账本）", async () => {
    const world = spendWorld();
    const created = await callTool(world.transport("request"), GENERATION_METHODS.plan, {
      operation: "create", taskKind: "text_to_image", candidate: candidate("img-model", { size: "1024x1024" }),
    }) as { result?: { canvasLanding?: unknown } };
    expect(world.renderer.nodes.size).toBe(1);
    expect(created.result?.canvasLanding).toEqual({ state: "placed", shotCount: 1, nodes: [{ shotId: expect.any(String), nodeId: [...world.renderer.nodes.keys()][0] }] });
  });

  it("S01：只摆点名的那三镜、按计划里的顺序（第几镜 = 分镜号）；33 镜一镜不少", async () => {
    const world = spendWorld();
    await longPlan(world);
    const presented = await callTool(world.transport("request"), GENERATION_METHODS.plan, { operation: "present", operationId: OPERATION_ID, shotIds: ["shot-3", "shot-1", "shot-2"] });
    expect(presented).toMatchObject({ ok: true });
    const shown = world.pending()!;
    expect(shown.shots.map((shot) => [shot.shotId, shot.index])).toEqual([["shot-1", 1], ["shot-2", 2], ["shot-3", 3]]);
    expect(world.run().generationPlan!.shots).toHaveLength(33);
  });

  it.each([[], ["shot-1", "shot-1"], ["foreign-shot"], ["shot-1", "foreign-shot"]].map((shotIds) => ({ shotIds })))(
    "S03：范围不合法 $shotIds 整体拒，账本一个字不动", async ({ shotIds }) => {
      const world = spendWorld();
      await longPlan(world);
      const before = world.run();
      await expect(world.handler({ capability: "present", params: { operationId: OPERATION_ID, shotIds }, lease })).rejects.toThrow(/shot|scope/i);
      expect(world.run()).toEqual(before);
    });

  it("S06：先交 3 张参考卡、再交剩下 30 镜：同一份 33 镜计划，每镜只发一次，先发的那 3 笔不重发，节点一个不换", async () => {
    const world = spendWorld();
    await longPlan(world);
    const nodes = nodesSnapshot(world);
    const firstIds = ["shot-1", "shot-2", "shot-3"];
    await world.handler({ capability: "present", params: { operationId: OPERATION_ID, shotIds: firstIds }, lease });
    const firstCard = world.pending()!;
    await world.generate();
    await world.renderer.drain();
    expect(world.sentShots()).toEqual(firstIds);
    expect(world.pending(), "三张参考卡都交到了，这一次出价自己关").toBeUndefined();
    expect(currentPresentation(world.run().generationPlan)!.closed?.by).toBe("handed_to_canvas");
    const firstRequests = structuredClone(world.vendor.executes);

    const remainingIds = Array.from({ length: 30 }, (_, offset) => `shot-${offset + 4}`);
    await world.handler({ capability: "present", params: { operationId: OPERATION_ID, shotIds: remainingIds }, lease });
    expect(await world.generate([remainingIds[0]], firstCard), "上一次出价的卡点不动这一次").toMatchObject({ ok: false, message: "generation_quote_changed" });
    expect(world.pending()!.shots.map((shot) => shot.shotId)).toEqual(remainingIds);
    await world.generate();
    await world.renderer.drain();
    expect(world.vendor.executes).toHaveLength(33);
    expect(new Set(world.sentShots()).size).toBe(33);
    expect(world.vendor.executes.slice(0, 3)).toEqual(firstRequests);
    expect(new Set(world.vendor.executes.map((entry) => entry.request.extras?.idempotencyKey)).size, "每一镜一个幂等键").toBe(33);
    expect(nodesSnapshot(world)).toEqual(nodes);
    expect(world.run().generationPlan!.shots).toHaveLength(33);
    expect(world.pending()).toBeUndefined();
  }, 120_000);
});

describe("关的只是这一次出价", () => {
  it("S02：卡上「取消」：卡没了；计划还是草稿，镜头、节点一个不动；同一份草稿再 generate 就是重新出价", async () => {
    const world = spendWorld();
    await longPlan(world);
    await world.handler({ capability: "present", params: { operationId: OPERATION_ID }, lease });
    const shots = world.run().generationPlan!.shots;
    const nodes = nodesSnapshot(world);
    expect(await world.cancel()).toEqual({ ok: true, code: "discarded" });
    expect(world.pending()).toBeUndefined();
    const plan = world.run().generationPlan!;
    expect(plan.state, "没有人说「不要这份草稿」").toBe("draft");
    expect(currentPresentation(plan)?.closed?.by).toBe("user_closed");
    expect(plan.shots).toEqual(shots);
    expect(nodesSnapshot(world)).toEqual(nodes);
    await world.handler({ capability: "present", params: { operationId: OPERATION_ID, shotIds: ["shot-1"] }, lease });
    expect(world.pending()!.shots.map((shot) => shot.shotId)).toEqual(["shot-1"]);
    expect(world.vendor.executes).toEqual([]);
  });

  it("取消之后：第二下取消照实回那一次的结局；再出价换一个身份（旧卡上的数批不了新的一张），摆的镜一字不变", async () => {
    const world = spendWorld();
    await draft(world);
    const displayed = world.pending()!;
    expect(await world.cancel(displayed)).toEqual({ ok: true, code: "discarded" });
    expect(await world.cancel(displayed), "连点 / 面板晚到一拍：不是错误").toEqual({ ok: true, code: "discarded" });
    await world.handler({ capability: "present", params: { operationId: OPERATION_ID }, lease });
    const reopened = world.pending()!;
    expect(reopened.quoteId).not.toBe(displayed.quoteId);
    expect(reopened.planVersion).toBeGreaterThan(displayed.planVersion);
    expect(reopened.shots).toEqual(displayed.shots);
    expect(await world.generate(undefined, displayed)).toMatchObject({ ok: false, message: "generation_quote_changed" });
    expect(world.vendor.executes).toEqual([]);
  });

  it("C09：晚到的取消带着被顶掉那一次的身份：关不掉新的一张；新的一张关了以后，也不替旧卡报新的一张的结局", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}]);
    const superseded = world.pending()!;
    await world.handler({ capability: "present", params: { operationId: OPERATION_ID }, lease });
    const current = world.pending()!;
    const before = world.run();
    expect(await world.cancel(superseded)).toMatchObject({ ok: false, message: "generation_quote_changed" });
    expect(world.run()).toEqual(before);
    expect(world.pending()!.quoteId).toBe(current.quoteId);
    await world.generate(undefined, current);
    await world.renderer.drain();
    expect(world.pending()).toBeUndefined();
    expect(await world.cancel(superseded)).toMatchObject({ ok: false, message: "generation_quote_changed" });
    expect(await world.cancel(current)).toEqual({ ok: true, code: "discarded", batchStopped: { sent: 2, notSent: 0 } });
  });

  it("Agent 收回出价（回合被停 / 用户打了字）：卡没了，计划、镜头、节点都在；收两次不变；还能再出价", async () => {
    const world = spendWorld();
    await longPlan(world);
    await world.handler({ capability: "present", params: { operationId: OPERATION_ID, shotIds: ["shot-1", "shot-2"] }, lease });
    expect(world.pending()).toBeDefined();
    const nodes = nodesSnapshot(world);
    await world.handler({ capability: "withdraw", params: { operationId: OPERATION_ID }, lease });
    expect(world.pending()).toBeUndefined();
    const plan = world.run().generationPlan!;
    expect(plan.state).toBe("draft");
    expect(presentationIsOpen(plan)).toBe(false);
    expect(plan.shots).toHaveLength(33);
    expect(nodesSnapshot(world)).toEqual(nodes);
    const revision = world.run().revision;
    await world.handler({ capability: "withdraw", params: { operationId: OPERATION_ID }, lease });
    expect(presentationIsOpen(world.run().generationPlan)).toBe(false);
    expect(world.run().revision).toBeGreaterThanOrEqual(revision);
    await world.handler({ capability: "present", params: { operationId: OPERATION_ID, shotIds: ["shot-1"] }, lease });
    expect(world.pending()).toBeDefined();
  });

  it("启动清扫只收「早于本进程」的出价：本进程摆出去的卡有人在等，不动；收回的关因是「被停」；关过的不在范围里", async () => {
    const world = spendWorld();
    await longPlan(world);
    await world.handler({ capability: "present", params: { operationId: OPERATION_ID, shotIds: ["shot-1"] }, lease });
    const listRuns = () => [world.run()];
    const withdraw = (projectId: string, operationId: string, at: string, reason: "stopped") => world.operations.withdraw(projectId, operationId, at, reason);
    expect(await withdrawStalePresentations({ listRuns, withdraw, processStartedAt: "2000-01-01T00:00:00.000Z", now }, PROJECT_ID)).toEqual([]);
    expect(world.pending()).toBeDefined();
    const later = new Date(Date.parse(currentPresentation(world.run().generationPlan)!.openedAt) + 1000).toISOString();
    expect(await withdrawStalePresentations({ listRuns, withdraw, processStartedAt: later, now }, PROJECT_ID)).toEqual([OPERATION_ID]);
    expect(world.pending()).toBeUndefined();
    expect(world.run().generationPlan!.state).toBe("draft");
    expect(currentPresentation(world.run().generationPlan)?.closed?.by).toBe("stopped");
    expect(await withdrawStalePresentations({ listRuns, withdraw, processStartedAt: later, now }, PROJECT_ID)).toEqual([]);
  });
});

describe("参考图住在节点上", () => {
  const assets: SpendReferenceAssets = {
    list: () => [{ id: "a1", data: { url: "nomi-local://asset/project-1/a1.png", contentType: "image/png" } }],
    identity: (_projectId, assetId) => (assetId === "a1" ? { contentHash: "h-a1", version: 1 } : undefined),
  };
  const pinned = (assetId: string, role?: "first_frame") => ({ assetId, contentHash: `h-${assetId}`, version: 1, kind: "image" as const, ...(role ? { role } : {}) });

  it("起草钉住的本项目参考落到节点上，交的时候供应商收到它；对不上的那一张（不在本项目素材里）不过线、也不会发出去", async () => {
    const world = spendWorld({ assets });
    await shotsDraft(world, [{ references: [pinned("a1", "first_frame"), pinned("gone")] as DraftShot["references"] }]);
    const node = world.renderer.nodeOf("shot-1")!;
    expect(node.references).toEqual([{ url: "nomi-local://asset/project-1/a1.png", kind: "image", role: "first_frame" }]);
    await world.generate();
    await world.renderer.drain();
    expect(world.vendor.executes[0].request.extras?.references).toEqual([{ url: "nomi-local://asset/project-1/a1.png", kind: "image", role: "first_frame" }]);
    expect(JSON.stringify(world.vendor.executes)).not.toContain("gone");
  });

  it("Agent 封出价时真实 multipart 上传被扣住：Nomi 自写节点绑定不作废，放行后出价照常封出", async () => {
    const upload = await startHeldReferenceUpload();
    const world = spendWorld({ assets: upload.assets, resolveReferences: upload.resolveReferences });
    try {
      await shotsDraft(world, [{ references: [pinned("a1")] }], false);
      await world.handler({ capability: "present", params: { operationId: OPERATION_ID }, lease });
      const seal = world.handler({ capability: "gate_request", params: { operationId: OPERATION_ID }, lease });
      await upload.requestSeen;
      const duringUpload = world.run();
      const shotId = duringUpload.generationPlan!.shots?.[0]?.shotId ?? duringUpload.generationPlan!.candidate.candidateId;
      world.repository.execute(PROJECT_ID, OPERATION_ID, {
        commandId: `fixture:self-write:${duringUpload.revision}`,
        expectedRevision: duringUpload.revision,
        type: "plan.bind-shot-nodes",
        payload: { bindings: [{ shotId, nodeId: "node-self-write" }] },
        issuedAt: now(),
      });
      upload.release();
      await expect(seal).resolves.toMatchObject({ nextAction: "confirm" });
      expect(upload.uploads).toHaveLength(1);
      expect(world.run().generationPlan?.state).toBe("sealed");
      expect(world.pending()).toBeDefined();
    } finally {
      upload.release();
      await upload.close();
    }
  });

  it("Agent 封出价时真实 multipart 上传被扣住：用户改候选后放行拒绝，原因是 generation_reference_scope_changed、供应商 0 次、卡保留", async () => {
    const upload = await startHeldReferenceUpload();
    const world = spendWorld({ assets: upload.assets, resolveReferences: upload.resolveReferences });
    try {
      await shotsDraft(world, [{ references: [pinned("a1")] }], false);
      await world.handler({ capability: "present", params: { operationId: OPERATION_ID }, lease });
      const seal = world.handler({ capability: "gate_request", params: { operationId: OPERATION_ID }, lease });
      await upload.requestSeen;
      const current = world.run();
      await world.operations.patch!(PROJECT_ID, OPERATION_ID, { prompt: "用户在上传期间改了这一镜" }, now(), "shot-1");
      upload.release();
      await expect(seal).rejects.toThrow("generation_reference_scope_changed");
      expect(world.vendor.executes).toHaveLength(0);
      expect(world.pending()).toBeDefined();
      expect(current.generationPlan?.shots?.[0]?.candidate.prompt).not.toBe("用户在上传期间改了这一镜");
    } finally {
      upload.release();
      await upload.close();
    }
  });
});

describe("节点号不是任务号", () => {
  it("C12/C15：拿真节点 id 当任务号查 / 停：找不到，账本一个字不动；拿草稿的 taskRef 查：还没开始，不建也不撤执行", async () => {
    const world = spendWorld();
    await draft(world);
    const nodeId = [...world.renderer.nodes.keys()][0];
    expect(nodeId).toBeTruthy();
    expect(nodeId).not.toBe(OPERATION_ID);
    const before = world.run();
    const adapter = world.transport("request");
    for (const toolName of ["check_job", "cancel_job"]) {
      const wrong = verbToTransportCall({ toolCallId: toolName, toolName, args: { domain: "generation", jobId: nodeId } }, [])!;
      expect(await adapter.tryExecute(wrong.call, new AbortController().signal)).toMatchObject({ ok: false, code: "generation_operation_not_found" });
      expect(world.run()).toEqual(before);
    }
    const correct = verbToTransportCall({ toolCallId: "correct", toolName: "check_job", args: { domain: "generation", jobId: OPERATION_ID } }, [])!;
    expect(await adapter.tryExecute(correct.call, new AbortController().signal)).toMatchObject({
      ok: true, result: { executionState: "not_started", taskRef: { domain: "generation", jobId: OPERATION_ID }, operation: { operationId: OPERATION_ID, state: "draft" } },
    });
    expect(world.run()).toEqual(before);
    expect(world.vendor.executes).toEqual([]);
  });
});
