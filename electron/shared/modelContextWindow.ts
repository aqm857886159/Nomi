import { officialModelContextWindow } from "./modelContextWindowCatalog";

/**
 * 模型上下文窗口：**一个** owner。
 *
 * 这个数字在目录里住在 `model.meta.contextWindow`（`meta` 是 `unknown`，谁读谁自己校验）。
 * 在这之前只有 `electron/ai/agentChatV2.ts` 在读它，读法是内联的三段式判断；渲染层
 * `src/` 下 `contextWindow` 零命中——所以 Agent 面板头上那个上下文环没有 `max` 可用，
 * 现役面板只好印一句写死的「还能聊 ~40 轮」（`40 - sessionTurns`，一个常数减法）。
 *
 * 把校验收在这里，两个调用方（主进程的模型配置、模型目录 DTO 的投影）读同一份规则：
 * 有效就给数，无效或没有就问那张一手文档表（`modelContextWindowCatalog.ts`），
 * 两处都没有就给 `undefined`。**不给默认值**——一个编出来的 200K 会让环
 * 画出一个用户没法核对的百分比，而 `undefined` 至少诚实地说「不知道」。
 * （运行时自己的兜底 `contextWindow ?? 128_000` 留在 pi 侧，那是「请求要带个数」，
 * 不是「告诉用户这个模型有多大」，两件事不共用一个值。）
 */
export function modelContextWindow(meta: unknown, modelKey?: string): number | undefined {
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const value = (meta as Record<string, unknown>).contextWindow;
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  }
  // 供应商没报 → 问一手文档抄下来的那张表（`modelContextWindowCatalog.ts`）。
  // 2026-09-06 实测：用户真实目录里 21 个对话模型的 `meta.contextWindow` **一个都没有**，
  // 所以在这之前上下文环恒为空圈。表里查不到的仍然是 `undefined`——那张表宁可写 unknown
  // 也不编，理由写在它的文件头。
  return officialModelContextWindow(modelKey);
}
