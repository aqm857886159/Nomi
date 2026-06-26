import { describe, expect, it } from "vitest";
import {
  applyParamMap,
  bodyReferencedParamKeys,
  consumedCanonicalKeys,
  ratioResToOpenAiSize,
  type ParamMap,
} from "./paramTranslate";

describe("ratioResToOpenAiSize", () => {
  it("16:9 4K → 经典 3840x2160（命中像素预算上限）", () => {
    expect(ratioResToOpenAiSize(["16:9", "4K"])).toBe("3840x2160");
  });
  it("1:1 4K 被像素预算夹下来（OpenAI 1:1 不能真 4K）", () => {
    const size = ratioResToOpenAiSize(["1:1", "4K"]);
    const [w, h] = (size || "").split("x").map(Number);
    expect(w).toBe(h);
    expect(w * h).toBeLessThanOrEqual(8294400);
    expect(w % 16).toBe(0);
  });
  it("竖图 9:16 4K → 高 > 宽", () => {
    const [w, h] = (ratioResToOpenAiSize(["9:16", "4K"]) || "").split("x").map(Number);
    expect(h).toBeGreaterThan(w);
  });
  it("auto / 空比例 → undefined（省略 size 由站默认）", () => {
    expect(ratioResToOpenAiSize(["auto", "4K"])).toBeUndefined();
    expect(ratioResToOpenAiSize(["", "1K"])).toBeUndefined();
  });
  it("1K/2K 长边随档位缩放", () => {
    expect(ratioResToOpenAiSize(["16:9", "1K"])).toBe("1024x576");
    expect(ratioResToOpenAiSize(["16:9", "2K"])).toBe("2048x1152");
  });
});

describe("applyParamMap", () => {
  it("无 paramMap → 原样返回", () => {
    const params = { aspect_ratio: "16:9" };
    expect(applyParamMap(undefined, params)).toBe(params);
  });
  it("改名规则：size <- aspect_ratio（apimart 比例字段名不同）", () => {
    const map: ParamMap = { rules: [{ wire: "size", from: "aspect_ratio" }] };
    const out = applyParamMap(map, { aspect_ratio: "16:9", resolution: "4K" });
    expect(out.size).toBe("16:9");
    expect(out.resolution).toBe("4K"); // 透传保留
  });
  it("值转换规则：size <- ratioResToOpenAiSize(比例,档位)", () => {
    const map: ParamMap = { rules: [{ wire: "size", fromMany: ["aspect_ratio", "resolution"], transform: "ratioResToOpenAiSize" }] };
    const out = applyParamMap(map, { aspect_ratio: "16:9", resolution: "4K" });
    expect(out.size).toBe("3840x2160");
  });
  it("常量规则", () => {
    const out = applyParamMap({ rules: [{ wire: "quality", const: "high" }] }, {});
    expect(out.quality).toBe("high");
  });
  it("空/缺值不注入（避免发空字段）", () => {
    const map: ParamMap = { rules: [{ wire: "size", from: "aspect_ratio" }] };
    expect(applyParamMap(map, { aspect_ratio: "" }).size).toBeUndefined();
    expect(applyParamMap(map, {}).size).toBeUndefined();
  });
  it("未知 transform id → 跳过该规则，不崩", () => {
    const map: ParamMap = { rules: [{ wire: "size", fromMany: ["x"], transform: "nope" }] };
    expect(applyParamMap(map, { x: "1" }).size).toBeUndefined();
  });
});

describe("consumedCanonicalKeys", () => {
  it("收集 from + fromMany 并集", () => {
    const map: ParamMap = {
      rules: [
        { wire: "size", from: "aspect_ratio" },
        { wire: "x", fromMany: ["resolution", "quality"], transform: "ratioResToOpenAiSize" },
        { wire: "c", const: "1" },
      ],
    };
    expect(consumedCanonicalKeys(map).sort()).toEqual(["aspect_ratio", "quality", "resolution"]);
  });
});

describe("bodyReferencedParamKeys", () => {
  it("扫嵌套 body 里的 {{request.params.X}}", () => {
    const body = {
      model: "{{model.modelKey}}",
      input: { prompt: "{{request.prompt}}", aspect_ratio: "{{request.params.aspect_ratio}}", resolution: "{{request.params.resolution}}" },
      arr: ["{{request.params.size}}"],
    };
    expect(bodyReferencedParamKeys(body).sort()).toEqual(["aspect_ratio", "resolution", "size"]);
  });
});
