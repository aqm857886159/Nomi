import crypto from "node:crypto";
import { hardenedFetch, type HardenedFetchOptions } from "../hardenedFetch";
import type { LocalAssetReader } from "../catalog/assetLocalization";
import type { Mapping, Model, Vendor } from "../catalog/types";
import { streamTextTask } from "../ai/streamTextTask";
import {
  buildProfileTaskResult,
  executeProfileOperation,
  type TaskRequest,
  type TaskResult,
} from "../runtime";
import { VendorRequestError, type VendorErrorCategory } from "../vendor/vendorHttp";
import type { AdapterModeDraft } from "./types";
import { redactAdapterSecrets } from "./redaction";

// 文本探测的额度上限。**上限不是花费**——模型答完 "ready" 就停，实际只出几十 token，
// 设大不多花一分钱；设小却会把整类思考型模型判死：DeepSeek V4 / R1 / o 系默认先思考，
// 思考的 token 同样计入 max_tokens，而 AI SDK 的 textStream 只含正文。旧值 24 被思考
// 全部吃光 → 正文为空 → 误判「模型不可用」（2026-08-11 用户接 deepseek-v4-pro/flash
// 实测：max_tokens=24 → finish_reason=length、content=""；=2048 → "ready"，仅用 35 token）。
const TEXT_PROBE_MAX_TOKENS = 2_048;

const REFERENCE_URL = "nomi-local://adapter-test/reference.png";
const REFERENCE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8AARAwMjDAGDAAANgQCAf6mRpsAAAAASUVORK5CYII=",
  "base64",
);

export type AdapterVerificationResult =
  | { ok: true; taskKind: AdapterModeDraft["taskKind"]; requestSummary?: unknown }
  | {
      ok: false;
      taskKind: AdapterModeDraft["taskKind"];
      stage: "localize_reference" | "create" | "poll" | "verify_asset";
      error: string;
      /**
       * 失败归类。**在抛出点就已查表定好**（vendorHttp：401/403→auth、402→balance、429→quota、
       * 400/422→input、5xx→server），这里只是把它带出来，不是重新判断。
       * 不带的话渲染层只能拿 error 字符串做关键词匹配去猜——正是 2026-08-12
       * `fix(errors): 文本侧错误也在源头留住 category` 修掉的反模式：猜就按类漏，且反复漏
       * （那次注释里记着 5 轮同型补丁）。
       */
      errorCategory?: VendorErrorCategory;
      httpStatus?: number;
      requestSummary?: unknown;
    };

type ExecuteInput = Parameters<typeof executeProfileOperation>[0];
type NormalizeInput = Parameters<typeof buildProfileTaskResult>[0];

export type AdapterVerifierDependencies = {
  execute?: (input: ExecuteInput) => Promise<{ response: unknown; request: unknown }>;
  normalize?: (input: NormalizeInput) => Promise<{ result: TaskResult; providerMeta: Record<string, unknown> }>;
  fetchAsset?: (
    url: string,
    options: HardenedFetchOptions,
  ) => Promise<{ contentType: string; bytes: Buffer }>;
  sleep?: (ms: number) => Promise<void>;
  maxPolls?: number;
  pollIntervalMs?: number;
  verifyText?: (input: {
    vendor: Vendor;
    model: Model;
    apiKey: string;
    prompt: string;
    imageUrl?: string;
    signal?: AbortSignal;
  }) => Promise<{ text: string; finishReason?: string; reasoning?: string }>;
};

