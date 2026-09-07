// 审批预检的判据（方案 §1.1 档位与硬清单 · §1.2 状态机的三条分叉）。
//
// 这些断言**不起 lane**：预检是纯函数，它红的时候必须能一眼看出是判据错了，
// 而不是「pi 那边今天不一样了」。等待、abort、恢复那一半在
// `tests/agent-runtime/lane-approval-gate.test.mts`。
import { describe, expect, it } from "vitest";

import { laneApprovalGrantable, preflightLaneApproval, type LaneApprovalSubject } from "./laneApproval";
import type { ProjectAgentApprovalPolicy } from "../projectAgentContracts";

const READ: LaneApprovalSubject = {
  toolName: "nomi_canvas_read", capabilityId: "canvas.read",
  effect: "read", effectClass: "reversible_local", requiresPlanReview: false, destructiveHint: false,
};
const WRITE: LaneApprovalSubject = {
  toolName: "nomi_canvas_write", capabilityId: "canvas.write",
  effect: "reversible_write", effectClass: "reversible_local", requiresPlanReview: false, destructiveHint: false,
};
const PLAN: LaneApprovalSubject = { ...WRITE, toolName: "nomi_timeline_write", capabilityId: "timeline.write", requiresPlanReview: true };
const PAID: LaneApprovalSubject = {
  toolName: "nomi_start_generation", capabilityId: "generation.gate",
  effect: "paid", effectClass: "spend", requiresPlanReview: false, destructiveHint: false,
};
const DESTRUCTIVE: LaneApprovalSubject = {
  toolName: "nomi_canvas_delete", capabilityId: "canvas.delete",
  effect: "destructive", effectClass: "irreversible", requiresPlanReview: false, destructiveHint: false,
};
const UNKNOWN: LaneApprovalSubject = {
  toolName: "some_external_tool", capabilityId: "unknown:some_external_tool",
  effect: undefined, effectClass: undefined, requiresPlanReview: false, destructiveHint: false,
};

const SAFE_AUTO: ProjectAgentApprovalPolicy = { mode: "safe-auto", spend: "confirm" };
const STEP: ProjectAgentApprovalPolicy = { mode: "step", spend: "confirm" };
const PROJECT: ProjectAgentApprovalPolicy = { mode: "project", spend: "confirm" };

function preflight(
  subject: LaneApprovalSubject,
  overrides: Partial<Parameters<typeof preflightLaneApproval>[1]> = {},
) {
  return preflightLaneApproval(subject, {
    policy: SAFE_AUTO, workMode: "agent", hasUserInterface: true, sessionGrants: new Set<string>(),
    ...overrides,
  });
}

describe("档位", () => {
  it("safe-auto 放行本地可撤销的改动，不弹卡", () => {
    expect(preflight(WRITE).state).toBe("auto-granted");
    expect(preflight(READ).state).toBe("auto-granted");
  });

  it("step 档每一步都问——连读也问，那正是「每步问」这三个字的意思", () => {
    expect(preflight(WRITE, { policy: STEP }).state).toBe("awaiting-user");
    expect(preflight(READ, { policy: STEP }).state).toBe("awaiting-user");
  });

  it("project 档连需要先读一遍计划的能力也放行", () => {
    expect(preflight(PLAN, { policy: PROJECT }).state).toBe("auto-granted");
  });

  it("safe-auto 下 requiresPlanReview 的能力首次必弹，答过之后才复用", () => {
    expect(preflight(PLAN).state).toBe("awaiting-user");
    expect(preflight(PLAN, { sessionGrants: new Set(["timeline.write"]) }).state).toBe("auto-granted");
  });
});

describe("硬清单：档位管不着的那一族", () => {
  it.each([
    ["花钱", PAID],
    ["不可逆", DESTRUCTIVE],
    ["解不出效果类的（fail-closed）", UNKNOWN],
  ])("%s 在每一档下都逐次问，包括全自动", (_label, subject) => {
    for (const policy of [SAFE_AUTO, STEP, PROJECT]) {
      expect(preflight(subject, { policy }).state).toBe("awaiting-user");
    }
  });

  it("这一族拿不到「本会话允许这类」的按钮，答过一次也不会被复用", () => {
    for (const subject of [PAID, DESTRUCTIVE, UNKNOWN]) {
      expect(laneApprovalGrantable(subject, SAFE_AUTO)).toBe(false);
      expect(preflight(subject, { sessionGrants: new Set([subject.capabilityId]) }).state).toBe("awaiting-user");
    }
  });

  it("MCP 的 destructiveHint 只能抬高摩擦：true 抬进硬闸，false 不给任何人减一次确认", () => {
    expect(preflight({ ...WRITE, destructiveHint: true }).state).toBe("awaiting-user");
    expect(laneApprovalGrantable({ ...WRITE, destructiveHint: true }, SAFE_AUTO)).toBe(false);
    // false 什么都不做——一个自称无害的外部工具不会因此绕开它本来的那一档。
    expect(preflight({ ...PAID, destructiveHint: false }).state).toBe("awaiting-user");
  });
});

describe("工作模式先于档位", () => {
  it("ask 只放 read，写入被策略拒且带可行动的下一步", () => {
    expect(preflight(READ, { workMode: "ask" }).state).toBe("auto-granted");
    const denied = preflight(WRITE, { workMode: "ask", policy: PROJECT });
    expect(denied.state).toBe("denied-by-policy");
    if (denied.state !== "denied-by-policy") throw new Error("unreachable");
    expect(denied.reason).toMatch(/read-only/i);
    // 可行动 = 模型读完知道下一步做什么，而不只是知道自己被拒了。
    expect(denied.reason).toMatch(/switch the work mode/i);
  });

  it("editSelection 放可撤销的改动，但拦住花钱和不可逆", () => {
    expect(preflight(WRITE, { workMode: "editSelection" }).state).toBe("auto-granted");
    expect(preflight(PAID, { workMode: "editSelection" }).state).toBe("denied-by-policy");
    expect(preflight(DESTRUCTIVE, { workMode: "editSelection" }).state).toBe("denied-by-policy");
  });
});

describe("没有人可问的时候（MCP stdio / 走查 / 后台批）", () => {
  it("要问人的一律拒，并告诉模型去哪儿才能确认——不是静默放行", () => {
    const denied = preflight(PAID, { hasUserInterface: false });
    expect(denied.state).toBe("denied-by-policy");
    if (denied.state !== "denied-by-policy") throw new Error("unreachable");
    expect(denied.reason).toMatch(/Nomi window/);
    expect(denied.reason).toMatch(/Do not retry/);
  });

  it("本来就不用问的还是照跑：没人可问不是「什么都不许做」", () => {
    expect(preflight(WRITE, { hasUserInterface: false }).state).toBe("auto-granted");
    expect(preflight(READ, { hasUserInterface: false }).state).toBe("auto-granted");
  });
});

describe("「本会话允许这类」的门槛", () => {
  it("只有本地可撤销的改动有这个按钮，step 档下谁都没有", () => {
    expect(laneApprovalGrantable(PLAN, SAFE_AUTO)).toBe(true);
    // step 的字面意思就是每一步都问；给它一个会话级放行等于把用户刚选的档位偷偷改掉。
    expect(laneApprovalGrantable(PLAN, STEP)).toBe(false);
    expect(laneApprovalGrantable(WRITE, STEP)).toBe(false);
  });
});
