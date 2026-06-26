/**
 * 已知供应商目录（presentation + 推广元数据）。
 *
 * 设计意图（P4 通用第一）：接入卡片是"供应商接入卡"的通用形态，不是某家专属。
 * 这里只放**无法从 catalog 派生**的展示信息（logo 字形 / 副标题 / 推广话术 + 链接）。
 * 供应商显示名（vendor.name）和该家的模型清单都从 catalog **派生**，不在此硬编码——
 * 新增一家只加一条目录数据，不写新 UI（见 VendorOnboardCard）。
 *
 * 与 catalog 的绑定键：`vendorKey` 必须等于 seed 里的 vendor.key
 * （apimart → APIMART_VENDOR_SEED.key、kie → KIE_VENDOR_SEED.key）。
 */

export type KnownVendorPromo = {
  /** 卡片底部话术正文。 */
  text: string
  /** CTA 按钮文案。 */
  ctaLabel: string
  /**
   * 注册链接。当前先指官网；拿到专属 affiliate ?ref= 链接后替换这里即可，
   * 卡片代码无需改动（TODO: 用户拿回推广链接/优惠码后替换）。
   */
  url: string
}

/**
 * 多段凭证的单个字段声明（如火山语音的 App ID / Access Token）。
 * 供应商档案声明「我要哪几段」，通用接入卡按声明渲染对应数量的输入框（P4 档案声明槽、通用系统填）。
 * 保存时各段按 credentialJoin（默认冒号）拼成单串存进 vendor 的唯一 apiKey 槽——
 * 底层存储/钥匙串/runner 零改动，多段拆分只活在录入这一层。
 */
export type CredentialField = {
  /** 字段标识（aria-label / 状态区分用，不进存储）。 */
  key: string
  /** 字段显示名（如「App ID」）。 */
  label: string
  /** 输入框占位。 */
  placeholder: string
  /** 是否密文输入（如 Access Token）。 */
  secret?: boolean
  /** 字段下方小字说明（去哪拿这一段）。 */
  hint?: string
}

export type KnownVendor = {
  /** 与 catalog vendor.key 一致。 */
  vendorKey: string
  /** brand logo 打包资源 URL；缺省回退到 glyph 字形。 */
  logo?: string
  /** 单字母 logo 字形（无 logo 时的回退）。 */
  glyph: string
  /** 卡片副标题。 */
  tagline: string
  /** 推广位；null = 不展示推广。 */
  promo: KnownVendorPromo | null
  /** key 输入框占位（缺省 = 通用 sk- 提示）。仅单段凭证用；声明了 credentialFields 时被忽略。 */
  credentialPlaceholder?: string
  /** key 输入框下方帮助文案（缺省 = 通用「填一次即可…」）。多段凭证时作为卡片底部总说明。 */
  credentialHint?: string
  /**
   * 多段凭证声明（缺省 = 单段，沿用 credentialPlaceholder）。
   * 声明后接入卡渲染对应数量的独立输入框，各自标注；保存时按 credentialJoin 拼成单串存进唯一 key 槽。
   * 用于火山语音这类需要 App ID + Access Token 两段、但底层只有一个 key 槽的供应商。
   */
  credentialFields?: readonly CredentialField[]
  /** 多段凭证的拼接分隔符（缺省冒号）。必须与后端拆分一致（如 splitDoubaoCredential 按首个冒号切）。 */
  credentialJoin?: string
  /** 「新手推荐」软标：仅未接入时显示，帮纯新人在多家里有个默认起点（聚合中转一个 key 全解锁）。
   *  软提示，不钦点、不占 C 位（用户拍板：留但只当软提示）。 */
  recommended?: boolean
}

