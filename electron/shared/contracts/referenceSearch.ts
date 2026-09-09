// 「找参考」跨平台素材检索的**中立契约单一 owner**（electron/shared/contracts/ = renderer+main 都可合法
// import，见 .dependency-cruiser.mjs 的 src-no-import-electron 豁免）。同 tikhubRoute/tikhubErrorKinds 的做法。
//
// 为什么要有这一层：TikHub 的文档**按平台分组而不是按能力分组**，且**不规定统一的响应 envelope**
// （docs.tikhub.io 实读 2026-09-07）——每个平台的字段名、指标语义、甚至信封层数都不一样
// （小红书比其它三家多包一层）。所以「把平台差异归一掉」这件事只能我们自己做，
// 而归一的产物必须有单一 owner，否则主进程和渲染层会各长一份形状（R14.1）。
//
// 设计要点见 docs/design/2026-09-07-find-reference-design.md：
//   **平台是项目级设定，不是每次搜索的筛选器**（跟分镜画幅同构），随之 derive 三样：
//   ① 角标语义 ② 要不要转译关键词 ③ 有哪些筛选维度。

/**
 * 可作为「参考来源」的平台。
 *
 * 排序即 UI 里 chip 的排序。只收**已实调验证过检索端点**的平台——
 * B站/X 的检索端点在 scripts/research/tikhub-search-lib.mjs 里已跑通，但它们的
 * **指标字段未经核对**，所以不在这里登记（宁可少一个平台，不要一个显示错数字的平台）。
 */
export const REFERENCE_PLATFORMS = ["douyin", "xhs", "tiktok"] as const;

export type ReferencePlatform = (typeof REFERENCE_PLATFORMS)[number];

/**
 * 一条证据的语义类别。UI 据此决定视觉权重，**不据此决定文案**（文案在 label/value 里，
 * 由 normalizer 按平台给好）——UI 不认识平台。
 *
 *   · scale     ：规模（点赞/收藏这类「有多少人认可」）——主角标
 *   · perf      ：投放表现（CTR/分位）——**只有 TikTok 广告库有**
 *   · hot       ：正在放量（花费档高）——只有 TikTok 广告库有；UI 画成醒目小标
 *   · secondary ：次要指标，放第二行
 */
export const REFERENCE_EVIDENCE_KINDS = ["scale", "perf", "hot", "secondary"] as const;

export type ReferenceEvidenceKind = (typeof REFERENCE_EVIDENCE_KINDS)[number];

/**
 * 指标名的**语义 token**，不是文案。
 * 归一层决定「用哪个指标、排第几」（那是平台知识），UI 决定「怎么说」（那是 i18n）——
 * 所以这里绝不能出现中文：主进程不产出用户可见文字（`check:i18n` 会拦）。
 * `none` = 值自带含义、不需要前缀（如「♥ 8.4k」）。
 */
export const REFERENCE_METRICS = ["none", "collect", "like", "ctr", "hot"] as const;

export type ReferenceMetric = (typeof REFERENCE_METRICS)[number];

export type ReferenceEvidence = {
  kind: ReferenceEvidenceKind;
  /** 指标语义 token；UI 据此取文案。 */
  metric: ReferenceMetric;
  /**
   * 已格式化好的值（如「18.4万」「0.32%」）。**归一层负责数字换算**（多少算大是平台习惯：
   * 抖音说 74.1万、TikTok 说 8.4k），UI 不做换算。空串 = 这一格只有名字没有值（如「放量」）。
   */
  value: string;
};

/**
 * 归一后的一条参考素材。**UI 只认识这个形状，不认识任何平台的原始字段。**
 */
export type ReferenceItem = {
  platform: ReferencePlatform;
  /** 平台侧作品 id（去重与二次拉取用）。 */
  id: string;
  /** 标题/正文首行（已截断）。可能为空串（有些广告没标题）。 */
  caption: string;
  /** 封面图 URL；可能为空串。⚠️ 平台侧多为带签名的短时 URL，**不落库久存**。 */
  coverUrl: string;
  /** 作品页链接（用户「去看原片」用）。可能为空串。 */
  pageUrl: string;
  /** 时长文案（如「0:22」）。拿不到 / 图文帖为空串——**不编 0:00**。 */
  durationLabel: string;
  /** 媒体类型。小红书有大量图文帖，UI 据此显示「图文」而不是空白时长。 */
  mediaKind: "video" | "image";
  /**
   * 证据格，**有序**。第 0 项是主角标，其余按序排在副行。
   * 哪些项、什么顺序**由平台决定**（小红书收藏排点赞前面，因为收藏≈「被当攻略存起来」）。
   */
  evidence: readonly ReferenceEvidence[];
};

/** 一次检索的归一结果。 */
export type ReferenceSearchResult = {
  platform: ReferencePlatform;
  items: readonly ReferenceItem[];
  /**
   * 实际用于检索的关键词。与用户输入不同时（中文→英文转译）UI 必须回显它 + 给「改」。
   * 见设计文档卡点③b：不回显＝用户不知道结果为什么长这样。
   */
  effectiveKeyword: string;
  /**
   * 转译发生了才有值：**原因的语义 token**（不是文案，同 ReferenceMetric 的道理）。
   * `english-index` = 这个平台的检索索引是英文的。
   */
  translationReason?: "english-index";
  /** 还有下一页（游标形态各平台不同，故只暴露布尔）。 */
  hasMore: boolean;
};

/**
 * 每个平台的固定事实（UI 与归一层共用，避免两边各写一份）。
 *
 * `pageSize` 是**实测上限**不是文档值：TikTok 广告库文档写「最大 50」，
 * 实测传 30/50 都返回 422，真实上限是 20（2026-09-07 实调）。
 * 官方 SDK 文档也建议每次 ≤30（github.com/TikHub/TikHub-API-Python-SDK）。
 */
export type ReferencePlatformFacts = {
  /** 单次请求条数（实测上限）。 */
  pageSize: number;
  /** 检索索引的语言。'zh' = 中文原生可用；'en' = 需把中文关键词转成英文再搜。 */
  indexLanguage: "zh" | "en";
  /** 有没有投放表现面（CTR/花费档/分位）。只有 TikTok 广告库有。 */
  hasAdPerformance: boolean;
};

export const REFERENCE_PLATFORM_FACTS: Readonly<Record<ReferencePlatform, ReferencePlatformFacts>> = {
  douyin: { pageSize: 20, indexLanguage: "zh", hasAdPerformance: false },
  xhs: { pageSize: 20, indexLanguage: "zh", hasAdPerformance: false },
  tiktok: { pageSize: 20, indexLanguage: "en", hasAdPerformance: true },
};

/** 运行时白名单：合法平台值 Set（IPC 入参校验用；类型的运行时投影，单一真相源在上方联合类型）。 */
export const REFERENCE_PLATFORM_VALUES: ReadonlySet<string> = new Set<string>(REFERENCE_PLATFORMS);

export function isReferencePlatform(value: unknown): value is ReferencePlatform {
  return typeof value === "string" && REFERENCE_PLATFORM_VALUES.has(value);
}
