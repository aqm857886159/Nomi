import { describe, expect, it } from "vitest";
import { buildCustomCallAiInstruction } from "./customCallContract";

describe("custom call AI instruction without reliable docs", () => {
  it("材料没有端点时要求停止并列出缺口，不允许猜一个付费请求", () => {
    const instruction = buildCustomCallAiInstruction({
      modelKey: "private-model",
      kind: "video",
      baseUrl: "https://private.example/v1",
      material: "只知道模型名字，没有接口文档",
    });
    expect(instruction).toMatch(/do not (?:invent|guess).*endpoint/i);
    expect(instruction).toMatch(/do not make any network request/i);
    expect(instruction).toMatch(/throw new Error/i);
    expect(instruction).not.toMatch(/fall back to the most common/i);
  });
});
