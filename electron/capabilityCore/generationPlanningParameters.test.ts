import { describe, expect, it } from "vitest";

import { GENERATION_PLANNING_HINTS, GENERATION_PLANNING_PARAMETER_KEYS } from "./generationPlanningParameters";
import { videoRecommendationInput } from "./mcpGenerationVideoResolve";
import { requestedVideoDurationSeconds } from "./semanticGenerationCandidate";
import type { PlanCandidate } from "./executionContract";

/**
 * 这张表的意义全在「它和真正的读者不许漂开」：表里多一个键 = 一个本该报错的参数被悄悄丢掉，
 * 表里少一个键 = 正常的视频规划被整条打掉。所以不用注释维持，用读者本身当判据。
 */
const candidate = (parameters: Record<string, unknown>): PlanCandidate => ({
  candidateId: "c1", revision: 1, moduleId: "generation.single-shot",
  providerId: "p", modelId: "m", mode: "image_to_video",
  prompt: "一只橘猫走进画面", parameters, references: [],
});

describe("generation planning parameters", () => {
  it("每个登记的意图键都真的被 Nomi 自己读走（没有一个是凭空写上去的）", () => {
    const unread: string[] = [];
    for (const key of GENERATION_PLANNING_PARAMETER_KEYS) {
      const probe = {
        cameraIntent: "orbit", preferredFamily: "seedance", preserveCharacter: true,
        preserveTransition: true, useReferenceAudio: true, quality: "final",
        durationSeconds: 7,
        totalDurationSeconds: 120, targetDurationSeconds: 120,
      }[key as keyof Record<string, unknown>];
      expect(probe, `${key} 在探针里没有取值，测试本身证明不了任何事`).toBeDefined();
      const readByRecommendation = JSON.stringify(videoRecommendationInput(candidate({ [key]: probe })) ?? {})
        !== JSON.stringify(videoRecommendationInput(candidate({})) ?? {});
      const readByDuration = requestedVideoDurationSeconds({ [key]: probe }) !== undefined;
      if (!readByRecommendation && !readByDuration) unread.push(key);
    }
    expect(unread, "这些键登记成了「Nomi 自己消费」，但全仓没有读者——它们应该报错而不是被丢掉").toEqual([]);
  });

  it("不在表里的键不是意图键（阳性对照）", () => {
    expect(GENERATION_PLANNING_PARAMETER_KEYS.has("resolution")).toBe(false);
    expect(GENERATION_PLANNING_PARAMETER_KEYS.has("aspect_ratio")).toBe(false);
    expect(GENERATION_PLANNING_PARAMETER_KEYS.has("duration")).toBe(false);
    // 语义比例不是意图键：它要翻成真实键上线缆，放进这张表就会在编合同时被静默吞掉（2026-10-05）。
    expect(GENERATION_PLANNING_PARAMETER_KEYS.has("aspectRatio")).toBe(false);
  });

  it("键名集合与类型表是同一张表——不许再漂出第二份（2026-09-22 总合并）", () => {
    // 两张表曾经并存：打捞分支只有键名，#837 只有推荐器那六个键 + 类型。
    // 合并后键名集合必须由类型表派生；谁再写一个独立的 Set，这条就红。
    expect([...GENERATION_PLANNING_PARAMETER_KEYS].sort()).toEqual(Object.keys(GENERATION_PLANNING_HINTS).sort());
    // 每个键都得有一个真类型（`any` 不算声明——那正是「原样吞掉」的写法）。
    for (const [key, type] of Object.entries(GENERATION_PLANNING_HINTS)) {
      expect(["string", "number", "boolean"], `${key} 的类型没声明成可判的那三种之一`).toContain(type);
    }
  });
});
