// 根因合同 2026-09-18-draft-shots-drops-candidate 的多镜那一半。
//
// 20 动词的 `draft_shots` 交出来的是**语义镜**（prompt + 可选 provider/model/参数/参考）——它是模型能写出来
// 的唯一形状，声明里根本没有 candidateId / revision / moduleId 这些内部字段。而 `plan` 入口此前只认
// 一份**完整 PlanCandidate**，于是两镜以上的 `draft_shots` 对着模型抛一段裸 zod（"expected object,
// received undefined"），整条分镜路 100% 死，没有任何门岗看得见。
//
// 这里钉住三件事：语义镜能编译、点名的模型算数、没点名也没默认时照旧诚实拒绝。
import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "./moduleRegistry";
import { createMultiShotCreateHelpers } from "./mcpGenerationMultiShot";
import { draftShotFromPlan } from "./mcpGenerationMultiShot";
import { generationCandidateSchema } from "../shared/agentCapabilities/generationPlanSchemas";
import { compileExecutionContract, type PlanCandidate } from "./executionContract";

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image"],
  outputKinds: ["image", "video"],
  modes: ["text_to_image", "text_to_video", "image_to_video"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{
    providerId: "apimart",
    models: [
      { modelId: "image-model", modes: ["text_to_image"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } },
      { modelId: "video-model", modes: ["text_to_video", "image_to_video"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } },
    ],
  }],
}]);

const parsers = {
  candidateFrom: (value: unknown) => generationCandidateSchema.parse(value) as unknown as PlanCandidate,
  record: (value: unknown, label: string) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
    return value as Record<string, unknown>;
  },
};

function helpers(overrides: Partial<Parameters<typeof createMultiShotCreateHelpers>[0]> = {}) {
  return createMultiShotCreateHelpers({
    registry,
    parsers,
    normalizeVideoCandidate: (candidate) => candidate,
    // 合同编译只有一个实现（生产里是 mcpGenerationTools 的 contractFor）；这里注入等价的最小版本，
    // 不在测试里重写一份参数表/提示词投影，否则夹具就成了第二台发动机。
    compileContract: (candidate) => compileExecutionContract(candidate, registry),
    priceForCandidate: () => ({ known: true, amount: 0.3 } as never),
    effectiveVideoModes: () => [],
    ...overrides,
  });
}

describe("多镜 plan 入口 · 语义镜（动词交出来的那种形状）", () => {
  it("两镜各自点名模型 → 各自编译成候选，身份逐字是模型点的那个", async () => {
    const shots = await helpers().resolveCreateShots("project-1", {
      shots: [
        { shotId: "shot-1", prompt: "海上日出", taskKind: "text_to_image", providerId: "apimart", modelId: "image-model" },
        { shotId: "shot-2", prompt: "海浪推近", taskKind: "text_to_video", providerId: "apimart", modelId: "video-model", parameters: { duration: 5 } },
      ],
    });
    expect(shots).toHaveLength(2);
    expect(shots![0].candidate).toMatchObject({ providerId: "apimart", modelId: "image-model", prompt: "海上日出" });
    expect(shots![1].candidate).toMatchObject({ providerId: "apimart", modelId: "video-model", prompt: "海浪推近" });
    // 时长到这一层时**已经**叫 `duration` 了：`durationSec → parameters.duration` 这条换名住在翻译层
    // 那张表上（`verbs/draftShotsProjection.ts`），宿主的 `shots[]` 是 `.strict()` 且没有顶层
    // `durationSeconds` 的位置——所以这里再写一遍换名就是第二份实现（P1），换名对不对由
    // `check:verb-host-conformance` 与 `mcpMultiShotCreateEntrance.e2e.test.ts` 各核一次。
    // 这条守的是它自己那半：模型给的参数**原样活到候选里**。
    expect(shots![1].candidate.parameters).toMatchObject({ duration: 5 });
  });

  it("没点名时用保存过的默认模型", async () => {
    const shots = await helpers({
      defaultModelForTaskKind: () => ({ moduleId: "generation.single-shot", providerId: "apimart", modelId: "image-model", mode: "text_to_image" }),
    }).resolveCreateShots("project-1", { shots: [{ prompt: "一只猫", taskKind: "text_to_image" }] });
    expect(shots![0].candidate).toMatchObject({ providerId: "apimart", modelId: "image-model" });
  });

  it("阳性对照：既没点名也没默认，照旧诚实拒绝——不按目录行序替用户挑一个花钱", async () => {
    await expect(helpers().resolveCreateShots("project-1", { shots: [{ prompt: "一只猫", taskKind: "text_to_image" }] }))
      .rejects.toThrow(/没有配置可用的图片模型/);
  });

  it("阳性对照：不注入编译口时，`plan` 入口对语义镜的行为一字不变（外部契约的旧路径）", () => {
    expect(() => draftShotFromPlan({ prompt: "海上日出" }, 0, "shot-1", parsers)).toThrow();
  });

  it("带完整 candidate 的镜头照旧走原来那个解析器", async () => {
    const shots = await helpers().resolveCreateShots("project-1", {
      shots: [{
        shotId: "shot-1",
        candidate: {
          candidateId: "cand-1", revision: 1, moduleId: "generation.single-shot",
          providerId: "apimart", modelId: "image-model", mode: "text_to_image", prompt: "海上日出",
        },
      }],
    });
    expect(shots![0].candidate).toMatchObject({ candidateId: "cand-1", modelId: "image-model" });
  });
});
