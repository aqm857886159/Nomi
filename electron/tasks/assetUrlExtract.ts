import { firstString, isJsonRecord, type JsonRecord } from "../jsonUtils";
import { contentTypeFromMagicBytes } from "../assets/mediaTypes";

/**
 * `b64_json` → data URL，**类型取自字节而非写死 image/png**。
 *
 * 为什么（2026-08-26）：厂商回的 b64_json 常是 JPEG（火山方舟 / kie 均如此）。写死
 * `data:image/png;base64,` 会让这段 JPEG 一路顶着 image/png 的假身份走到落盘层，
 * 于是产物被命名成 `.png`。这里解头几个字节按魔数说实话；认不出才回退 image/png。
 */
function base64ImageDataUrl(b64Json: unknown): string {
  const data = typeof b64Json === "string" ? b64Json.trim() : "";
  if (!data) return "";
  let sniffed: string | null = null;
  try {
    sniffed = contentTypeFromMagicBytes(Buffer.from(data.slice(0, 32), "base64"));
  } catch {
    // 非法 base64：交给下游按 image/png 兜底，不在抽取层抛。
  }
  return `data:${sniffed || "image/png"};base64,${data}`;
}

/**
 * 从原始响应里尽力取出第一个资产 URL（试 ~12 种常见路径：url/video_url/image_url/model_url/
 * data[0].url|b64_json/images[0].url/videos[0].url/result.*），末尾再兜 chat/completions
 * 多模态图片返回（见 extractChatImageUrl）。纯函数，从 runtime.ts 下沉（R9 巨壳瘦身）。
 */
export function extractAssetUrl(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const record = raw as JsonRecord;
  const candidates = [
    record.url,
    record.video_url,
    record.image_url,
    record.model_url,
    record.output,
    (record.data as JsonRecord[] | undefined)?.[0]?.url,
    base64ImageDataUrl((record.data as JsonRecord[] | undefined)?.[0]?.b64_json),
    (record.images as JsonRecord[] | undefined)?.[0]?.url,
    (record.videos as JsonRecord[] | undefined)?.[0]?.url,
    (record.result as JsonRecord | undefined)?.url,
    (record.result as JsonRecord | undefined)?.video_url,
    (record.result as JsonRecord | undefined)?.image_url,
    // chat/completions 多模态图片返回（gemini/nano-banana 系图生图走这条：图在 choices[0].message 里，
    // 不是 OpenAI images 端点的顶层 data[0]）。放最后兜底，不影响上面既有 images 端点口径。
    extractChatImageUrl(record),
  ];
  return firstString(...candidates);
}

/**
 * 从 chat/completions 响应的 choices[0].message 里抠图（gemini/nano-banana 系图生图返回）。三种形态：
 *   ① message.images:[{url|b64_json}]（部分中转结构化返回）
 *   ② message.content 是多模态数组：找 {type:"image_url",image_url:{url}} / 含 url|b64_json 的项
 *   ③ message.content 是字符串：markdown ![](url) / 裸 data:image base64 / 裸 http 图片 url
 * 取不到返回 ""。不改上面既有 images 端点口径（P1：只加不改）。
 */
export function extractChatImageUrl(raw: JsonRecord): string {
  const choices = raw.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const message = isJsonRecord(choices[0]) ? (choices[0].message as unknown) : undefined;
  if (!isJsonRecord(message)) return "";

  // ① 结构化 images 数组
  if (Array.isArray(message.images)) {
    for (const img of message.images) {
      if (!isJsonRecord(img)) continue;
      const u = firstString(img.url, img.image_url, base64ImageDataUrl(img.b64_json));
      if (u) return u;
    }
  }

  // ② content 多模态数组
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (!isJsonRecord(part)) continue;
      const imageUrl = part.image_url;
      const u = firstString(
        typeof imageUrl === "string" ? imageUrl : isJsonRecord(imageUrl) ? imageUrl.url : "",
        part.url,
        base64ImageDataUrl(part.b64_json),
      );
      if (u) return u;
    }
  }

  // ③ content 字符串
  if (typeof message.content === "string") return extractImageFromText(message.content);
  return "";
}

/** 从一段文本里抠图 URL：markdown ![](…) > 裸 data:image base64 > 裸 http(s) 图片链接。取不到返回 ""。 */
function extractImageFromText(text: string): string {
  const md = text.match(/!\[[^\]]*\]\((data:image\/[^)]+|https?:\/\/[^)\s]+)\)/i);
  if (md) return md[1];
  const dataUri = text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
  if (dataUri) return dataUri[0];
  const httpImg = text.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s)]*)?/i);
  if (httpImg) return httpImg[0];
  return "";
}
