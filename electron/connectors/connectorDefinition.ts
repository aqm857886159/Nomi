// ConnectorDefinition —— 外部数据 API 桥的形态合同（不是生成 catalog 的 vendor/model）。
//
// 出处：docs/plan/2026-08-29-creative-capability-catalog-and-prompt-system.md §5.5（#226 已入 main）。
// 这里把纸面合同落成运行时可校验的 TS 类型。为什么单开一族、不塞进 electron/catalog：
//   catalog 是 vendor → model → create/poll「生成任务」家族（会进模型列表、要认证、有额度语义）；
//   数据 connector 是「给链接/ID → 拿结构化数据」的读取面，塞进生成 catalog = 概念错配（P4）。
// 凭据仍复用 catalog 的 safeStorage 加密层（secretOwner:'nomi-settings'），不另起加密管线（P1）。

export type ConnectorTransport = "native-api" | "mcp-stdio" | "mcp-http";

export type ConnectorAuth = {
  kind: "none" | "api-key" | "oauth";
  /** 谁持有密钥。'nomi-settings' = 用户在 Nomi 设置里自带（BYO-key），落 safeStorage。 */
  secretOwner: "nomi-settings";
};

export type ConnectorNetworkPolicy = {
  /** 出站只允许这些 origin（hostname 精确白名单）。connector 的每次 fetch 都要过它。 */
  allowedOrigins: readonly string[];
  redirectPolicy: "same-origin" | "allowlist";
};

/**
 * connector 工具的 effect 语义（与生成侧同词表，但这里是数据面）：
 *   · read     ：只读结构化数据（元数据/评论/列表）。
 *   · download ：取到一个媒体直链/字节（会落盘或喂进下游）。
 *   · write    ：向第三方写（v1 无）。
 *   · spend    ：按次计费——必须接既有费用确认流后才发起。
 */
export type ConnectorToolEffect = "read" | "download" | "write" | "spend";

export type ConnectorTool = {
  /** 第三方侧的端点/方法名（对账用，如 fetch_video_high_quality_play_url）。 */
  externalName: string;
  /** Nomi 侧稳定名（UI/日志/契约测试引用它，与第三方改名解耦）。 */
  nomiName: string;
  effect: ConnectorToolEffect;
  /** 该端点相对 baseUrl 的路径（含 /api/v1/...）。 */
  path: string;
  method: "GET" | "POST";
  /** 单次计费（美元）；未文档化留 undefined。仅供 UI 诚实展示，不参与真实扣费。 */
  unitPriceUsd?: number;
  maxBytes?: number;
};

export type ConnectorDataEgress = {
  /** 会发往第三方的数据类别（如 'share-link','video-id'）。 */
  categories: readonly string[];
  retention?: string;
};

export type ConnectorDefinition = {
  kind: "connector";
  /** 稳定 id，同时用作凭据 vendorKey（复用 catalog apiKeysByVendor 加密存储）。 */
  id: string;
  name: string;
  baseUrl: string;
  transport: ConnectorTransport;
  auth: ConnectorAuth;
  network: ConnectorNetworkPolicy;
  tools: readonly ConnectorTool[];
  dataEgress: ConnectorDataEgress;
};

/**
 * AssetSourceEvidence —— 落库媒体的来源取证（能力目录 P0.1 一等合同）。
 * 从 connector 拿来的媒体必落它，且 rightsStatus 恒 'unknown'：**绝不推断可商用**
 * （这些是第三方抓取来的平台内容，署名/许可未知）。作为 asset metadata 进 .meta sidecar。
 */
export type AssetSourceEvidence = {
  /** 一等来源：本次是经 connector 摄取。 */
  source: "connector";
  /** 哪个 connector（= ConnectorDefinition.id）。 */
  connectorId: string;
  /** 用户贴的原始分享链接。 */
  originalUrl: string;
  /** 解析出的媒体直链（短时有效，仅取证记录，不保证可再取）。 */
  resolvedUrl: string;
  /** 抓取源平台（douyin/tiktok/…）。 */
  platform: string;
  /**
   * 权利状态。connector 抓取内容一律 'unknown'——不推断可商用，交付时按既有
   * 「缺署名/未知许可只拦异常」处理。
   */
  rightsStatus: "unknown";
  fetchedAt: string;
};
