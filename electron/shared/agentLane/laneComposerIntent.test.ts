// 三态映射（方案 §1.3 那张表）。判据是纯函数，所以它能被逐条钉死——
// 而这三行决定的是「用户那句话会不会花一次模型请求」「一张卡会不会继续等下去」，
// 散进 composer 组件就只能靠截图证明，而截图证不了这个。
import { describe, expect, it } from "vitest";

import { laneComposerIntent, laneComposerState } from "./laneComposerIntent";
import type { LanePendingApproval, LaneProjection } from "./laneContracts";

const PENDING: LanePendingApproval = {
  toolCallId: "call-9", toolName: "append_to_end", args: { content: "…" },
  effectClass: "reversible_local", grantable: true, pendingCount: 1,
};

const projection = (overrides: Partial<LaneProjection> = {}): LaneProjection => ({
  lane: "main", parts: [], running: false, queues: [],
  usage: {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
    cost: { state: "unknown", reason: "no-settled-turn" },
    contextTokens: { state: "unknown", reason: "no-settled-turn" },
    reasoningTokens: { state: "unknown", reason: "no-settled-turn" },
  },
  thinking: { supportedLevels: ["off"], level: "off", canTurnOff: true },
  ...overrides,
});

describe("laneComposerIntent", () => {
  it("有卡在等：先记录 steer，宿主解除审批；次级手势才 follow-up", () => {
    // 这是整张表的重点。今天的系统把它排进队列：卡还在那儿等着，模型直到用户再点一次
    // 「不要」才知道他想说什么——用户的体感是「我说了它没听见」。
    const intent = laneComposerIntent(projection({ running: true, pending: PENDING }), "不对，横屏");
    expect(intent.state).toBe("awaiting-approval");
    expect(intent.primary.command).toEqual({
      kind: "steer", text: "不对，横屏",
    });
    // 显式次选等整轮结束，审批卡仍然在等。
    expect(intent.secondary?.command).toEqual({ kind: "follow-up", text: "不对，横屏" });
  });

  it("在跑、没卡：默认 steer（等这一步做完就听我的），次选 followUp", () => {
    const intent = laneComposerIntent(projection({ running: true }), "横屏");
    expect(intent.state).toBe("running");
    expect(intent.primary.command).toEqual({ kind: "steer", text: "横屏" });
    expect(intent.secondary?.command).toEqual({ kind: "follow-up", text: "横屏" });
  });

  it("空闲：新一轮，没有次选——「发一句话」没有第二种读法", () => {
    const intent = laneComposerIntent(projection(), "横屏");
    expect(intent.state).toBe("idle");
    expect(intent.primary.command).toEqual({ kind: "prompt", text: "横屏" });
    expect(intent.secondary).toBeUndefined();
  });

  it("等人的卡盖过「在跑」：pending 时 running 也是 true，顺序不能反过来判", () => {
    expect(laneComposerState(projection({ running: true, pending: PENDING }))).toBe("awaiting-approval");
    expect(laneComposerState(projection({ running: true }))).toBe("running");
    expect(laneComposerState(projection())).toBe("idle");
  });

  it("那句话一字不改地穿过去：不加前缀、不加引号、不加「用户说：」", () => {
    // 等待期也记录为原始用户消息。替用户改口 = 模型按一句他没说过的话重新规划。
    const raw = '  "横屏"，别竖着  ';
    expect(laneComposerIntent(projection({ running: true, pending: PENDING }), raw).primary.command)
      .toMatchObject({ text: raw });
    expect(laneComposerIntent(projection({ running: true }), raw).primary.command).toMatchObject({ text: raw });
  });
});

// 「等你确认」只有一种表示（2026-10-05）：付费卡也在投影里，等它时输入框不再答「在跑」。
describe("付费卡在投影里：等它时也是「等你确认」", () => {
  const SPEND = { surface: "ready", rows: [{ operationId: "op-1" }] } as never;

  it("回合在跑、项目里有一笔钱在等点头 → awaiting-approval；回车照旧是 steer（宿主把这句话递给那张卡）", () => {
    const intent = laneComposerIntent(projection({ running: true }), "第二镜改短点", SPEND);
    expect(intent.state).toBe("awaiting-approval");
    expect(intent.primary.command).toEqual({ kind: "steer", text: "第二镜改短点" });
  });

  it("没有回合在等它（全自动代答失败留下的卡）→ 仍是空闲：打字开新一轮，不当成对那张卡的回答", () => {
    const intent = laneComposerIntent(projection({ running: false }), "再来一张", SPEND);
    expect(intent.state).toBe("idle");
    expect(intent.primary.command).toEqual({ kind: "prompt", text: "再来一张" });
  });

  it("没有卡 / 读不到 / 没装 → 照旧按在跑判", () => {
    for (const spend of [undefined, { surface: "ready", rows: [] }, { surface: "unreadable", reason: "projection-failed" }, { surface: "off", phase: "starting" }] as const) {
      expect(laneComposerState(projection({ running: true }), spend)).toBe("running");
    }
  });
});
