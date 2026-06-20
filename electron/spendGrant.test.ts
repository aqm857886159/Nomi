import { describe, it, expect, beforeEach } from "vitest";
import {
  mintSpendGrant,
  assertAndConsumeSpendGrant,
  SpendNotAuthorizedError,
  GENERIC_NODE_KEY,
  __resetSpendGrantsForTests,
  __spendGrantCountForTests,
} from "./spendGrant";

describe("spendGrant 付费守卫令牌", () => {
  beforeEach(() => __resetSpendGrantsForTests());

  it("无令牌 → 拦截（AI 不小心触发生成的真实威胁）", () => {
    expect(() => assertAndConsumeSpendGrant(undefined, "n1")).toThrow(SpendNotAuthorizedError);
    expect(() => assertAndConsumeSpendGrant("", "n1")).toThrow(SpendNotAuthorizedError);
  });

  it("伪造/未知 grantId → 拦截", () => {
    mintSpendGrant({ nodeIds: ["n1"] });
    expect(() => assertAndConsumeSpendGrant("not-a-real-grant", "n1")).toThrow(SpendNotAuthorizedError);
  });

  it("grantId 不可猜：是 uuid 形态", () => {
    const id = mintSpendGrant({ nodeIds: ["n1"] });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("授权的节点放行，未授权节点拦截（防借 A 令牌生成 B）", () => {
    const id = mintSpendGrant({ nodeIds: ["A", "B"], maxAttemptsPerNode: 1 });
    expect(() => assertAndConsumeSpendGrant(id, "A")).not.toThrow();
    expect(() => assertAndConsumeSpendGrant(id, "C")).toThrow(SpendNotAuthorizedError);
  });

  it("每节点重试预算：用尽即拦（首发+重试共享 maxAttempts）", () => {
    const id = mintSpendGrant({ nodeIds: ["A"], maxAttemptsPerNode: 3 });
    assertAndConsumeSpendGrant(id, "A"); // 首发
    assertAndConsumeSpendGrant(id, "A"); // 重试1
    assertAndConsumeSpendGrant(id, "A"); // 重试2
    expect(() => assertAndConsumeSpendGrant(id, "A")).toThrow(SpendNotAuthorizedError); // 第4次超预算
  });

  it("预算耗尽后令牌即焚（无残留可复用）", () => {
    const id = mintSpendGrant({ nodeIds: ["A"], maxAttemptsPerNode: 1 });
    assertAndConsumeSpendGrant(id, "A");
    expect(__spendGrantCountForTests()).toBe(0);
    expect(() => assertAndConsumeSpendGrant(id, "A")).toThrow(SpendNotAuthorizedError);
  });

  it("过期令牌 → 拦截并清除", () => {
    const id = mintSpendGrant({ nodeIds: ["A"], ttlMs: 0 });
    expect(() => assertAndConsumeSpendGrant(id, "A")).toThrow(/过期/);
    expect(__spendGrantCountForTests()).toBe(0);
  });

  it("非节点付费（onboarding/调试）走占位 key", () => {
    const id = mintSpendGrant({ nodeIds: [], maxAttemptsPerNode: 1 });
    expect(() => assertAndConsumeSpendGrant(id, GENERIC_NODE_KEY)).not.toThrow();
    expect(() => assertAndConsumeSpendGrant(id, GENERIC_NODE_KEY)).toThrow(SpendNotAuthorizedError);
  });

  it("多节点：各自独立预算，互不串用", () => {
    const id = mintSpendGrant({ nodeIds: ["A", "B"], maxAttemptsPerNode: 1 });
    assertAndConsumeSpendGrant(id, "A");
    // A 用尽，B 仍可用
    expect(() => assertAndConsumeSpendGrant(id, "A")).toThrow(SpendNotAuthorizedError);
    expect(() => assertAndConsumeSpendGrant(id, "B")).not.toThrow();
  });
});
