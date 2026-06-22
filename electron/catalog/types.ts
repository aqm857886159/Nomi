// Catalog 领域类型的单一真相源（从 runtime.ts 抽出 —— 评审 CTO/M1 + 审计 P0-3）。
// electron 内部各处（runtime / seedBuiltins / kieSeedance …）一处定义、各处 import，避免漂移。
// 渲染层不消费这些（electron 专用；渲染层有自己的 DTO，经 desktopClient 单源）。
import type { ApiKeyRecord } from "./secrets";

export type BillingModelKind = "text" | "image" | "video" | "audio";
export type ProfileKind =
  | "chat"
  | "prompt_refine"
  | "text_to_image"
  | "image_to_prompt"
  | "image_to_video"
  | "text_to_video"
  | "image_edit"
  | "text_to_audio"
  | "image_to_audio"
  | "transcribe";

// openai-responses：OpenAI Responses API（/responses，非 /chat/completions）。
// 中转（如 foxcode codex 渠道 wire_api=responses）只认 Responses → chat/completions 会 502（2026-06-06 实测根因）。
export type AiSdkProviderKind = "openai-compatible" | "anthropic" | "openai-responses";

/**
 * 供应商「怎么吞本地素材」的声明(R1,通用第一)。本地素材(nomi-local://)只有 app 自己能读,
 * vendor 服务器够不着;发送前必须按 vendor 声明的策略把它变成可达值。通用解析器据此分叉,
 * 加新 vendor = 多声明一份,通用层不改。
 *  - inline-base64：直接把 data:URI 塞进 body(无需上传)。
 *  - upload-url   ：把字节传到 vendor 文件接口 → 拿回临时公网 URL → 填进 body。
 *  - upload-stream：multipart 流式上传(二进制,大文件高效)→ 拿回临时公网 URL。用于视频 mp4
 *                   (KIE file-stream-upload),base64 对 mp4 低效/受限。
 *  - none         ：vendor 只收公网 URL 且无上传通道 → 明确报错(不静默失败)。
 *
 * `accepts`：该通道接受的媒体类型(image/video/audio)。缺省视为 ['image']——今天的通道都面向图片
 * (apimart 的 /uploads/images 仅图片)。视频素材必须路由到声明 'video' 的通道(如 KIE 通用文件托管)。
 */
export type AssetMediaKind = "image" | "video" | "audio";

export type AssetIngestion =
  | { strategy: "inline-base64"; accepts?: ReadonlyArray<AssetMediaKind> }
  | { strategy: "none"; accepts?: ReadonlyArray<AssetMediaKind> }
  | {
      strategy: "upload-stream";
      /** 上传端点(完整 URL)。multipart/form-data,file 字段为二进制,另带 uploadPath/fileName。 */
      endpoint: string;
      /** 目录字段名(默认 "uploadPath")。 */
      uploadPathField?: string;
      uploadPath?: string;
      /** 文件名字段名(默认 "fileName")。 */
      fileNameField?: string;
      /** 响应里公网 URL 的点路径(如 KIE 的 "data.downloadUrl")。 */
      urlPath: string;
      /** 鉴权:复用 vendor 的 api key(默认 bearer)。 */
      authType?: "bearer";
      /** 该通道接受的媒体类型;缺省 ['image']。 */
      accepts?: ReadonlyArray<AssetMediaKind>;
    }
  | {
      strategy: "upload-url";
      accepts?: ReadonlyArray<AssetMediaKind>;
      /** 上传端点(完整 URL)。 */
      endpoint: string;
      method?: string;
      /** base64 字段名(如 kie 的 "base64Data")。 */
      base64Field: string;
      /** 是否带 data:URI 前缀(默认 true);false = 纯 base64。 */
      dataUrlPrefix?: boolean;
      /** 可选:目录字段名 + 值。 */
      uploadPathField?: string;
      uploadPath?: string;
      /** 可选:文件名字段名。 */
      fileNameField?: string;
      /** 响应里公网 URL 的点路径(如 kie 的 "data.downloadUrl")。 */
      urlPath: string;
      /** 鉴权:复用 vendor 的 api key(默认 bearer)。 */
      authType?: "bearer";
    }
  | {
      strategy: "upload-multipart";
      /** 上传端点(完整 URL)。multipart/form-data，file 字段为二进制。 */
      endpoint: string;
      /**
       * 响应里公网 URL 的点路径(如 apimart 的 "url")。
       * 当 responseIsPlainTextUrl 为 true 时整个响应体即 URL,此字段可省。
       */
      urlPath?: string;
      /**
       * 响应体是否为纯文本 URL(整个 body trim 后即直链,非 JSON)。
       * 用于 litterbox/catbox 这类匿名临时文件托管(响应 = "https://litter.catbox.moe/abc.mp4")。
       * 缺省 false → 按 JSON + urlPath 读取。
       */
      responseIsPlainTextUrl?: boolean;
      /** file 字段名(默认 "file")。litterbox 用 "fileToUpload"。 */
      fileField?: string;
      /** multipart 里除 file 外的固定文本字段(如 litterbox 的 reqtype=fileupload & time=1h)。 */
      extraFields?: Record<string, string>;
      /**
       * 可选:提取出 URL 后再做一次纯字符串替换。
       * 某些托管(tmpfiles.org)JSON 里给的是**页面 URL**,真正的直链需把 host 后插入 "/dl/"
       * (tmpfiles.org/<id>/<name> → tmpfiles.org/dl/<id>/<name>),否则 vendor fetch 到的是 HTML 页。
       * tmpfiles 用 { search: "tmpfiles.org/", replace: "tmpfiles.org/dl/" }。
       */
      urlTransform?: { search: string; replace: string };
      /** 鉴权:复用 vendor 的 api key(默认 bearer)。无 key 时不发 Authorization。 */
      authType?: "bearer";
      /** 该通道接受的媒体类型;缺省 ['image']。 */
      accepts?: ReadonlyArray<AssetMediaKind>;
    }
  | {
      /**
       * 匿名上传 fallback 链:按顺序逐个 host 试,谁先返回合法 http(s) URL 就用谁。
       * 用于"零配置兜底"——bake-in 的免 key 免账号公共托管(litterbox → tmpfiles…),
       * 单 host 限速/宕机/封禁时自动切下一个,全失败才抛诚实错误。每个 chain 项都是
       * 一个普通 upload-multipart 声明(无 key),由 resolveLocalAsset 逐个 try/catch 执行。
       */
      strategy: "anon-chain";
      chain: ReadonlyArray<AssetIngestion>;
      /** 该链接受的媒体类型;缺省 ['image']。匿名 host 收任意文件,声明全媒体类型。 */
      accepts?: ReadonlyArray<AssetMediaKind>;
    };