export const KNOWN_VENDORS: readonly KnownVendor[] = [
  {
    vendorKey: 'apimart',
    logo: new URL('../assets/vendor-logos/apimart.png', import.meta.url).href,
    glyph: 'A',
    tagline: '一个 key，解锁全部预置模型',
    recommended: true, // 聚合中转，一个 key 解锁图/视频/文本/配音 → 新手最省事的起点

    promo: {
      text: '如果你愿意，可以用我们的链接注册；不愿意也可以直接去官方注册。',
      ctaLabel: '用我们的链接',
      url: 'https://apimart.ai/register?aff=t55VtP', // 专属推广链接
    },
  },
  {
    vendorKey: 'kie',
    logo: new URL('../assets/vendor-logos/kie.png', import.meta.url).href,
    glyph: 'K',
    tagline: '一个 key，解锁内置模型',
    promo: {
      text: '如果你愿意，可以用我们的链接注册；不愿意也可以直接去官方注册。',
      ctaLabel: '用我们的链接',
      url: 'https://kie.ai', // TODO: 替换为专属 ?ref 链接
    },
  },
  {
    vendorKey: 'modelscope',
    logo: new URL('../assets/vendor-logos/modelscope.png', import.meta.url).href,
    glyph: '魔',
    tagline: '官方原生 · 绑定阿里云每天免费额度',
    promo: {
      text: '魔搭社区由阿里达摩院运营，绑定阿里云账号后每天有免费推理额度。去官网拿 API Key。',
      ctaLabel: '去魔搭注册',
      url: 'https://modelscope.cn/my/myaccesstoken',
    },
  },
  {
    vendorKey: 'volcengine',
    logo: new URL('../assets/vendor-logos/volcengine.png', import.meta.url).href,
    glyph: '火',
    tagline: '官方原生 · 豆包 Seedream / Seedance',
    promo: {
      text: '火山方舟（字节跳动）官方。需先在 Ark 控制台「开通管理」激活模型（Seedream/Seedance），再拿 API Key。',
      ctaLabel: '去火山方舟',
      url: 'https://console.volcengine.com/ark',
    },
  },
  {
    // 火山「语音技术」= 独立产品线，凭证 ≠ 方舟 bearer key（见 volcengineVendor.ts）。
    // 故必须独立成卡：否则豆包语音音色被归进「其他模型」且写死「已配置」，
    // 用户既无处填 APP_ID:ACCESS_KEY，又被误导以为已连通（真实坑，2026-06-25 用户反馈）。
    vendorKey: 'volcengine-speech',
    logo: new URL('../assets/vendor-logos/doubao.png', import.meta.url).href,
    glyph: '声',
    tagline: '官方原生 · 豆包语音 2.0 配音（自然语言情感控制）',
    // 火山语音需要两段凭证（App ID + Access Token），声明成两个独立框，别让用户自己拼冒号
    // （D1：让用户照我们的格式手写 = 离谱）。卡片保存时内部拼成 APP_ID:ACCESS_KEY 存单槽。
    credentialFields: [
      {
        key: 'appId',
        label: 'App ID',
        placeholder: '火山语音应用的 App ID',
        hint: '语音控制台 → 应用管理里的 App ID',
      },
      {
        key: 'accessToken',
        label: 'Access Token',
        placeholder: '对应的 Access Token',
        secret: true,
        hint: '同一应用的访问令牌（Access Key）',
      },
    ],
    credentialHint: '需先开通豆包语音合成 2.0 + 付费音色；凭证本地加密存储、只在调用时使用。',
    promo: {
      text: '火山「语音技术」官方（与方舟是不同控制台）。开通豆包语音合成 2.0 与付费音色后，拿 App ID 与 Access Token。',
      ctaLabel: '去火山语音控制台',
      url: 'https://console.volcengine.com/speech/app',
    },
  },
] as const

const KNOWN_VENDOR_BY_KEY = new Map<string, KnownVendor>(
  KNOWN_VENDORS.map((vendor) => [vendor.vendorKey, vendor]),
)

export function getKnownVendor(vendorKey: string): KnownVendor | undefined {
  return KNOWN_VENDOR_BY_KEY.get(vendorKey)
}

export function isKnownVendor(vendorKey: string): boolean {
  return KNOWN_VENDOR_BY_KEY.has(vendorKey)
}
