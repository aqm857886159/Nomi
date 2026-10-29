import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  currentPresentation,
  handOverOfCanvasRun,
  offerShots,
  presentationIsOpen,
  queuedHandOversOfClosedPresentations,
} from "../shared/productionGenerationPresentation";
import { deriveProductionShotState } from "../shared/productionShotPhase";
import type { PlanCandidate } from "../capabilityCore/executionContract";
import type { ProjectAgentApprovalPolicy } from "../shared/agentCapabilities/capabilityApprovalPolicy";
import { createProductionRunRepository } from "./productionRunRepository";
import type { ProductionRun, RunCommand } from "./productionRunTypes";

// 出价账上的交接（D2 第③步）：卡 / 策略把几镜交给画布 → 渲染层开同意时绑上画布 Run → 画布派发落定写回。
// 账本是唯一的线性化点：每一条关卡的路都在同一条命令里把「还没绑上」的那几笔记成收回；绑上了的按画布 Run 号落定，
// 不管它那一次出价此刻还是不是当前那一次。这里在真仓库上逐条钉命令的资格与形状（端到端在 agentPanelSpendCard*.e2e）。

const PROJECT = "project-1";
const RUN = "op-handover";
const NOW = "2026-10-24T00:00:00.000Z";
const roots: string[] = [];

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function candidate(shotId: string): PlanCandidate {
  return { candidateId: `cand-${shotId}`, revision: 1, moduleId: "generation.single-shot", providerId: "acme", modelId: "img-model", mode: "text_to_image", prompt: shotId, parameters: {}, references: [] };
}