export type Vendor = {
  key: string;
  name: string;
  enabled: boolean;
  hasApiKey?: boolean;
  baseUrlHint?: string | null;
  authType?: "none" | "bearer" | "x-api-key" | "query";
  authHeader?: string | null;
  authQueryParam?: string | null;
  /**
   * Which Vercel AI SDK provider implementation to use for this vendor.
   * Optional; absent / unknown values fall back to "openai-compatible"
   * so existing model-catalog.json files keep working without migration.
   */
  providerKind?: AiSdkProviderKind;
  /** R1:本地素材吞入策略。curated vendor 也可由代码注册表兜底(见 assetLocalization.curatedAssetIngestion)。 */
  assetIngestion?: AssetIngestion;
  meta?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type Model = {
  modelKey: string;
  vendorKey: string;
  modelAlias?: string | null;
  labelZh: string;
  kind: BillingModelKind;
  enabled: boolean;
  meta?: unknown;
  pricing?: {
    cost: number;
    enabled: boolean;
    createdAt?: string;
    updatedAt?: string;
    specCosts: Array<{ specKey: string; cost: number; enabled: boolean; createdAt?: string; updatedAt?: string }>;
  };
  /**
   * Catalog v2+: present when this model was produced by the onboarding agent.
   * Carries the doc-quote evidence per parameter so we can audit / re-trial later.
   */
  onboarding?: {
    addedVia: "agent" | "manual";
    trialId?: string;
    docsUrl?: string;
    addedAt: string;
    fields: Array<{
      key: string;
      displayName: string;
      type: "select" | "number" | "text" | "boolean" | "image-url";
      options?: Array<{ value: string; label: string }>;
      default?: string;
      evidence: {
        field: string;
        evidence: string;
        evidence_location: string;
        confidence: "high" | "medium" | "low";
      };
    }>;
  };
  createdAt: string;
  updatedAt: string;
};

/**
 * A single HTTP call template: method + path (relative to vendor.baseUrl, or
 * absolute), headers, query, body. String values may contain `{{...}}`
 * placeholders resolved by `renderTemplateValue` against the request context.
 * `response_mapping` / `provider_meta_mapping` describe how to read the
 * upstream response (used by `buildProfileTaskResult`).
 */
export type HttpOperation = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  response_mapping?: Record<string, unknown>;
  provider_meta_mapping?: Record<string, unknown>;
};

/**
 * One (vendor, taskKind) → one mapping row. `create` is the synchronous POST
 * (or whatever initiates the task). `query` is the poll for async APIs.
 * Vendors that map their status strings to ours can use `statusMapping`
 * (e.g. `{ succeeded: ["completed", "done"] }`).
 */
