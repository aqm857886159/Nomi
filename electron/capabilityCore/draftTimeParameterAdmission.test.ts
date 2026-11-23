// 起草那一刻就判参数：草稿在变成付费卡之前，必须过和确认时**同一个** `compileParameters`。
//
// 2026-10-18 真付费走查：Agent 起草的 `seed: null` 进了草稿、出了付费卡，用户点「生成」才被合同编译口拒掉。
// 起草和确认判的不是同一时刻的同一份参数——前面放行、后面才拒，错在最贵的地方才显形。
// 这里钉三件事：①坏参数在起草就被拒，且不产生草稿（= 不产生付费卡）；②拒绝是现有的结构化 ParameterRejection，
// 模型当场能改对；③每个能产生待付费草稿的入口都过这一处（Agent 的 draft_shots 三支 + 对外 MCP 的 create / plan）。
import { describe, expect, it, vi } from "vitest";

import { createModuleRegistry } from "./moduleRegistry";
import { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } from "./mcpGenerationTools";
import { createPiGenerationTransportAdapterForTest as createPiGenerationTransportAdapter } from "./generationPlanning.testkit";
import { ContractCompilationError } from "./executionContract";
import { buildVideoModelCandidates } from "../shared/videoCapabilities";
import { PROJECT_LEASE_ALGORITHM, PROJECT_LEASE_AUDIENCE, PROJECT_LEASE_VERSION, type ProjectLeaseV2 } from "./projectLease";
import { verbToTransportCall } from "../agentLane/laneVerbTransport";
import type { ProjectBinding } from "../shared/projectBinding";
import { withFixedCatalog } from "./generationFixedCatalog.testkit";

const videoModelCandidates = buildVideoModelCandidates([
  { provider: "apimart", modelKey: "doubao-seedance-2.0", label: "Seedance 2.0" },
  { provider: "runway", modelKey: "gen4_turbo", label: "Runway Gen-4 Turbo" },
]);

const anyParam = { type: "any" } as const;
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot", version: "1.0.0",
  inputKinds: ["text", "image", "video", "audio"], outputKinds: ["video", "image"],
  modes: ["text_to_video", "image_to_video", "text_to_image", "image_edit"],
  parameterSchema: { duration: { type: "number" }, size: anyParam, resolution: anyParam, generate_audio: anyParam, seed: anyParam },
  assetInputSchema: { references: { kind: "asset", max: 30 } },
  providers: [
    {
      providerId: "apimart",
      models: [
        {
          modelId: "doubao-seedance-2.0",
          modes: ["text_to_video", "image_to_video"],
          parameterSchema: { duration: { type: "number" }, size: anyParam, resolution: anyParam, generate_audio: anyParam, seed: anyParam },
          capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
        },
        {
          modelId: "gpt-image-2",
          modes: ["text_to_image", "image_edit"],
          parameterSchema: { size: anyParam, quality: anyParam },
          capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
        },
      ],
    },
    {
      providerId: "runway",
      models: [
        {
          modelId: "gen4_turbo",
          modes: ["image_to_video"],
          parameterSchema: { duration: { type: "number" }, ratio: anyParam },
          capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
        },
      ],
    },
  ],
}]);

const binding: ProjectBinding = { projectId: "project-1", immutableProjectUuid: "11111111-1111-4111-8111-111111111111", projectGeneration: 1 };
const lease = {
  version: PROJECT_LEASE_VERSION, keyId: "k", algorithm: PROJECT_LEASE_ALGORITHM, issuer: "nomi-main",
  nonce: "n", scopeHash: "s", mac: "m", ...binding,
  canonicalRootDigest: "r", manifestDigest: "mf",
  issuedAt: "2026-10-18T00:00:00.000Z", expiresAt: "2099-10-18T00:00:00.000Z",
  audience: PROJECT_LEASE_AUDIENCE, leasePrincipal: "mcp:codex", sessionId: "s1", connectionNonce: "c1",
  revocationEpoch: 0, scopeSet: ["generation:create", "generation:plan", "generation:preview", "generation:read", "generation:cancel"],
} as ProjectLeaseV2;

/** deepseek-v4-pro 在 2026-10-18 真走查里写的那一份（逐键）。 */
const WRITTEN_BY_BRAIN = { resolution: "480p", size: "16:9", generate_audio: false, seed: null };

