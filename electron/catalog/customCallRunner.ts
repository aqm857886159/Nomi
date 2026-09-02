// 自定义调用脚本执行器（主进程）。脚本在独立 QuickJS/WASM realm 中运行，只能使用
// customCallContract 声明的变量与显式桥接能力；绝不自动安装或执行远程脚本（plan §10）。
//
// 网络全走 vendorHttp.requestJson/requestMultipart（与主路径同核）：代理/SOCKS、逻辑错误检测、
// 结构化 VendorRequestError 免费继承。**刻意不做 SSRF 私网拦截**——地址是用户显式写的，
// LAN 中转合法（与资产回捞 assertSafeUrl 的“被动跟随响应”场景不同）。
//
// transcript：http/request 每次调用记一条（Authorization/apiKey 脱敏），试跑面板摊开
// 「实际发了什么」——参考图第三闸对脚本失明的补偿（plan §10）。
import { isJsonRecord, type JsonRecord } from "../jsonUtils";
import { requestJson, requestMultipart, vendorResponseLimitForKind, VendorRequestError } from "../vendor/vendorHttp";
import { CustomCallSandboxError, runCustomCallSandbox } from "./customCallSandbox";
import type { Model, ProfileKind, Vendor } from "./types";
import { desktopT } from "../i18n";

export type CustomCallTranscriptEntry = {
  method: string;
  url: string;
  status: "ok" | "error";
  durationMs: number;
  requestPreview?: string;
  responsePreview?: string;
  errorMessage?: string;
};

export type CustomCallScriptResult = {
  /** 归一后的产物（URL 或 dataURL）。 */
  assets: string[];
  /**
   * 文本产出。文本模型的脚本 `return { text: '…' }` 走这里——它不是资产，不能塞进 assets
   * （塞进去下游会把整段文字当 URL 去下载）。见 collectCustomCallText。
   */
  text?: string;
  transcript: CustomCallTranscriptEntry[];
};

const PREVIEW_LIMIT = 2000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function customCallTimeoutReason(timeoutMs: number): Error {
  const error = new Error(desktopT("customCall.timeout", { seconds: Math.round(timeoutMs / 1000) }));
  error.name = "TimeoutError";
  return error;
}

