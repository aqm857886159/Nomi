// 文本任务执行引擎（从 runtime.ts 抽出——规则 12 巨壳门岗：runtime.ts 已逼近 800 行硬上限，
// 文本任务这块自成一单元）。方案 A：路径 B 文本生成统一走 AI SDK streamTextTask。
//
// 回引 runtime 的 findExecutableModelForTask/billingKindForTaskKind（同 catalogCommit 的既定模式）：
// 调用都在函数体内（运行期），CommonJS 循环引用安全（runtime ↔ textTaskRunner 仅函数体互引，
// 无加载期互调）。
import crypto from "node:crypto";
import { streamTextTask } from "./ai/streamTextTask";
import { firstReferenceImage } from "./catalog/taskParams";
import { firstString, trim } from "./jsonUtils";
import { billingKindForTaskKind, findExecutableModelForTask, type TaskRequest, type TaskResult } from "./runtime";
import type { Model, Vendor } from "./catalog/types";

// 文本任务的执行收口（单一真相）：runTask（收集最终）与 runTextTaskStream（逐字流式）
// 共用这一份——resolve 之后只差「传不传 onDelta」。
export async function executeTextTask(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  kind: TaskRequest["kind"];
  request: TaskRequest;
  taskId: string;
  onDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
}): Promise<TaskResult> {
  const imageUrl = input.kind === "image_to_prompt" ? firstReferenceImage(input.request) : "";
  const maxTokensValue = Number(input.request.extras?.maxTokens ?? input.request.extras?.max_tokens);
  const temperatureValue = Number(input.request.extras?.temperature);
  const { raw } = await streamTextTask(
    {
      vendor: input.vendor,
      model: input.model,
      apiKey: input.apiKey,
      prompt: input.request.prompt,
      ...(imageUrl ? { imageUrl } : {}),
      ...(Number.isFinite(temperatureValue) ? { temperature: temperatureValue } : {}),
      ...(Number.isFinite(maxTokensValue) && maxTokensValue > 0 ? { maxTokens: maxTokensValue } : {}),
    },
    { ...(input.onDelta ? { onDelta: input.onDelta } : {}), ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}) },
  );
  return { id: input.taskId, kind: input.kind, status: "succeeded", assets: [], raw };
}

/**
 * 文本任务的流式入口：与 runTask 同源解析 vendor/model，但逐 token 回调 onDelta。
 * 给 textStreamIpc 用；非文本 kind 直接报错（流式只服务文本）。不进指纹缓存——
 * 流式语义就是"现抽现出"，缓存命中无逐字意义（缓存仍由 runTask 路径覆盖）。
 */
export async function runTextTaskStream(
  payload: unknown,
  opts: { onDelta?: (delta: string) => void; abortSignal?: AbortSignal } = {},
): Promise<TaskResult> {
  const raw = payload as { vendor?: string; request?: TaskRequest };
  const vendorKey = trim(raw.vendor);
  const request = raw.request;
  if (!vendorKey || !request) throw new Error("vendor and request are required");
  const kind = request.kind;
  const wantedKind = billingKindForTaskKind(kind);
  if (wantedKind !== "text") throw new Error(`runTextTaskStream 只处理文本任务，收到 kind=${kind}`);
  const modelKey = firstString(request.extras?.modelKey, request.extras?.modelAlias);
  const { vendor, model, apiKey } = findExecutableModelForTask(vendorKey, modelKey, wantedKind);
  const taskId = `task-${crypto.randomUUID()}`;
  return executeTextTask({
    vendor,
    model,
    apiKey,
    kind,
    request,
    taskId,
    ...(opts.onDelta ? { onDelta: opts.onDelta } : {}),
    ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
  });
}
