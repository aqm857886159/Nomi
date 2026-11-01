/**
 * 接入套件里的「照着改」样例。**AI 写代码每次都能接，靠的四件事里，这是第二件**（§0）：
 * 眼前有 schema、**手里有例子**、改一份文件、跑一下看真话。
 *
 * ── 为什么是手写的字面量，不是从目录里现抓 ──────────────────────────────────────────
 * 内置目录里那些 mapping 行**没有 `sources`**（它们的出处写在代码注释与
 * `docs/evidence/2026-09-17-higgsfield-contract/` 里），而卡上每条 mode 的 `sourceUrls`
 * 必须出现在 `sources[]` 中。现抓就得替它们编一个出处——那正是这张卡要杜绝的事。
 * 所以这里手写，内容一字一句来自仓库里**已经实测固化**的那两份契约
 * （`catalog/higgsfieldVendor.ts` / `higgsfieldModels.ts` / `assetIngestionRegistry.ts`）。
 *
 * ── 手写的代价，由测试兜住 ────────────────────────────────────────────────────────
 * 样例会随 schema 和登记规则漂。`kit.test.ts` 把每一份都原样交给真实的声明提交（`submitDeclaration`：
 * 校验 + 登记 + 能力投影）——schema 或规则改了而样例没跟上，那条测试立刻红。
 * 「发给模型的例子自己就是非法的」是这类套件最贵的失败方式，所以它必须是机器守的。
 */
import type { ProviderAdapterDraft } from "../../providerAdapter/types";

const HIGGSFIELD_DOCS = "https://docs.higgsfield.ai/docs/llms-full.txt";
const HIGGSFIELD_PRICING = "https://docs.higgsfield.ai/docs/concepts/pricing";
const OPENAI_IMAGES_DOCS = "https://platform.openai.com/docs/api-reference/images/create";

export type OnboardingKitExample = {
  name: string;
  /** 这份样例是拿来解决哪一类形状的——AI 照着挑，而不是三份都读完。 */
  useWhen: string;
  card: ProviderAdapterDraft;
};

/**
 * 样例一：**异步任务 + 非 Bearer 方案词 + 自己的上传通道**（Higgsfield，仓库实测契约）。
 * 覆盖 AI 最容易写错的四格：`authScheme`、`delivery:"asynchronous"` 必须配 `query`、
 * 轮询路径里的 `{{providerMeta.task_id}}`、以及产物键在图片与视频之间的不对称
 * （`images.0.url` vs `video.url`——2026-09-17 真机跑出来才发现的那一条）。
 */
