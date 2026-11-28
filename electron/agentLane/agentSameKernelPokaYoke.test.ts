import { describe, expect, it } from "vitest";
import { makeStrictJsonSchema } from "@earendil-works/pi-ai/api/constrained-sampling";

import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } from "../capabilityCore/mcpGenerationTools";
import { createPiGenerationTransportAdapterForTest as createPiGenerationTransportAdapter } from "../capabilityCore/generationPlanning.testkit";
import { withFixedCatalog } from "../capabilityCore/generationFixedCatalog.testkit";
import { setCatalogRowLookup } from "../capabilityCore/modelAdmissionSchema";
import { PROJECT_LEASE_ALGORITHM, PROJECT_LEASE_AUDIENCE, PROJECT_LEASE_VERSION, type ProjectLeaseV2 } from "../capabilityCore/projectLease";
import { buildVideoModelCandidates } from "../shared/videoCapabilities";
import { installModelNameSourceLookup } from "../shared/modelArchetypes";
import type { ProjectBinding } from "../shared/projectBinding";
import { VERB_DECLARATIONS } from "../shared/agentCapabilities/verbDeclarations";
import { toPublishedJsonSchema } from "../shared/agentCapabilities/modelVisibleJsonSchema";
import { summarizeDraftedShotsForModel } from "../shared/agentLane/draftCanvasLanding";
import { storyboardSubjectFromCandidate } from "../shared/storyboard/storyboardSubjectAdapter";
import type { LaneComposerContext } from "../shared/agentLane/laneDesktopContracts";
import type { AgentModelEntry } from "../shared/agentCapabilities/availableModels";
import { bindLaneTool } from "./laneRuntimePort";
import { createLaneTools, hasStrictCompilerUnsupportedKeywords } from "./laneTools.mjs";
import { createNomiModelDescriptor } from "./laneModelProvider.mjs";
import { openLane } from "./laneHost.mjs";
import { verbToTransportCall } from "./laneVerbTransport";
import { formatLaneAmbientFocus, formatLaneModelIndex } from "./laneModelContext";
import { createDesktopLaneInput } from "./laneDesktopInput";
import { patchStoryboardAuthoring } from "../capabilityCore/generationDocumentPlan";
import { statedShotTaskKind, taskKindForModeId } from "../shared/generationShotKind";
import { createHttpFixture } from "../../tests/agent-runtime/httpFixture.mjs";
import { cleanupTestTemp, makeTempDir } from "../../scripts/_test-temp.mjs";

const INTERNAL_VERBS = VERB_DECLARATIONS.filter((verb) => (verb.profiles ?? ["internal", "mcp"]).includes("internal"));

installModelNameSourceLookup(() => undefined);
setCatalogRowLookup(() => undefined);

const capabilities = { submitIdempotency: true, query: true, reconcile: true, cancel: true };

const videoModelCandidates = buildVideoModelCandidates([
  { provider: "apimart", modelKey: "doubao-seedance-2.5", label: "Seedance 2.5" },
  { provider: "apimart", modelKey: "MiniMax-Hailuo-2.3", label: "Hailuo 2.3" },
  { provider: "runway", modelKey: "gen4_turbo", label: "Runway Gen-4 Turbo" },
]);

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image", "video", "audio"],
  outputKinds: ["image", "video"],
  modes: ["text_to_image", "image_edit", "text_to_video", "image_to_video"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "asset", max: 30 } },
  providers: [
    {
      providerId: "apimart",
      models: [
        { modelId: "seedream-5-5", modes: ["text_to_image", "image_edit"], parameterSchema: {}, capabilities },
        { modelId: "doubao-seedance-2.5", modes: ["text_to_video", "image_to_video"], parameterSchema: {}, capabilities },
        { modelId: "MiniMax-Hailuo-2.3", modes: ["text_to_video", "image_to_video"], parameterSchema: {}, capabilities },
      ],
    },
    {
      providerId: "volcengine",
      models: [
        { modelId: "doubao-seedream-4-5-251128", modes: ["text_to_image", "image_edit"], parameterSchema: {}, capabilities },
      ],
    },
    {
      providerId: "runway",
      models: [
        { modelId: "gen4_turbo", modes: ["image_to_video"], parameterSchema: {}, capabilities },
      ],
    },
  ],
}]);

