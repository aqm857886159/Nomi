// 文本任务的流式引擎（方案 A：路径 B 收口到 AI SDK）。
//
// 取代原 runtime.ts 直 POST /v1/chat/completions（一次性收口）。一个核心两种消费：
// ① 不传 onDelta → 跑完返回最终文本（runTask 文本分支用，对外契约不变）；
// ② 传 onDelta → 逐 token 回调（流式 IPC 用，渲染层增量写节点文档）。
//
// 复用 buildLanguageModelForVendor（vendor→模型单一真相）+ AI SDK streamText.textStream。
import { streamText } from "ai";
import { buildLanguageModelForVendor } from "./vendorLanguageModel";
import { sanitizeForBroadCompat } from "./promptSanitize";
import type { Model, Vendor } from "../catalog/types";

export type StreamTextTaskInput = {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  prompt: string;
  /** image_to_prompt：把参考图作为多模态输入一并喂给模型。 */
  imageUrl?: string;
  temperature?: number;
  maxTokens?: number;
};

export type StreamTextTaskOptions = {
  onDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
};

// 文本流式超时（根因修复 2026-06-13）：中转接了连接却不吐 token/不关流时，
// AI SDK 的 textStream for-await 会永久挂起，节点永远停在「正在把任务发给模型」——
// 既不报错也进不了重试。两道闸：
// ① 首字超时：发出请求后这么久还没收到第一个 token 就中断（判活，区别于"慢但在动"）;
// ② 整体超时：收到首字后总时长上限，防开了流又卡死在中途。
// 超时即 abort（真掐断 HTTP 连接，见 buildAiSdkModel 透传 init.signal），并抛错让节点落 error 可重试。
const FIRST_TOKEN_TIMEOUT_MS = 30_000;
const OVERALL_TIMEOUT_MS = 120_000;

/** http(s) URL 走 URL 引用（不内联）；data:/base64 等原样作字符串传给 SDK。 */
function toImagePart(imageUrl: string): { type: "image"; image: URL | string } {
  if (/^https?:\/\//i.test(imageUrl)) {
    try {
      return { type: "image", image: new URL(imageUrl) };
    } catch {
      /* 退回字符串 */
    }
  }
  return { type: "image", image: imageUrl };
}

/**
 * 流式跑一个文本任务。返回 { text, raw }——raw 合成成 OpenAI choices 形状，
 * 让渲染层既有的 extractTextFromChatRaw 零改动继续可用。
 */
export async function streamTextTask(
  input: StreamTextTaskInput,
  opts: StreamTextTaskOptions = {},
): Promise<{ text: string; raw: unknown }> {
  const model = buildLanguageModelForVendor(input.vendor, input.model, input.apiKey);
  // 收口 sanitize（P0-6）：与原文本分支同语义，prompt 统一 ASCII 可移植化。
  const promptText = sanitizeForBroadCompat(input.prompt);
  const content = input.imageUrl
    ? [{ type: "text" as const, text: promptText }, toImagePart(input.imageUrl)]
    : promptText;

  // 内部 controller 统一承载「超时」与「外部取消」两个中断源 → 只给 streamText 一个 signal。
  const controller = new AbortController();
  let timeoutReason: string | null = null;
  const external = opts.abortSignal;
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", () => controller.abort(), { once: true });
  }
  let firstTokenTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timeoutReason = `首字 ${FIRST_TOKEN_TIMEOUT_MS / 1000}s 未响应`;
    controller.abort();
  }, FIRST_TOKEN_TIMEOUT_MS);
  const overallTimer = setTimeout(() => {
    timeoutReason = `整体超过 ${OVERALL_TIMEOUT_MS / 1000}s`;
    controller.abort();
  }, OVERALL_TIMEOUT_MS);
  const timeoutError = () =>
    new Error(`文本生成超时（${timeoutReason}），已中断。请重试或更换模型。`);

  const result = streamText({
    model,
    messages: [{ role: "user", content }],
    temperature: typeof input.temperature === "number" ? input.temperature : 0.7,
    ...(typeof input.maxTokens === "number" && input.maxTokens > 0 ? { maxTokens: input.maxTokens } : {}),
    abortSignal: controller.signal,
  });

  let text = "";
  try {
    for await (const delta of result.textStream) {
      // 收到首字 → 撤首字闸，后续交给整体闸。
      if (firstTokenTimer) {
        clearTimeout(firstTokenTimer);
        firstTokenTimer = null;
      }
      text += delta;
      opts.onDelta?.(delta);
    }
  } catch (err) {
    // AI SDK abort 时 textStream 多半静默结束，但个别 provider 会抛——抛了也归一成超时错。
    if (timeoutReason) throw timeoutError();
    throw err;
  } finally {
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
    clearTimeout(overallTimer);
  }
  // abort 导致的静默结束在这里兜：是我们的超时 abort 就抛错（落 node error 可重试），
  // 不能把空/残文本当成功返回。外部取消(timeoutReason 为空)则由渲染层的取消路径收尾。
  if (timeoutReason) throw timeoutError();
  return { text, raw: { choices: [{ message: { role: "assistant", content: text } }] } };
}
