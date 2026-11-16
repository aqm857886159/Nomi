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
import { objectFieldKeys } from "../shared/agentCapabilities/verbs/verbProjections";
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
};

/** 一份能过每个动词 schema 的最小参数：翻译只改形状不改语义，所以这里只要字段齐。 */
const SAMPLE_FIELDS: Record<string, unknown> = {
  domain: "generation", shots: [{ prompt: "海上日出" }], operationId: "op-1", jobId: "op-1", name: "ugc-ad", nodeIds: ["node-1"],
  baseRevision: "revision-1", summary: "move", operations: [{ kind: "move", clipId: "clip-1", startFrame: 0 }], changeId: "timeline:v1:undo-1", expectedRevision: "revision-1",
  dirName: "talking-head", skillMarkdown: "---\nname: x\n---\nbody", provider: "DeepSeek", query: "rain",
};

/**
 * 只把**这个动词自己声明过的**字段喂给它。
 *
 * 过去这里是一份大杂烩：20 个动词的字段全塞进同一个对象，每个动词都收到一堆它没声明过的键。
 * 对照表时代看不出问题（`projectByFieldMap` 只挑表里列过的键），投影之后模型面是 `.strict()` 的，
 * 一个外来键就该当场被拒——而那正是生产行为，所以要拒的是这份夹具，不是投影。
 */
function sampleArgsFor(verb: string): Record<string, unknown> {
  const spec = modelFacingToolSpecs("internal").find((item) => item.name === verb);
  const keys = spec ? objectFieldKeys(spec.schema, `verb ${verb}`) : [];
  return Object.fromEntries(Object.entries(SAMPLE_FIELDS).filter(([key]) => keys.includes(key)));
}

/**
 * 延迟目录里经领域端口执行的动词 + `check_job`（它是读动词，同样走 `executeRead` 的生成→导出两跳）。
 */
/** 这条消息带上来的可用模型清单（`draft_shots` 的完整名字在它里面查）。`video-1` 两家都有：只写 id 要拒。 */
const MODELS = [
  { vendor: "apimart", modelId: "image-1", modelAlias: null },
  { vendor: "apimart", modelId: "video-1", modelAlias: null },
  { vendor: "kie", modelId: "video-1", modelAlias: null },
  { vendor: "kie", modelId: "bytedance/seedance-2", modelAlias: null },
];
const translate = (call: Parameters<typeof verbToTransportCall>[0]) => verbToTransportCall(call, MODELS);

function transportedVerbs(): string[] {
  const deferred = LANE_DEFERRED_TOOL_CATALOG
    .filter((spec) => spec.contractId !== "timeline.read")
    .map((spec) => spec.name);
  const checkJob = modelFacingToolSpecs("internal").find((spec) => spec.name === "check_job");
  return checkJob && !deferred.includes(checkJob.name) ? [...deferred, checkJob.name] : deferred;
}

