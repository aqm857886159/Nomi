/**
 * P1·taskCache 把「被 LRU/TTL 驱逐」与「从不存在」混为一谈的回归。
 *
 * 旧实现：fetchTaskResult 在 taskCache miss 时一律返回 status=failed +
 * 「Local task is not in the pending cache.」——把两种语义完全不同的情况压成一句：
 *   ① 这个 taskId 从来没进过 pending cache（真·未知 id / 调错了）；
 *   ② 它**曾经**在 pending cache、还在轮询途中被 LRU(>200) 或 TTL 驱逐——
 *      此时 vendor 侧很可能已成功，本地却误报「失败」，用户白等且无从诊断。
 *
 * 根治：runtime 维护一个「曾受理 taskId」的有界账本（比工作缓存更耐久），miss 时据此
 * 给出**两种可诊断的不同错误**：未知 id vs 本地追踪丢失（可能已在供应商侧完成→去查/重试）。
 * 分类逻辑抽成纯函数 classifyTaskCacheMiss 便于单测。
 */
import { describe, it, expect } from "vitest";
import { classifyTaskCacheMiss, isLocalQueryBlockedRaw } from "./tasks/taskAdmission";

describe("isLocalQueryBlockedRaw：本机查不了的判别，供应商的响应不能冒充", () => {
  it("三种码都是本机查不了", () => {
    expect(isLocalQueryBlockedRaw(classifyTaskCacheMiss("t", false).raw)).toBe(true);
    expect(isLocalQueryBlockedRaw(classifyTaskCacheMiss("t", true).raw)).toBe(true);
    expect(isLocalQueryBlockedRaw({ code: "model_unresolvable", taskId: "t" })).toBe(true);
  });

  it("供应商响应里碰巧有个 code 字段不算；别的码、空值也不算", () => {
    for (const raw of [{ code: "task_unknown" }, { code: "model_unresolvable", id: "t" }, { code: "failed", taskId: "t" }, {}, null, undefined, "task_unknown"]) {
      expect(isLocalQueryBlockedRaw(raw), JSON.stringify(raw)).toBe(false);
    }
  });
});

describe("classifyTaskCacheMiss — 两种 miss 给可诊断的不同错误", () => {
  it("从未受理过的 taskId → failed，错误明确指向「未知/不存在」", () => {
    const out = classifyTaskCacheMiss("bogus-id", false);
    expect(out.status).toBe("failed");
    expect((out.raw as { code?: string }).code).toBe("task_unknown");
    // 人话原因落在一等字段 error（与 vendor 终态失败同一出口，渲染层只读这一处）。
    expect(out.error).toMatch(/未知|不存在|unknown/i);
  });

  it("曾受理但已被驱逐/过期的 taskId → failed，但与「未知」是不同的可诊断错误", () => {
    const out = classifyTaskCacheMiss("evicted-id", true);
    expect(out.status).toBe("failed");
    // 关键：code 与「未知」不同，渲染层/用户能区分两种 miss。
    expect((out.raw as { code?: string }).code).toBe("task_tracking_lost");
    expect(isLocalQueryBlockedRaw(out.raw)).toBe(true);
    // 提示「可能已在供应商侧完成」，引导去查/重试，而不是当作彻底失败。
    expect(out.error).toMatch(/追踪|供应商|completed|tracking|重试|retry/i);
  });

  it("两种 miss 的原因文案彼此不同（不再压成同一句）", () => {
    expect(classifyTaskCacheMiss("a", false).error).not.toBe(classifyTaskCacheMiss("a", true).error);
  });
});
