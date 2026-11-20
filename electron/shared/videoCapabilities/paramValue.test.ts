// 参数值内部类型的三个门（声明门 / 值门 / 出口）各自的判据。端到端（档案 × 供应商 × 写入口 × 报文）在
// electron/parity/paramValueType.parity.test.ts。
import { describe, expect, it } from "vitest";
import {
  admitNumber,
  admitParamValue,
  declaredOptionValue,
  encodeParamsForWire,
  isCanonicalNumericString,
  normalizeDeclaredControls,
  paramSeconds,
  parseControlInput,
} from "./paramValue";
import type { ModelParameterControl } from "./types";

const select = (values: (string | number)[], extra: Partial<ModelParameterControl> = {}): ModelParameterControl => ({
  key: "duration", label: "时长", type: "select", options: values.map((value) => ({ value, label: String(value) })), ...extra,
});

describe("值门：只认规范数字串", () => {
  it("规范数字串 = 转成数字再转回来一字不差", () => {
    for (const ok of ["12", "2.5", "0", "-1"]) expect(isCanonicalNumericString(ok)).toBe(true);
    for (const bad of ["05", "5s", " 5", "5 ", "", "1e3", "Infinity", "NaN", "5.0"]) expect(isCanonicalNumericString(bad)).toBe(false);
  });

  it("admitNumber：有限数原样、规范数字串转数字、其余 undefined（不当 0、不当默认）", () => {
    expect(admitNumber(12)).toBe(12);
    expect(admitNumber("12")).toBe(12);
    for (const bad of ["05", "5s", "", null, undefined, Number.NaN, Infinity, true, {}]) expect(admitNumber(bad)).toBeUndefined();
  });

  it("要数字的声明（数字控件 / 全数字下拉）：\"12\" 落 12，认不出的原样交给政策", () => {
    expect(admitParamValue({ type: "number" }, "12")).toBe(12);
    expect(admitParamValue(select([5, 10]), "10")).toBe(10);
    expect(admitParamValue(select([5, 10]), "05")).toBe("05");
    expect(admitParamValue(select([5, 10]), "5s")).toBe("5s");
  });

  it("没过声明门的数字串下拉（目录行自带控件）：数字按它声明的写法收成字符串", () => {
    expect(admitParamValue(select(["4", "8"]), 8)).toBe("8");
    expect(admitParamValue(select(["4", "8"]), "8")).toBe("8");
  });

  it("混型下拉（用户目录 / ComfyUI）：数值相同的那一档就是它，文字档和认不出的原样", () => {
    expect(admitParamValue(select([5, "auto", 10]), "5")).toBe(5);
    expect(admitParamValue(select(["auto", "5"]), 5)).toBe("5");
    expect(admitParamValue(select([5, "auto", 10]), "auto")).toBe("auto");
    expect(admitParamValue(select([5, "auto", 10]), "7")).toBe("7");
    expect(admitParamValue(select([5, "auto", 10]), "05")).toBe("05");
  });

  it("文字档、布尔不动", () => {
    expect(admitParamValue(select(["720p", "1080p"], { key: "resolution" }), "720p")).toBe("720p");
    expect(admitParamValue({ type: "boolean" }, "false")).toBe("false");
    expect(admitParamValue({ type: "text" }, "12")).toBe("12");
  });
});

describe("paramSeconds：从参数袋读秒数的唯一取值函数", () => {
  it("duration 优先，其次 durationSeconds；都经值门", () => {
    expect(paramSeconds({ duration: "12" })).toBe(12);
    expect(paramSeconds({ duration: 8, durationSeconds: 5 })).toBe(8);
    expect(paramSeconds({ duration: "5s", durationSeconds: 6 })).toBe(6);
    expect(paramSeconds({ duration: "05" })).toBeUndefined();
    expect(paramSeconds(undefined)).toBeUndefined();
  });
});

