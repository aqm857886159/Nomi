import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-10-11 走查 §1：拆解表拆不出画面 / 景别。读图腿由代码自动挑模型（免费限流的那家排第一），
// 用户既选不了也看不到失败原话。这份测试走**编排本体**（deconstructVideo），把读图腿的三件事钉住：
//   ① 显式 `vision` 就是报价卡与真实调用用的那一个；给的不可用 → 零调用、零报价、不悄悄换别家；
//   ② 软偏好 `visionPreferred`：能读图才采用，否则回到自动；
//   ③ 每镜失败的供应商原话落进结果的 `failureReason`（不是只写日志）。
// 方案卡：docs/plan/2026-10-11-canvas-ux-8-issues.md §11。

const runTask = vi.hoisted(() => vi.fn());
vi.mock("../runtime", () => ({ runTask }));
vi.mock("./detectShotCuts", () => ({
  detectShotCuts: vi.fn(async () => ({
    cuts: [{ seconds: 3, score: 0.9 }],
    coverage: { capped: false, totalCuts: 1, keptCuts: 1, coveredSeconds: 3, durationSeconds: 6 },
  })),
}));
vi.mock("./extractAudioTrack", () => ({ extractAudioTrack: vi.fn(async () => ({ hasAudio: false })) }));
vi.mock("./extractVideoFrame", () => ({
  resolveVideoLocalPath: vi.fn(async () => ({ filePath: "x.mp4", cleanup: () => undefined })),
  extractVideoFrameToAsset: vi.fn(async () => ({ url: "nomi-local://asset/p/frame.png" })),
}));
vi.mock("../export/mediaProbe", () => ({ probeMediaMetadata: vi.fn(async () => ({ durationSeconds: 6, hasAudio: false })) }));
vi.mock("../settings/vendorPreferenceSettings", () => ({ readVendorPreferenceSettings: () => ({ orderedVendorKeys: [] }) }));

const catalog = {
  vendors: [
    { key: "agnes", enabled: true, authType: "bearer" },
    { key: "gem", enabled: true, authType: "bearer" },
    { key: "ds", enabled: true, authType: "bearer" },
    { key: "my-relay", enabled: true, authType: "bearer" },
    { key: "apimart", enabled: true, authType: "bearer" },
  ],
  models: [
    { vendorKey: "agnes", modelKey: "agnes-flash", kind: "text", enabled: true, published: true, updatedAt: "1", meta: { supportsImageInput: true } },
    { vendorKey: "gem", modelKey: "gem-flash", kind: "text", enabled: true, published: true, updatedAt: "1", meta: { supportsImageInput: true } },
    { vendorKey: "ds", modelKey: "ds-chat", kind: "text", enabled: true, published: true, updatedAt: "1", meta: { supportsImageInput: false } },
    // 读图能力三态（设计卡 docs/plan/2026-10-27-vision-capability-declared.md）：自配行没声明 = 不知道；内置种子行没声明 = 不能。
    { vendorKey: "my-relay", modelKey: "my-gpt", kind: "text", enabled: true, published: true, updatedAt: "1" },
    { vendorKey: "apimart", modelKey: "deepseek-v4-pro", kind: "text", enabled: true, published: true, updatedAt: "1" },
  ] as Array<Record<string, unknown>>,
  apiKeysByVendor: { agnes: { enabled: true }, gem: { enabled: true }, ds: { enabled: true }, "my-relay": { enabled: true }, apimart: { enabled: true } },
};
vi.mock("../catalog/catalogStore", () => ({ readCatalog: () => catalog, normalizeProviderKind: (v: string) => v, mutateCatalog: vi.fn() }));
vi.mock("../catalog/secrets", () => ({ decryptApiKeyRecord: () => "k", decryptCustomConfigWithLegacy: () => ({}), apiKeyDecryptStatus: () => "ok" }));
vi.mock("../catalog/catalogModelAvailability", () => ({
  catalogModelAvailability: () => ({ usable: true, reason: null }),
  createCatalogAvailability: () => ({ of: () => ({ usable: true, reason: null }) }),
}));

const okReply = { raw: { choices: [{ message: { content: '{"shotSize":"特写","visual":"一只狗"}' } }] } };

