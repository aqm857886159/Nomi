/**
 * 已知供应商目录（presentation + 推广元数据）。
 *
 * 设计意图（P4 通用第一）：接入卡片是"供应商接入卡"的通用形态，不是某家专属。
 * 这里只放**无法从 catalog 派生**的展示数据（logo / 字形 / 推广链接 / 凭证形状）。
 * 界面文字（副标题 / 推广话术 / CTA / 凭证说明）一个字都不住这里：全在
 * `onboardingProviders.knownVendors.<vendorKey>.*` 词典里，按界面语言取（check:i18n 对 src/config/ 汉字硬零）。
 * 供应商显示名（vendor.name）和该家的模型清单都从 catalog **派生**，不在此硬编码——
 * 新增一家只加一条目录数据 + 一组词条，不写新 UI（见 VendorOnboardCard）。
 *
 * 与 catalog 的绑定键：`vendorKey` 必须等于 seed 里的 vendor.key
 * （apimart → APIMART_VENDOR_SEED.key、kie → KIE_VENDOR_SEED.key）。
 */

import i18n from '../i18n'
import { VENDOR_LOGOS } from '../assets/vendor-logos'

export type KnownVendorPromo = {
  /** 卡片底部话术正文（已按界面语言取好，词典 promoText）。 */
  text: string
  /** CTA 按钮文案（已按界面语言取好，词典 promoCta）。 */
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
  /** 字段标识（aria-label / 状态区分用，不进存储；也是词典 fields.<key>.* 的键）。 */
  key: string
  /** 字段显示名（词典 fields.<key>.label）。 */
  label: string
  /** 输入框占位（词典 fields.<key>.placeholder）。 */
  placeholder: string
  /** 是否密文输入（如 Access Token）。 */
  secret?: boolean
  /** 字段下方小字说明（词典 fields.<key>.hint，可缺省）。 */
  hint?: string
}

/** 目录里的一条：只有数据，没有界面文字。 */
type KnownVendorEntry = {
  /** 与 catalog vendor.key 一致；也是词典 onboardingProviders.knownVendors.<vendorKey> 的键。 */
  vendorKey: string
  /** brand logo 打包资源 URL；缺省回退到 glyph 字形。 */
  logo?: string
  /** logo 回退字形（拉丁字母，跟界面语言无关）。 */
  glyph: string
  /** 推广链接；null = 不展示推广。有链接时词典必须有 promoText / promoCta。 */
  promoUrl: string | null
  /** 多段凭证只声明字段形状；文字在词典 fields.<key>.*。 */
  credentialFields?: readonly { key: string; secret?: boolean }[]
  /** 多段凭证的拼接分隔符（缺省冒号）。必须与后端拆分一致（如 splitDoubaoCredential 按首个冒号切）。 */
  credentialJoin?: string
  /** 「新手推荐」软标：仅未接入时显示，帮纯新人在多家里有个默认起点（聚合中转一个 key 全解锁）。
   *  软提示，不钦点、不占 C 位（用户拍板：留但只当软提示）。 */
  recommended?: boolean
  /**
   * 该供应商支持「先填 key → 继续验证」的两步接入流程（KnownVendorKeyConnectPage → openWizard）。
   * 缺省 true（当前全部已知供应商均支持 wizard 验证晋级）；
   * 设为 false 的供应商保存 key 后直接可用，不需要经过认证运行。
   * 推导规则：availableKnown 行的 onOpen 由此字段 derive，不再硬编码 vendorKey 白名单。
   */
  usesPlatformConnect?: boolean
}

/** 接入卡拿到的形状：目录数据 + 按当前界面语言取好的文字。只能经 getKnownVendor / getLocalizedKnownVendors 得到。 */
export type KnownVendor = Omit<KnownVendorEntry, 'promoUrl' | 'credentialFields'> & {
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
}

