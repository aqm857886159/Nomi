// 门岗（R28 第三层）：延迟目录里的每个动词翻出来的传输方法名，必须被它的目标 lane 适配器认。
//
// 根因合同 2026-09-11-agent-generation-second-door §direct_cause：PR #777 把模型面改成 20 个动词后，
// `verbToTransportCall` 翻出的 `nomi_generation_plan` 不在 `generationTransportAdapters` 手写的方法名
// 白名单里，适配器 `return null`，lane 把它写成 `generation_surface_unavailable`——生成组 4 个动词恒 100% 死。
// 第一层（编译器）：方法名是 `GenerationMethodName` 字面量联合；第二层（单一真相源）：白名单从契约
// `method` surface 派生；这一层兜底：真跑一遍翻译表。加规则前先验它会红（R17）：对着手写九元素数组跑，
// draft_shots / generate / check_job / cancel_job 四条红。
import { describe, expect, it } from "vitest";

import { isPiGenerationToolName } from "../capabilityCore/generationTransportAdapters";
import { resolveCapabilityAlias } from "../shared/agentCapabilities/registry";
import { modelFacingToolSpecs } from "../shared/agentCapabilities/modelFacingToolRegistry";
import { LANE_DEFERRED_TOOL_CATALOG } from "./laneToolCatalog";
import { exportJobTransportCall, verbToTransportCall, type VerbTransportCall } from "./laneVerbTransport";

/** 每个 lane 的「适配器认不认这个方法名」判据——与各适配器的路由谓词同源。 */
const ACCEPTED_BY_LANE: Record<VerbTransportCall["lane"], (method: string) => boolean> = {
  generation: (method) => isPiGenerationToolName(method),
  timeline: (method) => resolveCapabilityAlias(method)?.contract.id === "timeline.write",
  canvas: (method) => resolveCapabilityAlias(method)?.contract.id === "canvas.delete",
  export: (method) => resolveCapabilityAlias(method)?.contract.id === "export.write",
  media: (method) => resolveCapabilityAlias(method)?.contract.id === "asset.read",
  skillRead: (method) => resolveCapabilityAlias(method)?.contract.id === "skill.read",
  skillWrite: (method) => resolveCapabilityAlias(method)?.contract.id === "skill.write",
  modelSetup: (method) => resolveCapabilityAlias(method)?.contract.id === "model.setup.open",
};

/** 一份能过每个动词 schema 的最小参数：翻译只改形状不改语义，所以这里只要字段齐。 */
const SAMPLE_ARGS: Record<string, unknown> = {
  shots: [{ prompt: "海上日出" }], draftId: "op-1", jobId: "op-1", name: "ugc-ad", nodeIds: ["node-1"],
  revision: "revision-1", summary: "move", operations: [], changeId: "undo-1", expectedRevision: "revision-1",
  dirName: "talking-head", skillMarkdown: "---\nname: x\n---\nbody", provider: "DeepSeek", query: "rain",
};

/** 延迟目录里经领域端口执行的动词 + `check_job`（它是读动词，同样走 `executeRead` 的生成→导出两跳）。 */
function transportedVerbs(): string[] {
  const deferred = LANE_DEFERRED_TOOL_CATALOG.filter((spec) => spec.contractId !== "timeline.read").map((spec) => spec.name);
  const checkJob = modelFacingToolSpecs("internal").find((spec) => spec.name === "check_job");
  return checkJob && !deferred.includes(checkJob.name) ? [...deferred, checkJob.name] : deferred;
}

describe("verbToTransportCall · every transported verb lands on a method its lane adapter accepts", () => {
  for (const verb of transportedVerbs()) {
    it(`${verb} translates to a routable method`, () => {
      const translated = verbToTransportCall({ toolCallId: "call-1", toolName: verb, args: SAMPLE_ARGS });
      expect(translated, `${verb} has no transport mapping (lane would answer capability_unsupported)`).toBeDefined();
      const { lane, call } = translated!;
      expect(ACCEPTED_BY_LANE[lane](call.toolName),
        `${verb} → ${lane} lane → ${call.toolName}: the ${lane} adapter does not accept this method name`).toBe(true);
    });
  }

  it("check_job / cancel_job fall back to export methods the export adapter accepts", () => {
    for (const verb of ["check_job", "cancel_job"]) {
      const exportCall = exportJobTransportCall({ toolCallId: "call-1", toolName: verb, args: { jobId: "export-1" } });
      expect(resolveCapabilityAlias(exportCall.toolName)?.contract.id, `${verb} export fallback`).toMatch(/^export\./);
    }
  });

  it("a name that is not a generation method is rejected by the generation adapter", () => {
    // 阳性对照：谓词不是恒真。
    expect(isPiGenerationToolName("draft_shots")).toBe(false);
    expect(isPiGenerationToolName("nomi_generation_plan_v9")).toBe(false);
  });
});
