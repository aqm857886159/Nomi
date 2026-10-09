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
import { readNomiLocalAsset } from "../assets/localAssetFile";
import { ANTIGRAVITY_VENDOR_KEY } from "../shared/antigravity";
import { runAntigravityTask } from "./antigravityTask";
import { desktopT } from "../i18n";

export type StreamTextTaskInput = {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  prompt: string;
  /** image_to_prompt：把参考图作为多模态输入一并喂给模型。 */
  imageUrl?: string;
  /**
   * 多图版（视频拆解要求）：一次请求喂 N 张图。
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
/** 读完流之后等 finishReason / reasoning 的上限：它们是附带信息，不给就当没有。 */
const METADATA_GRACE_MS = 2_000;

/** http(s) URL 走 URL 引用（不内联）；data:/base64 等原样作字符串传给 SDK。 */
function toImagePart(imageUrl: string): { type: "image"; image: URL | string | Uint8Array; mimeType?: string } {
  if (imageUrl.startsWith("nomi-local://")) {
    const asset = readNomiLocalAsset(imageUrl);
    if (!asset || !asset.contentType.startsWith("image/")) throw new Error("Local image attachment is missing or unreadable");
    return { type: "image", image: asset.bytes, mimeType: asset.contentType };
  }
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
  // 图片入参归一：多图优先（视频拆解一镜 3 帧），否则退单图；两者都空则纯文本。
  const requestedImages = (input.imageUrls?.length ? input.imageUrls : input.imageUrl ? [input.imageUrl] : [])
    .filter((url): url is string => typeof url === "string" && url.length > 0);
  if (input.vendor.key === ANTIGRAVITY_VENDOR_KEY) {
    const result = await runAntigravityTask({ prompt: input.prompt, model: input.model.modelKey,
      imageUrls: requestedImages, signal: opts.abortSignal, onDelta: opts.onDelta });
    return { text: result.text, raw: { choices: [{ message: { role: "assistant", content: result.text } }],
      usage: result.usage }, finishReason: "stop" };
  }
  const model = buildLanguageModelForVendor(input.vendor, input.model, input.apiKey);
  // 收口 sanitize（P0-6）：与原文本分支同语义，prompt 统一 ASCII 可移植化。
  const promptText = sanitizeForBroadCompat(input.prompt);
  // toImagePart 对读不出的 nomi-local 会**抛错**（不静默瞎编）。多图（视频拆解一镜 3 帧）时逐张兜住，
  // 只把读得出的送进去；但若明确要了图却**一张都送不进** → **宁可报错也别让模型瞎编**（「静默骗人」bug
  // 的收口闸：调用方明确要求看图、我们却只发文字，任何结果都不可信）。此时把第一张的底层错误原样抛出，
  // 保住 toImagePart 既有的错误契约（如「Local image attachment is missing or unreadable」）。
  const imageParts: ReturnType<typeof toImagePart>[] = [];
  let firstImageError: unknown = null;
  for (const url of requestedImages) {
    try {
      imageParts.push(toImagePart(url));
    } catch (err) {
      if (firstImageError === null) firstImageError = err;
    }
  }
  if (requestedImages.length && !imageParts.length) {
    // 单图读不出：原样抛 toImagePart 的既有错误（保住其错误契约与既有测试）。
    // 多图全读不出：走可国际化的收口文案（R15，desktopT zh/en）。
    throw firstImageError instanceof Error
      ? firstImageError
      : new Error(desktopT("textTask.imagesUnreadable", { count: requestedImages.length }));
  }
  const content = imageParts.length
    ? [{ type: "text" as const, text: promptText }, ...imageParts]
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

  // ai@4 的 streamText 在请求发不出去（被测试网闸拦、DNS、断网——fetch 本身抛）时不抛也不关：textStream 静默结束、
  // finishReason 永远不 settle，下面一 await 它整个任务就永远挂住（节点永远「提交中」）。错误只通过 onError 交出来，
  // 所以必须在这里接住，流一结束就当错抛给调用方（真模型走查 2026-10-09 复现：fetch 抛错后 70 秒无任何事件）。
  let streamError: unknown;
  const result = streamText({
    onError: ({ error }) => { streamError ??= error; },
    model,
    messages: [{ role: "user", content }],
    temperature: typeof input.temperature === "number" ? input.temperature : 0.7,
    ...(typeof input.maxTokens === "number" && input.maxTokens > 0 ? { maxTokens: input.maxTokens } : {}),
    abortSignal: controller.signal,
  });

  // ⚠️ 这两个 promise **必须在这里就挂上 handler**（不是等成功路径末尾才 await）。
  // 供应商报错时 AI SDK 会同时 reject 它们；此刻若没人处理，Node 判「未处理的 rejection」
  // → **主进程当场死**，IPC 侧只看到 `reply was never sent`，一个字都指不出真因
  // （2026-09-12 诊断复现：404 之后 ~23s 主进程消失）。
  // 挂了之后，报错就只是一个**值**——由下面的 catch 原样抛给调用方，调用方看得到供应商原话。
  const finishReasonPromise = result.finishReason.catch(() => undefined);
  const reasoningPromise = result.reasoning.catch(() => undefined);

  // 所有结束方式（正常读完 / 出错 / 超时 / 用户停止）都必须让下面的 await 收口——ai@4 的流在 abort、或请求没发出去时，
  // textStream / finishReason 都可能永远不 settle。所以不是各种情况各补一处，而是统一用「已中止」信号与读流竞速：
  // 中止一发生，立刻收口，不再等 SDK 的任何 Promise（2026-10-09 复审：停止也会让主进程任务永久悬挂）。
  const aborted = new Promise<void>((resolve) => {
    if (controller.signal.aborted) resolve();
    else controller.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  let text = "";
  const consume = (async () => {
    for await (const delta of result.textStream) {
      // 收到首字 → 撤首字闸，后续交给整体闸。
      if (firstTokenTimer) {
        clearTimeout(firstTokenTimer);
        firstTokenTimer = null;
      }
      text += delta;
      opts.onDelta?.(delta);
    }
  })();
  consume.catch(() => undefined); // 竞速输了之后它再 reject 也不能变成未处理的 rejection
  try {
    await Promise.race([consume, aborted]);
  } catch (err) {
    if (timeoutReason) throw timeoutError();
    throw err;
  } finally {
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
    clearTimeout(overallTimer);
  }
  // 是我们的超时 abort 就抛错（落 node error 可重试）；用户点停止 = 取消：抛 AbortError，
  // 不是成功（不把残文本当结果）也不是错误（调用方按 AbortError 收尾，IPC 层不发 error）。
  if (timeoutReason) throw timeoutError();
  if (external?.aborted) throw new DOMException("text stream aborted", "AbortError");
  if (streamError !== undefined) throw streamError;
  // 元数据（finishReason / reasoning）只是附带信息：正常读完它应当立刻可解；SDK 若不给就当没有，
  // 绝不因此挂住整个任务，也不因此让任务失败。
  // 取消优先于一切：等元数据的这 2 秒里用户点停止，也要立刻收口、并且结果是 AbortError（不是成功）。
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const [finishReason, reasoning] = await Promise.race([
    Promise.all([finishReasonPromise, reasoningPromise]),
    new Promise<[undefined, undefined]>((resolve) => { graceTimer = setTimeout(() => resolve([undefined, undefined]), METADATA_GRACE_MS); }),
    aborted.then((): [undefined, undefined] => [undefined, undefined]),
  ]).finally(() => clearTimeout(graceTimer));
  if (external?.aborted) throw new DOMException("text stream aborted", "AbortError");
  return {
    text,
    raw: { choices: [{ message: { role: "assistant", content: text } }] },
    ...(finishReason ? { finishReason } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}
