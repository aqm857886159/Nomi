import { revalidatePendingCredential } from './catalog/validateCandidateCredential';
// 文本任务执行引擎（从 runtime.ts 抽出——规则 12 巨壳门岗）。2026-10-21 起走 pi-ai 单次调用的唯一核心
// （electron/agentLane/laneModelCall.mts，经 ai/modelCallBridge 过 CJS→ESM 桥），与 Agent 的一次性提问、接入说明卡编译器同一台发动机。
// 过去这里走的是 ai@4（streamTextTask），判活只数正文，思考型模型 30 秒就被掐（docs/audit/2026-10-21-text-stream-first-token-gate.md）。
//
// 回引 runtime 的 findExecutableModelForTask/billingKindForTaskKind（同 catalogCommit 的既定模式）：
// 调用都在函数体内（运行期），CommonJS 循环引用安全（runtime ↔ textTaskRunner 仅函数体互引，
// 无加载期互调）。
import crypto from "node:crypto";
import { callModelOnce } from "./ai/modelCallBridge";
import { modelCallTransport } from "./ai/modelCallFetch";
import { readModelImage, ModelImageUnreadableError } from "./ai/modelImageInput";
import { modelCallFailure } from "./ai/runtimeVendorError";
import { nomiModelConfigFor } from "./ai/vendorModelConnection";
import { sanitizeForBroadCompat } from "./ai/promptSanitize";
import { runAntigravityTask } from "./ai/antigravityTask";
import { ANTIGRAVITY_VENDOR_KEY } from "./shared/antigravity";
import { allReferenceImages } from "./catalog/taskParams";
import { firstString, trim } from "./jsonUtils";
import { desktopT } from "./i18n";
import { billingKindForTaskKind, findExecutableModelForTask, type TaskRequest, type TaskResult } from "./runtime";
import type { Model, Vendor } from "./catalog/types";
import { readNomiLocalAsset } from './assets/localAssetFile';
import { assertNativeMediaCapability, assertNativeMediaProtocol, bindNativeFile, MAX_NATIVE_FILE_BYTES, nativeMediaKind, NativeMediaInputError, NativeMediaBudget } from './ai/nativeFilePayload';
import type { NativeFileContent } from './shared/agentLane/nativeModelInput';
import type { NomiModelConfig } from './shared/agentLane/laneModelConfig';

/**
 * 文本任务缺省的重试次数（流开始之前的 408/409/429/5xx/连不上）。迁移前是 ai@4 的 SDK 默认 2 次；
 * pi 缺省 0 次，所以这里**显式**给，策略不变（任务书：429 照现在的策略处理）。拆解路径显式传 0（2026-10-11 拍板）。
 */
const DEFAULT_TEXT_TASK_RETRIES = 2;
/** 迁移前的缺省温度（streamTextTask 没给就是 0.7）。 */
const DEFAULT_TEXT_TASK_TEMPERATURE = 0.7;

function abortError(): DOMException {
  return new DOMException("text stream aborted", "AbortError");
}

/**
 * 参考图 → 模型看得到的图片段。要了图却**一张都读不进** → 宁可报错也别让模型瞎编（「静默骗人」的收口闸，迁移前就有）：
 * 单图读不出原样抛那张图的错误（既有契约），多图全读不出走可国际化的收口文案。读得出几张就送几张（拆解一镜 3 帧，丢一帧照跑）。
 */
async function imageContent(urls: readonly string[], signal: AbortSignal | undefined) {
  const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
  let firstError: unknown = null;
  for (const url of urls) {
    try {
      const image = await readModelImage(url, signal ? { signal } : {});
      images.push({ type: "image", data: Buffer.from(image.bytes).toString("base64"), mimeType: image.mimeType });
    } catch (error) {
      if (signal?.aborted) throw abortError();
      firstError ??= error;
    }
  }
  if (urls.length && !images.length) {
    if (urls.length === 1 && firstError instanceof Error) throw firstError;
    throw new ModelImageUnreadableError(desktopT("textTask.imagesUnreadable", { count: urls.length }), urls[0] ?? "");
  }
  return images;
}

/** Text tasks receive the exact same project-owned originals as Agent attachments. */
function originalMediaContent(request: TaskRequest, config: NomiModelConfig, signal?: AbortSignal): NativeFileContent[] {
  const files: NativeFileContent[] = [];
  const budget = new NativeMediaBudget();
  for (const [field, kind] of [['referenceAudioUrls', 'audio'], ['referenceVideoUrls', 'video']] as const) {
    const values = request.extras?.[field];
    if (values === undefined) continue;
    if (!Array.isArray(values)) throw new NativeMediaInputError('unreadable', { file: field });
    if (values.length) assertNativeMediaCapability(kind, config.inputModalities, field);
    if (values.length && kind === 'video') assertNativeMediaProtocol('video/mp4', config.kind, field);
    for (const [index, url] of values.entries()) {
      signal?.throwIfAborted();
      if (typeof url !== 'string' || !url.startsWith('nomi-local://asset/')) throw new NativeMediaInputError('unreadable', { file: field });
      const key = `${field}:${index}`;
      const available = Math.min(MAX_NATIVE_FILE_BYTES, budget.remainingBytes(key));
      if (available <= 0) throw new NativeMediaInputError('tooLarge');
      const file = readNomiLocalAsset(url, { maxBytes: available });
      if (!file?.bytes.length) throw new NativeMediaInputError('unreadable', { file: field });
      if (nativeMediaKind(file.contentType) !== kind) throw new NativeMediaInputError('invalidType', { file: file.fileName, mimeType: file.contentType });
      budget.reserve(key, file.bytes.length);
      const part: NativeFileContent = { type: 'file', fileName: file.fileName, mimeType: file.contentType, data: Buffer.from(file.bytes).toString('base64') };
      bindNativeFile(part);
      files.push(part);
    }
  }
  return files;
}