function preview(value: unknown, redact: (s: string) => string): string | undefined {
  if (value === undefined || value === null) return undefined;
  let text: string;
  if (typeof value === "string") text = value;
  else if (typeof FormData !== "undefined" && value instanceof FormData) {
    text = `FormData(${[...value.keys()].join(", ")})`;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  return redact(text).slice(0, PREVIEW_LIMIT);
}

/**
 * 脚本返回值 → 文本产出。只认**显式**的文本形状（字符串 text/content/output_text 字段），
 * 不把裸字符串当文本——裸字符串是资产 URL 的既有约定，两者抢同一个形状会让图片模型的
 * URL 被当成正文。文本模型请 `return { text: '…' }`。
 */
export function collectCustomCallText(result: unknown): string | undefined {
  if (!isJsonRecord(result)) return undefined;
  const record = result as JsonRecord;
  for (const key of ["text", "content", "output_text"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

/** 脚本返回值 → 产物列表。宽松归一（与 infinite-canvas 同精神），空产出=人话报错。 */
export function collectCustomCallAssets(result: unknown): string[] {
  const items = Array.isArray(result) ? result : [result];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
      continue;
    }
    if (!isJsonRecord(item)) continue;
    const record = item as JsonRecord;
    const single = [record.url, record.video_url, record.image_url, record.dataUrl].find(
      (v) => typeof v === "string" && v.trim(),
    );
    if (typeof single === "string") {
      out.push(single.trim());
      continue;
    }
    if (typeof record.b64_json === "string" && record.b64_json.trim()) {
      out.push(`data:image/png;base64,${record.b64_json.trim()}`);
      continue;
    }
    if (Array.isArray(record.urls)) {
      for (const u of record.urls) if (typeof u === "string" && u.trim()) out.push(u.trim());
    }
  }
  return out;
}

/** params 里的标准参考键 → 便捷视图（键名与 archetypeInput 标准键一一对应，单源在那边）。 */
export function referencesViewFromParams(params: JsonRecord): {
  firstFrame?: string;
  lastFrame?: string;
  images: string[];
  videos: string[];
  audios: string[];
} {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
  return {
    firstFrame: str(params.first_frame_url),
    lastFrame: str(params.last_frame_url),
    images: arr(params.reference_image_urls).length ? arr(params.reference_image_urls) : arr(params.reference_images),
    videos: arr(params.reference_video_urls),
    audios: arr(params.reference_audio_urls),
  };
}

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

function restoreSandboxFormData(value: unknown): FormData | null {
  if (!isJsonRecord(value) || value.__nomiFormData !== true || !Array.isArray(value.entries)) return null;
  const form = new FormData();
  for (const rawEntry of value.entries) {
    if (!isJsonRecord(rawEntry) || typeof rawEntry.name !== "string" || !isJsonRecord(rawEntry.value)) {
      throw new Error(desktopT("customCall.formDataEntry"));
    }
    const filename = typeof rawEntry.filename === "string" ? rawEntry.filename : undefined;
    if (rawEntry.value.kind === "bytes") {
      if (!Array.isArray(rawEntry.value.bytes) || !rawEntry.value.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
        throw new Error(desktopT("customCall.formDataBytes", { name: rawEntry.name }));
      }
      form.append(rawEntry.name, new Blob([Uint8Array.from(rawEntry.value.bytes as number[])]), filename || "file.bin");
      continue;
    }
    if (rawEntry.value.kind !== "string") throw new Error(desktopT("customCall.formDataValue", { name: rawEntry.name }));
    form.append(rawEntry.name, String(rawEntry.value.value ?? ""));
  }
  return form;
}

export async function runCustomCallScript(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  /** Plaintext exists only in main-process memory and never crosses IPC. */
  customConfig?: Record<string, string>;
  script: string;
  prompt: string;
  params: JsonRecord;
  /** 由 selectTaskMapping/request.kind 确认的传输通道，只读注入脚本。 */
  taskKind: ProfileKind;
  /** 由 ModelArchetype / 显式能力契约验证后的模式；未知时不猜，注入 undefined。 */
  modeId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /**
   * 把脚本拿到的二进制落成本地资产，返回可用的 URL（注入避免 ↔ runtime 循环依赖，同 localizeTaskAsset）。
   * 没有它，「上游只给字节流不给 URL」那类模型（Sora 的下载端点、Stability v2beta）只能转成
   * data URL —— 图片尚可，几十 MB 的视频就离谱了。缺省不注入时脚本里没有 saveFile。
   */
  saveFile?: (bytes: Buffer, ext: string, contentType: string) => Promise<string>;
}): Promise<CustomCallScriptResult> {
  const { vendor, apiKey } = input;
  const customConfig = input.customConfig || {};
  const baseUrl = String(vendor.baseUrlHint || "").replace(/\/+$/, "");
  const transcript: CustomCallTranscriptEntry[] = [];
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadlineAt = Date.now() + timeoutMs;
  const timer = setTimeout(() => controller.abort(customCallTimeoutReason(timeoutMs)), timeoutMs);
  const relayAbort = () => controller.abort(input.signal?.reason);
  if (input.signal) {
    if (input.signal.aborted) relayAbort();
    else input.signal.addEventListener("abort", relayAbort, { once: true });
  }
  const secretVariants = [...new Set([apiKey, ...Object.values(customConfig)]
    .filter((value) => value.length > 0)
    .flatMap((value) => [
      value,
      encodeURIComponent(value),
      new URLSearchParams({ value }).toString().slice("value=".length),
      JSON.stringify(value).slice(1, -1),
    ]))]
    .sort((left, right) => right.length - left.length);
  const redact = (text: string): string => secretVariants.reduce(
    (safe, secret) => safe.split(secret).join("•••"),
    text,
  );

  const record = async <T>(method: string, url: string, body: unknown, run: () => Promise<T>): Promise<T> => {
    if (controller.signal.aborted) throw controller.signal.reason instanceof Error ? controller.signal.reason : new Error("aborted");
    const started = Date.now();
    try {
      const response = await run();
      transcript.push({
        method: method.toUpperCase(),
        url: redact(url),
        status: "ok",
        durationMs: Date.now() - started,
        requestPreview: preview(body, redact),
        responsePreview: preview(response, redact),
      });
      return response;
    } catch (error) {
      transcript.push({
        method: method.toUpperCase(),
        url: redact(url),
        status: "error",
        durationMs: Date.now() - started,
        requestPreview: preview(body, redact),
        errorMessage: redact(error instanceof Error ? error.message : String(error)).slice(0, PREVIEW_LIMIT),
      });
      throw error;
    }
  };

  const doRequest = (init: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    query?: Record<string, unknown>;
    body?: unknown;
  }) => {
    const url = joinUrl(baseUrl, String(init.url || ""));
    const headers = init.headers || {};
    const restoredForm = restoreSandboxFormData(init.body);
    const body = restoredForm ?? init.body;
    return record(init.method, url, body, () =>
      restoredForm
        ? requestMultipart(vendor, apiKey, url, headers, init.query || {}, restoredForm, controller.signal, {
            maxResponseBytes: vendorResponseLimitForKind(input.model.kind),
          })
        : requestJson(vendor, apiKey, String(init.method || "POST"), url, headers, init.query || {}, body, controller.signal, {
            maxResponseBytes: vendorResponseLimitForKind(input.model.kind),
          }),
    );
  };

  const references = referencesViewFromParams(input.params);
  const modelId = String(input.model.modelAlias || input.model.modelKey);
  const globals: Record<string, unknown> = {
    prompt: input.prompt,
    taskKind: input.taskKind,
    modeId: input.modeId,
    params: input.params,
    references,
    model: modelId,
    baseUrl,
    apiKey,
    // 用户在「自定义配置」里填的任意键值。Nomi 只准备了一个密钥槽，而腾讯要 SecretId+SecretKey、
    // Kling 要 AK+SK 每 30 分钟重签——与其我们一个个猜着加字段（永远追不上），不如给一张空白表。
    config: customConfig,
  };
  try {
    const raw = await runCustomCallSandbox({
      script: input.script,
      globals,
      signal: controller.signal,
      deadlineAt,
      request: (init) => doRequest(init as Parameters<typeof doRequest>[0]),
      saveFile: async ({ bytes, ext, contentType }) => {
        if (!input.saveFile) {
          throw new Error(desktopT("customCall.saveFileUnavailable"));
        }
        return input.saveFile(Buffer.from(bytes), ext.replace(/^\./, "") || "bin", contentType || "application/octet-stream");
      },
      redact,
    });
    // 文本先看：文本模型 return { text } 不产出资产，走 assets 那条会被当成 URL 去下载。
    const text = collectCustomCallText(raw);
    if (text) return { assets: [], text, transcript };
    const assets = collectCustomCallAssets(raw);
    if (assets.length === 0)
      throw new Error(desktopT("customCall.noOutput"));
    return { assets, transcript };
  } catch (error) {
    const rawMessage = redact(error instanceof Error ? error.message : String(error));
    const message = error instanceof CustomCallSandboxError && error.kind === "syntax"
      ? `自定义调用脚本语法错误：${rawMessage}`
      : rawMessage;
    const rawCauseError = error instanceof CustomCallSandboxError && error.causeError !== undefined
      ? error.causeError
      : error;
    const causeError = rawCauseError instanceof VendorRequestError
      ? new VendorRequestError(redact(rawCauseError.message), {
          ...rawCauseError.structured,
          url: redact(rawCauseError.structured.url),
          upstreamMsg: redact(rawCauseError.structured.upstreamMsg),
        })
      : rawCauseError instanceof Error
        ? Object.assign(new Error(redact(rawCauseError.message)), { name: rawCauseError.name })
        : rawCauseError;
    throw new CustomCallScriptError(message, transcript, causeError);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", relayAbort);
  }
}

/** 带 transcript 的失败：试跑面板要摊开「发了什么、错在哪」。cause 保留原始错误
 *  （VendorRequestError 的结构化分类信息），runtime 派发点会解包重抛给渲染层分类器。 */
export class CustomCallScriptError extends Error {
  transcript: CustomCallTranscriptEntry[];
  causeError: unknown;
  constructor(message: string, transcript: CustomCallTranscriptEntry[], causeError?: unknown) {
    super(message);
    this.name = "CustomCallScriptError";
    this.transcript = transcript;
    this.causeError = causeError;
  }
}
