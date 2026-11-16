import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createCanvasHandOver } from "./canvasHandOver";
import { HAND_OVER_SHOTS_OP } from "../shared/contracts/canvasHandOver";
import type { PlanCandidate } from "./executionContract";
import { landingThatBinds } from "../productionRun/landFirstTestUtils";
import { createProductionRunRepository } from "../productionRun/productionRunRepository";
import { withEventTap } from "../productionRun/productionRunEventTap";
import type { ProductionRun } from "../productionRun/productionRunTypes";
import { currentPresentation } from "../shared/productionGenerationPresentation";

// 画布交接编排（`createCanvasHandOver`）在真仓库上的边：第①步不成就抛、什么都不记不交；之后每一步失败都不抛，
// 落成那几镜「没发出去」并带 Nomi 自己的语义码（渲染层回的乱码不过线）；策略那一档等落定，等满 / 回合被停就按此刻的样子回。

const PROJECT = "project-1";
const RUN = "op-handover";
const NOW = "2026-10-24T00:00:00.000Z";
const roots: string[] = [];

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const candidate = (shotId: string): PlanCandidate => ({ candidateId: `cand-${shotId}`, revision: 1, moduleId: "generation.single-shot", providerId: "acme", modelId: "img-model", mode: "text_to_image", prompt: shotId, parameters: {}, references: [] });

function world(requestRenderer: (op: string, payload: unknown) => Promise<unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-canvas-handover-"));
  roots.push(root);
  const listeners = new Set<(run: ProductionRun) => void>();
  const repository = withEventTap(createProductionRunRepository({ projectDirResolver: (id) => (id === PROJECT ? root : null), now: () => NOW }),
    (_events, run) => { for (const listener of [...listeners]) listener(run); });
  repository.createGenerationDraft({ operationId: RUN, projectId: PROJECT, origin: { host: "nomi" }, candidate: candidate("s1"),
    shots: ["s1", "s2"].map((shotId) => ({ shotId, candidate: candidate(shotId) })) });
  const calls: unknown[] = [];
  const handOver = createCanvasHandOver({
    runs: { read: (projectId, runId) => repository.read(projectId, runId), execute: (projectId, runId, command) => repository.execute(projectId, runId, command) },
    landShots: landingThatBinds(repository),
    requestRenderer: async (op, payload) => { calls.push({ op, payload }); return requestRenderer(op, payload); },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    now: () => NOW,
  });
  const read = () => repository.read(PROJECT, RUN)!;
  const settlements = () => (currentPresentation(read().generationPlan)?.handOvers ?? []).map((entry) => [entry.shotId, entry.settled?.outcome ?? null, entry.settled?.failure?.code ?? null]);
  let bindSequence = 0;
  /** 渲染层开好同意之后主进程绑上的那一步（生产里在 `appIntegrationCanvasShot.consent` 里）。 */
  const bind = (shotId: string) => {
    const run = read();
    return repository.execute(PROJECT, RUN, { commandId: `bind-${++bindSequence}`, expectedRevision: run.revision, issuedAt: NOW,
      type: "generation.handover.bind", payload: { bindings: [{ shotId, nodeId: `node-${shotId}`, canvasRunId: `canvas-${shotId}` }] } });
  };
  const settle = (shotId: string, outcome: string) => {
    const run = read();
    return repository.execute(PROJECT, RUN, { commandId: `settle-${shotId}`, expectedRevision: run.revision, issuedAt: NOW,
      type: "generation.handover.settle", payload: { shotId, canvasRunId: `canvas-${shotId}`, outcome } });
  };
  return { repository, handOver, calls, read, settlements, bind, settle };
}

