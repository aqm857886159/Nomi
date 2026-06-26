// 异步任务「续查」收口（从 runtime.ts 拆出，巨壳门岗·只减不增 R12）。
// 单一真相：缓存命中与无状态重建共用同一段 query。与 runtime 是调用时（函数体内）的循环依赖——
// ESM/CJS 都按 live binding 在调用时取值，加载期不触碰，安全。
import { trim, type JsonRecord } from "../jsonUtils";
import type { Mapping, Model, ProfileKind } from "../catalog/types";
import { classifyTaskCacheMiss, wasTaskAdmitted } from "./taskAdmission";
import { traceVendorCompleted } from "../events/vendorCallTrace";
import { rememberTaskResult } from "../vendor/fingerprintCache";
import {
  type CachedTask,
  type TaskResult,
  admitTask,
  billingKindForTaskKind,
  buildProfileTaskResult,
  executeProfileOperation,
  extractAssetUrl,
  findExecutableModel,
  findTaskMapping,
  localizeTaskAsset,
  taskCache,
} from "../runtime";

/**
 * 无状态重建续查上下文（治本核心）：内存 taskCache 是 TTL 1h/上限 200/重启即空 的工作缓存，
 * 但续查其实只需 {vendor, modelKey, taskKind, taskId}——mapping/model 都是 catalog 的纯函数产物，
 * providerMeta.task_id 就是持久化的 taskId。渲染层超时找回(重启后也能)把这四个字段喂回来，
 * 据此重建一个等价 CachedTask，走与缓存命中**同一段** query。重建不了(模型没配/无 query op)→ 返回 null。
 */
function rebuildCachedTaskFromPayload(taskId: string, raw: JsonRecord): CachedTask | null {
  const vendorKey = trim(raw.vendor);
  const taskKind = trim(raw.taskKind) as ProfileKind;
  const modelKey = trim(raw.modelKey);
  if (!vendorKey || !taskKind || !modelKey) return null;
  const wantedKind = billingKindForTaskKind(taskKind);
  let model: Model;
  try {
    model = findExecutableModel(vendorKey, modelKey, wantedKind).model;
  } catch {
    return null; // 模型已不可用/未配置 → 无法重建，落回诚实诊断
  }
  const mapping = findTaskMapping(vendorKey, taskKind, modelKey);
  if (!mapping?.query) return null; // 同步模型无 query op，没法续查
  const projectId = trim(raw.projectId);
  return {
    vendor: vendorKey,
    request: { kind: taskKind, prompt: trim(raw.prompt), extras: { modelKey } },
    raw: {},
    mapping,
    model,
    providerMeta: { task_id: taskId, query_id: taskId },
    ...(projectId ? { projectId } : {}),
    wantedKind,
  };
}

/** 跑一次续查（缓存命中 / 无状态重建 共用单一真相）：有 query op 走 query；无则尝试 raw 里已带的资产。 */
async function executeTaskQuery(taskId: string, cached: CachedTask): Promise<{ vendor: string; result: TaskResult }> {
  const queryOperation = cached.mapping?.query;
  if (cached.mapping && queryOperation && cached.model) {
    // 不再用缓存的明文 key，轮询时按 vendor 重新派生（并重新校验 key 仍可用）。
    const { vendor, model, apiKey } = findExecutableModel(cached.vendor, cached.model.modelKey, cached.wantedKind);
    const executed = await executeProfileOperation({
      vendor,
      model,
      apiKey,
      request: cached.request,
      operation: queryOperation,
      providerMeta: {
        ...(cached.providerMeta || {}),
        query_id: cached.providerMeta?.query_id || taskId,
        task_id: cached.providerMeta?.task_id || taskId,
      },
    });
    const normalized = await buildProfileTaskResult({
      response: executed.response,
      mapping: cached.mapping,
      operation: queryOperation,
      request: cached.request,
      taskIdFallback: taskId,
      wantedKind: cached.wantedKind || model.kind,
      projectId: cached.projectId,
      nodeId: cached.nodeId,
      vendor,
      model,
    });
    if (normalized.result.status === "succeeded" || normalized.result.status === "failed") {
      // 终态才入日志(轮询 tick 不记);cache.delete 保证单次触发
      traceVendorCompleted(cached.projectId, { runId: taskId, nodeId: cached.nodeId, status: normalized.result.status, assetCount: normalized.result.assets.length });
      rememberTaskResult(cached.projectId || "", cached.fingerprint, normalized.result);
      taskCache.delete(taskId);
    } else {
      admitTask(taskId, {
        ...cached,
        raw: executed.response,
        providerMeta: {
          ...(cached.providerMeta || {}),
          ...normalized.providerMeta,
        },
      });
    }
    return { vendor: cached.vendor, result: normalized.result };
  }

  const assetUrl = extractAssetUrl(cached.raw);
  if (assetUrl) {
    const type: "image" | "video" | "model3d" = cached.wantedKind === "video" ? "video" : cached.wantedKind === "model3d" ? "model3d" : "image";
    const asset = cached.projectId
      ? await localizeTaskAsset(cached.projectId, assetUrl, type, cached.nodeId)
      : { type, url: assetUrl, thumbnailUrl: type === "image" ? assetUrl : null };
    taskCache.delete(taskId);
    const lateResult: TaskResult = { id: taskId, kind: cached.request.kind, status: "succeeded", assets: [asset], raw: cached.raw };
    rememberTaskResult(cached.projectId || "", cached.fingerprint, lateResult);
    return { vendor: cached.vendor, result: lateResult };
  }

  return {
    vendor: cached.vendor,
    result: { id: taskId, kind: cached.request.kind, status: "queued", assets: [], raw: cached.raw },
  };
}

export async function fetchTaskResult(payload: unknown): Promise<{ vendor: string; result: TaskResult }> {
  const raw = payload as JsonRecord;
  const taskId = trim(raw.taskId);
  const cached = taskCache.get(taskId);
  if (cached) return executeTaskQuery(taskId, cached);

  // 缓存 miss：先试无状态重建（重启/驱逐后仍能续查的治本点）。重建得了就走同一段 query。
  const rebuilt = rebuildCachedTaskFromPayload(taskId, raw);
  if (rebuilt) {
    try {
      return await executeTaskQuery(taskId, rebuilt);
    } catch {
      // 重建后查询失败(网络/上游) → 落回诚实诊断，别把可重试当未知 id。
    }
  }

  // 区分两种 miss：曾受理但被驱逐/过期(可能 vendor 侧已完成) vs 真·未知 id（修 P1）。
  const miss = classifyTaskCacheMiss(taskId, wasTaskAdmitted(taskId));
  return {
    vendor: trim(raw.vendor),
    result: { id: taskId, kind: (raw.taskKind as ProfileKind) || "text_to_image", status: miss.status, assets: [], raw: miss.raw },
  };
}
