import { describe, expect, it } from "vitest";

import type { PlanCandidate } from "./executionContract";
import { createModuleRegistry } from "./moduleRegistry";
import {
  admitShotIdentity,
  declaredModeForModel,
  isLongFormGenerationRequest,
  requestedVideoDurationSeconds,
  semanticCandidateFromParams,
  shotTaskKind,
} from "./semanticGenerationCandidate";

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "test",
  inputKinds: ["text", "image", "video"],
  outputKinds: ["image", "video"],
  modes: ["text_to_image", "image_edit", "text_to_video", "image_to_video"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "asset", max: 8 } },
  providers: [{
    providerId: "fixture",
    models: [{
      modelId: "image-model",
      modes: ["text_to_image", "image_edit"],
      parameterSchema: {},
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    }, {
      modelId: "video-model",
      modes: ["text_to_video", "image_to_video"],
      parameterSchema: {},
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    }],
  }],
}]);

function parse(value: unknown): PlanCandidate {
  const raw = value as Record<string, unknown>;
  if (typeof raw.candidateId !== "string" || typeof raw.prompt !== "string") throw new Error("invalid fixture candidate");
  return raw as unknown as PlanCandidate;
}

describe("semantic generation candidate", () => {
  it("recognizes minute-scale video goals without confusing a five-second clip parameter", () => {
    expect(requestedVideoDurationSeconds({ prompt: "帮我做一个5分钟品牌视频", parameters: { duration: 5 } })).toBe(300);
    expect(isLongFormGenerationRequest({ prompt: "帮我做一个5分钟品牌视频", parameters: { duration: 5 } })).toBe(true);
    expect(isLongFormGenerationRequest({ prompt: "生成一段5秒视频", parameters: { duration: 5 } })).toBe(false);
    expect(isLongFormGenerationRequest({ prompt: "生成一张小猫头像" })).toBe(false);
  });

  // ── 2026-09-30 付费卡① 第 9 条：种类只从「点名的模型 + 明写的种类」来，提示词一个字都不看 ──
  describe("一镜是图还是视频（shotTaskKind）", () => {
    it("点名的模型只做图片 → 图片；带参考图 → 改图。提示词里写「镜头 / 视频」也不改它", () => {
      expect(shotTaskKind({ params: { prompt: "做一个封面，3:4，镜头感强一点", modelId: "image-model" }, registry })).toBe("text_to_image");
      expect(shotTaskKind({ params: { prompt: "把这一段视频的画面改成水彩", modelId: "image-model", references: [{}] }, registry })).toBe("image_edit");
    });

    it("点名的模型只做视频 → 视频；带参考图 → 图生视频。提示词里写「一张图」也不改它", () => {
      expect(shotTaskKind({ params: { prompt: "一张海报那样的静帧", modelId: "video-model" }, registry })).toBe("text_to_video");
      expect(shotTaskKind({ params: { prompt: "一张图", modelId: "video-model", references: [{}] }, registry })).toBe("image_to_video");
    });

    it("明写的种类说了算；mode / modeId 是同一件事实的另外两种写法", () => {
      expect(shotTaskKind({ params: { prompt: "一段视频", taskKind: "text_to_image" }, registry })).toBe("text_to_image");
      expect(shotTaskKind({ params: { prompt: "x", mode: "image-edit" }, registry })).toBe("image_edit");
      expect(shotTaskKind({ params: { prompt: "x", modeId: "i2v" }, registry })).toBe("image_to_video");
    });

    it("没点名模型、也没写种类 → 当场拒绝，说清下一步怎么写（不按提示词猜）", () => {
      const attempt = () => shotTaskKind({ params: { prompt: "生成一段品牌视频" }, registry });
      expect(attempt).toThrow(/set taskKind/);
      expect(attempt).toThrow(/does not guess it from the prompt/);
    });

    it("点名的模型做不了写明的那一种 → 当场拒绝，并列出它能做什么", () => {
      const attempt = () => shotTaskKind({ params: { prompt: "x", taskKind: "text_to_video", modelId: "image-model" }, registry });
      expect(attempt).toThrow(/image-model cannot do text_to_video/);
      expect(attempt).toThrow(/text_to_image, image_edit/);
    });

    it("点名的模型既出图又出视频、又没写种类 → 请它写明，不替它选", () => {
      const both = createModuleRegistry([{
        moduleId: "generation.single-shot", version: "test", inputKinds: ["text"], outputKinds: ["image", "video"],
        modes: ["text_to_image", "text_to_video"], parameterSchema: {}, assetInputSchema: {},
        providers: [{ providerId: "fixture", models: [{ modelId: "omni-model", modes: ["text_to_image", "text_to_video"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }] }],
      }]);
      expect(() => shotTaskKind({ params: { prompt: "x", modelId: "omni-model" }, registry: both })).toThrow(/makes both images and videos/);
      expect(shotTaskKind({ params: { prompt: "x", modelId: "omni-model", taskKind: "text_to_video" }, registry: both })).toBe("text_to_video");
    });

    it("点名的模型不出图也不出视频 → 说它做什么，不说「不在目录里」", () => {
      const audio = createModuleRegistry([{
        moduleId: "generation.single-shot", version: "test", inputKinds: ["text"], outputKinds: ["audio"],
        modes: ["text_to_audio"], parameterSchema: {}, assetInputSchema: {},
        providers: [{ providerId: "fixture", models: [{ modelId: "voice-model", modes: ["text_to_audio"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }] }],
      }]);
      expect(() => shotTaskKind({ params: { prompt: "x", modelId: "voice-model" }, registry: audio })).toThrow(/makes neither images nor videos \(it does: text_to_audio\)/);
    });
  });

  describe("建镜头那一刻的身份核对（admitShotIdentity）", () => {
    const shot = { moduleId: "generation.single-shot", providerId: "fixture", modelId: "image-model", mode: "text_to_image" };

    it("目录里真有这一对 → 放行", () => {
      expect(() => admitShotIdentity(shot, registry)).not.toThrow();
    });

    it("视频镜头配图片模型 → 当场拒绝，说清它能做什么（第 21 行：不会出一张自相矛盾的卡）", () => {
      const attempt = () => admitShotIdentity({ ...shot, mode: "text_to_video" }, registry);
      expect(attempt).toThrow(/image-model cannot do text_to_video\. It does: text_to_image, image_edit/);
    });

    it("参考卡只能是图片", () => {
      expect(() => admitShotIdentity({ ...shot, modelId: "video-model", mode: "text_to_video" }, registry, "anchor")).toThrow(/must be an image/);
      expect(() => admitShotIdentity(shot, registry, "anchor")).not.toThrow();
    });

    it("目录里没有这个模型 → 说「不在目录里」，不说「做不了」", () => {
      expect(() => admitShotIdentity({ ...shot, modelId: "ghost" }, registry)).toThrow(/fixture\/ghost is not in the model catalog/);
    });

    it("模型做得了、目录却对不上（模块错了）→ 照目录原话说，不冤枉模型", () => {
      expect(() => admitShotIdentity({ ...shot, moduleId: "other.module" }, registry)).toThrow(/Unknown module: other\.module\. Model image-model declares: text_to_image, image_edit/);
    });
  });

  it("换模型时模式按新模型目录里的拼法跟过去；新模型做不了这一种 = 不跟（交给核对去拒绝）", () => {
    const spelled = createModuleRegistry([{
      moduleId: "generation.single-shot", version: "test", inputKinds: ["text"], outputKinds: ["image", "video"],
      modes: ["text-to-image", "text_to_video"], parameterSchema: {}, assetInputSchema: {},
      providers: [{ providerId: "fixture", models: [
        { modelId: "hyphen-image", modes: ["text-to-image"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } },
        { modelId: "clip-model", modes: ["text_to_video"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } },
      ] }],
    }]);
    expect(declaredModeForModel(spelled, "fixture", "hyphen-image", "text_to_image")).toBe("text-to-image");
    expect(declaredModeForModel(spelled, "fixture", "clip-model", "text_to_image")).toBeUndefined();
  });

  it("uses the live registry when no saved default exists", () => {
    const candidate = semanticCandidateFromParams({
      operationId: "op-fallback",
      params: { prompt: "生成一个头像", taskKind: "text_to_image" },
      candidateFrom: parse,
      allowRegistryFallback: true,
      registry,
    });
    expect(candidate).toMatchObject({
      candidateId: "cand-op-fallback",
      providerId: "fixture",
      modelId: "image-model",
      mode: "text_to_image",
    });
  });

  // ── 2026-09-18 回归：参考素材的身份归宿主，不归模型（`docs/fixes/2026-09-18-verb-host-input-conformance`）──
  it("参考素材只给 assetId 时，身份由注入的解析器补齐", () => {
    const candidate = semanticCandidateFromParams({
      operationId: "op-ref",
      params: { prompt: "把这张图改成水彩风", taskKind: "image_edit", references: [{ assetId: "asset-1", role: "character" }] },
      candidateFrom: parse,
      allowRegistryFallback: true,
      registry,
      resolveAssetReferenceIdentity: (assetId) => (assetId === "asset-1" ? { contentHash: "a".repeat(64), version: 1 } : undefined),
    });
    expect(candidate.references).toEqual([{ assetId: "asset-1", role: "character", contentHash: "a".repeat(64), version: 1 }]);
  });

  it("已经钉住身份的参考，身份逐字节不变（解析器只用来对种类，不会改写哈希 / 版本）", () => {
    const pinned = { assetId: "asset-2", contentHash: "b".repeat(64), version: 3, kind: "image" as const };
    const candidate = semanticCandidateFromParams({
      operationId: "op-pinned",
      params: { prompt: "把这张图改成水彩风", taskKind: "image_edit", references: [pinned] },
      candidateFrom: parse,
      allowRegistryFallback: true,
      registry,
      resolveAssetReferenceIdentity: () => ({ contentHash: "c".repeat(64), version: 9, kind: "image" as const }),
    });
    expect(candidate.references).toEqual([pinned]);
  });

  it("素材不在本项目时报人话，而不是一个模型看不懂的 Required", () => {
    const attempt = () => semanticCandidateFromParams({
      operationId: "op-missing",
      params: { prompt: "把这张图改成水彩风", taskKind: "image_edit", references: [{ assetId: "asset-ghost" }] },
      candidateFrom: parse,
      allowRegistryFallback: true,
      registry,
      resolveAssetReferenceIdentity: () => undefined,
    });
    expect(attempt).toThrow(/asset-ghost/);
    expect(attempt).toThrow(/look_at_media/);
    // 阳性对照：同一条路在解析得到时是通的，所以上面的红不是「这条路恒抛」。
    expect(() => semanticCandidateFromParams({
      operationId: "op-present",
      params: { prompt: "把这张图改成水彩风", taskKind: "image_edit", references: [{ assetId: "asset-ghost" }] },
      candidateFrom: parse,
      allowRegistryFallback: true,
      registry,
      resolveAssetReferenceIdentity: () => ({ contentHash: "d".repeat(64), version: 1 }),
    })).not.toThrow();
  });

  // 2026-09-18 金路径真机红：Agent 照 list_models 给了 modelKey，宿主却答「没有配置可用的图片模型」——
  // 因为只有「用户保存过的默认模型」能带出 providerId/moduleId，显式点名的模型从不去目录里查它属于谁。
  it("resolves provider and module for an explicitly named model even when no default is saved", () => {
    const candidate = semanticCandidateFromParams({
      operationId: "op-explicit",
      params: { prompt: "清晨的旧书店门口", taskKind: "text_to_image", modelId: "image-model", modeId: "t2i" },
      candidateFrom: parse,
      registry,
    });
    expect(candidate).toMatchObject({ providerId: "fixture", moduleId: "generation.single-shot", modelId: "image-model", mode: "text_to_image", modeId: "t2i" });
  });

  it("still refuses an explicitly named model the registry does not know (no invented provider)", () => {
    expect(() => semanticCandidateFromParams({
      operationId: "op-unknown",
      params: { prompt: "x", taskKind: "text_to_image", modelId: "ghost-model" },
      candidateFrom: parse,
      registry,
    })).toThrow(/没有配置可用的图片模型/);
  });

  it("lets explicit fields override saved defaults without exposing internal IDs", () => {
    const candidate = semanticCandidateFromParams({
      operationId: "op-explicit",
      params: {
        prompt: "做一个短视频",
        taskKind: "text_to_video",
        parameters: { duration: 4 },
        providerId: "fixture",
        modelId: "video-model",
      },
      candidateFrom: parse,
      defaultModelForTaskKind: () => ({ moduleId: "generation.single-shot", providerId: "other", modelId: "other-model", mode: "text_to_video" }),
      registry,
    });
    expect(candidate).toMatchObject({ providerId: "fixture", modelId: "video-model", mode: "text_to_video", parameters: { duration: 4 } });
    expect(candidate).not.toHaveProperty("transportModelId");
  });

  it("does not carry a saved model's mode or variant into an explicitly selected model", () => {
    const candidate = semanticCandidateFromParams({
      operationId: "op-explicit-mode",
      params: {
        prompt: "做一个短视频",
        taskKind: "text_to_video",
        providerId: "fixture",
        modelId: "video-model",
      },
      candidateFrom: parse,
      defaultModelForTaskKind: () => ({
        moduleId: "generation.single-shot",
        providerId: "other",
        modelId: "other-model",
        mode: "text_to_video",
        modeId: "other-mode",
        variantId: "other-variant",
      }),
      registry,
    });

    expect(candidate).toMatchObject({ providerId: "fixture", modelId: "video-model", mode: "text_to_video" });
    expect(candidate).not.toHaveProperty("modeId");
    expect(candidate).not.toHaveProperty("variantId");
  });

  // 根因合同 2026-09-18-draft-shots-drops-candidate：模型点了名的模型，对**没保存过默认**的用户
  // 也必须算数。此前 moduleId 只能从保存的默认里来，所以「点名 + 没存默认」= 当场拒绝，
  // 而模型面上根本没有 moduleId 这个字段可填——点名因此永远差一格。
  it("honours an explicitly named provider+model for a user who never saved a default", () => {
    const candidate = semanticCandidateFromParams({
      operationId: "op-named",
      params: { prompt: "生成一张六棱柱的图", taskKind: "text_to_image", providerId: "fixture", modelId: "image-model" },
      candidateFrom: parse,
      registry,
    });
    expect(candidate).toMatchObject({
      moduleId: "generation.single-shot", providerId: "fixture", modelId: "image-model", mode: "text_to_image",
    });
  });

  it("still refuses when nothing names a model — the module lookup is not a way in", () => {
    // 阳性对照：上一条的绿不是因为判据恒真。没点名 + 没默认 = 照旧拒绝，不许按目录行序挑一个花钱。
    expect(() => semanticCandidateFromParams({
      operationId: "op-unnamed", params: { prompt: "生成一张图", taskKind: "text_to_image" }, candidateFrom: parse, registry,
    })).toThrow(/没有配置可用的图片模型/);
    // 点了名但目录里没有这个身份，也照旧拒绝（不为不存在的模型编一个 module）。
    expect(() => semanticCandidateFromParams({
      operationId: "op-unknown",
      params: { prompt: "生成一张图", taskKind: "text_to_image", providerId: "fixture", modelId: "not-in-catalog" },
      candidateFrom: parse, registry,
    })).toThrow(/没有配置可用的图片模型/);
    // 种类也没写：先问它要哪一种（目录里认不出这个模型，就不知道它出什么）。
    expect(() => semanticCandidateFromParams({
      operationId: "op-unknown-kind",
      params: { prompt: "生成一张图", providerId: "fixture", modelId: "not-in-catalog" },
      candidateFrom: parse, registry,
    })).toThrow(/not-in-catalog is not in the model catalog/);
  });
});
