import { describe, expect, it } from "vitest";
import { humanizeModelKey } from "./modelLabel";

// 审计 A13：显示名兜底不落裸 id——保留 vendor 词根，只做分词排版。
describe("humanizeModelKey", () => {
  it("把连字符 id 排版成可读词组（审计原始案例）", () => {
    expect(humanizeModelKey("moonshot-v1-128k-vision-preview")).toBe("Moonshot v1 128k Vision Preview");
  });

  it("数字/版本 token 不强行首字母大写", () => {
    expect(humanizeModelKey("gpt-4o-mini")).toBe("Gpt 4o Mini");
    expect(humanizeModelKey("claude-3-5-sonnet")).toBe("Claude 3 5 Sonnet");
  });

  it("空串/空白原样返回", () => {
    expect(humanizeModelKey("")).toBe("");
    expect(humanizeModelKey("  ")).toBe("");
  });
});
