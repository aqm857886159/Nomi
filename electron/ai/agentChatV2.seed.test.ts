import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => process.cwd() } }));

import { bubblesToSeedTurns } from "./agentChatV2";

describe("bubblesToSeedTurns — 续聊重建规范化", () => {
  it("tool 气泡折成 assistant 旁注(让模型记起做过的操作),不再整条丢弃", () => {
    const turns = bubblesToSeedTurns([
      { role: "user", content: "拆 3 个镜头" },
      { role: "assistant", content: "好的，我来拆" },
      { role: "tool", content: "✓ 已应用：创建 3 个节点 + 2 条边\n更多细节略" },
      { role: "user", content: "再加一个空镜头" },
      { role: "assistant", content: "已加" },
    ]);
    const joined = turns.map((t) => `${t.role}:${String(t.content)}`).join(" | ");
    expect(joined).toContain("已执行操作：✓ 已应用：创建 3 个节点 + 2 条边"); // 操作摘要进了上下文
    expect(joined).not.toContain("更多细节略"); // 只取首行、截断
    expect(turns[0].role).toBe("user");
    expect(turns[turns.length - 1].role).toBe("assistant"); // 严格交替:末条 assistant
  });

  it("首条 assistant/tool 剥除、末条 user 剥除(满足严格交替)", () => {
    const turns = bubblesToSeedTurns([
      { role: "tool", content: "leading op" }, // 折进 assistant 侧 → 作首条被剥
      { role: "user", content: "hi" },
      { role: "assistant", content: "yo" },
      { role: "user", content: "trailing" }, // 末条 user → 被剥
    ]);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("空 / 无有效角色 → 空数组", () => {
    expect(bubblesToSeedTurns([])).toEqual([]);
    expect(bubblesToSeedTurns([{ role: "system", content: "x" }])).toEqual([]);
  });
});
