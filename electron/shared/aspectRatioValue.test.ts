import { describe, expect, it } from "vitest";
import { normalizeAspectRatioToWH, parseAspectRatioValue, readAspectRatioGeometry, resolveAspectRatioGeometryChoice } from "./aspectRatioValue";

describe("像素写法与比例共用解析", () => {
  it.each(["2560x1440", "2560×1440", "2560*1440"])("%s 认同一个宽高，落到冒号档", value => {
    expect(readAspectRatioGeometry(value)).toEqual({ width: 2560, height: 1440 });
    expect(parseAspectRatioValue(value)).toBeNull();
    expect(normalizeAspectRatioToWH(value)).toBeNull();
    expect(resolveAspectRatioGeometryChoice(value, [{ key: "size", options: [{ value: "1:1" }, { value: "16:9" }] }]))
      .toEqual({ ok: true, key: "size", value: "16:9" });
  });
  it.each(["abcx", "0x720", "2560x", "-2560x1440", "16/9", "1.78"])("%s 不冒充比例", value => {
    expect(readAspectRatioGeometry(value)).toBeNull();
    expect(parseAspectRatioValue(value)).toBeNull();
    expect(normalizeAspectRatioToWH(value)).toBeNull();
  });
  it("冒号、全角、标签与命名档维持原值", () => {
    expect(normalizeAspectRatioToWH(" 16 : 9 (宽屏) ")).toBe("16 : 9");
    expect(normalizeAspectRatioToWH("16：9")).toBe("16：9");
    expect(normalizeAspectRatioToWH("portrait_4_3")).toBe("3:4");
  });
});

it("宿主几何匹配不采用邻近档", () => {
  expect(resolveAspectRatioGeometryChoice("16:9", [{ key: "size", options: [{ value: "1344x768" }] }]))
    .toEqual({ ok: false, reason: "not_offered", key: "size", allowedValues: ["1344x768"] });
});
