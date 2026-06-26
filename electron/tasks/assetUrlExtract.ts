import { firstString, type JsonRecord } from "../jsonUtils";

/**
 * 从原始响应里尽力取出第一个资产 URL（试 ~12 种常见路径：url/video_url/image_url/model_url/
 * data[0].url|b64_json/images[0].url/videos[0].url/result.*）。纯函数，从 runtime.ts 下沉（R9 巨壳瘦身）。
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
    (record.data as JsonRecord[] | undefined)?.[0]?.b64_json ? `data:image/png;base64,${(record.data as JsonRecord[])[0].b64_json}` : "",
    (record.images as JsonRecord[] | undefined)?.[0]?.url,
    (record.videos as JsonRecord[] | undefined)?.[0]?.url,
    (record.result as JsonRecord | undefined)?.url,
    (record.result as JsonRecord | undefined)?.video_url,
    (record.result as JsonRecord | undefined)?.image_url,
  ];
  return firstString(...candidates);
}
