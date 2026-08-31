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
import { readNomiLocalAsset } from "../assets/localAssetFile";
import type { Model, Vendor } from "../catalog/types";

export type StreamTextTaskInput = {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  prompt: string;
  /** image_to_prompt：把参考图作为多模态输入一并喂给模型。 */
  imageUrl?: string;
  /**
   * 多图版（2026-08-13 加，视频拆解要求）：一次请求喂 N 张图。
   * 为什么必须支持多图——视频拆解按镜取 3 帧一起问，单帧会漏掉「出现又消失」的字幕/角标
   * （实测：同一镜 3 帧里下载弹窗只在第 3 帧）；而多帧的代价是 image token 线性涨、
   * **墙钟只慢 26%**（瓶颈在模型思考不在传图）。给 imageUrls 时忽略 imageUrl。
   */
  imageUrls?: string[];
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

/**
 * http(s) URL 走 URL 引用（不内联）；**nomi-local:// 读成字节内联**；data:/base64 原样给 SDK。
 *
 * ⚠️ nomi-local 这一支是 2026-08-13 修的一类**静默骗人**的 bug：项目内素材（抽出来的帧、
 * 用户上传的图）都是 nomi-local:// 协议，AI SDK 解析不了，此前会被当普通字符串塞进 image part
 * ——请求照发、模型照答，只是**它根本没看见图**，于是凭提示词里的上下文瞎编一段。
 * 不报错、不重试、看起来一切正常，实测拆解时一半镜头是幻觉、另一半自己说「缺少帧信息」。
 * 修在这里而不是各调用方：凡走多模态的都过这个函数，修一处整类消失（P2）。
 */
function toImagePart(imageUrl: string): { type: "image"; image: URL | string | Uint8Array } {
  if (/^https?:\/\//i.test(imageUrl)) {
    try {
      return { type: "image", image: new URL(imageUrl) };
    } catch {
      /* 退回字符串 */
    }
  }
  if (imageUrl.startsWith("nomi-local://")) {
    const local = readNomiLocalAsset(imageUrl);
    // 读不出来就让它以原样字符串继续——上游 imagesResolved 会发现少了图并拒发，不至于静默瞎编。
    if (local?.bytes) return { type: "image", image: new Uint8Array(local.bytes) };
  }
  return { type: "image", image: imageUrl };
}

/** 这张图能不能真的被模型看见（nomi-local 读得出字节、或本就是 http/data）。 */
function isResolvableImage(part: { image: URL | string | Uint8Array }): boolean {
  if (part.image instanceof URL || part.image instanceof Uint8Array) return true;
  return /^data:/i.test(String(part.image));
}

/**
 * 流式跑一个文本任务。返回 { text, raw }——raw 合成成 OpenAI choices 形状，
 * 让渲染层既有的 extractTextFromChatRaw 零改动继续可用。
 *
 * 另附 finishReason / reasoning（2026-08-12 加）：思考型模型（DeepSeek V4、R1、o 系…）
 * 会先吐 reasoning_content 再吐正文，而 textStream **只含正文**。额度不够时正文为空、
 * finishReason='length'——这时「没拿到文字」是我们自己截断的，不是模型不行。
 * 调用方要能分清这两种空，才不会把好模型判死（见 providerAdapter/verifier 探测）。
 */
export async function streamTextTask(
  input: StreamTextTaskInput,
  opts: StreamTextTaskOptions = {},
): Promise<{ text: string; raw: unknown; finishReason?: string; reasoning?: string }> {
  const model = buildLanguageModelForVendor(input.vendor, input.model, input.apiKey);
  // 收口 sanitize（P0-6）：与原文本分支同语义，prompt 统一 ASCII 可移植化。
  const promptText = sanitizeForBroadCompat(input.prompt);
  const images = (input.imageUrls?.length ? input.imageUrls : input.imageUrl ? [input.imageUrl] : [])
    .filter((url): url is string => typeof url === "string" && url.length > 0);
  const parts = images.map(toImagePart);
  // 要了图却一张都送不进去 → **宁可报错也别让模型瞎编**。这是上面那个「静默骗人」bug 的第二道闸：
  // 调用方明确要求看图，我们却只发了文字，任何结果都是不可信的。
  if (images.length && !parts.some(isResolvableImage)) {
    throw new Error(`参考图都读不出来（${images.length} 张），没法让模型看图作答。请检查素材是否还在项目里。`);
  }
  const content = parts.length ? [{ type: "text" as const, text: promptText }, ...parts] : promptText;

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
  // 流已跑完，这两个 promise 立即可解；individual provider 不给就当没有，绝不因此让整个任务失败。
  const [finishReason, reasoning] = await Promise.all([
    result.finishReason.catch(() => undefined),
    result.reasoning.catch(() => undefined),
  ]);
  return {
    text,
    raw: { choices: [{ message: { role: "assistant", content: text } }] },
    ...(finishReason ? { finishReason } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}