async function run(payloadExtra: Record<string, unknown>) {
  const { deconstructVideo } = await import("./deconstructVideo");
  type DeconstructSpendPlan = import("./deconstructVideo").DeconstructSpendPlan;
  const authorizeSpend = vi.fn(async (_plan: DeconstructSpendPlan) => "grant-1" as string | null);
  const result = await deconstructVideo(
    { videoUrl: "nomi-local://asset/p/v.mp4", projectId: "p", framesPerShot: 1, ...payloadExtra } as never,
    { authorizeSpend, signal: new AbortController().signal },
  ).catch((error: unknown) => error as Error);
  return { result, authorizeSpend };
}

describe("拆解读图腿的模型身份", () => {
  beforeEach(() => {
    runTask.mockReset();
    runTask.mockResolvedValue(okReply);
  });

  it("默认（不给 vision）：沿用自动挑——目录序第一个能读图的（旧行为，不是回归）", async () => {
    const { authorizeSpend } = await run({});
    expect(authorizeSpend.mock.calls[0]?.[0].vision).toEqual({ vendorKey: "agnes", modelKey: "agnes-flash" });
  });

  it("显式 vision：报价卡与每一次真实调用都用它，不用自动挑的那个", async () => {
    const { authorizeSpend } = await run({ vision: { vendorKey: "gem", modelKey: "gem-flash" } });
    expect(authorizeSpend.mock.calls[0]?.[0].vision).toEqual({ vendorKey: "gem", modelKey: "gem-flash" });
    expect(runTask).toHaveBeenCalled();
    for (const [call] of runTask.mock.calls) {
      expect(call.vendor).toBe("gem");
      expect(call.request.extras.modelKey).toBe("gem-flash");
    }
  });

  it("显式 vision 不可用（已停用 / 不存在）：整次拒绝，零报价、零付费调用，不悄悄换别家", async () => {
    const { result, authorizeSpend } = await run({ vision: { vendorKey: "gem", modelKey: "no-such-model" } });
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).name).toBe("DeconstructError");
    expect((result as Error).message).toContain("no-such-model");
    expect(authorizeSpend).not.toHaveBeenCalled();
    expect(runTask).not.toHaveBeenCalled();
  });

  it("软偏好 visionPreferred：它能读图就用它（复用用户在 Agent 面板选的脑）", async () => {
    const { authorizeSpend } = await run({ visionPreferred: { vendorKey: "gem", modelKey: "gem-flash" } });
    expect(authorizeSpend.mock.calls[0]?.[0].vision).toEqual({ vendorKey: "gem", modelKey: "gem-flash" });
  });

  it("软偏好不能读图（纯文本脑）：回到自动挑，不报错也不用它", async () => {
    const { authorizeSpend } = await run({ visionPreferred: { vendorKey: "ds", modelKey: "ds-chat" } });
    expect(authorizeSpend.mock.calls[0]?.[0].vision).toEqual({ vendorKey: "agnes", modelKey: "agnes-flash" });
  });

  it("显式 vision 优先于软偏好", async () => {
    const { authorizeSpend } = await run({
      vision: { vendorKey: "agnes", modelKey: "agnes-flash" },
      visionPreferred: { vendorKey: "gem", modelKey: "gem-flash" },
    });
    expect(authorizeSpend.mock.calls[0]?.[0].vision).toEqual({ vendorKey: "agnes", modelKey: "agnes-flash" });
  });
});

