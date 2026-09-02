import { describe, expect, it } from "vitest";

import { planStoryboardFromScript } from "./mcpStoryboardPlanner";

describe("desktop storyboard planner", () => {
  it("turns natural script prose into ordered video shots without provider fields", () => {
    const result = planStoryboardFromScript({
      projectId: "project-1",
      scriptText: "清晨，猫跳上窗台。\n镜头跟随它走进花园！",
    });
    expect(result.shots).toHaveLength(2);
    expect(result.shots.map((shot) => shot.shotId)).toEqual(["shot-1", "shot-2"]);
    expect(result.shots.every((shot) => shot.role === "shot" && shot.included === true)).toBe(true);
    expect(result.shots[0]).not.toHaveProperty("modelId");
  });

  it("keeps a minute-scale one-sentence goal multi-shot when the semantic caller requests it", () => {
    const result = planStoryboardFromScript({
      projectId: "project-1",
      scriptText: "帮我做一个5分钟品牌视频",
      minimumShots: 2,
      targetDurationSeconds: 300,
    });
    expect(result.shots).toHaveLength(20);
    expect(result.shots.every((shot) => shot.role === "shot" && shot.included === true)).toBe(true);
    expect(result.shots.reduce((sum, shot) => sum + (shot.durationSeconds ?? 0), 0)).toBe(300);
    expect(result.shots.every((shot) => shot.durationSeconds === 15)).toBe(true);
    expect(result.targetDurationSeconds).toBe(300);
  });

  it("fails closed when a requested duration cannot fit the bounded storyboard", () => {
    expect(() => planStoryboardFromScript({
      projectId: "project-1",
      scriptText: "x".repeat(20_000),
      targetDurationSeconds: 60,
    })).toThrow(/不足以容纳|无法把目标时长/);
  });

  it("bounds oversized prose into finite, non-empty shots", () => {
    const result = planStoryboardFromScript({ projectId: "project-1", scriptText: "x".repeat(20_000) });
    expect(result.shots.length).toBeGreaterThan(0);
    expect(result.shots.length).toBeLessThanOrEqual(48);
    expect(result.shots.every((shot) => shot.prompt.length > 0)).toBe(true);
  });
});