describe("声明门", () => {
  it("全是规范数字串的下拉 → 数字档 + 记报文写法；默认值和引用它的选项约束一起换", () => {
    const controls: ModelParameterControl[] = [
      select(["4", "8", "12"], { defaultValue: "4" }),
      { key: "resolution", label: "清晰度", type: "select", options: [{ value: "720p", label: "720p" }],
        optionConstraints: [{ when: { key: "duration", value: "12" }, values: ["720p"] }] },
    ];
    const [duration, resolution] = normalizeDeclaredControls(controls);
    expect(duration!.options.map((option) => option.value)).toEqual([4, 8, 12]);
    expect(duration!.defaultValue).toBe(4);
    expect(duration!.wireEncoding).toBe("numeric-string");
    expect(resolution!.optionConstraints).toEqual([{ when: { key: "duration", value: 12 }, values: ["720p"] }]);
    expect(normalizeDeclaredControls(normalizeDeclaredControls(controls))).toEqual(normalizeDeclaredControls(controls));
  });

  it("文字、混型、非规范写法不动；什么都没换返回同一个数组", () => {
    const untouched = [select(["auto", "5"]), select(["05", "10"]), select(["720p"], { key: "resolution" })];
    expect(normalizeDeclaredControls(untouched)).toBe(untouched);
  });
});

describe("出口编码", () => {
  const declared = normalizeDeclaredControls([select(["4", "8", "12"])]);

  it("数字串声明：12 和 \"12\" 都发 \"12\"；数字声明不动；可以重复跑", () => {
    expect(encodeParamsForWire(declared, { duration: 12 })).toEqual({ duration: "12" });
    expect(encodeParamsForWire(declared, { duration: "12" })).toEqual({ duration: "12" });
    const numeric = [select([4, 8])];
    expect(encodeParamsForWire(numeric, { duration: "8" })).toEqual({ duration: 8 });
    const once = encodeParamsForWire(declared, { duration: 12, seed: 3 });
    expect(encodeParamsForWire(declared, once)).toEqual(once);
  });

  it("认不出的值、没声明的键原样放行；同一个键在各方式写法不一致 → 不编", () => {
    expect(encodeParamsForWire(declared, { duration: "5s", extra: 1 })).toEqual({ duration: "5s", extra: 1 });
    const split = [...declared, select([4, 8])];
    expect(encodeParamsForWire(split, { duration: 8 })).toEqual({ duration: 8 });
  });
});

describe("三个门串起来：存什么写法、发什么写法（设计卡 ★9.9）", () => {
  // 声明门 → 值门 → 出口，一个值走完整一圈。非规范写法、带单位、混型：一个字节不动。
  const roundTrip = (declared: ModelParameterControl, stored: unknown) => {
    const [control] = normalizeDeclaredControls([declared]);
    return encodeParamsForWire([control!], { duration: admitParamValue(control!, stored) })?.duration;
  };

  it("规范数字串声明：存 \"8\" 或 8 都发 \"8\"；数字声明：存 \"8\" 或 8 都发 8", () => {
    for (const stored of ["8", 8]) {
      expect(roundTrip(select(["4", "8"]), stored)).toBe("8");
      expect(roundTrip(select([4, 8]), stored)).toBe(8);
    }
  });

  it("\"05\" / \"5s\" 声明、混型下拉的文字档：存什么发什么", () => {
    expect(roundTrip(select(["05", "10"]), "05")).toBe("05");
    expect(roundTrip(select(["5s", "10s"]), "5s")).toBe("5s");
    expect(roundTrip(select([5, "auto"]), "auto")).toBe("auto");
    expect(roundTrip(select([5, "auto"]), 5)).toBe(5);
    expect(roundTrip(select([5, "auto"]), "5")).toBe(5);
  });
});

describe("界面输入门", () => {
  it("下拉显示串 → 它声明的值；数字控件空 = null；布尔按 \"true\"", () => {
    expect(declaredOptionValue([4, 8], "8")).toBe(8);
    expect(declaredOptionValue(["4", "8"], "8")).toBe("8");
    expect(parseControlInput(select([4, 8]), "8")).toBe(8);
    expect(parseControlInput({ key: "seed", label: "seed", type: "number", options: [] }, "")).toBeNull();
    expect(parseControlInput({ key: "seed", label: "seed", type: "number", options: [] }, "5.0")).toBe(5);
    expect(parseControlInput({ key: "audio", label: "audio", type: "boolean", options: [] }, "true")).toBe(true);
  });
});