function ledger(options: { host?: string; policySnapshot?: ProjectAgentApprovalPolicy; shots?: string[] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-handover-"));
  roots.push(root);
  const repository = createProductionRunRepository({ projectDirResolver: (id) => (id === PROJECT ? root : null), now: () => NOW });
  const shotIds = options.shots ?? ["s1", "s2"];
  repository.createGenerationDraft({
    operationId: RUN, projectId: PROJECT, origin: { host: options.host ?? "nomi" }, candidate: candidate(shotIds[0]),
    shots: shotIds.map((shotId) => ({ shotId, candidate: candidate(shotId) })),
    ...(options.policySnapshot ? { policySnapshot: options.policySnapshot } : {}),
  });
  let sequence = 0;
  const execute = (command: Omit<RunCommand, "commandId" | "expectedRevision" | "issuedAt">): ProductionRun => {
    const current = repository.read(PROJECT, RUN)!;
    return repository.execute(PROJECT, RUN, { ...command, commandId: `test-${++sequence}`, expectedRevision: current.revision, issuedAt: NOW } as RunCommand).run;
  };
  execute({ type: "plan.bind-shot-nodes", payload: { bindings: shotIds.map((shotId) => ({ shotId, nodeId: `node-${shotId}` })) } });
  const read = () => repository.read(PROJECT, RUN)!;
  const offers = () => offerShots(read()).map((shot) => [shot.shotId, shot.state]);
  return {
    repository, execute, read, offers,
    handOver: (shotIds: string[], by: "gesture" | "policy" = "gesture") => execute({ type: "generation.handover", payload: { shotIds, by } }),
    bind: (shotId: string, canvasRunId = `canvas-${shotId}`, nodeId = `node-${shotId}`) => execute({ type: "generation.handover.bind", payload: { bindings: [{ shotId, nodeId, canvasRunId }] } }),
    settle: (payload: Record<string, unknown>) => execute({ type: "generation.handover.settle", payload }),
    withdraw: (reason: string) => execute({ type: "generation.withdraw", payload: { reason } }),
    present: (shotIds?: string[]) => execute({ type: "generation.present", payload: shotIds ? { shotIds } : {} }),
    remove: (shotId: string) => execute({ type: "generation.shot.remove", payload: { shotId } }),
  };
}

describe("交接三步：记决定 → 绑画布 Run → 落定", () => {
  it("卡上点「生成」：两镜「正在发出」；绑上之后按画布 Run 落定成交到了；都交到了，这一次出价以「已交给画布」关", () => {
    const run = ledger();
    run.handOver(["s1", "s2"]);
    expect(run.offers()).toEqual([["s1", "handing_over"], ["s2", "handing_over"]]);
    run.bind("s1");
    run.bind("s2");
    run.settle({ shotId: "s1", canvasRunId: "canvas-s1", outcome: "accepted" });
    expect(run.offers()).toEqual([["s1", "sent"], ["s2", "handing_over"]]);
    expect(presentationIsOpen(run.read().generationPlan)).toBe(true);
    run.settle({ shotId: "s2", canvasRunId: "canvas-s2", outcome: "accepted" });
    expect(currentPresentation(run.read().generationPlan)?.closed?.by).toBe("handed_to_canvas");
  });

  it("只交还在等卡上决定的镜：正在发出 / 交到了 / 结果未知的再交一次都拒；确定没发出去的可以再交（新的一笔）", () => {
    const run = ledger();
    run.handOver(["s1"]);
    expect(() => run.handOver(["s1"])).toThrow(/generation_quote_changed/);
    run.bind("s1");
    run.settle({ shotId: "s1", canvasRunId: "canvas-s1", outcome: "unknown" });
    expect(() => run.handOver(["s1"])).toThrow(/generation_quote_changed/);
    run.handOver(["s2"]);
    run.settle({ shotId: "s2", outcome: "not_sent", failure: { kind: "parameter_rejected", code: "reference_required" } });
    expect(run.offers()).toEqual([["s1", "unknown"], ["s2", "not_sent"]]);
    run.handOver(["s2"]);
    expect(currentPresentation(run.read().generationPlan)!.handOvers!.filter((entry) => entry.shotId === "s2")).toHaveLength(2);
    expect(() => run.handOver([])).toThrow(/generation_quote_changed/);
    expect(() => run.handOver(["foreign"])).toThrow(/generation_quote_changed/);
  });

  it("绑：节点必须就是这一镜落在画布上的那个；一镜只绑一个画布 Run；出价关了就绑不上", () => {
    const run = ledger();
    run.handOver(["s1", "s2"]);
    expect(() => run.bind("s1", "canvas-s1", "node-elsewhere")).toThrow(/not on canvas node/);
    run.bind("s1");
    expect(() => run.bind("s1", "canvas-other")).toThrow(/already bound/);
    run.bind("s1");
    run.withdraw("user_closed");
    expect(() => run.bind("s2")).toThrow(/presentation closed/);
  });

  it("落定：没绑上的只能记「没发出去」/「收回」；画布 Run 号对不上的、已经落定过的原样不动（幂等）", () => {
    const run = ledger();
    run.handOver(["s1", "s2"]);
    expect(() => run.settle({ shotId: "s1", outcome: "accepted" })).toThrow(/never sent/);
    run.bind("s1");
    run.settle({ shotId: "s1", canvasRunId: "canvas-someone-else", outcome: "accepted" });
    expect(currentPresentation(run.read().generationPlan)!.handOvers![0].settled, "认不出的那一笔不写").toBeUndefined();
    run.settle({ shotId: "s1", canvasRunId: "canvas-s1", outcome: "accepted" });
    run.settle({ shotId: "s1", canvasRunId: "canvas-s1", outcome: "not_sent" });
    expect(currentPresentation(run.read().generationPlan)!.handOvers![0].settled?.outcome).toBe("accepted");
  });

  it("任务列表里把排队的这一镜去掉（收回 + removed）：出价开着时它同时记成「不生成」", () => {
    const run = ledger();
    run.handOver(["s1"]);
    run.bind("s1");
    run.settle({ shotId: "s1", canvasRunId: "canvas-s1", outcome: "withdrawn", withdrawnBy: "removed" });
    expect(run.offers()).toEqual([["s1", "removed"], ["s2", "undecided"]]);
    expect(run.read().generationPlan!.shots!.find((shot) => shot.shotId === "s1")?.included).toBe(false);
  });
});

// 债 d：「正在发出」是账上的一个事实，不是卡自己记的一份。卡那一格读 `offerShots`（`handing_over` → 「正在发出」），
// 画布占位读 `deriveProductionShotState`（→ 「排队中」），两个读点底下是同一笔交接；交出去、还没交到的时候，
// 画布不许还写「等你确认」（那会让用户以为还要再点一次）。
describe("「正在发出」：卡那一格和画布占位读同一笔交接", () => {
  const phases = (run: ReturnType<typeof ledger>) => ["s1", "s2"].map((shotId) => deriveProductionShotState(run.read(), shotId)?.phase ?? null);

  it("交出去、还没交到：卡那一格「正在发出」，画布占位「排队中」而不是「等你确认」；同一张卡上没交的那一镜照旧等你确认", () => {
    const run = ledger();
    expect(phases(run)).toEqual(["awaiting_confirmation", "awaiting_confirmation"]);
    run.handOver(["s1"]);
    expect(run.offers()).toEqual([["s1", "handing_over"], ["s2", "undecided"]]);
    expect(phases(run)).toEqual(["queued", "awaiting_confirmation"]);
    run.bind("s1");
    expect(phases(run), "绑上画布 Run、供应商还没受理：仍是排队中").toEqual(["queued", "awaiting_confirmation"]);
    run.settle({ shotId: "s1", canvasRunId: "canvas-s1", outcome: "not_sent", failure: { kind: "not_sent", code: "renderer_unavailable" } });
    expect(run.offers()).toEqual([["s1", "not_sent"], ["s2", "undecided"]]);
    expect(phases(run), "确定没发出去：占位说「还没生成」，不再说排队中").toEqual(["not_generated", "awaiting_confirmation"]);
  });

  it("「取消」收回还没交到的那几笔：占位不再说排队中，也不再等你确认", () => {
    const run = ledger();
    run.handOver(["s1", "s2"]);
    expect(phases(run)).toEqual(["queued", "queued"]);
    run.withdraw("user_closed");
    expect(phases(run)).toEqual(["not_generated", "not_generated"]);
  });
});

describe("每一条关卡的路都收尾还没绑上的那几笔", () => {
  it.each(["user_closed", "user_wrote", "stopped"] as const)("收回（%s）：没绑上的当场记成收回、原因照关卡的原因；绑上了还没落定的留给画布那一侧收回同意", (reason) => {
    const run = ledger();
    run.handOver(["s1", "s2"]);
    run.bind("s1");
    run.withdraw(reason);
    const presentation = currentPresentation(run.read().generationPlan)!;
    expect(presentation.closed?.by).toBe(reason);
    expect(presentation.handOvers!.map((entry) => [entry.shotId, entry.settled?.outcome ?? null, entry.settled?.withdrawnBy ?? null])).toEqual([
      ["s1", null, null], ["s2", "withdrawn", reason],
    ]);
    expect(queuedHandOversOfClosedPresentations(run.read().generationPlan)).toEqual([{ canvasRunId: "canvas-s1", by: reason }]);
  });

  it("被下一次出价顶掉：上一次没绑上的收回（stopped）；绑上的那一笔之后照样按画布 Run 号落定在它自己那一次出价上", () => {
    const run = ledger({ policySnapshot: { mode: "direct" } });
    run.handOver(["s1", "s2"], "policy");
    run.bind("s1");
    // 两镜都在交，不点名不剩没定的（会被拒）；点名重摆才顶得掉这一张。
    run.present(["s1", "s2"]);
    const [superseded, current] = run.read().generationPlan!.presentations!.slice(-2);
    expect(superseded.closed?.by).toBe("stopped");
    expect(superseded.handOvers!.find((entry) => entry.shotId === "s2")?.settled).toMatchObject({ outcome: "withdrawn", withdrawnBy: "stopped" });
    expect(current.handOvers ?? []).toEqual([]);
    run.settle({ shotId: "s1", canvasRunId: "canvas-s1", outcome: "not_sent" });
    const after = run.read().generationPlan!.presentations!;
    expect(after.at(-2)!.handOvers!.find((entry) => entry.shotId === "s1")?.settled?.outcome, "结论写回它自己那一笔").toBe("not_sent");
    expect(after.at(-2)!.policyDecisionState, "已经关了的出价不再退回给人").not.toBe("failed");
    expect(after.at(-1)!.handOvers ?? [], "当前这一次出价不被上一次的落定改动").toEqual([]);
    expect(handOverOfCanvasRun(run.read().generationPlan, "canvas-s1")?.presentationIndex).toBe(after.length - 2);
    expect(queuedHandOversOfClosedPresentations(run.read().generationPlan), "落定了就不再算排队").toEqual([]);
  });
});

describe("策略交接", () => {
  it("只在出价按「直接生成」开、代答没失败过时记得下；策略交出去的一镜没交到 → 这一次出价退回给人", () => {
    expect(() => ledger().handOver(["s1"], "policy")).toThrow(/generation_policy_not_direct/);
    const run = ledger({ policySnapshot: { mode: "direct" } });
    run.handOver(["s1", "s2"], "policy");
    run.bind("s1");
    run.settle({ shotId: "s1", canvasRunId: "canvas-s1", outcome: "accepted" });
    run.settle({ shotId: "s2", outcome: "not_sent", failure: { kind: "not_sent", code: "renderer_unavailable" } });
    expect(currentPresentation(run.read().generationPlan)!.policyDecisionState).toBe("failed");
    expect(() => run.handOver(["s2"], "policy"), "退回给人之后策略不再替他交").toThrow(/generation_policy_not_direct/);
    run.handOver(["s2"], "gesture");
    expect(run.offers()).toEqual([["s1", "sent"], ["s2", "handing_over"]]);
  });
});

describe("全部去掉", () => {
  it("Agent 面板的那一张全部去掉时留着（主按钮置灰、还能恢复），要关点「取消」", () => {
    const run = ledger();
    run.remove("s1");
    run.remove("s2");
    expect(presentationIsOpen(run.read().generationPlan)).toBe(true);
    run.execute({ type: "generation.shot.restore", payload: { shotId: "s2" } });
    expect(run.offers()).toEqual([["s1", "removed"], ["s2", "undecided"]]);
  });

  it("别的宿主（画布批量卡那一份同意 / 外部宿主）去掉了就是收回，照旧自己关", () => {
    const run = ledger({ host: "claude-code" });
    run.remove("s1");
    run.remove("s2");
    expect(currentPresentation(run.read().generationPlan)?.closed?.by).toBe("resolved");
  });
});