// 文本任务的执行收口（单一真相）：runTask（收集最终）与 runTextTaskStream（逐字流式）
// 共用这一份——resolve 之后只差「传不传 onDelta / abortSignal」。
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
  // image_to_prompt 走**多图**：视频拆解一次喂一镜的 3 帧（单帧会漏掉「出现又消失」的字幕/角标，
  // 实测同一镜 3 帧里下载弹窗只在第 3 帧）。单图调用方（浏览器「画面复刻」）传的 referenceImages 只有
  // 一个元素，行为完全不变。保留 main 的 {vendorKey, modelKey} 选择参数（ComfyUI 参考契约感知）。
  const imageUrls = input.kind === "image_to_prompt"
    ? allReferenceImages(input.request, { vendorKey: input.vendor.key, modelKey: input.model.modelKey })
    : [];
  const maxTokensValue = Number(input.request.extras?.maxTokens ?? input.request.extras?.max_tokens);
  const temperatureValue = Number(input.request.extras?.temperature);
  // 只有调用方显式给了才用（拆解路径给 0）；没给就是缺省 2 次。
  const maxRetriesRaw = input.request.extras?.maxRetries;
  const maxRetries = typeof maxRetriesRaw === "number" && Number.isInteger(maxRetriesRaw) && maxRetriesRaw >= 0 && maxRetriesRaw <= 2
    ? maxRetriesRaw : DEFAULT_TEXT_TASK_RETRIES;
  const signal = input.abortSignal;
  const succeeded = (text: string, finishReason?: string): TaskResult => ({
    id: input.taskId, kind: input.kind, status: "succeeded", assets: [],
    // raw 合成成 OpenAI choices 形状：渲染层既有的 extractTextFromChatRaw 零改动继续可用。
    raw: { choices: [{ message: { role: "assistant", content: text } }] },
    // finishReason 必须带出去：截断（`length`）这一类问题在下游**只能**靠它自证。
    ...(finishReason ? { finishReason } : {}),
  });

  if (input.vendor.key === ANTIGRAVITY_VENDOR_KEY) {
    if (['referenceAudioUrls', 'referenceVideoUrls'].some(field => {
      const value = input.request.extras?.[field];
      return Array.isArray(value) ? value.length > 0 : value !== undefined;
    })) {
      throw new NativeMediaInputError('unsupported', { file: '', media: 'audio/video' });
    }
    const result = await runAntigravityTask({ prompt: input.request.prompt, model: input.model.modelKey,
      imageUrls, signal, onDelta: input.onDelta });
    return { ...succeeded(result.text, "stop"), raw: { choices: [{ message: { role: "assistant", content: result.text } }], usage: result.usage } };
  }

  // 收口 sanitize（P0-6）：prompt 统一 ASCII 可移植化（迁移前同语义）。
  const prompt = sanitizeForBroadCompat(input.request.prompt);
  const images = await imageContent(imageUrls, signal);
  const config = nomiModelConfigFor(input.vendor, input.model, input.apiKey);
  const originalMedia = originalMediaContent(input.request, config, signal);
  const transport = modelCallTransport({ modelId: config.modelId, knownSecrets: [input.apiKey] });
  const failure = (error: unknown, errorMessage?: string) => modelCallFailure({
    vendorKey: input.vendor.key, error, ...(errorMessage === undefined ? {} : { errorMessage }),
    attempt: transport.lastAttempt(), redact: transport.redact });
  let result: Awaited<ReturnType<typeof callModelOnce>>;
  try {
    result = await callModelOnce({
      model: config,
      fetch: transport.fetch,
      content: images.length || originalMedia.length ? [{ type: "text", text: prompt }, ...images, ...originalMedia] : prompt,
      temperature: Number.isFinite(temperatureValue) ? temperatureValue : DEFAULT_TEXT_TASK_TEMPERATURE,
      ...(Number.isFinite(maxTokensValue) && maxTokensValue > 0 ? { maxTokens: maxTokensValue } : {}),
      maxRetries,
      // 有停止键的入口（流式）传 signal；一次性入口没有，核心自加整体兜底（协调 10-21 定，D2）。
      ...(signal ? { signal } : {}),
      // 只有正文进 onDelta；思考事件只说明「还活着」，判活由核心的看门狗管。
      ...(input.onDelta ? { onEvent: (event) => { if (event.type === "text_delta") input.onDelta!(event.delta); } } : {}),
    });
  } catch (error) {
    // 用户点了停止 = 取消：不是成功（不把残文本当结果）也不是错误（调用方按 AbortError 收尾，IPC 层不发 error）。
    if (signal?.aborted) throw abortError();
    throw failure(error);
  }
  const { message } = result;
  if (message.stopReason === "aborted") throw signal?.aborted ? abortError() : failure(undefined, message.errorMessage);
  if (message.stopReason === "error") throw failure(undefined, message.errorMessage);
  const text = message.content.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join("");
  return succeeded(text, message.stopReason === "length" ? "length" : "stop");
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
  await revalidatePendingCredential(vendorKey);
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