const LANE_MODELS: AgentModelEntry[] = [
  {
    vendor: "apimart",
    modelId: "seedream-5-5",
    modelAlias: null,
    label: "Seedream 5.5",
    displayName: "即梦 5.5",
    kind: "image",
    defaultModeId: "t2i",
    modes: [
      {
        modeId: "t2i",
        vendorTerm: "文生图",
        intent: "text",
        hint: "文生图",
        slots: [],
        params: [
          { key: "size", label: "比例", type: "select", defaultValue: "1:1", options: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"].map((v) => ({ value: v, label: v })) },
          { key: "resolution", label: "清晰度", type: "select", defaultValue: "2K", options: ["1K", "1.5K", "2K"].map((v) => ({ value: v, label: v })) },
        ],
      },
      {
        modeId: "edit",
        vendorTerm: "改图",
        intent: "edit",
        hint: "改图",
        slots: [{ kind: "image_ref", label: "输入图", max: 10 }],
        params: [
          { key: "size", label: "比例", type: "select", defaultValue: "1:1", options: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"].map((v) => ({ value: v, label: v })) },
          { key: "resolution", label: "清晰度", type: "select", defaultValue: "2K", options: ["1K", "1.5K", "2K"].map((v) => ({ value: v, label: v })) },
        ],
      },
    ],
  },
  {
    vendor: "volcengine",
    modelId: "doubao-seedream-4-5-251128",
    modelAlias: null,
    label: "Seedream 4.5 Volc",
    displayName: "火山即梦 4.5",
    kind: "image",
    defaultModeId: "t2i",
    modes: [
      {
        modeId: "t2i",
        vendorTerm: "文生图",
        intent: "text",
        hint: "文生图",
        slots: [],
        params: [
          { key: "size", label: "尺寸", type: "select", defaultValue: "2048x2048", options: ["2048x2048", "2560x1440", "1440x2560", "4096x4096", "3840x2160", "2160x3840"].map((v) => ({ value: v, label: v })) },
        ],
      },
    ],
  },
  {
    vendor: "apimart",
    modelId: "doubao-seedance-2.5",
    modelAlias: null,
    label: "Seedance 2.5",
    displayName: "即梦视频 2.5",
    kind: "video",
    defaultModeId: "t2v",
    modes: [
      {
        modeId: "t2v",
        vendorTerm: "text-video-mode",
        intent: "text",
        hint: "text-video-hint",
        slots: [],
        params: [
          { key: "size", label: "比例", type: "select", defaultValue: "16:9", options: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].map((v) => ({ value: v, label: v })) },
          { key: "duration", label: "时长", type: "number", defaultValue: 5, min: 4, max: 15, options: [] },
          { key: "resolution", label: "清晰度", type: "select", defaultValue: "720p", options: ["720p", "1080p"].map((v) => ({ value: v, label: v })) },
          { key: "generate_audio", label: "生成音频", type: "boolean", defaultValue: true, options: [] },
        ],
      },
      {
        modeId: "firstlast",
        vendorTerm: "首尾帧",
        intent: "frames",
        hint: "首尾帧生视频",
        slots: [
          { kind: "first_frame", label: "首帧", max: 1 },
          { kind: "last_frame", label: "尾帧", max: 1 },
        ],
        params: [
          { key: "size", label: "比例", type: "select", defaultValue: "16:9", options: ["16:9", "9:16", "1:1"].map((v) => ({ value: v, label: v })) },
          { key: "duration", label: "时长", type: "number", defaultValue: 5, min: 4, max: 15, options: [] },
          { key: "resolution", label: "清晰度", type: "select", defaultValue: "720p", options: ["720p", "1080p"].map((v) => ({ value: v, label: v })) },
          { key: "generate_audio", label: "生成音频", type: "boolean", defaultValue: true, options: [] },
        ],
      },
    ],
  },
  {
    vendor: "apimart",
    modelId: "MiniMax-Hailuo-2.3",
    modelAlias: null,
    label: "Hailuo 2.3",
    displayName: "海螺 2.3",
    kind: "video",
    defaultModeId: "t2v",
    modes: [{
      modeId: "t2v",
      vendorTerm: "hailuo-t2v-mode",
      intent: "text",
      hint: "hailuo-t2v-hint",
      slots: [],
      params: [{ key: "duration", label: "时长", type: "select", defaultValue: 6, options: [{ value: 6, label: "6s" }, { value: 10, label: "10s" }] }],
    }],
  },
  {
    vendor: "runway",
    modelId: "gen4_turbo",
    modelAlias: null,
    label: "Runway Gen-4 Turbo",
    displayName: "Gen-4 Turbo",
    kind: "video",
    defaultModeId: "i2v",
    modes: [{
      modeId: "i2v",
      vendorTerm: "img-video-mode",
      intent: "image",
      hint: "img-video-hint",
      slots: [{ kind: "first_frame", label: "首帧", max: 1 }],
      params: [],
    }],
  },
];

const binding: ProjectBinding = { projectId: "project-1", immutableProjectUuid: "11111111-1111-4111-8111-111111111111", projectGeneration: 1 };
const lease: ProjectLeaseV2 = {
  version: PROJECT_LEASE_VERSION, keyId: "k", algorithm: PROJECT_LEASE_ALGORITHM, issuer: "nomi-main",
  nonce: "n", scopeHash: "s", mac: "m", ...binding,
  canonicalRootDigest: "r", manifestDigest: "mf",
  issuedAt: "2026-11-28T00:00:00.000Z", expiresAt: "2099-11-28T00:00:00.000Z",
  audience: PROJECT_LEASE_AUDIENCE, leasePrincipal: "mcp:codex", sessionId: "s1", connectionNonce: "c1",
  revocationEpoch: 0, scopeSet: ["generation:create", "generation:plan", "generation:preview", "generation:read", "generation:cancel"],
};

function createHarness() {
  const draftShotsVerb = INTERNAL_VERBS.find((v) => v.name === "draft_shots")!;
  const operations = createInMemoryGenerationOperationStore();
  const knownAssets = new Set(["asset-1", "asset-2"]);
  const handler = createGenerationPlanningHandler(withFixedCatalog({
    registry,
    operations,
    videoModelCandidates,
    now: () => "2026-11-28T00:00:00.000Z",
    defaultModelForTaskKind: (taskKind) => {
      if (taskKind === "text_to_image" || taskKind === "image_edit") {
        return { moduleId: "generation.single-shot", providerId: "apimart", modelId: "seedream-5-5", mode: taskKind };
      }
      return { moduleId: "generation.single-shot", providerId: "apimart", modelId: "doubao-seedance-2.5", mode: taskKind };
    },
    resolveAssetReferenceIdentity: (_projectId, assetId) => (
      knownAssets.has(assetId)
        ? { contentHash: assetId.padEnd(64, "0").slice(0, 64), version: 1, kind: "image" as const }
        : undefined
    ),
  }));
  const adapter = createPiGenerationTransportAdapter(binding, { planning: handler, leaseFor: () => lease });
  let seq = 0;
  const callDraftShots = async (rawArgs: Record<string, unknown>) => {
    const prepared = draftShotsVerb.prepareArguments ? draftShotsVerb.prepareArguments(rawArgs) : rawArgs;
    const parsed = draftShotsVerb.schema.parse(prepared);
    const translated = verbToTransportCall({ toolCallId: `call-${++seq}`, toolName: "draft_shots", args: parsed }, LANE_MODELS)!;
    return adapter.tryExecute(translated.call, new AbortController().signal);
  };
  return { operations, callDraftShots };
}

describe("Slice 1 · UI 与 Agent 同核参数解析 + 批量改多镜 + 全镜一次报全", () => {
  it("传了明确 modeId 时自动推导 taskKind（不因缺失或同义冗余 taskKind 硬拒；锚点省掉 carrier 也一次落成）", async () => {
    const { callDraftShots } = createHarness();
    // 1) 图像改图模式 modeId='edit'，未传 taskKind -> 自动推为 image_edit
    const editRes = await callDraftShots({
      shots: [{ prompt: "把背景改成极光雪山", model: "seedream-5-5@apimart", modeId: "edit", references: ["asset-1"] }],
    });
    expect(editRes).toMatchObject({ ok: true });

    // 2) 纯 i2v 模型传了明确 modeId='i2v'，即使冗余/惯性写了 taskKind='text_to_video'，也按 modeId 定为 image_to_video 落成
    const i2vRes = await callDraftShots({
      shots: [{ prompt: "镜头缓缓推进", model: "gen4_turbo@runway", modeId: "i2v", taskKind: "text_to_video", references: ["asset-1"] }],
    });
    expect(i2vRes).toMatchObject({ ok: true });

    // 3) 顶层 taskKind='text_to_video' 混排 anchor（不写 taskKind 且不写 storyboard.carrier）+ firstlast 镜头
    const mixedRes = await callDraftShots({
      taskKind: "text_to_video",
      shots: [
        { role: "anchor", title: "主角小林", prompt: "短发女孩，白色风衣", model: "seedream-5-5@apimart", storyboard: { kind: "character" } },
        { role: "shot", title: "推门入场", prompt: "小林推门走进咖啡馆", model: "doubao-seedance-2.5@apimart", modeId: "firstlast", references: ["asset-1", "asset-2"] },
      ],
    });
    expect(mixedRes).toMatchObject({ ok: true });

    // 4) 跨模态重名 modeId='edit'（未指定 model、靠顶层 taskKind='image_edit' 走默认模型）：绝不被视频子表截胡到高价视频模型
    expect(taskKindForModeId("edit")).toBeUndefined();
    expect(taskKindForModeId("omni")).toBeUndefined();
    expect(statedShotTaskKind({ taskKind: "image_edit", modeId: "edit" })).toBe("image_edit");
    expect(statedShotTaskKind({ taskKind: "image_to_video", modeId: "omni" })).toBe("image_to_video");

    const topLevelImageEdit = await callDraftShots({
      taskKind: "image_edit",
      shots: [{ prompt: "把天空换成晚霞", modeId: "edit", references: ["asset-1"] }],
    });
    expect(topLevelImageEdit).toMatchObject({
      ok: true,
      result: { operation: { candidate: { providerId: "apimart", modelId: "seedream-5-5", mode: "image_edit", modeId: "edit" } } },
    });

    // 5) 跨供应商歧义 modeId='omni' + 顶层 taskKind='image_to_video'：保留顶层 taskKind 并成功起草，不再因剥离顶层 taskKind 而误拒
    const draftShotsVerb = INTERNAL_VERBS.find((v) => v.name === "draft_shots")!;
    const omniParsed = draftShotsVerb.schema.parse({
      taskKind: "image_to_video",
      shots: [{ prompt: "主体环绕运镜", modeId: "omni", references: ["asset-1"] }],
    });
    const omniTranslated = verbToTransportCall({ toolCallId: "call-omni", toolName: "draft_shots", args: omniParsed }, LANE_MODELS)!;
    expect((omniTranslated.call.args as Record<string, unknown>).taskKind).toBe("image_to_video");
    const omniDrafted = await callDraftShots({
      taskKind: "image_to_video",
      shots: [{ prompt: "主体环绕运镜", modeId: "omni", references: ["asset-1"] }],
    });
    expect(omniDrafted).toMatchObject({
      ok: true,
      result: { operation: { candidate: { providerId: "apimart", modelId: "doubao-seedance-2.5", modeId: "omni" } } },
    });
  });

  it("文稿分镜批量改镜（patchStoryboardAuthoring）通过单次批量 IPC 原子提交，后镜缺失时零半截落盘并一次报全", async () => {
    const ipcCalls: Array<{ op: string; payload: unknown }> = [];
    await expect(
      patchStoryboardAuthoring(
        { sourceDocumentId: "doc-1" },
        {
          patches: [
            { shotId: "shot-1", patch: { prompt: "新提示词 1" } },
            { shotId: "shot-ghost", patch: { prompt: "不存在" } },
            { shotId: "shot-2", patch: { prompt: "新提示词 2" } },
          ],
        },
        "project-1",
        "design-1",
        () => [],
        undefined,
        async (op, payload) => {
          ipcCalls.push({ op, payload });
          return {
            status: "batch-failed",
            failures: [
              { index: 1, kind: "shot-not-found", shotId: "shot-ghost", shots: [{ id: "shot-1", row: 1 }, { id: "shot-2", row: 2 }], anchorHoldsShotNumber: false },
            ],
          };
        },
      ),
    ).rejects.toThrow(/nothing changed[\s\S]*shot-ghost/);
    // 只发了 1 次批量 IPC 请求（而非逐镜循环多次写盘）
    expect(ipcCalls).toHaveLength(1);
    expect((ipcCalls[0]!.payload as { patches: unknown[] }).patches).toHaveLength(3);
  });

  it("创作者语义比例遇像素枚举模型（Seedream 等）在 aspectRatio 或 parameters.size 下均自动映射到对应比例的合法像素档", async () => {
    const { callDraftShots } = createHarness();
    // 顶层 aspectRatio + 分辨率档位提示 4K -> 2160x3840
    const tier4k = await callDraftShots({
      shots: [{ prompt: "竖屏赛博街景", model: "doubao-seedream-4-5-251128@volcengine", aspectRatio: "9:16" }],
    });
    expect(tier4k).toMatchObject({ ok: true });
    const cand1 = ((tier4k as { result: { operation: { candidate: { parameters: Record<string, unknown> } } } }).result).operation.candidate;
    expect(cand1.parameters.size).toBe("1440x2560");

    // Agent 直接写在 parameters.size = "9:16" 也能经同核几何解析映射成 "1440x2560"，不再被 enum 硬拒
    const inParams = await callDraftShots({
      shots: [{ prompt: "竖屏赛博街景", model: "doubao-seedream-4-5-251128@volcengine", parameters: { size: "9:16" } }],
    });
    expect(inParams).toMatchObject({ ok: true });
    const cand2 = ((inParams as { result: { operation: { candidate: { parameters: Record<string, unknown> } } } }).result).operation.candidate;
    expect(cand2.parameters.size).toBe("1440x2560");
  });

  it("时长越界或不在枚举时确定性吸附到最近合法档，并在结果 adjustments 与模型摘要中明确告知", async () => {
    const { callDraftShots } = createHarness();
    // 请求 3s，Seedance 2.5 支持 4-15s -> 吸附为 4s 并返回 adjustments
    const rangeSnap = await callDraftShots({
      shots: [{ title: "快切开场", prompt: "海浪拍岸", model: "doubao-seedance-2.5@apimart", durationSec: 3 }],
    });
    expect(rangeSnap).toMatchObject({ ok: true });
    const res1 = (rangeSnap as { result: Record<string, unknown> }).result;
    expect(res1.adjustments).toEqual([
      expect.objectContaining({ shotId: "shot-1", field: "durationSec", requested: 3, applied: 4 }),
    ]);
    const summary1 = summarizeDraftedShotsForModel(res1);
    expect(summary1).toContain("durationSec");
    expect(summary1).toContain("3");
    expect(summary1).toContain("4");

    // 请求 8s，海螺 2.3 只支持 [6, 10] -> 等距取更短省钱档 6s 并返回 adjustments
    const enumSnap = await callDraftShots({
      shots: [{ title: "街角回眸", prompt: "霓虹雨夜回眸", model: "MiniMax-Hailuo-2.3@apimart", durationSec: 8 }],
    });
    expect(enumSnap).toMatchObject({ ok: true });
    const res2 = (enumSnap as { result: Record<string, unknown> }).result;
    expect(res2.adjustments).toEqual([
      expect.objectContaining({ shotId: "shot-1", field: "durationSec", requested: 8, applied: 6 }),
    ]);
  });

  it("解除 revise one shot per call 死锁：支持在一次 draft_shots 调用中原子批量修改多个已有镜头", async () => {
    const { callDraftShots } = createHarness();
    const created = await callDraftShots({
      taskKind: "text_to_video",
      shots: [
        { title: "镜 1", prompt: "晨雾森林", model: "doubao-seedance-2.5@apimart", durationSec: 8 },
        { title: "镜 2", prompt: "溪流石桥", model: "doubao-seedance-2.5@apimart", durationSec: 8 },
        { title: "镜 3", prompt: "林间小鹿", model: "doubao-seedance-2.5@apimart", durationSec: 8 },
        { title: "镜 4", prompt: "阳光穿透树冠", model: "doubao-seedance-2.5@apimart", durationSec: 8 },
      ],
    });
    expect(created).toMatchObject({ ok: true });
    const operationId = ((created as { result: { operation: { operationId: string } } }).result).operation.operationId;

    // 一次调用把 4 个镜头都改成 5 秒、关掉声音
    const patched = await callDraftShots({
      operationId,
      shots: ["shot-1", "shot-2", "shot-3", "shot-4"].map((shotId) => ({
        shotId,
        durationSec: 5,
        parameters: { generate_audio: false },
      })),
    });
    expect(patched).toMatchObject({ ok: true });
    const updatedShots = ((patched as { result: { operation: { shots: Array<{ shotId: string; candidate: { parameters: Record<string, unknown> } }> } } }).result).operation.shots;
    expect(updatedShots.map((s) => ({ id: s.shotId, dur: s.candidate.parameters.duration, audio: s.candidate.parameters.generate_audio }))).toEqual([
      { id: "shot-1", dur: 5, audio: false },
      { id: "shot-2", dur: 5, audio: false },
      { id: "shot-3", dur: 5, audio: false },
      { id: "shot-4", dur: 5, audio: false },
    ]);
  });

  it("全镜一次扫完合并报全：多镜起草或批量修改遇硬错误（不存在的 shotId / assetId）一次报出全部问题且零脏写", async () => {
    const { callDraftShots } = createHarness();
    // 1) 新建多镜：第 1 镜与第 3 镜分别引用不存在的素材，一次返回两条错误
    const badCreate = await callDraftShots({
      shots: [
        { title: "镜 1", prompt: "改图 1", model: "seedream-5-5@apimart", modeId: "edit", references: ["missing-asset-A"] },
        { title: "镜 2", prompt: "正常文生图", model: "seedream-5-5@apimart" },
        { title: "镜 3", prompt: "改图 3", model: "seedream-5-5@apimart", modeId: "edit", references: ["missing-asset-C"] },
      ],
    });
    expect(badCreate).toMatchObject({ ok: false });
    const createMsg = JSON.stringify(badCreate);
    expect(createMsg).toContain("missing-asset-A");
    expect(createMsg).toContain("missing-asset-C");

    // 2) 批量改多镜：第 1 镜和第 3 镜 shotId 不存在，一次报全且第 2 镜不被半截修改
    const created = await callDraftShots({
      shots: [
        { title: "镜 1", prompt: "原提示 1", model: "seedream-5-5@apimart" },
        { title: "镜 2", prompt: "原提示 2", model: "seedream-5-5@apimart" },
      ],
    });
    const opId = ((created as { result: { operation: { operationId: string } } }).result).operation.operationId;

    const badPatch = await callDraftShots({
      operationId: opId,
      shots: [
        { shotId: "shot-ghost-1", prompt: "改坏 1" },
        { shotId: "shot-2", prompt: "不该被写进去的半截修改" },
        { shotId: "shot-ghost-3", prompt: "改坏 3" },
      ],
    });
    expect(badPatch).toMatchObject({ ok: false });
    const patchMsg = JSON.stringify(badPatch);
    expect(patchMsg).toContain("shot-ghost-1");
    expect(patchMsg).toContain("shot-ghost-3");
  });
});

describe("Slice 2 · 首轮 Ambient Context 补齐（默认模型规格 ≤350 tokens + 当前子视图/焦点摘要）", () => {
  it("默认生成模型摘要在 ≤350 tokens 预算内写明合法比例、时长范围/枚举、分辨率与参考槽位上限", () => {
    const context = {
      model: { vendorKey: "openai", modelKey: "gpt-5" },
      availableModels: LANE_MODELS,
    } as unknown as LaneComposerContext;
    const indexText = formatLaneModelIndex(context, {
      text_to_image: { vendor: "apimart", modelId: "seedream-5-5" },
      image_edit: { vendor: "apimart", modelId: "seedream-5-5" },
      text_to_video: { vendor: "apimart", modelId: "doubao-seedance-2.5" },
      image_to_video: { vendor: "apimart", modelId: "doubao-seedance-2.5" },
    });
    // 包含合法比例、时长范围、清晰度与参考槽上限
    expect(indexText).toContain("16:9");
    expect(indexText).toContain("9:16");
    expect(indexText).toMatch(/4[-–~]15s/);
    expect(indexText).toContain("720p");
    expect(indexText).toContain("1080p");
    expect(indexText).toMatch(/10/); // image_ref <= 10

    // 默认段紧凑预算：即使 4 个默认槽位分别指向 4 个不同模型，默认规格段仍 ≤350 tokens
    const fourDistinctIndex = formatLaneModelIndex(context, {
      text_to_image: { vendor: "apimart", modelId: "seedream-5-5" },
      image_edit: { vendor: "volcengine", modelId: "doubao-seedream-4-5-251128" },
      text_to_video: { vendor: "apimart", modelId: "doubao-seedance-2.5" },
      image_to_video: { vendor: "apimart", modelId: "MiniMax-Hailuo-2.3" },
    });
    const defaultSection = fourDistinctIndex.slice(fourDistinctIndex.indexOf("用户的默认模型状态"));
    const estimatedTokens = (defaultSection.match(/[\u4e00-\u9fff]|[A-Za-z0-9_@.*+-]+|[^\s\w\u4e00-\u9fff]/g) ?? []).length;
    expect(estimatedTokens).toBeLessThanOrEqual(350);
  });

  it("首轮用户环境块清晰标出当前工作面与选中节点焦点摘要（超长字段受控截断，且不与 contextSnapshot 重复投影 handles）", async () => {
    const longId = `node-${"x".repeat(120)}`;
    const focusLine = formatLaneAmbientFocus({
      admissionSurface: "canvas",
      documentId: "doc-main",
      target: { kind: "canvas", nodeIds: [longId] },
      contextSnapshot: {
        version: 1,
        handles: [{
          id: "director-focus-1",
          kind: "canvasNode",
          targetId: "node-director-1",
          revision: "dplan-1",
          intentRole: "target",
          display: { title: "DirectorBoxSubview", subtitle: "正在改：镜头 2" },
          locator: { type: "custom", key: "directorShot", value: "over_student" },
        }],
      },
    });
    expect(focusLine).toContain("surface=canvas");
    expect(focusLine).not.toContain("activeFocus=");
    expect(focusLine.length).toBeLessThan(200);
    const context: LaneComposerContext = {
      approvalPolicy: { mode: "request" },
      admissionSurface: "canvas",
      documentId: "doc-main",
      target: { kind: "canvas", nodeIds: ["node-shot-2"] },
      contextSnapshot: {
        version: 1,
        handles: [{
          id: "director-focus-1",
          kind: "canvasNode",
          targetId: "node-director-1",
          revision: "dplan-1",
          intentRole: "target",
          display: { title: "DirectorBoxSubview", subtitle: "正在改：镜头 2" },
          locator: { type: "custom", key: "directorShot", value: "over_student" },
        }],
      },
    };
    const input = createDesktopLaneInput({
      projectId: "p1",
      capture: () => context,
      activate: () => undefined,
      prepare: async (c) => c,
      model: () => ({ kind: "openai-compatible", model: { modelKey: "gpt-5", modelAlias: "", meta: {} } as never }),
    });
    const rendered = String(await input.providerContent({
      role: "nomi.input",
      content: "把这个镜头改成特写",
      timestamp: 1,
      context,
    }));
    expect(rendered).toContain("canvas");
    expect(rendered).toContain("node-shot-2");
    expect(rendered).toContain("directorShot");
  });
});

describe("Slice 3 · Schema 防呆瘦身 + 工具说明与 Schema 一致性锁 + 原生 constrainedSampling", () => {
  it("draft_shots 模型面移除宿主可自推的 storyboard.carrier 等膨胀字段，分镜适配器自动推导视觉锚 carrier", () => {
    const draftShotsVerb = INTERNAL_VERBS.find((v) => v.name === "draft_shots")!;
    const published = toPublishedJsonSchema(draftShotsVerb.schema) as {
      properties: { shots: { items: { properties: { storyboard: { properties: Record<string, unknown> } } } } };
    };
    const storyboardProps = published.properties.shots.items.properties.storyboard.properties;
    expect(storyboardProps).not.toHaveProperty("carrier");
    expect(storyboardProps).not.toHaveProperty("referenceBindings");
    expect(storyboardProps).not.toHaveProperty("promptSegments");
    expect(storyboardProps).not.toHaveProperty("continuity");

    // 宿主分镜适配器在不传 carrier 时自动推导 anchor 的 carrier='visual'
    const adapted = storyboardSubjectFromCandidate(
      {
        shotId: "anchor-1",
        role: "anchor",
        title: "主角小林",
        candidate: {
          candidateId: "cand-1",
          revision: 1,
          moduleId: "generation.single-shot",
          providerId: "apimart",
          modelId: "seedream-5-5",
          mode: "text_to_image",
          prompt: "短发女孩",
          parameters: {},
          references: [],
        },
      },
      { kind: "character" },
    );
    expect(adapted).toMatchObject({ id: "anchor-1", kind: "character", carrier: "visual" });
  });

  it("工具说明书与 Schema 一致性锁：所有内部动词的 examples 及说明中出现的字段路径/指针 100% 在其发布 Schema 中合法存在", () => {
    function hasSchemaPropertyPath(root: Record<string, unknown>, segments: readonly string[]): boolean {
      let current: Record<string, unknown> | undefined = root;
      for (const rawSeg of segments) {
        if (!current || typeof current !== "object") return false;
        const clean = rawSeg.replace(/\[\]$/, "");
        if (clean.startsWith("<") && clean.endsWith(">")) {
          // 具名实体槽（如 /shots/<name>/size）对应数组元素对象
          if (current.items && typeof current.items === "object" && !Array.isArray(current.items)) {
            current = current.items as Record<string, unknown>;
            continue;
          }
          return false;
        }
        const props = current.properties as Record<string, Record<string, unknown>> | undefined;
        let next = props?.[clean];
        if (!next && Array.isArray(current.anyOf)) {
          for (const branch of current.anyOf as Record<string, unknown>[]) {
            const bProps = branch.properties as Record<string, Record<string, unknown>> | undefined;
            if (bProps?.[clean]) { next = bProps[clean]; break; }
          }
        }
        if (!next) return false;
        if (rawSeg.endsWith("[]") && next.items && typeof next.items === "object" && !Array.isArray(next.items)) {
          current = next.items as Record<string, unknown>;
        } else {
          current = next;
        }
      }
      return true;
    }

    for (const verb of INTERNAL_VERBS) {
      // 1) 每个声明的 example 必须 100% 通过 prepareArguments + schema.safeParse
      for (const ex of verb.examples) {
        const prepared = verb.prepareArguments ? verb.prepareArguments(structuredClone(ex.arguments)) : ex.arguments;
        const parsed = verb.schema.safeParse(prepared);
        expect(parsed.success, `${verb.name} example failed schema: ${JSON.stringify(ex.arguments)}`).toBe(true);
      }

      const published = toPublishedJsonSchema(verb.schema) as Record<string, unknown>;
      const prose = [
        verb.describe.does,
        verb.describe.useWhen,
        verb.describe.notWhen,
        verb.describe.params,
        ...(verb.promptGuidelines ?? []),
      ].join("\n");

      // 2) 说明中显式点名的顶层/嵌套数组字段路径（如 actors[].desc、scene.setPieces[].kind、shots[].subject、target.shotId）必须在 schema 上真实存在
      for (const match of prose.matchAll(/\b([a-z][a-zA-Z0-9_]*(?:\[\])?(?:\.[a-z][a-zA-Z0-9_]*(?:\[\])?)+)\b/g)) {
        const rawPath = match[1]!;
        // taskRef.* 来自其他读/生成工具的返回对象，文件名（.md/.json）不是入参路径
        if (rawPath.startsWith("taskRef.") || /\.(md|json)$/i.test(rawPath)) continue;
        const segments = rawPath.split(".");
        // stage_shot 的 plan 子树字段在说明里相对 plan 书写（如 scene.tags、actors[].desc、scene.setPieces[].kind）
        const okDirect = hasSchemaPropertyPath(published, segments);
        const okUnderPlan = verb.name === "stage_shot" && hasSchemaPropertyPath(
          (published.properties as Record<string, Record<string, unknown>>).plan!,
          segments,
        );
        const okUnderShot = verb.name === "draft_shots" && hasSchemaPropertyPath(
          ((published.properties as Record<string, { items: Record<string, unknown> }>).shots.items),
          segments,
        );
        expect(okDirect || okUnderPlan || okUnderShot, `${verb.name} prose mentions "${rawPath}" which does not exist in its schema`).toBe(true);
      }

      // 3) stage_shot 说明中禁止再残留已移除/错误的字段名，且 JSON pointer 示例路径必须在 plan schema 中存在
      if (verb.name === "stage_shot") {
        const planSchema = (published.properties as Record<string, Record<string, unknown>>).plan!;
        for (const ptrMatch of prose.matchAll(/\/(shots|actors|scene|blocking)(?:\/([a-zA-Z0-9_<>-]+))+/g)) {
          const rawPtr = ptrMatch[0]!.replace(/^\/+/, "");
          const parts = rawPtr.split("/").filter((seg) => !seg.startsWith("["));
          // 将具名 id（如 intro / over_student）归一化为 <id> 以沿数组 items 下钻
          const normalizedParts = parts.map((seg, idx) => {
            if (idx === 1 && (parts[0] === "shots" || parts[0] === "actors" || parts[0] === "blocking")) return "<id>";
            if (idx === 2 && parts[0] === "scene" && parts[1] === "setPieces") return "<id>";
            return seg;
          });
          expect(hasSchemaPropertyPath(planSchema, normalizedParts), `stage_shot pointer "${ptrMatch[0]}" invalid against plan schema`).toBe(true);
        }
      }

      if (verb.name === "draft_shots") {
        expect(prose).not.toContain("carrier");
        expect(prose).not.toContain("referenceBindings");
        expect(prose).not.toContain("revise one shot per call");
      }
    }
  });

  it("createLaneTools 仅为纯严格语法子集工具开启 constrainedSampling，且第三方 openai-compatible 默认不强发 strict: true", async () => {
    const descriptors = INTERNAL_VERBS.map((verb) =>
      bindLaneTool(
        {
          name: verb.name,
          contractId: verb.contractId,
          effect: verb.effect,
          description: verb.describe.does,
          schema: verb.schema,
          examples: verb.examples,
          execution: { timeoutMs: 5_000 },
          ...(verb.prepareArguments ? { prepareArguments: verb.prepareArguments } : {}),
        } as never,
        async () => ({ ok: true, text: "ok" }),
      ),
    );
    const tools = createLaneTools(descriptors);
    const strictEnabled = tools.filter((t) =>
      typeof t.constrainedSampling === "object"
      && t.constrainedSampling !== null
      && t.constrainedSampling.type === "json_schema",
    );
    expect(strictEnabled.length).toBeGreaterThanOrEqual(10);
    for (const tool of tools) {
      let canStrict = !hasStrictCompilerUnsupportedKeywords(tool.parameters);
      if (canStrict) {
        try { makeStrictJsonSchema(tool.parameters as never); } catch { canStrict = false; }
      }
      if (canStrict) {
        expect(tool.constrainedSampling, `${tool.name} should enable constrainedSampling`).toEqual({
          type: "json_schema",
          strict: "prefer",
        });
        const strictSchemaJson = JSON.stringify(makeStrictJsonSchema(tool.parameters as never));
        expect(strictSchemaJson).not.toMatch(/"(minimum|maximum|exclusiveMinimum|exclusiveMaximum|minItems|maxItems|pattern|minLength|maxLength)"/);
      } else {
        expect(tool.constrainedSampling, `${tool.name} should disable constrainedSampling when schema has open records or value bounds`).toBe(false);
      }
    }

    // 1) 第三方 openai-compatible 中转站默认 supportsStrictMode = false，线上请求体绝不出现 "strict": true
    const relayDescriptor = createNomiModelDescriptor({
      kind: "openai-compatible",
      providerId: "relay",
      modelId: "relay-chat",
      baseURL: "http://127.0.0.1:9/v1",
      authType: "api-key",
      apiKey: "sk-test",
    });
    expect((relayDescriptor.compat as Record<string, unknown> | undefined)?.supportsStrictMode).toBe(false);

    const server = await createHttpFixture([{ type: "text", text: "done" }, { type: "text", text: "done" }]);
    const tempDir1 = makeTempDir("nomi-strict-relay-");
    const tempDir2 = makeTempDir("nomi-strict-declared-");
    try {
      const relayLane = await openLane({
        fetch: globalThis.fetch,
        projectDir: tempDir1,
        model: { kind: "openai-compatible", providerId: "relay", modelId: "relay-chat", baseURL: server.baseURL, authType: "api-key", apiKey: "sk-test" },
        systemPrompt: "Test",
        tools: descriptors,
      });
      await relayLane.execute({ kind: "prompt", text: "hi" });
      await relayLane.close();
      expect(server.requests[0]!.raw).not.toContain('"strict":true');
      expect(server.requests[0]!.raw).not.toContain('"type":"null"');

      // 2) 显式声明 compat.supportsStrictMode = true 的连接精确开启 strict: true，且仅对纯严格子集工具开启
      const strictLane = await openLane({
        fetch: globalThis.fetch,
        projectDir: tempDir2,
        model: {
          kind: "openai-compatible",
          providerId: "official",
          modelId: "strict-model",
          baseURL: server.baseURL,
          authType: "api-key",
          apiKey: "sk-test",
          compat: { supportsStrictMode: true },
        },
        systemPrompt: "Test",
        tools: descriptors,
      });
      await strictLane.execute({ kind: "prompt", text: "hi" });
      await strictLane.close();
      const wireTools = (server.requests[1]!.body as { tools: Array<{ function: { name: string; strict?: boolean; parameters: unknown } }> }).tools;
      const strictWireTools = wireTools.filter((t) => t.function.strict === true);
      expect(strictWireTools.length).toBe(strictEnabled.length);
      for (const wt of strictWireTools) {
        expect(hasStrictCompilerUnsupportedKeywords(wt.function.parameters)).toBe(false);
      }
    } finally {
      await server.close();
      cleanupTestTemp(tempDir1);
      cleanupTestTemp(tempDir2);
    }
  });
});
