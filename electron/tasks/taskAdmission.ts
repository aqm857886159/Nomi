import { TtlLruCache } from "./taskCache";
import type { JsonRecord } from "../jsonUtils";
import { desktopT } from "../i18n";

// 「曾受理 taskId」账本（修 P1·把驱逐误当从不存在）。只存 id 字符串（极轻），故容量更大、
// 存活更久：高并发(>200)把仍在轮询的条目从工作缓存 LRU 驱逐后，这里仍记得它「曾被受理」，
// 让 fetchTaskResult 的 miss 能区分「未知 id」与「本地追踪丢失（vendor 侧可能已成功）」。
// 从 runtime.ts 拆出（巨壳门岗·只减不增）：账本与诊断是独立关注点，runtime 只调本模块。
const admittedTaskIds = new TtlLruCache<true>({ maxEntries: 5000, ttlMs: 24 * 60 * 60 * 1000 });

/** 记一笔「该异步任务已受理」。runtime.admitTask 在写工作缓存的同时调它（单一入口防漏记）。 */
export function markTaskAdmitted(id: string): void {
  if (id) admittedTaskIds.set(id, true);
}

/** 该 taskId 是否曾被受理（即便其工作缓存条目已被驱逐/过期）。 */
export function wasTaskAdmitted(id: string): boolean {
  return admittedTaskIds.get(id) != null;
}

/**
 * 纯函数：taskCache miss 时按「是否曾受理」产出两种**可诊断**的失败结果（不再压成一句）。
 * - 未曾受理(wasAdmitted=false) → task_unknown：真·未知 id（调错/不存在）。
 * - 曾受理但已被驱逐/过期(wasAdmitted=true) → task_tracking_lost：本地追踪丢失，
 *   vendor 侧可能已完成 —— 引导去查/重试，而不是当作彻底失败。
 * 原因落在一等字段 error（与 vendor 终态失败同一个出口，渲染层只读这一处）。
 */
export function classifyTaskCacheMiss(
  taskId: string,
  wasAdmitted: boolean,
): { status: "failed"; error: string; raw: JsonRecord } {
  const code = wasAdmitted ? "task_tracking_lost" : "task_unknown";
  return {
    status: "failed",
    error: desktopT(wasAdmitted ? "tasks.trackingLost" : "tasks.unknown"),
    raw: { code, taskId },
  };
}

/** `classifyTaskCacheMiss` 产出的 raw 形状判别：查询方（如 `nomi_read target=task`）据此区分「真结果」与「没得查」。 */
export function isTaskCacheMissRaw(raw: unknown): raw is { code: "task_unknown" | "task_tracking_lost"; taskId: string } {
  const code = (raw as { code?: unknown } | null)?.code;
  return code === "task_unknown" || code === "task_tracking_lost";
}
