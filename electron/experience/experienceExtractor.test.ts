import { describe, expect, it } from "vitest";
import { extractExperienceCandidates, normalizeTrajectory, parseLearningEnvelope, setExperienceExtractorForTests } from "./experienceExtractor";

const trajectory = {
  trajectoryId: "traj-1",
  projectId: "project-1",
  sessionId: "session-1",
  prompt: "修复供应商接入",
  response: "<!-- nomi-learning {\"kind\":\"procedure\",\"title\":\"先跑契约\",\"content\":\"先跑官方契约，再跑 loopback。\",\"evidence\":{\"problem\":\"模型列表为空\",\"action\":\"补认证字段\",\"outcome\":\"列表恢复\",\"verification\":\"测试通过\",\"eventSeqs\":[4,5]},\"confidence\":0.9} -->",
  events: [{ type: "agent.turn.finished", seq: 4 }, { type: "agent.tool.completed", seq: 5 }],
  completedAt: "2026-09-02T00:00:00.000Z",
} as const;

describe("experience extractor", () => {
  it("extracts only an explicit structured envelope", async () => {
    const candidates = await extractExperienceCandidates(trajectory);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe("procedure");
    expect(candidates[0].evidence.verification).toBe("测试通过");
  });

  it("does not invent a learning from an ordinary answer", async () => {
    await expect(extractExperienceCandidates({ ...trajectory, response: "已经处理好了" })).resolves.toEqual([]);
  });

  it("rejects an envelope whose source sequence is absent from the normalized trajectory", async () => {
    await expect(extractExperienceCandidates({
      ...trajectory,
      events: [{ type: "agent.turn.finished", seq: 4 }],
    })).resolves.toEqual([]);
  });

  it("redacts secrets and caps trajectory text before an extractor sees it", () => {
    const normalized = normalizeTrajectory({
      ...trajectory,
      prompt: "token=sk-1234567890abcdef " + "x".repeat(3000),
      response: "Bearer abcdefghijklmnop",
    });
    expect(normalized.prompt).not.toContain("sk-1234567890abcdef");
    expect(normalized.response).not.toContain("Bearer abcdefghijklmnop");
    expect(normalized.prompt.length).toBeLessThanOrEqual(2000);
  });

  it("rejects malformed envelopes instead of activating them", () => {
    expect(parseLearningEnvelope("<!-- nomi-learning {\"kind\":\"procedure\"} -->")).toBeNull();
  });

  it("redacts a custom extractor result before it can become a candidate", async () => {
    setExperienceExtractorForTests(() => ({
      kind: "fact",
      title: "凭据",
      content: "token=sk-1234567890abcdef",
      evidence: { problem: "p", action: "a", outcome: "o", verification: "v", eventSeqs: [1] },
      confidence: 0.8,
    }));
    const [candidate] = await extractExperienceCandidates({ ...trajectory, events: [{ type: "agent.turn.finished", seq: 1 }] });
    expect(candidate.content).not.toContain("sk-1234567890abcdef");
    setExperienceExtractorForTests(null);
  });
});