/** 这条消息带上来的可用模型清单（`draft_shots` 的完整名字在 lane 这一侧按它查）。 */
const LANE_MODELS = [
  { vendor: "apimart", modelId: "doubao-seedance-2.0", modelAlias: null },
  { vendor: "apimart", modelId: "gpt-image-2", modelAlias: null },
  { vendor: "runway", modelId: "gen4_turbo", modelAlias: null },
];

const shotWith = (parameters: Record<string, unknown>, title?: string) => ({
  ...(title ? { title } : {}),
  prompt: "一只纸船在雨后的水洼里慢慢漂，清晨的光", taskKind: "text_to_video",
  model: "doubao-seedance-2.0@apimart",
  parameters,
});

function harness() {
  const operations = createInMemoryGenerationOperationStore();
  const create = vi.spyOn(operations, "create");
  const handler = createGenerationPlanningHandler(withFixedCatalog({
    registry, operations, videoModelCandidates, now: () => "2026-10-18T00:00:00.000Z",
    resolveAssetReferenceIdentity: (_projectId: string, assetId: string) => ({
      contentHash: assetId.padEnd(64, "0").slice(0, 64),
      version: 1,
      kind: assetId.startsWith("audio-") ? "audio" as const : "image" as const,
    }),
  } as never));
  const adapter = createPiGenerationTransportAdapter(binding, { planning: handler as never, leaseFor: () => lease });
  const draftShots = async (args: Record<string, unknown>) => {
    const translated = verbToTransportCall({ toolCallId: "call-1", toolName: "draft_shots", args }, LANE_MODELS)!;
    return adapter.tryExecute(translated.call, new AbortController().signal);
  };
  const direct = (capability: string, params: Record<string, unknown>) => handler({
    capability, params, lease, origin: { host: "codex" },
  } as never);
  return { operations, create, draftShots, direct };
}