describe("交给画布：第①步之后失败不抛，落成没发出去", () => {
  it("先落节点再问渲染层；渲染层拿到的是节点号与托管同意；回话里跳过的照它说的原因收尾，乱码不过线；没提到、也没绑上的按「没开出同意」", async () => {
    const fx = world(async () => ({ skipped: [{ shotId: "s1", failure: { kind: "parameter_rejected", code: "Reference Missing!" } }, { shotId: 42 }] }));
    await fx.handOver.handOver({ projectId: PROJECT, runId: RUN, shotIds: ["s1", "s2"], by: "gesture" });
    expect(fx.calls).toEqual([{ op: HAND_OVER_SHOTS_OP, payload: { projectId: PROJECT, runId: RUN, shots: [{ shotId: "s1", nodeId: "node-s1" }, { shotId: "s2", nodeId: "node-s2" }] } }]);
    expect(fx.settlements()).toEqual([["s1", "not_sent", "canvas_not_consented"], ["s2", "not_sent", "canvas_not_consented"]]);
    expect(currentPresentation(fx.read().generationPlan)!.handOvers![0].settled?.failure?.kind).toBe("parameter_rejected");
  });

  it.each([
    ["窗口不在（RendererUnavailableError）", Object.assign(new Error("gone"), { name: "RendererUnavailableError" }), "renderer_unavailable"],
    ["带 Nomi 语义码的错", Object.assign(new Error("x"), { code: "project_not_open" }), "project_not_open"],
    ["认不出的错", new Error("Socket closed by peer: secret-token-123"), "canvas_hand_over_failed"],
  ])("渲染层那一问失败（%s）：每一镜没发出去，码是 %s 那一类，供应商原话不过线", async (_label, error, code) => {
    const fx = world(async () => { throw error; });
    await fx.handOver.handOver({ projectId: PROJECT, runId: RUN, shotIds: ["s1"], by: "gesture" });
    expect(fx.settlements()).toEqual([["s1", "not_sent", code]]);
    expect(JSON.stringify(fx.read())).not.toContain("secret-token-123");
  });

  it("绑上了的不替它收尾：结局由画布那一侧写回", async () => {
    const fx = world(async () => { fx.bind("s1"); return { skipped: [] }; });
    await fx.handOver.handOver({ projectId: PROJECT, runId: RUN, shotIds: ["s1", "s2"], by: "gesture" });
    expect(fx.settlements()).toEqual([["s1", null, null], ["s2", "not_sent", "canvas_not_consented"]]);
  });

  it("第①步不成（这一镜已经不在等卡上的决定）：抛，什么都不记、不问渲染层", async () => {
    const fx = world(async () => ({}));
    await expect(fx.handOver.handOver({ projectId: PROJECT, runId: RUN, shotIds: ["ghost"], by: "gesture" })).rejects.toThrow(/generation_quote_changed/);
    expect(fx.calls).toEqual([]);
    expect(currentPresentation(fx.read().generationPlan)!.handOvers ?? []).toEqual([]);
  });
});

describe("策略那一档等落定", () => {
  it("落定一到就醒（账本变更订阅），回的是这一次出价里那几镜此刻的样子", async () => {
    const fx = world(async () => { fx.bind("s1"); fx.bind("s2"); return {}; });
    await fx.handOver.handOver({ projectId: PROJECT, runId: RUN, shotIds: ["s1", "s2"], by: "gesture" });
    const waiting = fx.handOver.waitForSettlement(PROJECT, RUN, ["s1", "s2"], 60_000);
    fx.settle("s1", "accepted");
    fx.settle("s2", "unknown");
    await expect(waiting).resolves.toEqual({ accepted: ["s1"], pending: [], failed: ["s2"] });
  });

  it("等满了还在交的照「在交」算；回合被停（signal 断了）当场按此刻的样子回", async () => {
    const fx = world(async () => { fx.bind("s1"); return {}; });
    await fx.handOver.handOver({ projectId: PROJECT, runId: RUN, shotIds: ["s1"], by: "gesture" });
    await expect(fx.handOver.waitForSettlement(PROJECT, RUN, ["s1"], 10)).resolves.toEqual({ accepted: [], pending: ["s1"], failed: [] });
    const controller = new AbortController();
    const waiting = fx.handOver.waitForSettlement(PROJECT, RUN, ["s1"], 60_000, controller.signal);
    controller.abort();
    await expect(waiting).resolves.toEqual({ accepted: [], pending: ["s1"], failed: [] });
  });
});
