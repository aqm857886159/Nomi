import { describe, expect, it } from "vitest";
import { experienceCandidateSchema, learningEnvelopeSchema, trajectorySchema } from "./experienceTypes";

describe("experience contracts", () => {
  it("accepts a complete learning envelope and rejects missing evidence", () => {
    const valid = learningEnvelopeSchema.safeParse({
      kind: "procedure",
      title: "供应商接入前先跑契约检查",
      content: "先核对官方端点，再跑 loopback 和 fault matrix。",
      evidence: {
        problem: "接入后模型列表为空",
        action: "补齐 discovery 的认证字段",
        outcome: "模型列表恢复",
        verification: "契约测试和 loopback 都通过",
        eventSeqs: [1, 2, 3],
      },
      confidence: 0.88,
    });
    expect(valid.success).toBe(true);
    expect(learningEnvelopeSchema.safeParse({
      kind: "procedure",
      title: "缺动作",
      content: "不能激活",
      evidence: { problem: "p", outcome: "o", verification: "v" },
      confidence: 0.9,
    }).success).toBe(false);
  });

  it("keeps stored candidate JSON-safe and bounded", () => {
    const result = experienceCandidateSchema.safeParse({
      candidateId: "exp_1234567890abcdef",
      contentHash: "a".repeat(64),
      trajectoryId: "traj_1",
      projectId: "project-1",
      kind: "fact",
      destination: "memory",
      scope: "project",
      risk: "green",
      title: "本地优先",
      content: "API key 保留在本机",
      evidence: {
        problem: "上传时担心泄露",
        action: "使用本地凭据边界",
        outcome: "凭据未离开本机",
        verification: "事件日志没有密钥",
        eventSeqs: [1],
      },
      confidence: 0.95,
      status: "active",
      reuseCount: 0,
      failureCount: 0,
      successfulTrajectoryIds: [],
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
    expect(trajectorySchema.safeParse({
      trajectoryId: "traj-1",
      projectId: "project-1",
      sessionId: "session-1",
      prompt: "修复上传",
      response: "已修复",
      events: [],
      completedAt: "2026-09-02T00:00:00.000Z",
    }).success).toBe(true);
  });
});
