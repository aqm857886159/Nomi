/**
 * 任务传输层的形状：请求、异步任务的工作缓存条目、结果里的一件产物。
 *
 * 从 runtime.ts 抽出来（R9 分层 ≤800 行：runtime.ts 是编排层，类型定义不占它的额度）。
 * runtime.ts 原样 re-export 请求与缓存两个名字，既有 `from "./runtime"` 的 import 面不变。
 * TaskResult 留在 runtime.ts：它的 status 联合是 check:vocabularies 登记在案的 debt site，
 * 搬家会被门岗读成「新开一处 debt」，而真正的收敛（中立 TASK_STATUSES 合同）是另一件事。
 * 产物那一件（TaskResultAsset）没有 status 联合，搬来这里；TaskResult["assets"] 仍是它的数组，旧写法照用。
 */
import type { BillingModelKind, Mapping, Model, ProfileKind } from "./catalog/types";
import type { JsonRecord } from "./jsonUtils";

export type TaskRequest = {
  kind: ProfileKind;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  extras?: Record<string, unknown> & { executionBinding?: import("./productionRun/productionExecutionBinding").ProductionExecutionBinding };
};
export type CachedTask = {
  vendor: string;
  request: TaskRequest;
  raw: unknown;
  mapping?: Mapping | null;
  model?: Model;
  providerMeta?: JsonRecord;
  projectId?: string;
  nodeId?: string;
  wantedKind?: BillingModelKind;
  /** S8 指纹:异步任务终态成功时写回指纹缓存用。 */
  fingerprint?: string;
  /** 未知状态动词连击（规则见 tasks/taskResultQuery）：本对象已是逐任务跨轮询的载体，故状态存这。 */
  unrecognizedStatusStreak?: { verb: string; polls: number; firstSeenAt: number };
};
/** 一次结果里的一件产物（runtime.TaskResult["assets"] 的元素）。 */
export type TaskResultAsset = import("./shared/canvas/canvasMediaPreview").TaskAssetPreviewFields & {
  type: "image" | "video" | "audio" | "model3d";
  url: string;
  assetId?: string | null;
  assetRefId?: string | null;
  assetName?: string | null;
  /** 原始 CDN URL（https://...）。供后续生成直接用，无需上传。可能过期，过期后退回本地字节。 */
  providerUrl?: string | null;
  durationSeconds?: number;
  /** 落盘边界 ffprobe 出来的源像素尺寸；画布拿到它就不必解码原图才知道有多大。 */
  width?: number;
  height?: number;
};