describe("verbToTransportCall · every transported verb lands on a method its lane adapter accepts", () => {
  for (const verb of transportedVerbs()) {
    it(`${verb} translates to a routable method`, () => {
      const translated = translate({ toolCallId: "call-1", toolName: verb, args: sampleArgsFor(verb) });
      expect(translated, `${verb} has no transport mapping (lane would answer capability_unsupported)`).toBeDefined();
      const { lane, call } = translated!;
      expect(ACCEPTED_BY_LANE[lane](call.toolName),
        `${verb} → ${lane} lane → ${call.toolName}: the ${lane} adapter does not accept this method name`).toBe(true);
    });
  }

  it("check_job / cancel_job route explicit export domain to methods the export adapter accepts", () => {
    for (const verb of ["check_job", "cancel_job"]) {
      const exportCall = exportJobTransportCall({ toolCallId: "call-1", toolName: verb, args: { domain: "export", jobId: "export-1" } });
      expect(resolveCapabilityAlias(exportCall.toolName)?.contract.id, `${verb} explicit export route`).toMatch(/^export\./);
    }
  });

  // ── 2026-09-18 扫描的回归：翻译层**静默丢字段**那一类（`docs/fixes/2026-09-18-verb-host-input-conformance`）──
  //
  // 这一族比「被拒收」更险：模型点名「用 apimart 的 image-1」，翻译层把点名整只丢掉，宿主照用户的
  // 默认模型去**花钱**，而没有任何一层报错。所以这里断的是「值有没有到达宿主」，不是「有没有报错」。
  it("逐镜点名的完整名字到得了宿主（拆回两件身份），而不是被悄悄换成用户的默认模型", () => {
    const translated = translate({
      toolCallId: "call-1", toolName: "draft_shots",
      args: { shots: [{ prompt: "海上日出", model: "image-1@apimart" }] },
    })!;
    expect(translated.call.args).toMatchObject({ operation: "create", providerId: "apimart", modelId: "image-1" });
    expect(translated).not.toHaveProperty("resolvedModels");
  });

  it("顶层缺省只剩 taskKind，折进每一镜；逐镜自己写的值优先，模型各镜自己点名", () => {
    const translated = translate({
      toolCallId: "call-1", toolName: "draft_shots",
      args: {
        taskKind: "text_to_video",
        shots: [
          { role: "anchor", prompt: "角色卡", taskKind: "text_to_image", model: "image-1@apimart" },
          { role: "shot", prompt: "第一镜", model: "video-1@kie" },
        ],
      },
    })!;
    const shots = (translated.call.args as { shots: Array<Record<string, unknown>> }).shots;
    expect(shots[0]).toMatchObject({ taskKind: "text_to_image", providerId: "apimart", modelId: "image-1" });
    expect(shots[1]).toMatchObject({ taskKind: "text_to_video", providerId: "kie", modelId: "video-1" });
  });

  it("只写模型 id、目录里只有一家：放行，并把落成的完整名字带回去", () => {
    const translated = translate({ toolCallId: "call-1", toolName: "draft_shots",
      args: { shots: [{ prompt: "海上日出", model: "image-1" }] } })!;
    expect(translated.call.args).toMatchObject({ providerId: "apimart", modelId: "image-1" });
    expect(translated).toMatchObject({ resolvedModels: [{ written: "image-1", model: "image-1@apimart" }] });
  });

  it("只写模型 id、两家都有：拒一次，列出那几个完整名字，不替 Agent 挑", () => {
    expect(() => translate({ toolCallId: "call-1", toolName: "draft_shots",
      args: { shots: [{ prompt: "第一镜", model: "video-1" }] } })).toThrow(expect.objectContaining({
      failure: expect.objectContaining({ code: "tool_arguments_invalid",
        issues: [expect.objectContaining({ path: "shots.0.model", allowed: ["video-1@apimart", "video-1@kie"] })] }) }));
  });

  it("名字查不到：拒收并给最像的完整名字作下一步；码和闭合原因与宿主那一层的「目录里没有」同一个（面板、遥测不变）", () => {
    let failure: { code: string; message: string; nextAction: string; issues: Array<{ allowed?: string[] }>; problem?: { code: string; field?: string; nearest?: string } } | undefined;
    try {
      translate({ toolCallId: "call-1", toolName: "draft_shots", args: { shots: [{ prompt: "第一镜", model: "image-1@kie" }] } });
    } catch (error) { failure = (error as { failure: typeof failure }).failure; }
    expect(failure?.code).toBe("generation_input_invalid");
    expect(failure?.problem).toMatchObject({ code: "unknown_model", field: "shots.0.model", nearest: "image-1@apimart", next: "use_nearest_model" });
    expect(failure?.message).toMatch(/model image-1@kie is not in the model list/);
    expect(failure?.issues[0]?.allowed).toContain("image-1@apimart");
    expect(failure?.nextAction).toMatch(/list_models/);
  });

  it("分镜子对象的独立关键帧：keyframe.model 换回宿主的 modelKey / modelVendor（落盘字段不变）", () => {
    const translated = translate({ toolCallId: "call-1", toolName: "draft_shots", args: { shots: [
      { prompt: "第一镜", title: "镜 1", storyboard: { keyframe: { enabled: true, prompt: "关键帧", model: "bytedance/seedance-2@kie" } } },
      { prompt: "第二镜", title: "镜 2" },
    ] } })!;
    const shots = (translated.call.args as { shots: Array<{ storyboard?: { keyframe?: Record<string, unknown> } }> }).shots;
    expect(shots[0]?.storyboard?.keyframe).toEqual({ enabled: true, prompt: "关键帧", modelKey: "bytedance/seedance-2", modelVendor: "kie" });
  });

  it("时长落在 parameters.duration 里（宿主读时长只认这一处），不是一个宿主没有的顶层字段", () => {
    const translated = translate({
      toolCallId: "call-1", toolName: "draft_shots",
      args: { shots: [{ prompt: "第一镜", durationSec: 3 }] },
    })!;
    expect(translated.call.args).toMatchObject({ parameters: { duration: 3 } });
    expect(translated.call.args).not.toHaveProperty("durationSeconds");
  });

  it("参考素材只带 assetId 递下去——身份由宿主按项目素材库补，不要模型发明", () => {
    const translated = translate({
      toolCallId: "call-1", toolName: "draft_shots",
      args: { shots: [{ prompt: "第一镜", references: ["asset-1"] }] },
    })!;
    expect(translated.call.args).toMatchObject({ references: [{ assetId: "asset-1" }] });
  });

  it("start_model_setup 不经延迟组翻译（它是常驻动词；那条 modelSetup 分支是死的，已删）", () => {
    // 阳性对照：同一把尺子对真正走延迟组的动词返回的是一次翻译，所以 undefined 不是「恒 undefined」。
    expect(translate({ toolCallId: "call-1", toolName: "start_model_setup", args: { provider: "DeepSeek" } })).toBeUndefined();
    expect(translate({ toolCallId: "call-1", toolName: "read_skill", args: { name: "ugc-ad" } })).toBeDefined();
  });

  it("a name that is not a generation method is rejected by the generation adapter", () => {
    // 阳性对照：谓词不是恒真。
    expect(isPiGenerationToolName("draft_shots")).toBe(false);
    expect(isPiGenerationToolName("nomi_generation_plan_v9")).toBe(false);
  });
});

// 2026-09-18 单一账本：改多镜草稿里的一镜必须能经 Run 账本走通——动词契约的例子就是
// `{ operationId, shots: [{ shotId, prompt }] }`，翻译层曾把 shotId 声明成 drop，于是「改第 2 镜」永远改的是顶层候选。
describe("draft_shots with operationId · one shot of a multi-shot draft", () => {
  it("lifts the shotId onto the plan patch envelope so the host edits that shot, not the top-level candidate", () => {
    const translated = translate({ toolCallId: "call-1", toolName: "draft_shots",
      args: { operationId: "op-1", shots: [{ shotId: "shot-2", prompt: "逆光侧脸" }] } });
    expect(translated?.call.args).toEqual({ operation: "patch", operationId: "op-1", shotId: "shot-2", patch: { prompt: "逆光侧脸" } });
  });

  it("omits shotId for a single-shot draft (top-level candidate, unchanged)", () => {
    const translated = translate({ toolCallId: "call-1", toolName: "draft_shots",
      args: { operationId: "op-1", shots: [{ prompt: "换一句" }] } });
    expect(translated?.call.args).toEqual({ operation: "patch", operationId: "op-1", patch: { prompt: "换一句" } });
  });
});
