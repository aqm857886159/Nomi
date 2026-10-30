import { describe, expect, it } from "vitest";
import type { ArchetypeMode, ModelParameterControl } from "./types";
import { MINIMAX_H3_ARCHETYPE } from "./minimaxH3";
import {
  durationControlOf,
  placeDurationParameters,
  withoutDurationParameters,
  clampToRange,
  isParamValueAllowed,
  modeDurationRange,
  nearestNumber,
  numericOptionValues,
  numericRangeOf,
} from "./paramConstraints";

const select = (options: (string | number)[], defaultValue?: string | number): ModelParameterControl => ({
  key: "duration",
  label: "时长",
  type: "select",
  options: options.map((value) => ({ value, label: String(value) })),
  ...(defaultValue === undefined ? {} : { defaultValue }),
});

const numberControl = (min: number, max: number): ModelParameterControl => ({
  key: "duration",
  label: "时长",
  type: "number",
  options: [],
  min,
  max,
});

describe("paramConstraints · 范围读取与钳值", () => {
  it("枚举控件读出档位与上下限；数值控件读出区间；两者都读不到 → null", () => {
    expect(numericRangeOf(select([5, 10]))).toEqual({ min: 5, max: 10, enum: [5, 10] });
    expect(numericRangeOf(numberControl(4, 15))).toEqual({ min: 4, max: 15 });
    expect(numericRangeOf({ key: "x", label: "x", type: "text", options: [] })).toBeNull();
    expect(numericRangeOf(undefined)).toBeNull();
  });

  it("枚举取最近档、区间取 clamp，并如实报告有没有被改动", () => {
    expect(clampToRange(6, { min: 5, max: 10, enum: [5, 10] })).toEqual({ value: 5, changed: true });
    expect(clampToRange(5, { min: 5, max: 10, enum: [5, 10] })).toEqual({ value: 5, changed: false });
    expect(clampToRange(20, { min: 4, max: 15 })).toEqual({ value: 15, changed: true });
    expect(clampToRange(2, { min: 4, max: 15 })).toEqual({ value: 4, changed: true });
    expect(nearestNumber(7, [5, 10])).toBe(5);
    expect(numericOptionValues(select([5, "auto", 10]))).toEqual([5, 10]);
  });

  it("模式的 duration 范围直接读档案数值（H3 = 4–15s），不在别处再抄一份", () => {
    const mode = MINIMAX_H3_ARCHETYPE.modes[0] as ArchetypeMode;
    expect(modeDurationRange(mode)).toEqual({ min: 4, max: 15 });
  });
});

describe("paramConstraints · 合法性判定是唯一 owner", () => {
  it("枚举按字符串形比较：JSON/IPC 送来的 \"5\" 与档位 5 是同一个合法值", () => {
    // 这条正是两份实现分叉的地方：planResolver 曾用严格 ===（判非法），
    // plannedNodeMeta 用 String() 比较（判合法）。现在只有一个答案。
    expect(isParamValueAllowed(select([5, 10]), "5")).toBe(true);
    expect(isParamValueAllowed(select([5, 10]), 5)).toBe(true);
    expect(isParamValueAllowed(select([5, 10]), 7)).toBe(false);
  });

  it("数值控件按 min-max 判；boolean 按类型判；无约束的文本一律放行", () => {
    expect(isParamValueAllowed(numberControl(4, 15), 4)).toBe(true);
    expect(isParamValueAllowed(numberControl(4, 15), 3)).toBe(false);
    expect(isParamValueAllowed(numberControl(4, 15), Number.NaN)).toBe(false);
    expect(isParamValueAllowed({ key: "audio", label: "音频", type: "boolean", options: [] }, true)).toBe(true);
    expect(isParamValueAllowed({ key: "audio", label: "音频", type: "boolean", options: [] }, "yes")).toBe(false);
    expect(isParamValueAllowed({ key: "note", label: "备注", type: "text", options: [] }, "任意")).toBe(true);
  });
});

describe("declared duration projection", () => {
  const imported = { ...numberControl(1, 20), key: "comfy_duration" };
  it("retains unrelated values and accepts equal serialized duration values", () => {
    const input = { duration: 7, comfy_duration: "7", seed: 41 };
    expect(placeDurationParameters(input, [imported])).toEqual({ comfy_duration: 7, seed: 41 });
    expect(input).toEqual({ duration: 7, comfy_duration: "7", seed: 41 });
  });
  it("does not infer duration from labels, arbitrary keys or absent input", () => {
    expect(placeDurationParameters({ duration: 7 }, [{ ...imported, key: "seconds" }])).toEqual({ duration: 7 });
    expect(placeDurationParameters({ comfy_duration: 8, seed: 41 }, [imported])).toEqual({ comfy_duration: 8, seed: 41 });
    expect(placeDurationParameters({ duration: 7 }, [numberControl(1, 20)])).toEqual({ duration: 7 });
  });
  it("rejects contradictory or ambiguous duration ownership", () => {
    expect(() => placeDurationParameters({ duration: 7, comfy_duration: 5 }, [imported])).toThrow("generation_duration_conflict");
    expect(() => durationControlOf([imported, numberControl(1, 20)])).toThrow("generation_duration_ambiguous");
  });
  it("removes only declared duration keys when a shot is split or merged", () => {
    expect(withoutDurationParameters({ duration: 7, comfy_duration: 7, seconds: 9, seed: 41 })).toEqual({ seconds: 9, seed: 41 });
  });
});
