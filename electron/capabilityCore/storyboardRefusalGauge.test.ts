import { describe, expect, it } from "vitest";
import { createLaneRepeatedFailureTracker, LANE_REPEATED_FAILURE_BLOCK } from "../agentLane/laneRepeatedFailure.mjs";
import { refuseIfStoryboardRejected } from "./mcpGenerationMultiShot";
import { GenerationRefusal } from "./transportFailure";

/**
 * 设计卡 D-main-thread-unblock ★9 Agent 量具（免费）：用真实的「Agent 一直把时长写成 NaN」那一幕重放。
 * 1) 拒收正文点名字段和需要什么（旧版是裸 ZodError 或只有一个码，模型读不懂只会原样重发）；
 * 2) 同一处连着被拒第 3 次，既有的熔断（laneRepeatedFailure，真实轨迹 docs/evidence/2026-09-21-askback-real-model 同一套）就拦下。
 */
const reply = { status: "rejected", issues: [{ path: "shots[1].durationSec", problem: "needs number, got nan" }, { path: "status", problem: "Invalid enum value. Expected 'draft' | 'ready'" }] };

function refusal(): GenerationRefusal {
  try { refuseIfStoryboardRejected(reply); } catch (error) { return error as GenerationRefusal; }
  throw new Error("expected a refusal");
}

describe("what the model reads when a storyboard write is refused", () => {
  it("names each field and what it needs, and says nothing was changed", () => {
    const text = refusal().message;
    expect(text).toContain("shots[1].durationSec needs number");
    expect(text).toContain("status Invalid enum value. Expected 'draft' | 'ready'");
    expect(text).toMatch(/not saved and nothing changed/);
  });

  it("the third identical refusal in a row trips the existing stop mechanism; the first two do not", () => {
    const tracker = createLaneRepeatedFailureTracker();
    const error = refusal();
    const identity = { code: error.code, problem: error.problem };
    for (let attempt = 1; attempt < LANE_REPEATED_FAILURE_BLOCK; attempt += 1) {
      tracker.note("nomi_storyboard_patch", true, error.message, identity);
      expect(tracker.block("nomi_storyboard_patch")).toBeNull();
    }
    tracker.note("nomi_storyboard_patch", true, error.message, identity);
    expect(tracker.block("nomi_storyboard_patch")).not.toBeNull();
  });
});
