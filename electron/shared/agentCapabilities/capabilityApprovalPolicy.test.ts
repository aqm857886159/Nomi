import { describe, expect, it } from "vitest";

import {
  PROJECT_AGENT_APPROVAL_MODES,
  capabilityIsHardGated,
  capabilityMayReuseSafeApproval,
  type CapabilityApprovalSubject,
} from "./capabilityApprovalPolicy";

// 2026-09-11 P1 · 权限三档收敛之后要守住的那条：**「全自动」不等于自动花钱**。
//
// 三档说的是「可撤销的改动问不问」；花钱、不可逆、外部 destructiveHint、解不出效果类这四族
// 独立于档位，任何一档都逐次问。这一组按档位逐个核对，而不是靠人读那段注释。

function subject(overrides: Partial<CapabilityApprovalSubject> = {}): CapabilityApprovalSubject {
  return {
    effect: "paid",
    effectClass: "spend",
    requiresPlanReview: false,
    destructiveHint: false,
    ...overrides,
  };
}

describe("硬清单独立于档位", () => {
  it("花钱在每一档都是硬闸——「全自动」也不例外", () => {
    for (const mode of PROJECT_AGENT_APPROVAL_MODES) {
      expect(capabilityIsHardGated(subject())).toBe(true);
      expect(capabilityMayReuseSafeApproval({ mode, spend: "confirm" }, subject(), true)).toBe(false);
      // 就算某条旧记录把 spend 轴写成了 within-budget（它已经不该被写出来），钱这条也不放行。
      expect(capabilityMayReuseSafeApproval({ mode, spend: "within-budget" }, subject(), true)).toBe(false);
    }
  });

  it("不可逆 / 外部 destructiveHint / 解不出效果类：同上", () => {
    for (const mode of PROJECT_AGENT_APPROVAL_MODES) {
      const policy = { mode, spend: "confirm" } as const;
      expect(capabilityMayReuseSafeApproval(policy, subject({ effect: "destructive", effectClass: "irreversible" }), true)).toBe(false);
      expect(capabilityMayReuseSafeApproval(policy, subject({ effect: "reversible_write", effectClass: "reversible_local", destructiveHint: true }), true)).toBe(false);
      expect(capabilityMayReuseSafeApproval(policy, subject({ effect: undefined, effectClass: undefined }), true)).toBe(false);
    }
  });

  // 阳性对照：这把尺子量得出「放行」，否则上面每一条都会因为它恒为 false 而无意义。
  it("可撤销的本地改动在「自动改」「全自动」下才真的免问，`step` 仍然每次问", () => {
    const reversible = subject({ effect: "reversible_write", effectClass: "reversible_local" });
    expect(capabilityMayReuseSafeApproval({ mode: "step", spend: "confirm" }, reversible, true)).toBe(false);
    expect(capabilityMayReuseSafeApproval({ mode: "safe-auto", spend: "confirm" }, reversible, true)).toBe(true);
    expect(capabilityMayReuseSafeApproval({ mode: "project", spend: "confirm" }, reversible, true)).toBe(true);
  });

  /**
   * 2026-09-11 用户拍板的时序：**一张付费卡正等着的时候用户切了档，卡仍然必须等人答。**
   *
   * 这条在结构上由两件事保证，两件都在这里量：① 判据只看能力契约上的事实，不看策略——
   * 同一个 subject 换任何档位得到的都是同一个答案；② 那个答案是「硬闸」。
   * 换句话说：档位根本没有一条通路能把一张已经在等的付费卡变成「不用问了」。
   */
  it("等待中的付费卡不因切档而被放行（判据与档位正交）", () => {
    const paid = subject();
    const answers = PROJECT_AGENT_APPROVAL_MODES.map((mode) => capabilityMayReuseSafeApproval({ mode, spend: "confirm" }, paid, true));
    expect(new Set(answers)).toEqual(new Set([false]));
    expect(capabilityIsHardGated(paid)).toBe(true);
  });
});