/** 目录数据（顺序即卡片顺序）。没有界面文字；要显示的一律走 getLocalizedKnownVendors / getKnownVendor。 */
export const KNOWN_VENDORS: readonly KnownVendorEntry[] = [
  // 聚合中转，一个 key 解锁图/视频/文本/配音 → 新手最省事的起点
  { vendorKey: 'apimart', logo: VENDOR_LOGOS.apimart, glyph: 'A', recommended: true, promoUrl: 'https://apimart.ai/register?aff=t55VtP' },
  // Agnes AI: public model coverage and account eligibility are separate (checked 2026-08-26).
  { vendorKey: 'agnes', logo: VENDOR_LOGOS.agnes, glyph: 'Ag', promoUrl: 'https://agnes-ai.com' },
  { vendorKey: 'kie', logo: VENDOR_LOGOS.kie, glyph: 'K', promoUrl: 'https://kie.ai' }, // TODO: 替换为专属 ?ref 链接
  { vendorKey: 'modelscope', logo: VENDOR_LOGOS.modelscope, glyph: 'MS', promoUrl: 'https://modelscope.cn/my/myaccesstoken' },
  { vendorKey: 'volcengine', logo: VENDOR_LOGOS.volcengine, glyph: 'V', promoUrl: 'https://console.volcengine.com/ark' },
  { vendorKey: 'minimax', logo: VENDOR_LOGOS.minimax, glyph: 'M', promoUrl: 'https://platform.minimax.io' },
  { vendorKey: 'elevenlabs', logo: VENDOR_LOGOS.elevenlabs, glyph: 'E', promoUrl: 'https://elevenlabs.io/app/developers/api-keys' },
  { vendorKey: 'meshy', logo: VENDOR_LOGOS.meshy, glyph: 'M', promoUrl: 'https://www.meshy.ai/settings/api' },
  { vendorKey: 'fal', logo: VENDOR_LOGOS.fal, glyph: 'F', promoUrl: 'https://fal.ai/dashboard/keys' },
  { vendorKey: 'runway', logo: VENDOR_LOGOS.runway, glyph: 'Rw', promoUrl: 'https://dev.runwayml.com' },
  // RunningHub 标准模型 API（openapi/v2）：一个 key 解锁 355+ 模型（Seedance/可灵/Veo/混元3D/Meshy…）。
  // ⚠️ 实测（2026-06-27）：标准模型 API **仅限 Enterprise-Shared（企业级-共享）key**，Consumer/个人 key
  // 会报错误码 1014「访问被拒绝」。故 credentialHint 明着标，免得用户拿个人 key 填进来被 1014 蒙（D4 诚实）。
  { vendorKey: 'runninghub', logo: VENDOR_LOGOS.runninghub, glyph: 'RH', promoUrl: 'https://www.runninghub.cn' },
  {
    // 火山「语音技术」= 独立产品线，凭证 ≠ 方舟 bearer key（见 volcengineVendor.ts）。
    // 故必须独立成卡：否则豆包语音音色被归进「其他模型」且写死「已配置」，
    // 用户既无处填 APP_ID:ACCESS_KEY，又被误导以为已连通（真实坑，2026-06-25 用户反馈）。
    vendorKey: 'volcengine-speech',
    logo: VENDOR_LOGOS.doubao,
    glyph: 'DS',
    // 火山语音需要两段凭证（App ID + Access Token），声明成两个独立框，别让用户自己拼冒号
    // （D1：让用户照我们的格式手写 = 离谱）。卡片保存时内部拼成 APP_ID:ACCESS_KEY 存单槽。
    credentialFields: [{ key: 'appId' }, { key: 'accessToken', secret: true }],
    promoUrl: 'https://console.volcengine.com/speech/app',
  },
  // Replicate：图片「元素拆解」(qwen-image-layered) 的托管端点。本机跑不动 57GB 模型，必须走云；
  // 一把 r8_ token 即可。见 docs/plan/2026-06-28-element-decomposition-feature.md。
  { vendorKey: 'replicate', logo: VENDOR_LOGOS.replicate, glyph: 'Rp', promoUrl: 'https://replicate.com/account/api-tokens' },
]

const KNOWN_VENDOR_BY_KEY = new Map<string, KnownVendorEntry>(KNOWN_VENDORS.map((vendor) => [vendor.vendorKey, vendor]))

export function getKnownVendor(vendorKey: string): KnownVendor | undefined {
  const vendor = KNOWN_VENDOR_BY_KEY.get(vendorKey)
  return vendor ? localizeKnownVendor(vendor) : undefined
}

function vendorText(key: string, field: string): string {
  return i18n.t(`onboardingProviders.knownVendors.${key}.${field}`)
}

function optionalVendorText(key: string, field: string): string | undefined {
  const path = `onboardingProviders.knownVendors.${key}.${field}`
  return i18n.exists(path) ? i18n.t(path) : undefined
}

function localizeKnownVendor(vendor: KnownVendorEntry): KnownVendor {
  const key = vendor.vendorKey
  const { promoUrl, credentialFields, ...data } = vendor
  const credentialPlaceholder = optionalVendorText(key, 'credentialPlaceholder')
  const credentialHint = optionalVendorText(key, 'credentialHint')
  return {
    ...data,
    tagline: vendorText(key, 'tagline'),
    promo: promoUrl ? { text: vendorText(key, 'promoText'), ctaLabel: vendorText(key, 'promoCta'), url: promoUrl } : null,
    ...(credentialPlaceholder ? { credentialPlaceholder } : {}),
    ...(credentialHint ? { credentialHint } : {}),
    ...(credentialFields
      ? {
          credentialFields: credentialFields.map((field) => {
            const hint = optionalVendorText(key, `fields.${field.key}.hint`)
            return {
              ...field,
              label: vendorText(key, `fields.${field.key}.label`),
              placeholder: vendorText(key, `fields.${field.key}.placeholder`),
              ...(hint ? { hint } : {}),
            }
          }),
        }
      : {}),
  }
}

export function getLocalizedKnownVendors(): readonly KnownVendor[] {
  return KNOWN_VENDORS.map(localizeKnownVendor)
}

export function isKnownVendor(vendorKey: string): boolean {
  return KNOWN_VENDOR_BY_KEY.has(vendorKey)
}