async function waitForPoll(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return sleep(ms);
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Verification cancelled");
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error("Verification cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([sleep(ms), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

const defaultReadFixture: LocalAssetReader = (url) =>
  url === REFERENCE_URL
    ? { bytes: REFERENCE_PNG, contentType: "image/png", fileName: "adapter-reference.png" }
    : null;

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactAdapterSecrets(raw);
}

function mappingFor(vendor: Vendor, model: Model, mode: AdapterModeDraft): Mapping {
  const now = new Date().toISOString();
  return {
    id: `candidate-${crypto.randomUUID()}`,
    vendorKey: vendor.key,
    modelKey: model.modelKey,
    taskKind: mode.taskKind,
    name: `${model.modelKey}/${mode.taskKind} candidate`,
    enabled: false,
    create: mode.create,
    ...(mode.query ? { query: mode.query } : {}),
    ...(mode.statusMapping ? { statusMapping: mode.statusMapping } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

function verificationRequest(model: Model, mode: AdapterModeDraft): TaskRequest {
  const extras: Record<string, unknown> = { modelKey: model.modelKey, ...(mode.testParams || {}) };
  if (mode.referenceParam) {
    extras[mode.referenceParam] = mode.referenceShape === "array" ? [REFERENCE_URL] : REFERENCE_URL;
    // The production request normalizer recognizes this canonical collection even when a wire-specific alias is also used.
    if (!("referenceImages" in extras)) extras.referenceImages = [REFERENCE_URL];
  }
  return {
    kind: mode.taskKind,
    prompt:
      mode.taskKind === "image_edit" || mode.taskKind.startsWith("image_to_")
        ? "Preserve the blue reference square and make one minimal variation."
        : "Nomi adapter verification. Return one minimal result.",
    extras,
  };
}

function allowedContentTypes(kind: Model["kind"]): string[] {
  if (kind === "video") return ["video/"];
  if (kind === "audio") return ["audio/"];
  if (kind === "model3d") return ["model/", "application/octet-stream", "application/gltf", "application/json"];
  return ["image/"];
}

function dataUrlMatches(url: string, kind: Model["kind"]): boolean {
  const prefix = kind === "video" ? "data:video/" : kind === "audio" ? "data:audio/" : kind === "model3d" ? "data:model/" : "data:image/";
  return url.toLowerCase().startsWith(prefix);
}

/** 取 http(s) origin；非法/非 http 一律 null（拿不到就不放行，保守失败）。 */
function originOf(baseUrlHint: string | null | undefined): string | null {
  if (!baseUrlHint) return null;
  try {
    const url = new URL(baseUrlHint);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export async function verifyAdapterMode(
  input: { vendor: Vendor; model: Model; apiKey: string; mode: AdapterModeDraft; signal?: AbortSignal },
  dependencies: AdapterVerifierDependencies = {},
): Promise<AdapterVerificationResult> {
  const execute = dependencies.execute || executeProfileOperation;
  const normalize = dependencies.normalize || buildProfileTaskResult;
  const fetchAsset = dependencies.fetchAsset || hardenedFetch;
  const sleep = dependencies.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const verifyText = dependencies.verifyText || (async (textInput) => streamTextTask(
    {
      ...textInput,
      temperature: 0,
      maxTokens: TEXT_PROBE_MAX_TOKENS,
    },
    { abortSignal: textInput.signal || AbortSignal.timeout(45_000) },
  ));
  const mapping = mappingFor(input.vendor, input.model, input.mode);
  const request = verificationRequest(input.model, input.mode);
  // 本次验证正在打的那个端点的 origin（用户刚亲手填的），产物 URL 与它同源才准下载。
  const verifiedOrigin = originOf(input.vendor.baseUrlHint);
  let stage: "localize_reference" | "create" | "poll" | "verify_asset" = input.mode.referenceParam
    ? "localize_reference"
    : "create";
  let requestSummary: unknown;

  try {
    if (input.model.kind === "text") {
      stage = "create";
      const prompt = "Nomi adapter verification. Reply with the single word ready.";
      const textResult = await verifyText({
        vendor: input.vendor,
        model: input.model,
        apiKey: input.apiKey,
        prompt,
        signal: input.signal,
        ...(input.mode.taskKind === "image_to_prompt"
          ? { imageUrl: `data:image/png;base64,${REFERENCE_PNG.toString("base64")}` }
          : {}),
      });
      requestSummary = {
        productionPath: "streamTextTask",
        modelKey: input.model.modelKey,
        taskKind: input.mode.taskKind,
      };
      // 空正文有两种，别混为一谈（根因修复 2026-08-12）：
      // ① 思考型模型把额度花在思考上、被我们的上限截断 → 端点/鉴权/模型都是通的，算通过。
      //    （否则无论上限设多大，思考更久的模型仍会被判死——这类 bug 只有这样才不再复发。）
      // ② 真的什么都没回 → 才是失败，且要说清「空回复」而不是含糊的 no readable text。
      if (!textResult.text.trim()) {
        const truncatedWhileThinking =
          textResult.finishReason === "length" || Boolean(textResult.reasoning?.trim());
        if (!truncatedWhileThinking) {
          throw new Error("Model connected but returned an empty reply (no text and no reasoning)");
        }
      }
      return { ok: true, taskKind: input.mode.taskKind, requestSummary };
    }

    let executed = await execute({
      vendor: input.vendor,
      model: input.model,
      apiKey: input.apiKey,
      request,
      operation: input.mode.create,
      localAssetReader: defaultReadFixture,
      signal: input.signal,
    });
    requestSummary = executed.request;
    stage = "create";

    let normalized = await normalize({
      response: executed.response,
      mapping,
      operation: input.mode.create,
      request,
      taskIdFallback: `adapter-${crypto.randomUUID()}`,
      wantedKind: input.model.kind,
      vendor: input.vendor,
      model: input.model,
    });

    if (normalized.result.status === "failed") throw new Error(normalized.result.error || "Provider returned a failed task");
    if (normalized.result.status !== "succeeded") {
      if (!input.mode.query) throw new Error("Provider returned a pending task but the adapter has no query operation");
      stage = "poll";
      const maxPolls = dependencies.maxPolls ?? 40;
      for (let attempt = 0; attempt < maxPolls && normalized.result.status !== "succeeded"; attempt += 1) {
        if (attempt > 0) await waitForPoll(sleep, dependencies.pollIntervalMs ?? 3_000, input.signal);
        executed = await execute({
          vendor: input.vendor,
          model: input.model,
          apiKey: input.apiKey,
          request,
          operation: input.mode.query,
          providerMeta: normalized.providerMeta,
          localAssetReader: defaultReadFixture,
          signal: input.signal,
        });
        requestSummary = executed.request;
        normalized = await normalize({
          response: executed.response,
          mapping,
          operation: input.mode.query,
          request,
          taskIdFallback: normalized.result.id,
          wantedKind: input.model.kind,
          vendor: input.vendor,
          model: input.model,
        });
        if (normalized.result.status === "failed") throw new Error(normalized.result.error || "Provider returned a failed task");
      }
      if (normalized.result.status !== "succeeded") throw new Error("Provider verification timed out while polling");
    }

    stage = "verify_asset";
    const asset = normalized.result.assets[0];
    if (!asset?.url) throw new Error("Successful task returned no media asset URL");
    if (asset.url.startsWith("data:")) {
      if (!dataUrlMatches(asset.url, input.model.kind)) throw new Error("Returned data URL has the wrong media type");
    } else {
      await fetchAsset(asset.url, {
        timeoutMs: 20_000,
        maxBytes: input.model.kind === "video" ? 25 * 1024 * 1024 : 12 * 1024 * 1024,
        allowContentTypes: allowedContentTypes(input.model.kind),
        signal: input.signal,
        // 自建/局域网端点产出的图片视频，URL 本身就在私网上（http://127.0.0.1:8080/asset/x.png）。
        // 不放行就必然卡在 verify_asset：「Refusing to fetch private/loopback host」→ 本地端点的
        // 图片/视频能力**永远无法通过验证**（真实走查跑出来的，见 tests/ux/local-gateway-onboarding.walk.mjs）。
        //
        // 与 assetLocalization.trustedLocalOutputOrigin 只放行 curated ComfyUI 的那条决策不冲突：
        // 那条防的是「持久化 vendor 字段自行长期打开私网下载」；这里的放行是**本次验证内**、
        // 且只认与用户刚亲手填的那个端点**完全同源**的 URL（hardenedFetch 比对 origin 全等，
        // 且放行私网时会同时关掉重定向跟随，杜绝跳转绕过）。换个私网地址照样拒。
        ...(verifiedOrigin ? { allowedPrivateOrigins: [verifiedOrigin] } : {}),
      });
    }
    return { ok: true, taskKind: input.mode.taskKind, requestSummary };
  } catch (error) {
    const message = errorMessage(error);
    if (stage === "localize_reference" && !/素材|asset|upload|local|上传/i.test(message)) stage = "create";
    // 归类不在这里判——原样取抛出点已经查表定好的那个（见 errorCategory 注释）。
    const structured = error instanceof VendorRequestError ? error.structured : undefined;
    return {
      ok: false,
      taskKind: input.mode.taskKind,
      stage,
      error: message,
      ...(structured?.category ? { errorCategory: structured.category } : {}),
      ...(structured?.httpStatus ? { httpStatus: structured.httpStatus } : {}),
      requestSummary,
    };
  }
}
