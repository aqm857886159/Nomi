import { describe, expect, it } from "vitest";

import {
  PROJECT_AGENT_APPROVAL_MODES,
  capabilityIsHardGated,
  capabilityMayReuseSafeApproval,
  spendDecidedByPolicy,
  type CapabilityApprovalSubject,
} from "./capabilityApprovalPolicy";

// 2026-09-11 P1 · 权限三档收敛之后要守住的那条：**模型永远不能自己发起一次付费调用**。
//
// ⚠️ 这句话 2026-09-12 之前写的是「『全自动』不等于自动花钱」。那句话把两个面说成了一个，
// 而它们的答案今天不同（用户拍板）：
//
//   · **模型面**（本文件下半部量的 `capabilityIsHardGated` / `capabilityMayReuseSafeApproval`）——
//     花钱、不可逆、外部 destructiveHint、解不出效果类这四族**独立于档位**，任何一档都要
//     当次点头，付费能力压根不投影进模型的工具表。这条一个字没改。
//   · **宿主面**（`spendDecidedByPolicy`）——草稿已经建好、闸已经在那里了，接下来是弹一张
//     报价卡等用户点，还是由他此前亲手切进的「全自动」代答。只有「全自动」代答。
//
// 两个面在这一个文件里各有自己的一组，正是为了让「哪一面变了」永远看得见。

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

/**
 * 宿主面那一半：「这一笔付费，宿主自己决定还是先问用户？」（2026-09-12 用户拍板）
 *
 * 三档逐个核对——只测「全自动能跑」不够：这一改真正的风险是它顺手把另外两档也放行了。
 */
describe("宿主面：哪一档的付费由策略代答", () => {
  it("只有「全自动」代答；每步问 / 自动改一个字没变", () => {
    expect(spendDecidedByPolicy({ mode: "project", spend: "confirm" })).toBe(true);
    expect(spendDecidedByPolicy({ mode: "safe-auto", spend: "confirm" })).toBe(false);
    expect(spendDecidedByPolicy({ mode: "step", spend: "confirm" })).toBe(false);
  });

  it("读不到档位 → 按默认档（自动改）走，也就是照旧弹卡：不知道就不许替用户花钱", () => {
    expect(spendDecidedByPolicy(undefined)).toBe(false);
  });

  it("判据挂在 `mode` 上，不挂在 `spend` 上——那根轴没有预算撑着（硬预算上限 2026-09-10 已删）", () => {
    // 两个方向都量：within-budget 既不能把非全自动档变成代答，也不能把全自动档变回逐笔问。
    expect(spendDecidedByPolicy({ mode: "safe-auto", spend: "within-budget" })).toBe(false);
    expect(spendDecidedByPolicy({ mode: "step", spend: "within-budget" })).toBe(false);
    expect(spendDecidedByPolicy({ mode: "project", spend: "within-budget" })).toBe(true);
  });

  it("模型面不受影响：同一档下，付费能力仍然是任何档位都不自动批的硬闸", () => {
    expect(spendDecidedByPolicy({ mode: "project", spend: "confirm" })).toBe(true);
    expect(capabilityIsHardGated(subject())).toBe(true);
    expect(capabilityMayReuseSafeApproval({ mode: "project", spend: "confirm" }, subject(), true)).toBe(false);
  });
});

/**
 * `hostMustConfirm`：受信宿主说「这一次必须当次确认」（沙箱逃逸档的 shell 命令）。
 *
 * 它替换掉的是 `laneApprovalGate` 里那条 `forceConfirmation ? { mode: 'step', spend: 'confirm' } : policy`
 * ——一个调用点伪造一份用户从没选过的档位。这一组量的正是「事实归事实、档位归档位」：
 * 摩擦照抬，而档位本身谁也改不动。
 */
describe("hostMustConfirm 只抬不降，且不伪造档位", () => {
  const reversible = (overrides: Partial<CapabilityApprovalSubject> = {}): CapabilityApprovalSubject =>
    subject({ effect: "reversible_write", effectClass: "reversible_local", ...overrides });

  it("抬：本来在「自动改」「全自动」下免问的可撤销改动，被它拦成逐次确认", () => {
    for (const mode of ["safe-auto", "project"] as const) {
      expect(capabilityMayReuseSafeApproval({ mode, spend: "confirm" }, reversible(), false)).toBe(true);
      expect(capabilityMayReuseSafeApproval({ mode, spend: "confirm" }, reversible({ hostMustConfirm: true }), false)).toBe(false);
    }
  });

  it("不降：`false`/缺席什么都不做——一个说自己无害的调用不会因此少问一次", () => {
    expect(capabilityMayReuseSafeApproval({ mode: "step", spend: "confirm" }, reversible({ hostMustConfirm: false }), true)).toBe(false);
    expect(capabilityMayReuseSafeApproval({ mode: "step", spend: "confirm" }, subject({ hostMustConfirm: false }), true)).toBe(false);
    // 付费仍是硬闸：宿主说「不必确认」这种话根本没有表达方式。
    expect(capabilityMayReuseSafeApproval({ mode: "project", spend: "confirm" }, subject({ hostMustConfirm: false }), true)).toBe(false);
  });

  it("用户自己答过的「这类以后别问」仍然算数——它夺走的是「不问就放行」，不是那个按钮", () => {
    const escaped = reversible({ hostMustConfirm: true });
    expect(capabilityMayReuseSafeApproval({ mode: "safe-auto", spend: "confirm" }, escaped, false)).toBe(false);
    expect(capabilityMayReuseSafeApproval({ mode: "safe-auto", spend: "confirm" }, escaped, true)).toBe(true);
  });

  it("它不是硬闸的一员：硬闸连「以后别问」的按钮都不给，逃逸命令要留着那个按钮", () => {
    expect(capabilityIsHardGated(reversible({ hostMustConfirm: true }))).toBe(false);
    expect(capabilityIsHardGated(subject())).toBe(true);
  });
});
