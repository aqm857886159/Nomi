/**
 * 类回归（2026-11-27，docs/fixes/2026-11-27-agent-param-keys.root-cause.json）：给 Agent 的模型清单，
 * **每一个内置档案的每一个方式**经两处真实投影出来，都要过两道真实入口校验；同时这两道门仍拒未知键。
 *
 * 投影两处：渲染层 `buildAgentModelEntries`（画布面板发回合用）、主进程 `agentModelEntriesFromCatalog`（list_models / 外部宿主）。
 * 入口两道：回合入参 `parseLaneComposerContext`（laneDesktopInput）、`list_models` 的输出校验（readVerbs）。
 *
 * 起因：档案控件类型加了可选键（图层分离的 presets / note），投影原样带过去，strict 的手抄键表不认，
 * 目录里有 Seedream 5.5 时**整轮**回合被拒、Agent 一个请求都发不出去；2026-11-14 的 slotEmpty 是同一类的上一次。
 * 只测某一个模型拦不住下一次：这里按档案全集走，新档案 / 新键自动进来。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  const { electronStub } = await import("../../parity/parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "nomi-agent-entry-boundary-")));
});

import { applyBuiltinSeeds } from "../../catalog/seedBuiltins";
import { agentModelEntriesFromCatalog } from "../../catalog/agentModelEntriesFromCatalog";
import { parseLaneComposerContext } from "../../agentLane/laneDesktopInput";
import { everyBuiltInArchetype } from "../modelArchetypes";
import { buildAgentModelEntries } from "../../../src/workbench/generationCanvas/agent/availableModels";
import type { ModelOption } from "../../../src/config/models";
import { readVerbs } from "./verbs/readVerbs";
import { modelSpecDetail, modelSpecRow } from "./modelSpecProjection";
import { PROJECT_AGENT_APPROVAL_MODES } from "./capabilityApprovalPolicy";
import { agentModelEntrySchema } from "./availableModelsSchema";
import type { AgentModelEntry } from "./availableModels";

const state = applyBuiltinSeeds({ version: 11, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, "2026-11-27").state;
const fromCatalog = agentModelEntriesFromCatalog(state).map((row) => row.entry);

// 渲染层那条：目录里的每一行（与 catalog IPC 下发同形），再加每个内置档案按 archetypeId 显式命中一行（没进种子的档案也覆盖到）。
const options: ModelOption[] = [
  ...state.models.map((model) => ({
    value: model.modelKey, modelKey: model.modelKey, label: model.labelZh || model.modelKey,
    vendor: model.vendorKey, kind: model.kind, meta: model.meta,
  })),
  ...everyBuiltInArchetype().map((archetype) => ({
    value: `class-test-${archetype.id}`, modelKey: `class-test-${archetype.id}`, label: archetype.id,
    vendor: "apimart", meta: { archetypeId: archetype.id },
  })),
];
const fromRenderer = buildAgentModelEntries(options);

/** 逐条过元素 schema，红的时候点名是哪个模型哪个方式哪个参数，不是一句「整张清单解析失败」。 */
function rejectedEntries(entries: readonly AgentModelEntry[]): string[] {
  return entries.flatMap((entry) => {
    const parsed = agentModelEntrySchema.safeParse(entry);
    return parsed.success ? [] : [`${entry.vendor}/${entry.modelId}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join(" | ")}`];
  });
}

/** 回合入参这道门自己有 256 KB 上限：分批送，每批都是一次真实的 parseLaneComposerContext。 */
function parseInBatches(entries: readonly AgentModelEntry[]): number {
  let accepted = 0;
  for (let start = 0; start < entries.length; start += 12) {
    const batch = entries.slice(start, start + 12);
    const parsed = parseLaneComposerContext({ approvalPolicy: { mode: PROJECT_AGENT_APPROVAL_MODES[0] }, availableModels: batch });
    accepted += parsed.availableModels?.length ?? 0;
  }
  return accepted;
}

describe("Agent 模型清单：全部内置档案经真实投影都过真实入口", () => {
  it("前提：两处投影覆盖了全部内置档案（不是只挑了几个）", () => {
    const archetypes = new Set(everyBuiltInArchetype().map((archetype) => archetype.id));
    expect(archetypes.size).toBeGreaterThan(100);
    expect(new Set(fromRenderer.map((entry) => entry.archetypeId).filter(Boolean))).toEqual(archetypes);
    // 带图层分离方式的档案也在两处清单里（这次的报告用例）。
    expect(fromRenderer.some((entry) => entry.modes.some((mode) => mode.modeId === "layers"))).toBe(true);
    expect(fromCatalog.some((entry) => entry.modes.some((mode) => mode.modeId === "layers"))).toBe(true);
  });

  it("渲染层投影的每一条都过元素 schema", () => {
    expect(rejectedEntries(fromRenderer)).toEqual([]);
  });

  it("主进程投影的每一条都过元素 schema", () => {
    expect(rejectedEntries(fromCatalog)).toEqual([]);
  });

  it("回合入参（laneDesktopInput）收下渲染层整张清单", () => {
    expect(parseInBatches(fromRenderer)).toBe(fromRenderer.length);
  });

  it("list_models 输出校验收下主进程整张清单，每个模型详情里的方式 / 参数都认得", () => {
    const listModels = readVerbs().find((verb) => verb.name === "list_models")!;
    expect(() => listModels.outputSchema!.parse({ models: fromCatalog.map((entry) => modelSpecRow(entry, "lane")) })).not.toThrow();
    // 这一条只管方式与参数（详情的 modes 复用条目 schema）；详情的 variants 另有一份键表，不在这次的类里（见根因合同 residual_risks）。
    const detailFailures = fromCatalog.flatMap((entry) => {
      const parsed = listModels.outputSchema!.safeParse({ model: modelSpecDetail(entry, "lane") });
      const inModes = parsed.success ? [] : parsed.error.issues.filter((issue) => issue.path.includes("modes") || issue.code === "invalid_union");
      return inModes.map((issue) => `${entry.vendor}/${entry.modelId}: ${issue.path.join(".")} ${issue.message}`);
    });
    expect(detailFailures).toEqual([]);
  });

  it("两道门仍拒未知键：放宽成照单全收（去掉 strict）的改法在这里红", () => {
    const sample = fromRenderer.find((entry) => entry.modes.some((mode) => mode.params.length > 0))!;
    const target = sample.modes.findIndex((mode) => mode.params.length > 0);
    const tampered = {
      ...sample,
      modes: sample.modes.map((mode, index) => index === target
        ? { ...mode, params: [{ ...mode.params[0], notDeclaredAnywhere: true }, ...mode.params.slice(1)] }
        : mode),
    };
    expect(agentModelEntrySchema.safeParse(tampered).success).toBe(false);
    expect(() => parseLaneComposerContext({ approvalPolicy: { mode: PROJECT_AGENT_APPROVAL_MODES[0] }, availableModels: [tampered] })).toThrow();
  });
});