const ASYNC_TASK_EXAMPLE: OnboardingKitExample = {
  name: "asynchronous-task-provider",
  useWhen:
    "The provider takes a job and hands back a request id you poll (create -> query -> artifact), and/or puts the key in Authorization behind a scheme word that is not Bearer.",
  card: {
    provider: {
      baseUrl: "https://api.higgsfield.ai",
      authType: "bearer",
      authHeader: "Authorization",
      // key 前面的方案词。写错这一格的症状是 401，而 401 看起来像「key 不对」。
      authScheme: "Key",
    },
    sources: [
      {
        url: HIGGSFIELD_DOCS,
        evidence:
          "POST /<endpoint-id>; Authorization: Key <KEY_ID>:<KEY_SECRET>; RequestStatus{status in queued|in_progress|completed|failed|canceled|nsfw, request_id, status_url, cancel_url, images[], video}; poll GET /requests/{id}/status",
      },
      {
        url: HIGGSFIELD_PRICING,
        evidence: "POST /estimate/<endpoint-id> returns {type:'estimate', credits, usd} without queueing a job.",
      },
    ],
    // 这家有自己的上传通道，参考图不经任何第三方图床。
    assetIngestion: {
      strategy: "upload-initiate-put",
      endpoint: "https://api.higgsfield.ai/files/generate-upload-url",
      initContentTypeField: "content_type",
      uploadUrlPath: "upload_url",
      uploadHeadersPath: "upload_headers",
      urlPath: "public_url",
      authType: "key",
      accepts: ["image", "video", "audio"],
      ttlSeconds: 604_800,
      sourceUrl: HIGGSFIELD_DOCS,
    },
    // 免费自检：报价端点，不排任务、不扣费。自检**绝不能**打生成端点（校验器会拒）。
    selfCheck: {
      kind: "liveness-probe",
      request: { method: "POST", path: "/estimate/higgsfield-ai/soul/v2/standard", body: { prompt: "ping" } },
      successPath: "credits",
      sourceUrl: HIGGSFIELD_PRICING,
    },
    models: [
      {
        modelKey: "higgsfield-ai/soul/v2/standard",
        labelZh: "Soul 2",
        kind: "image",
        parameters: [
          { key: "aspect_ratio", label: "画幅", type: "select", options: [{ value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" }, { value: "1:1", label: "1:1" }], default: "16:9", sourceUrl: HIGGSFIELD_DOCS },
          { key: "resolution", label: "分辨率", type: "select", options: [{ value: "1080p", label: "1080p" }, { value: "720p", label: "720p" }], default: "1080p", sourceUrl: HIGGSFIELD_DOCS },
        ],
        modes: [
          {
            taskKind: "text_to_image",
            delivery: "asynchronous",
            create: {
              method: "POST",
              path: "/higgsfield-ai/soul/v2/standard",
              body: {
                prompt: "{{request.prompt}}",
                aspect_ratio: "{{request.params.aspect_ratio}}",
                resolution: "{{request.params.resolution}}",
              },
              response_mapping: { task_id: "request_id", status: "status" },
              // 创建响应里的任务 id 存进 providerMeta，轮询路径再把它模板化回去。
              provider_meta_mapping: { task_id: "request_id" },
            },
            query: {
              method: "GET",
              path: "/requests/{{providerMeta.task_id}}/status",
              response_mapping: { task_id: "request_id", status: "status", image_url: "images.0.url", error_message: "detail" },
            },
            // 只声明通用词表不认识的那个动词；别把 queued/failed 这些再抄一遍。
            statusMapping: { failed: ["nsfw"] },
            sourceUrls: [HIGGSFIELD_DOCS],
          },
        ],
      },
      {
        modelKey: "higgsfield-ai/dop/standard",
        labelZh: "DoP",
        kind: "video",
        modes: [
          {
            taskKind: "image_to_video",
            delivery: "asynchronous",
            // 带参考图的模式必须声明 referenceParam / referenceShape：它们告诉 Nomi
            // 把用户挂在节点上的那张图放进请求体的哪一格。
            referenceParam: "image_url",
            referenceShape: "single",
            create: {
              method: "POST",
              path: "/higgsfield-ai/dop/standard",
              body: { prompt: "{{request.prompt}}", image_url: "{{request.params.image_url}}" },
              response_mapping: { task_id: "request_id", status: "status" },
              provider_meta_mapping: { task_id: "request_id" },
            },
            query: {
              method: "GET",
              path: "/requests/{{providerMeta.task_id}}/status",
              // 视频产物是单数对象 `video:{url}`，不是 `videos[0].url`——写错会「任务成功但取不到产物」。
              response_mapping: { task_id: "request_id", status: "status", video_url: "video.url", error_message: "detail" },
            },
            statusMapping: { failed: ["nsfw"] },
            sourceUrls: [HIGGSFIELD_DOCS],
          },
        ],
      },
    ],
  },
};

/**
 * 样例二：**同步返回 + OpenAI 兼容形状**（中转站最常见的那一种）。
 * 覆盖另一半形状：`delivery:"synchronous"` 时**不写** `query`／`statusMapping`，产物直接从
 * create 的响应里取；参考图用行内 base64 送。
 * 另一格容易写错的是参数键：参数只用 Nomi 的中性键（这里是 `resolution`），供应商自己的字段名（`size`）
 * 留在线缆里，由它去读中性键。把参数键写成 `size` 会被登记门拒掉。
 */
const SYNCHRONOUS_EXAMPLE: OnboardingKitExample = {
  name: "synchronous-openai-compatible",
  useWhen:
    "The provider returns the artifact on the same call (no task id, no polling) — most OpenAI-compatible relays look like this.",
  card: {
    provider: {
      baseUrl: "https://api.openai.com",
      authType: "bearer",
      authHeader: "Authorization",
      providerKind: "openai-compatible",
    },
    sources: [
      {
        url: OPENAI_IMAGES_DOCS,
        evidence:
          "POST /v1/images/generations with {model, prompt, size} returns {data:[{url}]} on the same request; Authorization: Bearer <key>.",
      },
    ],
    assetIngestion: {
      strategy: "inline-base64",
      accepts: ["image"],
      sourceUrl: OPENAI_IMAGES_DOCS,
    },
    models: [
      {
        modelKey: "gpt-image-1",
        labelZh: "GPT Image 1",
        kind: "image",
        parameters: [
          { key: "resolution", label: "尺寸", type: "select", options: [{ value: "1024x1024", label: "1024x1024" }, { value: "1536x1024", label: "1536x1024" }], default: "1024x1024", sourceUrl: OPENAI_IMAGES_DOCS },
        ],
        modes: [
          {
            taskKind: "text_to_image",
            delivery: "synchronous",
            create: {
              method: "POST",
              path: "/v1/images/generations",
              body: { model: "gpt-image-1", prompt: "{{request.prompt}}", size: "{{request.params.resolution}}" },
              response_mapping: { image_url: "data.0.url" },
            },
            sourceUrls: [OPENAI_IMAGES_DOCS],
          },
        ],
      },
    ],
  },
};

/** 两份，不是二十份：多给一份就多一份会漂的东西，而这两份覆盖了同步／异步两半。 */
export const ONBOARDING_KIT_EXAMPLES: readonly OnboardingKitExample[] = [
  ASYNC_TASK_EXAMPLE,
  SYNCHRONOUS_EXAMPLE,
];
