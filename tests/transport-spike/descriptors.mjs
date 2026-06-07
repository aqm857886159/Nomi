// 6 家真实供应商的 Transport 描述符（字段来自 2026-06-07 官方文档调研）。
// 覆盖 3 种 transport：images-sync / chat-modalities / async-task。
// 验证目标：同一个解释器 + 这些纯数据描述符，能否为各家构造出"形状正确"的请求。

export const DESCRIPTORS = [
  // ── A. images-sync ──
  {
    id: "siliconflow",
    transport: "images-sync",
    endpoint: "https://api.siliconflow.cn/v1/images/generations",
    auth: "bearer",
    defaultModel: "Kwai-Kolors/Kolors",
    requestMap: [
      { to: "model", from: "model" },
      { to: "prompt", from: "prompt" },
      { to: "image_size", from: "size" },   // 关键：size → image_size（SiliconFlow 字段名）
    ],
    responsePath: "images[].url",
  },
  {
    id: "openai",
    transport: "images-sync",
    endpoint: "https://api.openai.com/v1/images/generations",
    auth: "bearer",
    defaultModel: "gpt-image-1",
    requestMap: [
      { to: "model", from: "model" },
      { to: "prompt", from: "prompt" },
      { to: "size", from: "size" },
    ],
    responsePath: "data[].b64_json",
  },

  // ── B. chat-modalities（图走 chat 通道）──
  {
    id: "openrouter",
    transport: "chat-modalities",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    auth: "bearer",
    defaultModel: "google/gemini-2.5-flash-image-preview",
    modalities: ["image", "text"],
    imageConfigKey: "image_config",
    responsePath: "choices[0].message.images[].image_url.url",
  },

  // ── C. async-task（提交→轮询→取结果）──
  {
    id: "replicate",
    transport: "async-task",
    endpoint: "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions", // model 在 path
    auth: "bearer",
    requestMap: [
      { to: "input.prompt", from: "prompt" },   // 关键：嵌套路径 input.prompt
    ],
    poll: { taskIdPath: "id", statusField: "status", successValue: "succeeded", resultPath: "output" },
  },
  {
    id: "fal",
    transport: "async-task",
    endpoint: "https://queue.fal.run/fal-ai/flux/schnell", // model 在 path
    auth: "key",                                            // 关键：fal 用 "Authorization: Key <key>" 不是 Bearer
    requestMap: [
      { to: "prompt", from: "prompt" },                    // 平铺
    ],
    poll: { taskIdPath: "request_id", endpoint: "fromResponse:status_url", statusField: "status", successValue: "COMPLETED" },
  },
  {
    id: "kie",
    transport: "async-task",
    endpoint: "https://api.kie.ai/api/v1/jobs/createTask",
    auth: "bearer",
    defaultModel: "google/nano-banana",
    requestMap: [
      { to: "model", from: "model" },
      { to: "input.prompt", from: "prompt" },              // 关键：参数在 input 内
    ],
    poll: { taskIdPath: "data.taskId", endpoint: "https://api.kie.ai/api/v1/jobs/recordInfo", statusField: "state", successValue: "success", resultPath: "data.resultJson|json:resultUrls[]" },
  },
];
