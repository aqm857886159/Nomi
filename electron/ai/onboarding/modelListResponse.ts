// 「这个响应到底是不是模型列表」的唯一判据（中转拉取式接入 Issue #8）。
//
// 为什么要单独一个纯函数：拉模型是**多候选探测**（裸地址 → 依次试 /models、/v1/models）。
// 判「命中」如果只看 HTTP 200，就会被 new-api / one-api 这类网关坑死——它们的后台是 SPA，
// **任何未知路径都回 200 + 一整页 index.html**。于是 `{baseUrl}/models` 200 HTML 被当成命中，
// 探测提前收工，真正对的 `{baseUrl}/v1/models` 永远轮不到（用户看到「这个地址没列出模型」）。
//
// 根因层的判据是：**解析得出模型 id 列表才算命中**，解析不出就继续试下一个候选。

/** 解析模型列表响应体。返回 null = 这压根不是模型列表（HTML/错误页/别的 JSON），调用方应继续试下一个候选。 */
export function parseModelListResponse(bodyText: string): string[] | null {
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return null; // HTML 首页、纯文本错误页等
  }
  // OpenAI 标准 { data: [...] }；少数网关直接回顶层数组。
  const list = Array.isArray(json)
    ? json
    : Array.isArray((json as { data?: unknown })?.data)
      ? ((json as { data: unknown[] }).data)
      : null;
  if (!list) return null;
  // 元素形状：{ id } 为主，少数网关给裸字符串。
  return list
    .map((item) => (typeof item === "string" ? item : String((item as { id?: unknown })?.id ?? "")).trim())
    .filter(Boolean);
}