export type Mapping = {
  id: string;
  vendorKey: string;
  taskKind: ProfileKind;
  /**
   * 可选：把这条 mapping 绑定到**特定模型**。缺省（generic）= 该 (vendor, taskKind) 桶的通用模板，
   * 多个模型共享（如 Seedance + Fast 共用一条 image_to_video）。当同一 vendor 下两个模型的**同一 taskKind
   * 需要不同请求形状**时（如 kie 的 HappyHorse 与 Kling 都是 text_to_video，但 body 字段不同），各自带
   * modelKey 区分，避免「按 (vendor,taskKind) 找 mapping 时第一个赢、另一个静默套错模板」。
   * 选择优先级见 selectTaskMapping：精确 modelKey > generic（无 modelKey）。无匹配返回 null
   * （不再「任意 enabled 兜底」静默套别的模型模板）。
   */
  modelKey?: string;
  name: string;
  enabled: boolean;
  create: HttpOperation;
  query?: HttpOperation;
  statusMapping?: Record<string, string[]>;
  createdAt: string;
  updatedAt: string;
};

/**
 * 纯函数：在一组 mapping 里选出该 (vendor, taskKind, modelKey) 该用的那条。
 * 优先级：① 精确绑定该 modelKey 的 → ② generic（无 modelKey）。
 *
 * P3 根治（去掉「③ 任意 enabled 兜底」）：旧实现在无精确绑定 + 无 generic 时直接返回
 * `inBucket[0]`，会把当前 modelKey 静默套上桶里**另一个模型**的请求模板（body 字段全错），
 * 用户看到的是「莫名其妙的请求形状/参数」而非清晰的「该模型没配 mapping」。改为返回 null，
 * 让调用方（runtime.findTaskMapping）据此走通用回退/明确报错，绝不张冠李戴。
 * 向后兼容仍由「② generic（无 modelKey）」覆盖：老数据 Seedance 那条没带 modelKey 即 generic，
 * 任何 modelKey 都能命中，不受本次收紧影响。
 * 抽成纯函数是为了可单测（runtime.findTaskMapping 读 catalog 后调它）。
 */
export function selectTaskMapping(
  mappings: Mapping[],
  vendorKey: string,
  taskKind: ProfileKind,
  modelKey?: string,
): Mapping | null {
  const inBucket = mappings.filter((m) => m.enabled && m.vendorKey === vendorKey && m.taskKind === taskKind);
  if (inBucket.length === 0) return null;
  const key = (modelKey || "").trim();
  return (
    (key ? inBucket.find((m) => (m.modelKey || "").trim() === key) : undefined) ||
    inBucket.find((m) => !m.modelKey) ||
    null
  );
}

/**
 * 纯函数：在一组 model 里选出该 (vendor, modelKey/alias, kind) 该执行的那个。
 * **精确 modelKey 优先于 alias**（P1·修双键 OR 误路由根因）：旧实现用
 * `modelKey===k || modelAlias===k` 单条 OR，当「A 的 alias 撞 B 的 key」时会按
 * 数组序把 B 误选成 A。这里先扫精确 key，无果再扫 alias —— 精确身份永远赢。
 * 只认 enabled + 同 vendor；kind 给定时一并过滤。无匹配返回 undefined。
 * 抽成纯函数是为了可单测（runtime.findExecutableModel 读 catalog 后调它）。
 */
export function selectExecutableModel(
  models: Model[],
  vendorKey: string,
  modelKey: string,
  kind?: BillingModelKind,
): Model | undefined {
  const inBucket = models.filter(
    (m) => m.vendorKey === vendorKey && m.enabled && (!kind || m.kind === kind),
  );
  return (
    inBucket.find((m) => m.modelKey === modelKey) ||
    inBucket.find((m) => m.modelAlias === modelKey)
  );
}

/** Catalog version.
 *  v2 added Model.onboarding + ApiKeyRecord.enc.
 *  v3 collapsed Mapping.{requestMapping,responseMapping} (which used to wrap
 *  things in a v2 envelope `{version, create:{default}, query:{default}}`) into
 *  flat Mapping.{create,query} HttpOperation fields. Old rows are normalized
 *  in `migrateCatalogForward`.
 */
export type CatalogVersion = 1 | 2 | 3;
export const CURRENT_CATALOG_VERSION: CatalogVersion = 3;

export type CatalogState = {
  version: CatalogVersion;
  vendors: Vendor[];
  models: Model[];
  mappings: Mapping[];
  apiKeysByVendor: Record<string, ApiKeyRecord>;
};
