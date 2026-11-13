import { firstString, isJsonRecord, type JsonRecord } from "../jsonUtils";
import { contentTypeFromMagicBytes } from "../assets/mediaTypes";
export { certifyTaskOutputUrls } from "./taskResultCertification";

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
 * 从原始响应里取出这一笔的全部资产地址（试常见路径：url/video_url/image_url/model_url/output/
 * data[].url|b64_json/images[].url/videos[].url/result.*），末尾再兜 chat/completions 多模态图片返回
 * （见 extractChatImageUrls）。按顺序取**第一处有地址的位置**，那一处的列表整张取：一次运行给几份就是几份，
 * 别处的地址不搭车。纯函数，从 runtime.ts 下沉（R9 巨壳瘦身）。
 */
export function extractAssetUrls(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as JsonRecord;
  const list = (value: unknown): JsonRecord[] => (Array.isArray(value) ? value.filter(isJsonRecord) : []);
  const result = isJsonRecord(record.result) ? record.result : undefined;
  const groups: Array<() => unknown[]> = [
    () => [record.url],
    () => [record.video_url],
    () => [record.image_url],
    () => [record.audio_url],
    () => [record.model_url],
    () => (Array.isArray(record.output) ? record.output : [record.output]),
    () => list(record.data).map((item) => item.url),
    () => list(record.data).map((item) => base64ImageDataUrl(item.b64_json)),
    () => list(record.images).map((item) => item.url),
    () => list(record.videos).map((item) => item.url),
    () => [result?.url],
    () => [result?.video_url],
    () => [result?.image_url],
    () => [result?.audio_url],
    // chat/completions 多模态图片返回（gemini/nano-banana 系图生图走这条：图在 choices[].message 里，
    // 不是 OpenAI images 端点的顶层 data[]）。放最后兜底，不影响上面既有 images 端点口径。
    () => extractChatImageUrls(record),
  ];
  for (const group of groups) {
    const urls = Array.from(new Set(group().map((value) => firstString(value)).filter(Boolean)));
    if (urls.length) return urls;
  }
  return [];
}

/**
 * 从 chat/completions 响应里抠图（gemini/nano-banana 系图生图返回），每个 choice 都看（请求 n 份就有 n 个 choice）。
 * 每个 choice 的 message 按三种形态取，取到的那种整张取：
 *   ① message.images:[{url|b64_json}]（部分中转结构化返回）
 *   ② message.content 是多模态数组：{type:"image_url",image_url:{url}} / 含 url|b64_json 的项
 *   ③ message.content 是字符串：markdown ![](url) / 裸 data:image base64 / 裸 http 图片 url
 * 取不到返回空列表。
 */
export function extractChatImageUrls(raw: JsonRecord): string[] {
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const urls: string[] = [];
  for (const choice of choices) {
    const message = isJsonRecord(choice) ? (choice.message as unknown) : undefined;
    if (!isJsonRecord(message)) continue;
    urls.push(...chatMessageImageUrls(message));
  }
  return Array.from(new Set(urls));
}

function chatMessageImageUrls(message: JsonRecord): string[] {
  // ① 结构化 images 数组
  if (Array.isArray(message.images)) {
    const found = message.images.filter(isJsonRecord)
      .map((img) => firstString(img.url, img.image_url, base64ImageDataUrl(img.b64_json))).filter(Boolean);
    if (found.length) return found;
  }
  // ② content 多模态数组
  if (Array.isArray(message.content)) {
    const found = message.content.filter(isJsonRecord).map((part) => {
      const imageUrl = part.image_url;
      return firstString(
        typeof imageUrl === "string" ? imageUrl : isJsonRecord(imageUrl) ? imageUrl.url : "",
        part.url,
        base64ImageDataUrl(part.b64_json),
      );
    }).filter(Boolean);
    if (found.length) return found;
  }
  // ③ content 字符串
  if (typeof message.content === "string") return extractImagesFromText(message.content);
  return [];
}

/** 从一段文本里抠图 URL：markdown ![](…) > 裸 data:image base64 > 裸 http(s) 图片链接，取到的那一种全部取。 */
function extractImagesFromText(text: string): string[] {
  const md = Array.from(text.matchAll(/!\[[^\]]*\]\((data:image\/[^)]+|https?:\/\/[^)\s]+)\)/gi), (match) => match[1]!);
  if (md.length) return md;
  const dataUri = Array.from(text.matchAll(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g), (match) => match[0]);
  if (dataUri.length) return dataUri;
  return Array.from(text.matchAll(/https?:\/\/[^\s)]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s)]*)?/gi), (match) => match[0]);
}
