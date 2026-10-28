import { describe, expect, it } from "vitest";
import { setDesktopLocale } from "../desktopLocale";
import { desktopT } from "../desktopStrings";
import { MODEL_ARCHETYPES } from "../shared/modelArchetypes";
import { GPT_IMAGE_2_ARCHETYPE } from "../shared/modelArchetypes/gptImage2";
import { matchNomiErrorCode, tagNomiError } from "../shared/nomiErrorCodes";
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
  it("1K landscape meets the documented minimum pixel area; 2K stays unchanged", () => {
    const [width, height] = ratioResToOpenAiSize(["16:9", "1K"])!.split("x").map(Number);
    expect(width * height).toBeGreaterThanOrEqual(655360);
    expect(Math.abs(height - width * 9 / 16)).toBeLessThanOrEqual(16);
    expect(ratioResToOpenAiSize(["16:9", "2K"])).toBe("2048x1152");
  });
  it.each([["text_to_image"], ["image_edit"], [undefined]])("16:9 / 9:16 at 1K are the smallest legal 16-pixel step above the area floor (task kind %s)", (kind) => {
    // 1024x576 (589,824 px) is below the provider's 655,360 px floor and every request with it was rejected.
    expect(ratioResToOpenAiSize(["16:9", "1K"], kind)).toBe("1088x608");
    expect(ratioResToOpenAiSize(["9:16", "1K"], kind)).toBe("608x1088");
  });

  describe("an explicit image ratio beyond 3:1 is refused, never silently dropped", () => {
    // Omitting `size` made the provider pick its default shape: the user asked for one frame and got another.
    const REFUSED = /NOMI_ERR::aspect-ratio-unsupported::/;
    it.each(["4:1", "1:4", "8:1", "301:100", "100:301", "4 x 1"])("image tasks refuse %s while no size exists yet", (ratio) => {
      for (const kind of ["text_to_image", "image_edit", undefined]) {
        expect(() => ratioResToOpenAiSize([ratio, "1K"], kind), String(kind)).toThrow(REFUSED);
      }
    });
    it("numerals large enough to overflow are refused too, not misread as in range", () => {
      const huge = "9".repeat(400);
      for (const ratio of [`${huge}:1`, `1:${huge}`, `${huge}:${huge}`]) {
        expect(() => ratioResToOpenAiSize([ratio, "1K"], "text_to_image")).toThrow(REFUSED);
      }
    });
    it.each(["3:1", "1:3", "300:100", "2048:815"])("the documented boundary %s is still sized, not refused", (ratio) => {
      const [width, height] = ratioResToOpenAiSize([ratio, "1K"], "text_to_image")!.split("x").map(Number);
      expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(3);
    });
    it("the refusal names the selected ratio and the supported range in both desktop languages", () => {
      const messageFor = (locale: "zh-CN" | "en") => {
        setDesktopLocale(locale);
        try {
          ratioResToOpenAiSize(["4:1", "1K"], "text_to_image");
        } catch (error) {
          return (error as Error).message;
        } finally {
          setDesktopLocale("zh-CN");
        }
        throw new Error("expected 4:1 to be refused");
      };
      for (const locale of ["zh-CN", "en"] as const) {
        const message = messageFor(locale);
        expect(message).toBe(tagNomiError("aspect-ratio-unsupported", desktopT("imageSize.aspectRatioUnsupported", { ratio: "4:1" }, locale)));
        expect(matchNomiErrorCode(message)).toBe("aspect-ratio-unsupported");
        expect(message).toContain("4:1");
        expect(message).toContain("1:3");
      }
      expect(messageFor("zh-CN")).not.toBe(messageFor("en"));
    });
    it("a pathological ratio string is shortened in the message instead of being echoed whole", () => {
      let message = "";
      try {
        ratioResToOpenAiSize([`${"9".repeat(400)}:1`, "1K"], "text_to_image");
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(REFUSED);
      expect(message.length).toBeLessThan(300);
    });
    it("video tasks never inherit the image refusal: the same ratios keep their baseline sizes", () => {
      for (const kind of ["text_to_video", "image_to_video"]) {
        expect(ratioResToOpenAiSize(["4:1", "1K"], kind)).toBe("1024x256");
        expect(ratioResToOpenAiSize(["1:4", "1K"], kind)).toBe("256x1024");
        expect(ratioResToOpenAiSize(["16:9", "1K"], kind)).toBe("1024x576");
      }
    });
    it("the same persisted map refuses for images and keeps video at the request boundary of applyParamMap", () => {
      const map: ParamMap = { rules: [{ wire: "size", fromMany: ["aspect_ratio", "resolution"], transform: "ratioResToOpenAiSize" }] };
      const params = { aspect_ratio: "4:1", resolution: "1K" };
      expect(() => applyParamMap(map, params, "text_to_image")).toThrow(REFUSED);
      expect(() => applyParamMap(map, params, "image_edit")).toThrow(REFUSED);
      expect(applyParamMap(map, params, "text_to_video").size).toBe("1024x256");
      expect(applyParamMap(map, params, "image_to_video").size).toBe("1024x256");
    });
  });

  // The class test (not one example): every ratio any image profile can offer, in every tier, either becomes a size inside the
  // provider's whole domain or is refused with the Nomi code - and the refusal happens exactly when the ratio is beyond 3:1.
  const offeredRatios = [...new Set(
    MODEL_ARCHETYPES.filter((archetype) => archetype.kind === "image")
      .flatMap((archetype) => archetype.modes.flatMap((mode) => [...(mode.params ?? []), ...Object.values(mode.vendorParams ?? {}).flat()]))
      .flatMap((param) => param.options ?? [])
      .map((option) => (typeof option.value === "string" ? option.value.trim().toLowerCase() : ""))
      .filter((value) => /^\d+\s*[:x]\s*\d+$/.test(value)),
  )];
  it("the profile sweep is alive: it sees the GPT Image 2 ratios and at least one ratio beyond 3:1", () => {
    for (const ratio of ["16:9", "9:16", "3:1", "1:3"]) expect(offeredRatios, ratio).toContain(ratio);
    expect(offeredRatios.some((ratio) => { const [a, b] = ratio.split(/\s*[:x]\s*/).map(Number); return Math.max(a, b) > 3 * Math.min(a, b); })).toBe(true);
  });
  it.each(offeredRatios.flatMap((ratio) => ["1K", "2K", "4K"].map((tier) => [ratio, tier])))(
    "profile ratio %s / %s: a size inside the whole provider domain, or the Nomi refusal when beyond 3:1",
    (ratio, tier) => {
      const [a, b] = ratio.split(/\s*[:x]\s*/).map(Number);
      if (Math.max(a, b) > 3 * Math.min(a, b)) {
        expect(() => ratioResToOpenAiSize([ratio, tier], "text_to_image")).toThrow(/NOMI_ERR::aspect-ratio-unsupported::/);
        return;
      }
      const [width, height] = ratioResToOpenAiSize([ratio, tier], "text_to_image")!.split("x").map(Number);
      expect(width % 16).toBe(0);
      expect(height % 16).toBe(0);
      expect(Math.max(width, height)).toBeLessThanOrEqual(3840);
      expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(3);
      expect(width * height).toBeGreaterThanOrEqual(655360);
      expect(width * height).toBeLessThanOrEqual(8294400);
      expect(Math.abs(Math.min(width, height) - Math.max(width, height) * Math.min(a, b) / Math.max(a, b))).toBeLessThanOrEqual(16);
      expect(a >= b).toBe(width >= height);
    },
  );

  const ratios = GPT_IMAGE_2_ARCHETYPE.modes[0].params.find((param) => param.key === "aspect_ratio")!.options!
    .map((option) => option.value).filter((ratio): ratio is string => typeof ratio === "string" && ratio !== "auto");
  it.each(ratios.flatMap((ratio) => ["1K", "2K", "4K"].map((tier) => [ratio, tier])))
    ("selectable %s / %s satisfies all GPT Image 2 size limits", (ratio, tier) => {
      const [width, height] = ratioResToOpenAiSize([ratio, tier])!.split("x").map(Number);
      expect(width % 16).toBe(0);
      expect(height % 16).toBe(0);
      expect(Math.max(width, height)).toBeLessThanOrEqual(3840);
      expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(3);
      expect(width * height).toBeGreaterThanOrEqual(655360);
      expect(width * height).toBeLessThanOrEqual(8294400);
      const [a, b] = ratio.split(":").map(Number);
      expect(Math.abs(Math.min(width, height) - Math.max(width, height) * Math.min(a, b) / Math.max(a, b)))
        .toBeLessThanOrEqual(16);
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
  it("值转换规则：duration <- toString(数字枚举)", () => {
    const map: ParamMap = { rules: [{ wire: "duration", fromMany: ["duration"], transform: "toString" }] };
    expect(applyParamMap(map, { duration: "4" }).duration).toBe("4");
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
