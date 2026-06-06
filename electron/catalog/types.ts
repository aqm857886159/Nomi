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
  | "image_to_audio";

// openai-responses：OpenAI Responses API（/responses，非 /chat/completions）。
// 中转（如 foxcode codex 渠道 wire_api=responses）只认 Responses → chat/completions 会 502（2026-06-06 实测根因）。
export type AiSdkProviderKind = "openai-compatible" | "anthropic" | "openai-responses";

/**
 * 供应商「怎么吞本地素材」的声明(R1,通用第一)。本地素材(nomi-local://)只有 app 自己能读,
 * vendor 服务器够不着;发送前必须按 vendor 声明的策略把它变成可达值。通用解析器据此分叉,
 * 加新 vendor = 多声明一份,通用层不改。
 *  - inline-base64：直接把 data:URI 塞进 body(无需上传)。
 *  - upload-url   ：把字节传到 vendor 文件接口 → 拿回临时公网 URL → 填进 body。
 *  - none         ：vendor 只收公网 URL 且无上传通道 → 明确报错(不静默失败)。
 */
export type AssetIngestion =
  | { strategy: "inline-base64" }
  | { strategy: "none" }
  | {
      strategy: "upload-url";
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
   * 选择优先级见 selectTaskMapping：精确 modelKey > generic > 任意 enabled。
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
 * 优先级：① 精确绑定该 modelKey 的 → ② generic（无 modelKey）→ ③ 任意 enabled（兜底，兼容老数据）。
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
    inBucket[0]
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
