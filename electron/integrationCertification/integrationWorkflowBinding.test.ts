import { describe, expect, it } from "vitest";
import { sanitizeWorkflowEnumOptions } from "./integrationWorkflowBinding";

describe("sanitizeWorkflowEnumOptions（接入认证会话的 enumOptions 入站净化）", () => {
  it("combo 选项按 wire 原类型放行：字符串 / 数字 / 布尔（CreateVideo.bit_depth、easy hiresFix 那类）", () => {
    expect(sanitizeWorkflowEnumOptions([
      { classType: "CreateVideo", inputKey: "bit_depth", options: ["auto", 8, 10] },
      { classType: "easy hiresFix", inputKey: "rescale_after_model", options: [false, true] },
    ])).toEqual([
      { classType: "CreateVideo", inputKey: "bit_depth", options: ["auto", 8, 10] },
      { classType: "easy hiresFix", inputKey: "rescale_after_model", options: [false, true] },
    ]);
  });

  it("非标量选项（对象 / NaN / 空串）整份拒收，不静默改写", () => {
    expect(() => sanitizeWorkflowEnumOptions([{ classType: "X", inputKey: "k", options: [{ bad: true }] }])).toThrow(/enum value/);
    expect(() => sanitizeWorkflowEnumOptions([{ classType: "X", inputKey: "k", options: [Number.NaN] }])).toThrow(/enum value/);
    expect(() => sanitizeWorkflowEnumOptions([{ classType: "X", inputKey: "k", options: [""] }])).toThrow(/enum value/);
  });
});
