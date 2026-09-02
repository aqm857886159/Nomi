import { describe, expect, it } from "vitest";
import { workModeInstruction } from "./agentWorkModePolicy";

describe("work mode instructions", () => {
  it("gives every mode a distinct, explicit boundary", () => {
    expect(workModeInstruction("ask")).toContain("不要写入");
    expect(workModeInstruction("editSelection")).toContain("选中范围");
    expect(workModeInstruction("agent")).toContain("跨对象");
  });

  it("falls back to the Agent posture", () => {
    expect(workModeInstruction(undefined)).toBe(workModeInstruction("agent"));
  });
});
