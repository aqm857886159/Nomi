// Agent lane · 模型接线的**纯数据契约**（阶段 4 前置 ③）
//
// 为什么住在 `electron/shared/`：这两个类型是 lane、旧运行核与将来的投影层共同认的形状，
// 但它们**一个依赖都没有**——既不认识 pi，也不认识 Electron。放在
// `electron/harness/runtime/runtimePort.ts` 里的那份原本是对的，直到 `electron/agentLane/`
// 也开始用它：那一刻新通路就反向依赖上了要在阶段 4 删掉的目录，而「删目录」这件事
// 会连带把一个跟 harness 毫无关系的类型一起删掉。搬家消掉的是这条反向边，不是形状本身
// （`harness/runtime/runtimePort.ts` 现在只 re-export 它，旧通路一行不改）。

/** Nomi's boundary. SDK objects and types stay in the private pi directory. */
export interface NomiModelConfig {
  kind: 'openai-compatible' | 'openai-responses' | 'anthropic'
  providerId: string
  modelId: string
  accountTier?: string
  baseURL: string
  authType: 'api-key' | 'none'
  apiKey?: string
  headers?: Record<string, string>
  contextWindow?: number
  maxOutputTokens?: number
  temperature?: number
  /**
   * 按 token 计费的价目，**单位一律「美元 / 每百万 token」**（与 `Model.tokenPricing` 同一个单位）。
   * 缺席 = 我们没有这个模型的价目 → 运行时把花费那一行渲染成「不可知」，**不是 0**。
   * 出处（url/checkedAt）留在目录里，不过这道门：wire 配置只需要数字。
   */
  tokenPricing?: {
    inputPerMTokUsd: number
    outputPerMTokUsd: number
    /** 缺省 = 与 `inputPerMTokUsd` 同价。 */
    cacheReadPerMTokUsd?: number
    /** 缺省 = 与 `inputPerMTokUsd` 同价。 */
    cacheWritePerMTokUsd?: number
  }
  /** 显式「这个模型不按 token 计费」。与 `tokenPricing` 互斥；面板据此印「免费」而不是「不可知」。 */
  free?: true
  /**
   * 这个模型会不会思考。pi 的 `getSupportedThinkingLevels(model)` 直接读它：`false` → 只有 `off`
   * 一档（推理那一行「不适用」）。今天目录还没有一处声明它，所以生产路径恒为 `false`——
   * 这是**已知遗留**，不是设计：填它需要逐个模型抓官方文档（R5），不在阶段 3b 的范围里。
   */
  reasoning?: boolean
  /**
   * 各思考档到供应商原生取值的映射。`null` = 这一档这个模型不支持，pi 会把它从
   * `getSupportedThinkingLevels` 里剔掉；`off: null` 就是「关不掉思考」。
   */
  thinkingLevelMap?: Record<string, string | null>
}

/**
 * 这个模型在「按 token 花了多少钱」这件事上的**三态**，`createNomiProvider` 一并返回。
 *
 * 为什么必须单独返回、不能从 pi 的 `Model.cost` 反推：pi 的 `cost` **不是可选的**
 * （`pi-ai/dist/types.d.ts:729`），没有价目的模型只能填一份全零，于是 `cost.total` 恒 0——
 * 而 0 同时长得像「免费」「还没花钱」和「我们没有价目」三件事。三者在面板上是三句不同的话
 * （方案 §1.7），所以判据必须来自配置，不能来自算出来的那个 0。
 */
export type NomiPricingBasis =
  /** 目录里有 per-token 价目 → pi 算出来的金额可信。 */
  | 'priced'
  /** 目录明说这个模型不按 token 计费 → 花费那一行印「免费」。 */
  | 'free'
  /** 我们没有这个模型的价目 → 花费那一行印「不可知」，绝不印 0。 */
  | 'unpriced'
