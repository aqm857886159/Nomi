// 自定义调用脚本的**契约单源**：注入变量表 / 返回值约定 / 模板 / AI 生成指令，全从这里出。
// 编辑器 UI（变量说明的 i18n key 按 name 派生）、脚本执行器（new Function 形参表）、AI 帮写
// （指令正文）三处消费同一份——防「文档说有、实际没注入」类漂移（有对账单测）。
//
// 变量描述给 AI 的是这里的英文技术描述（提示词工程，不是 UI 文案）；用户可见的中文说明
// 走渲染层 i18n（customCall.vars.<name>），单测对账两边键集合一致。

export type CustomCallVariableDoc = {
  name: string;
  type: string;
  /** 给 AI 指令用的技术描述（英文，非 UI 文案）。 */
  desc: string;
};

/** 注入顺序即 new Function 形参顺序——runner 与此表逐项对齐（对账单测锁死）。 */
export const CUSTOM_CALL_VARIABLES: CustomCallVariableDoc[] = [
  { name: "prompt", type: "string", desc: "the user's prompt text" },
  {
    name: "params",
    type: "Record<string, unknown>",
    desc: "all generation params the UI collected (same table wire templates read): size, duration, n, seed, plus reference keys like first_frame_url / reference_image_urls",
  },
  {
    name: "references",
    type: "{ firstFrame?: string; lastFrame?: string; images: string[]; videos: string[]; audios: string[] }",
    desc: "convenience view over params reference keys; values are vendor-reachable URLs (already uploaded/localized by Nomi)",
  },
  { name: "model", type: "string", desc: "model id to send upstream (alias if configured, else key)" },
  { name: "baseUrl", type: "string", desc: "vendor base URL exactly as configured (may already end with /v1)" },
  { name: "apiKey", type: "string", desc: "vendor API key (add your own auth header when using `request`)" },
  {
    name: "config",
    type: "Record<string, string>",
    desc: "user-defined key/value pairs from this provider's custom config panel. The escape hatch for anything Nomi does not model: a second secret (AK/SK signing), region, api-version header, tenant id, account id. Read as config.<name>",
  },
  {
    name: "http",
    type: "{ post(path, body?, opts?): Promise<any>; get(path, opts?): Promise<any>; url(path): string }",
    desc: "convenience client: prefixes baseUrl for relative paths, sets Authorization: Bearer apiKey (override via opts.headers), JSON in/out; opts = { headers?, query? }",
  },
  {
    name: "request",
    type: "(init: { method: string; url: string; headers?: Record<string,string>; query?: Record<string,unknown>; body?: unknown }) => Promise<any>",
    desc: "raw request with NO default headers (write auth yourself); relative url is prefixed with baseUrl; body: object → JSON, string → as-is, FormData → multipart",
  },
  {
    name: "poll",
    type: "(fn: () => Promise<T>, extract: (v: T) => R | null | undefined | false, opts?: { intervalMs?: number; timeoutMs?: number }) => Promise<R>",
    desc: "repeat fn until extract returns a truthy value; default interval 2.5s, timeout 10min",
  },
  {
    name: "saveFile",
    type: "(bytes: Buffer | ArrayBuffer | Uint8Array, ext: string, contentType?: string) => Promise<string>",
    desc: "write raw bytes into the project as a local asset and get back a usable URL. Use this when the upstream returns a binary body instead of a URL (do NOT build a giant data: URL for video)",
  },
  { name: "sleep", type: "(ms: number) => Promise<void>", desc: "delay helper (abort-aware)" },
  { name: "signal", type: "AbortSignal", desc: "cancellation signal; http/request already honor it" },
];

export const CUSTOM_CALL_INJECTED_KEYS = CUSTOM_CALL_VARIABLES.map((v) => v.name);

/** 返回值约定（AI 指令 + 编辑器展示共用；用户可见文案版走 i18n customCall.returnContract）。 */
export const CUSTOM_CALL_RETURN_CONTRACT =
  "The script body must `return` the final result: an asset URL string (or data URL), an array of them, " +
  "or an object like { url } / { urls: [...] } / { video_url } / { image_url } / { b64_json }. " +
  "For a TEXT model, return { text: \"...\" } instead. " +
  "If the upstream hands you raw bytes rather than a URL, call saveFile(bytes, 'mp4') and return what it gives you. " +
  "For async upstreams, poll inside the script until done and return the final asset. Throw an Error with the upstream message on failure.";

