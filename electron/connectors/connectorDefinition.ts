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
 * UsageStatus —— 素材可用性的五态枚举（P0-1 核心判据）。
 *
 * 这些值的含义是**操作性**的（用户和系统该怎么对待这份素材），不是法律结论：
 *   · reference_only    : 仅供参考，不可直接用于成片（浏览器来源默认值）。
 *   · rights_unknown    : 许可未经核实（connector 抓取平台内容默认值）。
 *   · requires_attribution : 可用但必须署名（CC BY 族、Pexels 等回链要求）。
 *   · cleared           : 已核实可用，无须强制署名（仅 Pixabay API 等明确声明的来源才设此值）。
 *   · restricted        : 在当前项目用途下受限（如 CC BY-NC 在商业项目里）。
 *
 * 与 M4 taint 系统对齐：usageStatus 是 content trust level 的一个维度，
 * M4 output projection 检查时可直接读取，不需要再造一套。
 */
export type UsageStatus =
  | "reference_only"
  | "rights_unknown"
  | "requires_attribution"
  | "cleared"
  | "restricted";

/**
 * IntendedRole —— 素材在作品里的预定用途（可多值，互不排斥）。
 *
 * 这些值来自实际创作场景，驱动 P0-3 智能视图的按用途筛选：
 *   · character_reference : 角色/人物参考（定妆、体型、服装）。
 *   · scene_reference     : 场景/环境参考（建筑、地点、气氛）。
 *   · style_reference     : 风格参考（调色盘、摄影风格）。
 *   · background          : 直接用作背景（可能直接进时间轴）。
 *   · sound_effect        : 音效。
 *   · music               : 背景音乐。
 *   · voiceover           : 旁白/配音素材。
 *   · footage             : 原始素材片段（剪辑用）。
 *   · other               : 未分类。
 */
export type IntendedRole =
  | "character_reference"
  | "scene_reference"
  | "style_reference"
  | "background"
  | "sound_effect"
  | "music"
  | "voiceover"
  | "footage"
  | "other";

/**
 * LicenseSnapshot —— 许可条款的取证快照。
 *
 * 与 M4 provenance 兼容：checkedAt + termsHash 可被 M4 直接读取，
 * 不需要另造快照结构。
 */
export type LicenseSnapshot = {
  /** 许可条款的页面 URL（存原站，不存中间层）。 */
  termsUrl: string;
  /** 核验时间（ISO-8601）。 */
  checkedAt: string;
  /**
   * 许可条款的 SHA-256 截断哈希（前 16 字节十六进制），可选。
   * 用于检测条款是否在接入后被第三方变更；没有快照内容时留 undefined。
   */
  termsHash?: string;
};

/**
 * AssetSourceEvidence —— 落库媒体的来源取证（P0-1 一等合同 v2）。
 *
 * source 字段区分来源类型，各类型有各自必填字段：
 *   · "connector"  : 经 ConnectorDefinition 摄取（如 TikHub）。必填 connectorId。
 *   · "browser"    : 用户从浏览器手工导入。必填 pageUrl + capturedAt。usageStatus 恒 reference_only。
 *   · "user"       : 用户直接从本地文件导入（非浏览器来源）。usageStatus 恒 reference_only。
 *
 * 与 M4 taint 系统对齐（docs/plan/2026-09-03-creative-resource-chain-epic.md §5.2）：
 *   · source       → taint origin 标签
 *   · usageStatus  → content trust level
 *   · licenseId    → taint policy 证据
 *   · fetchedAt/capturedAt → provenance 时间戳
 *
 * 旧字段 rightsStatus 已被 usageStatus 取代；sanitizeSourceEvidence 在老 sidecar 里读到
 * rightsStatus:"unknown" 时会迁移成 usageStatus:"rights_unknown"，反向不兼容（不回写 rightsStatus）。
 */
export type AssetSourceEvidence = {
  /** 来源类型：connector 摄取 / 浏览器人工导入 / 本地文件导入。 */
  source: "connector" | "browser" | "user";

  // ── connector 专属（source === "connector" 时存在）──────────────────────
  /** 哪个 connector（= ConnectorDefinition.id）。 */
  connectorId?: string;
  /** 用户贴的原始分享链接。 */
  originalUrl?: string;
  /** 解析出的媒体直链（短时有效，仅取证记录）。 */
  resolvedUrl?: string;
  /** 抓取源平台（douyin/tiktok/…）。 */
  platform?: string;
  /** 取证时间（ISO-8601）。connector 路径用 fetchedAt，browser/user 路径用 capturedAt。 */
  fetchedAt?: string;

  // ── browser 专属（source === "browser" 时存在）──────────────────────────
  /** 素材所在的页面 URL（用于追溯来源；非媒体直链，不发给生成商）。 */
  pageUrl?: string;
  /** 浏览器导入时间（ISO-8601）。 */
  capturedAt?: string;

  // ── 通用扩展字段（所有来源均可选）──────────────────────────────────────
  /**
   * 作者 / 权利人。
   * 用于生成署名清单；connector 从 API 响应填入，browser 来源由用户或 heuristic 填入。
   */
  creator?: string;
  /**
   * 许可标识（规范值，带年份快照版本，如 "pexels-license-2024" / "CC BY 4.0"）。
   * 用规范值而非自由文本，便于机器判断 usageStatus。
   * 未知时留 undefined（不伪造）。
   */
  licenseId?: string;
  /** 许可条款页面 URL（直接链到原站，不存中间层）。 */
  licenseUrl?: string;
  /** 规范署名串（CC BY 规范格式，由导入路径自动生成）。 */
  attribution?: string;
  /** 许可快照（用于检测条款变更 + M4 provenance 对齐）。 */
  licenseSnapshot?: LicenseSnapshot;
  /**
   * 素材可用性（五态枚举，见 UsageStatus）。
   * 缺失时视为 "rights_unknown"（惰性迁移语义：不要假装合规）。
   */
  usageStatus?: UsageStatus;
  /**
   * 素材预定用途（多值，见 IntendedRole）。
   * 驱动 P0-3 按用途筛选；空数组表示「未指定」，不影响导入。
   */
  intendedRoles?: IntendedRole[];

  /**
   * @deprecated 旧版字段，由 sanitizeSourceEvidence 迁移成 usageStatus。
   * 新写入路径不得写此字段；消费点用 usageStatus 代替。
   */
  rightsStatus?: "unknown";
};
