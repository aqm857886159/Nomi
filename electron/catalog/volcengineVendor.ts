// 火山方舟（Volcengine Ark）供应商种子。
// 真实 probe 验证（2026-06-19，用户 key）：
//   - 认证：Bearer API key（ark- 开头），核心生成不用 AK/SK V4 签名（那套只在头像素材子系统）。
//   - modelKey 用模型直连名（如 doubao-seedream-5-0-260128），不用推理接入点 endpoint id。
//   - 图片 Seedream **同步**：POST /api/v3/images/generations → { data:[{ url, size }], usage }（data[0].url 即结果）。
//   - 视频 Seedance 异步（/api/v3/contents/generations/tasks）。
//
// baseUrl 取**官方文档口径** `https://ark.cn-beijing.volces.com/api/v3`，与 providerPresets 的火山那条一致
// （2026-08-26 统一）。此前这里是裸 host、预设是带 /api/v3，两份地址各说各话；加上 deriveVendorKeyFromBaseUrl
// 按 hostname 造 key，向导接入会另立一个 `ark-cn-beijing-volces-com` 供应商 → 同一家劈成两个柜子。
// 原生 op 声明 pathFrom:"host-root"，其 `/api/v3/...` 路径经 hostRootJoin 的重叠段折叠仍精确落位；
// 文本 `/v1/chat/completions` 经 joinUrl 的版本段折叠落到 `/api/v3/chat/completions`。两条都在
// nativeWireHostRoot.test.ts 的矩阵里钉死。
export const VOLCENGINE_VENDOR_SEED = {
  key: "volcengine",
  name: "火山方舟",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  authType: "bearer" as const,
  authHeader: "Authorization",
} as const;

// 火山「语音技术」是**独立产品线**（与方舟 LLM/图片不同域、不同鉴权）——豆包语音 2.0 配音走这家。
// 真实契约（2026-06-24 实查 openspeech 文档 + 接入手册，非记忆）：
//   - 域名 openspeech.bytedance.com（非 ark）；端点 POST /api/v3/tts/unidirectional（2.0 必须 V3）。
//   - 鉴权**三头**：X-Api-App-Id / X-Api-Access-Key / X-Api-Resource-Id（非 bearer）。
//     vendor.authType 表达不了三头，故声明 "none"——三头由 audioTaskRunner 手搓（凭证存 APP_ID:ACCESS_KEY）。
//   - 故必须独立 vendor：方舟那家存的是 ark- bearer key，与语音的 APP_ID:ACCESS_KEY 不是同一套凭证，
//     一个 vendor 只有一个 key 槽，合在一起会互相覆盖。
export const VOLCENGINE_SPEECH_VENDOR_SEED = {
  key: "volcengine-speech",
  name: "火山豆包语音",
  baseUrl: "https://openspeech.bytedance.com",
  authType: "none" as const,
  authHeader: null,
} as const;
