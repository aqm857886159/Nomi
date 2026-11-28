// vendor 调用 → NomiEvent 旁路(harness S4-1,治"接入必漂"的数据枢纽)。
// 纪律(§4.3):只记终态——requested 在任务受理时记一次,completed 在 status 终态时记一次;
// 轮询中间 tick 不入日志(进度走 S2 的瞬态通道)。runId = vendor 域配对键(§1.1)。
import crypto from "node:crypto";
import { appendEvents } from "./eventLogRepository";
import type { NormalizedRecipe } from "../vendor/provenance";
import type { VendorErrorStructured } from "../vendor/vendorHttp";
import { vendorFailureFacts } from "../logging/diskSafeFailure";
import type { ProviderCostActual } from "../vendor/cost";
import type { TaskTerminalStatus } from "../shared/contracts/taskStatus";

const mintId = () => `evt_${crypto.randomUUID().slice(0, 12)}`;

export function traceVendorRequested(
  projectId: string | undefined,
  payload: { runId: string; nodeId?: string; recipe: NormalizedRecipe },
): void {
  const id = String(projectId || "").trim();
  if (!id) return;
  appendEvents(id, [
    {
      id: mintId(),
      source: "runtime",
      type: "vendor.call.requested",
      payload: { runId: payload.runId, ...(payload.nodeId ? { nodeId: payload.nodeId } : {}), recipe: payload.recipe },
    },
  ]);
}

/** S8 指纹缓存命中:零 vendor 调用的「秒回」入账(投影=节点秒得结果;不与真调用混淆)。 */
export function traceVendorCached(
  projectId: string | undefined,
  payload: { runId: string; nodeId?: string; fingerprint: string },
): void {
  const id = String(projectId || "").trim();
  if (!id) return;
  appendEvents(id, [
    {
      id: mintId(),
      source: "runtime",
      type: "vendor.call.cached",
      payload: { runId: payload.runId, ...(payload.nodeId ? { nodeId: payload.nodeId } : {}), fingerprint: payload.fingerprint },
    },
  ]);
}

/**
 * 终态入账。失败时收完整的 `VendorErrorStructured`（调用方不用自己挑字段），
 * 但**落盘的只有 `vendorFailureFacts` 那几项结构事实**：上游原话与 URL 不进项目事件（独立验收 V-textmigrate N3）。
 */
export function traceVendorCompleted(
  projectId: string | undefined,
  payload: {
    runId: string;
    nodeId?: string;
    status: TaskTerminalStatus;
    assetCount: number;
    error?: VendorErrorStructured;
    cost?: ProviderCostActual;
  },
): void {
  const id = String(projectId || "").trim();
  if (!id) return;
  const error = payload.error ? vendorFailureFacts(payload.error) : null;
  appendEvents(id, [
    {
      id: mintId(),
      source: "runtime",
      type: "vendor.call.completed",
      payload: {
        runId: payload.runId,
        ...(payload.nodeId ? { nodeId: payload.nodeId } : {}),
        status: payload.status,
        assetCount: payload.assetCount,
        ...(error ? { error } : {}),
        ...(payload.cost ? { cost: payload.cost } : {}),
      },
    },
  ]);
}
