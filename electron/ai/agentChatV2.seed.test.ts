import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => process.cwd() } }));

import { bubblesToSeedTurns, selectTextModelCandidates } from "./agentChatV2";
import type { CatalogState } from "../catalog/types";

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

describe("selectTextModelCandidates — 助手模型完整身份路由", () => {
  it("同名模型优先命中用户选中的供应商，而不是按目录顺序换家", () => {
    const state = {
      version: 8,
      vendors: [
        { key: "relay-a", name: "Relay A", enabled: true, authType: "bearer", createdAt: "", updatedAt: "" },
        { key: "relay-b", name: "Relay B", enabled: true, authType: "bearer", createdAt: "", updatedAt: "" },
      ],
      models: [
        { modelKey: "gpt-5.2", vendorKey: "relay-a", labelZh: "GPT 5.2 A", kind: "text", enabled: true, createdAt: "", updatedAt: "" },
        { modelKey: "gpt-5.2", vendorKey: "relay-b", labelZh: "GPT 5.2 B", kind: "text", enabled: true, createdAt: "", updatedAt: "" },
      ],
      mappings: [],
      apiKeysByVendor: {},
    } satisfies CatalogState;

    const candidates = selectTextModelCandidates(state, { vendorKey: "relay-b", modelKey: "gpt-5.2" });
    expect(candidates[0]).toMatchObject({ vendor: { key: "relay-b" }, model: { vendorKey: "relay-b", modelKey: "gpt-5.2" } });
  });

  it("提示词增强专用文本模型不能进入通用 Agent 路由", () => {
    const state = {
      version: 8,
      vendors: [{ key: "relay", name: "Relay", enabled: true, authType: "none", createdAt: "", updatedAt: "" }],
      models: [
        { modelKey: "prompt-refiner", vendorKey: "relay", labelZh: "Prompt Refiner", kind: "text", enabled: true, meta: { promptRefineOnly: true }, createdAt: "", updatedAt: "" },
        { modelKey: "chat-model", vendorKey: "relay", labelZh: "Chat Model", kind: "text", enabled: true, createdAt: "", updatedAt: "" },
      ],
      mappings: [],
      apiKeysByVendor: {},
    } satisfies CatalogState;

    expect(selectTextModelCandidates(state).map(({ model }) => model.modelKey)).toEqual(["chat-model"]);
  });
});
