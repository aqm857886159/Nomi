import { describe, expect, it } from "vitest";
import { resolveManualSaveAction } from "./onboardingSaveGate";

describe("resolveManualSaveAction（manual 接入保存门槛 · 非阻断 + 二次确认）", () => {
  it("必填项未齐 → disabled（无论测试态/armed）", () => {
    expect(
      resolveManualSaveAction({ fieldsReady: false, testPassed: false, forceArmed: false }),
    ).toBe("disabled");
    expect(
      resolveManualSaveAction({ fieldsReady: false, testPassed: true, forceArmed: true }),
    ).toBe("disabled");
  });

  it("测试已通过 → 直接保存（不需二次确认）", () => {
    expect(
      resolveManualSaveAction({ fieldsReady: true, testPassed: true, forceArmed: false }),
    ).toBe("save");
  });

  it("未测/失败、首次点击 → arm（进入二次确认，不提交）", () => {
    expect(
      resolveManualSaveAction({ fieldsReady: true, testPassed: false, forceArmed: false }),
    ).toBe("arm");
  });

  it("未测/失败、已 armed、再次点击 → confirm（强行保存）", () => {
    expect(
      resolveManualSaveAction({ fieldsReady: true, testPassed: false, forceArmed: true }),
    ).toBe("confirm");
  });

  it("非阻断不变量：字段齐时永不因「没测过」返回 disabled（早期 bug：testState!=='ok' 死拦）", () => {
    for (const forceArmed of [false, true]) {
      expect(
        resolveManualSaveAction({ fieldsReady: true, testPassed: false, forceArmed }),
      ).not.toBe("disabled");
    }
  });
});
