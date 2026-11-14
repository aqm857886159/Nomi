// 「调一次模型」的跨岛契约（CJS 主进程 ⇄ ESM pi 岛）。实现在 `electron/agentLane/laneModelCall.mts`，
// CJS 一侧经 `electron/ai/modelCallBridge.ts` → `laneNativeLoader.cjs` 调过去。形状只写在这里一份：
// 岛那边的实现以它为类型，桥这边以它为签名——哪天不再结构兼容，编译在两侧当场红。
import type { Api, AssistantMessage, AssistantMessageEvent, ImageContent, Model, TextContent } from '@earendil-works/pi-ai'
import type { NomiModelConfig, NomiPricingBasis } from './laneModelConfig'
import type { NativeFileContent } from './nativeModelInput'

export interface ModelCallOptions {
  model: NomiModelConfig
  fetch: typeof globalThis.fetch
  systemPrompt?: string
  content: string | Array<TextContent | ImageContent | NativeFileContent>
  temperature?: number
  /** 调用方明确要的输出上限；不给就按模型配置（`createNomiProvider` 的 onPayload 决定发不发）。 */
  maxTokens?: number
  /** 流开始之前的可重试失败（408/409/429/5xx/连不上）重试几次。缺省 0。 */
  maxRetries?: number
  /** 停止键。没给 = 这个入口没有停止手段，核心自加整体兜底（MODEL_CALL_CEILING_MS）。 */
  signal?: AbortSignal
  /** 请求体最后一道改写（PDF 内联、response_format 之类调用方自己的需要）。 */
  onPayload?: (payload: unknown, api: Api) => unknown | Promise<unknown>
  /** 逐个事件（正文 / 思考 / 开始…）。用来往外推正文增量；思考事件只代表「还活着」。 */
  onEvent?: (event: AssistantMessageEvent) => void
}

export interface ModelCallResult {
  message: AssistantMessage
  model: Model<Api>
  pricingBasis: NomiPricingBasis
}

export type CallModelOnce = (options: ModelCallOptions) => Promise<ModelCallResult>

/** 预热只装这些协议的实现（每条带一个 SDK，装一条就是一段同步卡顿）：只装用户真接了的那几条。 */
export type ModelProtocol = NomiModelConfig['kind']
export type PrewarmModelCall = (protocols: readonly ModelProtocol[]) => Promise<void>

/**
 * 岛对外的两个口子。实现只有岛上 laneModelCall.mts 那一份；CJS 一侧的两座桥（laneNativeLoader.cts、electron/ai/modelCallBridge.ts）
 * 与单测的替身（tests/setup/modelCallBridge.ts）按这个槽位接线、只转发（概念 model-call.single-call）。
 */
export interface ModelCallPort {
  callModelOnce: CallModelOnce
  prewarmModelCall: PrewarmModelCall
}

/** 一次性入口的整体兜底到点的错误名（不是存活判据：存活由三相看门狗管）。按名认，不按类（类住在岛上）。 */
export const MODEL_CALL_CEILING_ERROR = 'ModelCallCeilingError'
