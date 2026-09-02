import { describe, expect, it } from "vitest";

import type { PlanCandidate } from "./executionContract";
import { createModuleRegistry } from "./moduleRegistry";
import {
  inferGenerationTaskKind,
  isLongFormGenerationRequest,
  requestedVideoDurationSeconds,
  semanticCandidateFromParams,
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

  it("infers image, edit, and video intent from user language", () => {
    expect(inferGenerationTaskKind({ prompt: "生成一个小猫头像" })).toBe("text_to_image");
    expect(inferGenerationTaskKind({ prompt: "把这张图改成水彩风", references: [{}] })).toBe("image_edit");
    expect(inferGenerationTaskKind({ prompt: "生成一段品牌视频" })).toBe("text_to_video");
    expect(inferGenerationTaskKind({ prompt: "让这张图动起来做成视频", references: [{}] })).toBe("image_to_video");
  });

  it("uses the live registry when no saved default exists", () => {
    const candidate = semanticCandidateFromParams({
      operationId: "op-fallback",
      params: { prompt: "生成一个头像" },
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
});