describe("起草就判参数：坏参数不产生草稿（Agent 的 draft_shots）", () => {
  it("单镜：seed 写成 \"abc\" → 工具结果是参数拒绝，点名 parameters.seed，不产生草稿", async () => {
    const { create, draftShots } = harness();
    const decision = await draftShots({ shots: [shotWith({ ...WRITTEN_BY_BRAIN, seed: "abc" })] });
    expect(decision).toMatchObject({ ok: false });
    expect(JSON.stringify(decision)).toContain("parameters.seed");
    expect(create).not.toHaveBeenCalled();
  });

  it("多镜：第二镜 seed 写成 \"4s\" → 整份被拒，第一镜也不留草稿", async () => {
    const { create, draftShots } = harness();
    const decision = await draftShots({ shots: [shotWith({ resolution: "480p" }, "镜1"), shotWith({ seed: "4s" }, "镜2")] });
    expect(decision).toMatchObject({ ok: false });
    expect(JSON.stringify(decision)).toContain("parameters.seed");
    expect(create).not.toHaveBeenCalled();
  });

  it("值门：seed 写成规范数字串 \"4\" 与 4 是同一个值 → 过，草稿建出来了", async () => {
    // 2026-11-17 参数值内部类型：外来值先过值门（paramValue.ts），"4" 对要数字的字段就是 4；"4s"、"05" 门不认，照旧拒（上一条）。
    const { create, draftShots } = harness();
    const decision = await draftShots({ shots: [shotWith({ resolution: "480p" }, "镜1"), shotWith({ seed: "4" }, "镜2")] });
    expect(decision).toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("多镜：布尔写成字符串 \"false\" → 拒", async () => {
    const { create, draftShots } = harness();
    const decision = await draftShots({ shots: [shotWith({ generate_audio: "false" }, "镜1"), shotWith({}, "镜2")] });
    expect(decision).toMatchObject({ ok: false });
    expect(JSON.stringify(decision)).toContain("parameters.generate_audio");
    expect(create).not.toHaveBeenCalled();
  });

  it("阳性对照：同一份草稿把 seed 写成 null → 过，且草稿建出来了", async () => {
    const { create, draftShots } = harness();
    const decision = await draftShots({ shots: [shotWith(WRITTEN_BY_BRAIN)] });
    expect(decision).toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("阳性对照：多镜里每镜都有 null 也过", async () => {
    const { create, draftShots } = harness();
    const decision = await draftShots({ shots: [shotWith(WRITTEN_BY_BRAIN, "镜1"), shotWith(WRITTEN_BY_BRAIN, "镜2")] });
    expect(decision).toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("起草放行的，确认时（preview / gate_request 的合同编译）也放行：合同里没有 seed", async () => {
    const { direct, draftShots, operations } = harness();
    const decision = await draftShots({ shots: [shotWith(WRITTEN_BY_BRAIN)] }) as { ok: true; result?: unknown };
    const operationId = /"operationId":"([^"]+)"/.exec(JSON.stringify(decision))?.[1];
    expect(operationId).toBeTruthy();
    expect(await operations.read("project-1", operationId!)).toBeTruthy();
    const preview = await direct("preview", { operationId }) as { contract: { parameters: Record<string, unknown>; warnings: string[] } };
    expect(preview.contract.parameters).not.toHaveProperty("seed");
    expect(preview.contract.parameters).toMatchObject({ resolution: "480p", generate_audio: false });
    expect(preview.contract.warnings.join("|")).toContain("seed");
  });
});

describe("起草就判参数：对外 MCP 的各个入口", () => {
  it("create（一句话单镜，nomi_operation_create）：坏参数同样当场拒", async () => {
    const { create, direct } = harness();
    await expect(direct("create", {
      prompt: "一只纸船", taskKind: "text_to_video", providerId: "apimart", modelId: "doubao-seedance-2.0",
      parameters: { seed: "abc" },
    })).rejects.toBeInstanceOf(ContractCompilationError);
    expect(create).not.toHaveBeenCalled();
  });

  it("create（多镜 shots）：坏参数同样当场拒", async () => {
    const { create, direct } = harness();
    // 对外 MCP 的多镜 shots 与 Agent 的 draft_shots 落在同一份宿主 create 载荷上（`draftShotToPlanShot`）。
    const { operation: _operation, ...args } = verbToTransportCall({
      toolCallId: "call-mcp", toolName: "draft_shots", args: { shots: [shotWith({ seed: "abc" }, "镜1"), shotWith({}, "镜2")] },
    }, LANE_MODELS)!.call.args as Record<string, unknown>;
    await expect(direct("create", args)).rejects.toBeInstanceOf(ContractCompilationError);
    expect(create).not.toHaveBeenCalled();
  });

  it("create：null 的可选参数放行", async () => {
    const { create, direct } = harness();
    await direct("create", {
      prompt: "一只纸船", taskKind: "text_to_video", providerId: "apimart", modelId: "doubao-seedance-2.0",
      parameters: WRITTEN_BY_BRAIN,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("plan（改草稿，nomi_operation_plan / nomi_submit_generation_plan）：坏参数当场拒，草稿原样不动", async () => {
    const { direct, draftShots, operations } = harness();
    const decision = await draftShots({ shots: [shotWith({ resolution: "480p" })] });
    const operationId = /"operationId":"([^"]+)"/.exec(JSON.stringify(decision))![1]!;
    const before = await operations.read("project-1", operationId);
    await expect(direct("plan", { operationId, patch: { parameters: { seed: "abc" } } })).rejects.toBeInstanceOf(ContractCompilationError);
    expect(await operations.read("project-1", operationId)).toEqual(before);
  });
});

describe("起草就判显式吃图方式的必填参考槽（铁律 ⑩：说的 = 摆的）", () => {
  it("P21 正例 1：显式 modeId=firstlast 且无 references → 当场拒收（mode_input_missing，点名首帧与 look_at_media，0 草稿落地）", async () => {
    const { create, draftShots } = harness();
    const decision = await draftShots({
      shots: [{
        title: "便利店到小林",
        prompt: "镜头从深夜便利店亮灯的玻璃门缓缓推近，过渡到小林站在柜台前抬头微笑的特写",
        model: "doubao-seedance-2.0@apimart",
        modeId: "firstlast",
        durationSec: 5,
      }],
    });
    expect(decision).toMatchObject({ ok: false, admission: "mode_input_missing" });
    const text = JSON.stringify(decision);
    expect(text).toContain("mode_input_missing");
    expect(text).toContain("first_frame");
    expect(text).toContain("look_at_media");
    expect(create).not.toHaveBeenCalled();
  });

  it("正例 1b：显式 modeId=firstlast 却只给了音频素材（类型不匹配首帧槽）→ 当场拒收 mode_input_missing", async () => {
    const { create, draftShots } = harness();
    const decision = await draftShots({
      shots: [{
        prompt: "推进镜头",
        model: "doubao-seedance-2.0@apimart",
        modeId: "firstlast",
        references: ["audio-bgm-1"],
      }],
    });
    expect(decision).toMatchObject({ ok: false, admission: "mode_input_missing" });
    expect(create).not.toHaveBeenCalled();
  });

  it("正例 1c：非视频图像模型显式 modeId=i2i 且无 references → 同样走 validateModeConstraints 当场拒收", async () => {
    const { create, draftShots } = harness();
    const decision = await draftShots({
      shots: [{
        prompt: "把背景换成雪景",
        model: "gpt-image-2@apimart",
        modeId: "i2i",
      }],
    });
    expect(decision).toMatchObject({ ok: false, admission: "mode_input_missing" });
    expect(create).not.toHaveBeenCalled();
  });

  it("P21 正例 2：显式 modeId=firstlast 且传 2 张图片 references → 放行并建草稿", async () => {
    const { create, draftShots } = harness();
    const decision = await draftShots({
      shots: [{
        title: "便利店到小林",
        prompt: "镜头从便利店推近到小林",
        model: "doubao-seedance-2.0@apimart",
        modeId: "firstlast",
        durationSec: 5,
        references: ["asset-store", "asset-xiaolin"],
      }],
    });
    expect(decision).toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("场景 5 & 场景 6：改已有 firstlast 草稿只改时长放行；把 references 清空成 [] 当场拒收且原草稿不动", async () => {
    const { direct, draftShots, operations } = harness();
    const decision = await draftShots({
      shots: [{
        prompt: "镜头从便利店推近到小林",
        model: "doubao-seedance-2.0@apimart",
        modeId: "firstlast",
        durationSec: 5,
        references: ["asset-store", "asset-xiaolin"],
      }],
    });
    expect(decision).toMatchObject({ ok: true });
    const operationId = /"operationId":"([^"]+)"/.exec(JSON.stringify(decision))![1]!;
    // 场景 5：只改时长，保留原参考 → 放行
    await expect(direct("plan", { operationId, patch: { parameters: { duration: 8 } } })).resolves.toBeTruthy();
    const beforeEmpty = await operations.read("project-1", operationId);
    // 场景 6：清空参考但仍留 modeId=firstlast → 当场拒收，草稿不动
    await expect(direct("plan", { operationId, patch: { references: [] } })).rejects.toMatchObject({ code: "mode_input_missing" });
    expect(await operations.read("project-1", operationId)).toEqual(beforeEmpty);
  });

  it("反例 A：普通文生视频草稿（不传 modeId、不传 references）→ 100% 放行并落成 t2v", async () => {
    const { create, draftShots } = harness();
    const decision = await draftShots({
      shots: [{
        prompt: "海边日落慢镜头",
        model: "doubao-seedance-2.0@apimart",
        durationSec: 5,
      }],
    }) as { ok: boolean; result?: { operation?: { candidate?: { modeId?: string } } } };
    expect(decision.ok).toBe(true);
    expect(decision.result?.operation?.candidate?.modeId).toBe("t2v");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("反例 B：同批起草视觉锚点 + 引用该锚点的显式吃图镜头（storyboard.anchorIds）→ 放行；纯文本锚点不顶替图片", async () => {
    const { create, draftShots } = harness();
    const visualOk = await draftShots({
      shots: [
        {
          role: "anchor", title: "小林", prompt: "穿着便利店围裙的年轻女孩小林",
          model: "gpt-image-2@apimart", taskKind: "text_to_image",
          storyboard: { kind: "character", carrier: "visual" },
        },
        {
          role: "shot", title: "镜1", prompt: "小林抬头微笑",
          model: "doubao-seedance-2.0@apimart", modeId: "firstlast", durationSec: 5,
          storyboard: { anchorIds: ["anchor-1"] },
        },
      ],
    });
    expect(visualOk).toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);

    const textOnlyRejected = await draftShots({
      shots: [
        {
          role: "anchor", title: "文字设定", prompt: "柔和暖色调",
          model: "gpt-image-2@apimart", taskKind: "text_to_image",
          storyboard: { kind: "style", carrier: "text" },
        },
        {
          role: "shot", title: "镜1", prompt: "小林抬头微笑",
          model: "doubao-seedance-2.0@apimart", modeId: "firstlast", durationSec: 5,
          storyboard: { anchorIds: ["anchor-1"] },
        },
      ],
    });
    expect(textOnlyRejected).toMatchObject({ ok: false, admission: "mode_input_missing" });
  });

  it("场景 4：纯图生视频模型（无 t2v）、未显式写 modeId、0 参考 → 放行空占位卡（由回执首行标缺口）", async () => {
    const { create, draftShots } = harness();
    const decision = await draftShots({
      shots: [{
        prompt: "先占个位，图待会儿我自己拖",
        model: "gen4_turbo@runway",
        taskKind: "image_to_video",
      }],
    });
    expect(decision).toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