export type CustomCallTemplate = { id: string; script: string };

/** 模板（编辑器「插入模板」）：故意只给 3 份最常用形状，别堆。label 走渲染层 i18n（customCall.template.<id>）。 */
export const CUSTOM_CALL_TEMPLATES: CustomCallTemplate[] = [
  {
    id: "openaiImage",
    script: `// OpenAI 兼容生图（同步返回）。改图时 references.images 有值。
const body = {
  model, prompt,
  n: params.n ?? 1,
  size: typeof params.size === 'string' ? params.size : undefined,
}
const data = await http.post('/images/generations', body)
return (data.data || []).map((item) =>
  item.url || (item.b64_json ? 'data:image/png;base64,' + item.b64_json : null))
`,
  },
  {
    id: "submitPollVideo",
    script: `// 提交任务 + 轮询取结果（多数视频中转的形状）。
const task = await http.post('/video/generations', {
  model, prompt,
  image_url: references.firstFrame ?? undefined,
  duration: params.duration || undefined,
  size: typeof params.size === 'string' ? params.size : undefined,
})
return await poll(
  () => http.get('/video/generations/' + (task.id || task.task_id)),
  (s) => {
    if (s.status === 'failed') throw new Error(s.error || s.message || '上游任务失败')
    return s.status === 'succeeded' || s.status === 'completed' ? (s.video_url || s.url) : null
  },
)
`,
  },
  {
    id: "chatMultimodalEdit",
    script: `// chat/completions 多模态改图（gemini / nano-banana 系中转常见）。
const content = [{ type: 'text', text: prompt }]
for (const url of references.images) content.push({ type: 'image_url', image_url: { url } })
const data = await http.post('/chat/completions', {
  model,
  messages: [{ role: 'user', content }],
})
const text = data.choices?.[0]?.message?.content || ''
const match = String(text).match(/https?:\\/\\/\\S+\\.(?:png|jpe?g|webp)\\S*/i) || String(text).match(/data:image\\/[a-z]+;base64,[A-Za-z0-9+/=]+/)
if (!match) throw new Error('响应里没有找到图片 URL：' + String(text).slice(0, 200))
return match[0]
`,
  },
];

/**
 * AI 帮写指令（提示词工程，主进程单源；渲染层经 IPC contract() 取走后拼上用户贴的材料发文本脑）。
 * 输出必须是**裸函数体**——渲染层还会剥一层 ``` 围栏兜底。
 */
export function buildCustomCallAiInstruction(input: {
  modelKey: string;
  kind: string;
  baseUrl: string;
  material: string;
  currentScript?: string;
  lastError?: string;
}): string {
  const vars = CUSTOM_CALL_VARIABLES.map((v) => `- ${v.name}: ${v.type} — ${v.desc}`).join("\n");
  const repair = input.currentScript
    ? `\n\nCurrent script (it failed — fix it, keep working parts):\n${input.currentScript}\n\nError / transcript from the failed test run:\n${input.lastError || "(none)"}`
    : "";
  return [
    `You are writing the body of an async JavaScript function that calls a generation API for the model "${input.modelKey}" (capability: ${input.kind}; base URL: ${input.baseUrl}).`,
    `Available variables (already in scope — do NOT redeclare them):\n${vars}`,
    CUSTOM_CALL_RETURN_CONTRACT,
    `Rules: output ONLY the raw function body statements — no markdown fences, no function wrapper, no explanations. Use await directly. Prefer \`http\` for Bearer-auth JSON APIs; use \`request\` when auth or content type is non-standard. Do not invent or guess an endpoint, HTTP method, auth scheme, request field, response path, or polling route. A base URL or model name alone is not enough evidence. If the material is insufficient for an exact call, put the missing facts in leading // comments, then \`throw new Error('接口材料不足：请补充实际 curl、请求样例或一次脱敏响应')\` before any call. In that case, do not make any network request.`,
    `API material provided by the user:\n${input.material || "(none)"}`,
  ].join("\n\n") + repair;
}