// 读图腿三条来源用同一个三态判据（设计卡 docs/plan/2026-10-27-vision-capability-declared.md，A10–A13）：
// 「不能」= 显式 false 或内置种子没声明；「不知道」= 其余没声明的行（自配 / 中转）。
describe("读图腿按声明核能力：只拒「不能」", () => {
  beforeEach(() => {
    runTask.mockReset();
    runTask.mockResolvedValue(okReply);
  });

  it.each([
    { label: "显式声明不能读图", vision: { vendorKey: "ds", modelKey: "ds-chat" } },
    { label: "内置纯文本种子（没声明）", vision: { vendorKey: "apimart", modelKey: "deepseek-v4-pro" } },
  ])("显式 vision 指向$label的模型：开拆前拒，零报价、零调用", async ({ vision }) => {
    const { result, authorizeSpend } = await run({ vision });
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).name).toBe("DeconstructError");
    expect((result as Error).message).toContain(vision.modelKey);
    expect((result as Error).message).toContain("Model does not accept image input");
    expect(authorizeSpend).not.toHaveBeenCalled();
    expect(runTask).not.toHaveBeenCalled();
  });

  it("显式 vision 指向没声明的自配模型（不知道）：照拆，报价与每次调用都用它", async () => {
    const { authorizeSpend } = await run({ vision: { vendorKey: "my-relay", modelKey: "my-gpt" } });
    expect(authorizeSpend.mock.calls[0]?.[0].vision).toEqual({ vendorKey: "my-relay", modelKey: "my-gpt" });
    expect(runTask).toHaveBeenCalled();
    for (const [call] of runTask.mock.calls) expect(call.vendor).toBe("my-relay");
  });

  it("软偏好是没声明的自配模型（不知道）：采用它，不回到自动挑", async () => {
    const { authorizeSpend } = await run({ visionPreferred: { vendorKey: "my-relay", modelKey: "my-gpt" } });
    expect(authorizeSpend.mock.calls[0]?.[0].vision).toEqual({ vendorKey: "my-relay", modelKey: "my-gpt" });
  });

  it("软偏好是内置纯文本种子（不能）：回到自动挑", async () => {
    const { authorizeSpend } = await run({ visionPreferred: { vendorKey: "apimart", modelKey: "deepseek-v4-pro" } });
    expect(authorizeSpend.mock.calls[0]?.[0].vision).toEqual({ vendorKey: "agnes", modelKey: "agnes-flash" });
  });

  it("自动挑：目录里只剩「不能」的文本模型 → 没有读图模型，零报价、零调用", async () => {
    const saved = catalog.models;
    catalog.models = saved.filter((model) => model.vendorKey === "ds" || model.vendorKey === "apimart");
    try {
      const { result, authorizeSpend } = await run({});
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).name).toBe("DeconstructError");
      expect(authorizeSpend).not.toHaveBeenCalled();
      expect(runTask).not.toHaveBeenCalled();
    } finally {
      catalog.models = saved;
    }
  });
});

describe("拆解失败原话落进结果", () => {
  beforeEach(() => { runTask.mockReset(); });

  it("供应商限流：该镜 visionFailed + failureReason 是供应商原话（画面 / 景别为空，但说得出为什么）", async () => {
    runTask.mockRejectedValue(new Error("You've reached the API rate limit for free users"));
    const { result } = await run({});
    const shots = (result as { shots: Array<{ visionFailed?: boolean; failureReason?: string; shotSize: string }> }).shots;
    expect(shots.length).toBeGreaterThan(0);
    for (const shot of shots) {
      expect(shot.visionFailed).toBe(true);
      expect(shot.shotSize).toBe("");
      expect(shot.failureReason).toContain("rate limit");
    }
  });

  it("拆解的每次读图调用都带 maxRetries: 0（限流不重试）", async () => {
    runTask.mockResolvedValue(okReply);
    await run({});
    expect(runTask).toHaveBeenCalled();
    for (const [call] of runTask.mock.calls) expect(call.request.extras.maxRetries).toBe(0);
  });

  it("模型回了非 JSON：也要说一句人话原因，不是空白", async () => {
    runTask.mockResolvedValue({ raw: { choices: [{ message: { content: "我不想说话" } }] } });
    const { result } = await run({});
    const shots = (result as { shots: Array<{ visionFailed?: boolean; failureReason?: string }> }).shots;
    for (const shot of shots) {
      expect(shot.visionFailed).toBe(true);
      expect(shot.failureReason).toBeTruthy();
    }
  });
});

// 类检查（结构）：读图腿的模型身份只有 resolveVisionLeg 一个出口——编排里不许再直接调 resolveTextBrainKeys 自己挑，
// 否则「付费腿身份由代码隐式挑、用户选不了」这一类会从下一条腿原样回来。
describe("读图腿身份的唯一出口", () => {
  it("deconstructVideo.ts 不直接 import resolveTextBrainKeys（只经 resolveVisionLeg）", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(new URL("./deconstructVideo.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/import\s*\{[^}]*resolveTextBrainKeys[^}]*\}/);
    expect(source).toContain("resolveVisionLeg(");
  });
});
