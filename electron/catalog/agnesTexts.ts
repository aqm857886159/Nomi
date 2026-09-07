// Source: https://agnes-ai.com/zh-Hans/docs/agnes-{20-flash,25-flash,25-pro-alpha,25-pro-beta,25-pro}
// Checked 2026-08-26. All five use the existing OpenAI-compatible chat SDK path,
// including streaming/tools and image_url input. Public coverage is not account eligibility.
import type { Model } from "./types";

export type AgnesTextModel = {
  modelKey: string;
  labelZh: string;
  meta: { supportsImageInput: true };
  /** 按 token 计费的价目（USD / 每百万 token）。见 `Model.tokenPricing`。 */
  tokenPricing: NonNullable<Model["tokenPricing"]>;
};

/**
 * 价目出处：Agnes 官方定价页，2026-09-07 实查。
 *
 * **记的是 list price，不是当下的促销价。** flash 两条官网当前写「$0 / M」促销、
 * 划线价 $0.03 / $0.15；促销随时会停，而目录里的价目是要长期跑的。记划线价 =
 * 宁可高估不低估（与 apimartTexts 那条峰谷取高同一条纪律）。它也不能记成 `free: true`——
 * 那个字段说的是「这个模型不按 token 计费」，而 Agnes flash 是按 token 计费、只是眼下打折到零。
 *
 * 官网只给 pro 三条列了「缓存命中」价；flash 两条没列，`cacheReadPerMTokUsd` 就不写，
 * 缺省即与输入同价（`Model.tokenPricing` 的注释）——不是 0。
 */
const AGNES_PRICING_SOURCE = { url: "https://agnes-ai.com/zh-Hans/docs/pricing", checkedAt: "2026-09-07" } as const;

const VISION: { supportsImageInput: true } = { supportsImageInput: true };

export const AGNES_TEXT_MODELS: AgnesTextModel[] = [
  {
    modelKey: "agnes-2.0-flash", labelZh: "Agnes 2.0 Flash", meta: VISION,
    tokenPricing: { inputPerMTokUsd: 0.03, outputPerMTokUsd: 0.15, source: AGNES_PRICING_SOURCE },
  },
  {
    modelKey: "agnes-2.5-flash", labelZh: "Agnes 2.5 Flash", meta: VISION,
    tokenPricing: { inputPerMTokUsd: 0.03, outputPerMTokUsd: 0.15, source: AGNES_PRICING_SOURCE },
  },
  {
    modelKey: "agnes-2.5-pro-alpha", labelZh: "Agnes 2.5 Pro Alpha", meta: VISION,
    tokenPricing: { inputPerMTokUsd: 0.45, outputPerMTokUsd: 0.9, cacheReadPerMTokUsd: 0.045, source: AGNES_PRICING_SOURCE },
  },
  {
    modelKey: "agnes-2.5-pro-beta", labelZh: "Agnes 2.5 Pro Beta", meta: VISION,
    tokenPricing: { inputPerMTokUsd: 0.1, outputPerMTokUsd: 0.3, cacheReadPerMTokUsd: 0.01, source: AGNES_PRICING_SOURCE },
  },
  {
    modelKey: "agnes-2.5-pro", labelZh: "Agnes 2.5 Pro", meta: VISION,
    tokenPricing: { inputPerMTokUsd: 0.45, outputPerMTokUsd: 0.9, cacheReadPerMTokUsd: 0.045, source: AGNES_PRICING_SOURCE },
  },
];
