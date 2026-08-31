// 免费探测中转站是否暴露 OpenAI 官方 /v1/images/edits（multipart）图生图端点。
//
// 为什么要探测（用户问「有没有可能自己测出来」）：图生图协议无 100% 可靠的纯模型名判据——同一个自建
// new-api 站可能只认 /v1/images/edits multipart（packyapi 等明确不支持 chat 出图），也可能只认 chat。
// 智能默认（按模型族猜）能覆盖 gpt-image*/dall-e*，但奇名模型会漏。探测按**站的真实能力**判，更稳。
//
// 机制（关键：**不触发付费生成、不花钱**）：发一个 multipart 请求但**故意缺 image 字段** → 请求在参数
// 校验就被挡下（进不了生成），读它的报错形状：
//   · 2xx / 400·422 且报错提到 image/required/missing → 端点在（只是嫌没给图）→ openai-multipart-edits
//   · 404/405/501 或报错像「路由不存在/no such/not found」→ 端点不在 → null（交回智能默认判 chat/xai）
//   · 其余（401/403 鉴权、5xx 服务端、网络失败、400 但没提 image）→ 拿不准 → null（**保守不猜**）
// 各站报错形状不统一，故多信号 + 保守：拿不准一律 null，绝不误判把 chat 站强判成 multipart。

export type ImageEditProbeOutcome = "openai-multipart-edits" | null;

// 端点在、只是缺图的正信号（英文各家措辞双向：image 在关键词前或后 + 中文）。
const ENDPOINT_PRESENT_RE =
  /image[^.]{0,24}(required|missing|must|empty|provide|expected|need)|(required|missing|must|provide|expected|need|empty|upload|no)[^.]{0,24}image|'image'|"image"|image\[\]|缺.{0,6}图|图片?.{0,8}(必填|不能为空|缺失|必须|不可为空)/i;
// 端点根本不在的负信号（路由/模型未找到）。
const ENDPOINT_ABSENT_RE =
  /not\s*found|no\s*such|unknown\s*(path|route|endpoint|model|url)|invalid\s*url|route[^.]{0,16}not|does\s*not\s*exist|无此|不存在|未找到|无效的?\s*(路径|路由|接口)/i;

/** 纯分类器（可单测各站报错形状）：状态码 + 报错文本 → 是否判定该站有 OpenAI multipart edits 端点。 */
export function classifyImageEditProbe(status: number | null, errorText: string): ImageEditProbeOutcome {
  const text = String(errorText || "");
  // 2xx：端点确实在（少数站缺图也不报错直接受理）。
  if (typeof status === "number" && status >= 200 && status < 300) return "openai-multipart-edits";
  // 明确「端点不在」优先（避免负信号文本里恰好含 image 被误判成 present）。
  if (status === 404 || status === 405 || status === 501) return null;
  if (ENDPOINT_ABSENT_RE.test(text)) return null;
  // 端点在、只是缺图。
  if ((status === 400 || status === 422) && ENDPOINT_PRESENT_RE.test(text)) return "openai-multipart-edits";
  // 400 但没提 image、鉴权错、5xx——拿不准，保守交回智能默认。
  return null;
}

type ProbeResponse = { status: number; text: () => Promise<string> };
type ProbeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: FormData; signal?: AbortSignal },
) => Promise<ProbeResponse>;

/**
 * 对一个中转站探测 /v1/images/edits 端点存在性。发 multipart（model+prompt，**无 image**）读报错形状。
 * baseUrl 裸根（不带 /v1）；apiKey 可空（有的站探测用不到鉴权）。fetchImpl 供单测注入。
 * 任何异常/超时 → null（拿不准，绝不阻塞接入，绝不误判）。
 */
export async function probeImageEditProtocol(input: {
  baseUrl: string;
  apiKey?: string;
  modelKey: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  fetchImpl?: ProbeFetch;
}): Promise<ImageEditProbeOutcome> {
  const base = String(input.baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return null;
  const url = `${base}/v1/images/edits`;
  const headers: Record<string, string> = {
    ...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {}),
    ...(input.headers || {}),
  };
  const form = new FormData();
  form.append("model", input.modelKey || "");
  form.append("prompt", "ping"); // 故意不 append image[]：探端点存在性，非真生成
  const doFetch: ProbeFetch = input.fetchImpl || ((u, init) => fetch(u, init) as unknown as Promise<ProbeResponse>);
  try {
    const res = await doFetch(url, { method: "POST", headers, body: form, signal: input.signal });
    const text = await res.text().catch(() => "");
    return classifyImageEditProbe(res.status, text);
  } catch {
    return null;
  }
}
