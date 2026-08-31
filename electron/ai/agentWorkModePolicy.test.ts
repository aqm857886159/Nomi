import { describe, expect, it } from "vitest";
import { workModeInstruction } from "./agentWorkModePolicy";

describe("work mode instructions", () => {
  it("gives every mode a distinct, explicit boundary", () => {
    expect(workModeInstruction("ask")).toContain("不要擅自写入");
    expect(workModeInstruction("guided")).toContain("关键阶段");
    expect(workModeInstruction("balanced")).toContain("可撤销步骤");
    expect(workModeInstruction("auto")).toContain("状态未知");
  });

  it("falls back to the safe balanced posture", () => {
    expect(workModeInstruction(undefined)).toBe(workModeInstruction("balanced"));
  });
});
