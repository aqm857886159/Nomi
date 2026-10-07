// Agent lane · 「这一回合为什么没答完」的**结构化事实**（2026-10-06，NF-0928-0003 / NF-1001-0003 / NF-1001-0004）。
//
// 助手回合以 `stopReason: 'error'` 收场时，转录里只留下 `errorMessage` 一串字。其中有三类字**不是服务商说的**：
//   · 我们自己的看门狗那句（`Nomi model <phase> timeout after <ms>ms`）；
//   · pi-ai 的 openai-completions 在流没给 finish_reason 就断了时抛的那句；
//   · pi-agent-core 判定上下文装不下、又压缩救不回来时补的那句。
// 它们过去和服务商原话混在一起交给渲染层按关键词猜：看门狗那句因为有 `timeout` 被说成「连不上服务商」，
// 而其实连上了、是模型两分钟没出字；上下文那句一个词都不中，落成「服务商返回了一个没见过的错误」
// （真实反馈 NF-0928-0003 / NF-1001-0003 / NF-1001-0004，用户看到的就是这三句英文原文）。
//
// 所以在投影这一层把它们认成一个闭合的事实，渲染层按事实给人话、**原文不进界面**。
// 这里是浏览器也 import 的中立层：不许 import pi 的运行时；需要 pi 判断的那一条（上下文溢出）由宿主喂进来。

import type { RuntimeErrorFacts } from '../agentCapabilities/transportContracts'

/** 看门狗三个相位。**派生，不重抄**：词表本体是 `RuntimeErrorFacts.timeoutPhase`。 */
export type LaneModelTimeoutPhase = NonNullable<RuntimeErrorFacts['timeoutPhase']>

/** 看门狗那句话的**唯一**格式：看门狗用它铸，下面的解析用它认。 */
export function laneModelTimeoutMessage(phase: LaneModelTimeoutPhase, milliseconds: number): string {
  return `Nomi model ${phase} timeout after ${milliseconds}ms`
}

const MODEL_TIMEOUT = /^Nomi model (first-response|first-token|idle) timeout after (\d+)ms/

/**
 * pi-ai 0.85 `dist/api/openai-completions.js`：流结束了却没有 finish_reason（中转站 / 网关半路掐断）。
 * 字面量抄自依赖，`laneAssistantFault.test.ts` 读依赖源码钉住它——升级 pi 改了这句会当场红。
 */
export const PI_STREAM_CUT_MESSAGE = 'Stream ended without finish_reason'

/**
 * pi-agent-core 0.85 `dist/harness/runtime/drive/response.js`：判定溢出、压缩一次仍救不回时补的那句
 * （服务商没给原话时才用它；服务商给了原话，由宿主喂进来的 pi `isContextOverflow` 认）。同样由测试钉住。
 */
export const PI_CONTEXT_OVERFLOW_MESSAGE = 'Assistant request exceeded the context window'

export type LaneAssistantFault =
  | Readonly<{ kind: 'model-timeout'; phase: LaneModelTimeoutPhase; seconds: number }>
  | Readonly<{ kind: 'stream-cut' }>
  | Readonly<{ kind: 'context-overflow' }>

/**
 * 出错的助手消息 → 事实；认不出就 `undefined`（那是服务商原话，归生成域分类器管）。
 * `contextOverflow` 是宿主用 pi 的 `isContextOverflow` 判好的结论（各家服务商的溢出原话由 pi 那张表认）。
 */
export function laneAssistantFaultOf(errorMessage: string | undefined, contextOverflow = false): LaneAssistantFault | undefined {
  const text = (errorMessage ?? '').trim()
  if (contextOverflow || text.startsWith(PI_CONTEXT_OVERFLOW_MESSAGE)) return { kind: 'context-overflow' }
  const timeout = MODEL_TIMEOUT.exec(text)
  if (timeout) return { kind: 'model-timeout', phase: timeout[1] as LaneModelTimeoutPhase, seconds: Math.round(Number(timeout[2]) / 1000) }
  if (text.startsWith(PI_STREAM_CUT_MESSAGE)) return { kind: 'stream-cut' }
  return undefined
}
