// Agent lane · 失败结果 → 界面文案的**唯一**边界。
//
// 2026-09-11 用户真机截图：Agent 面板顶部飘出一行红色英文原文
// 「The agent is opening a conversation. Try again after it opens.」。那不是文案没翻译，
// 是主进程的一句**内部不变量断言**被当成了产品文案：
//
//   laneIpc 的 catch 把 `error.message` 原样过桥 → `checked()` 把它重新包成
//   `new Error(result.message)`（丢掉同一份结果里已经带着的 `code`）→ `friendlyError`
//   在分类表里找不到这句散句，就把它当「服务商原话」印进了红色横幅。
//
// 这一层就是那条通路的收口：**只认码**。`diagnostic` 只进 console 与「技术详情」，
// 任何情况下都不会成为界面文字——它可能是内部断言、第三方栈文本，或一句没翻译的英文，
// 三者都不是用户能据以行动的事实。
import { looksLikeMachineCode, isLaneErrorCode, type LaneErrorCode } from '../../../../electron/shared/agentLane/laneErrorCodes'
import type { TranslationKey } from '../../../i18n/translationKey'
import { classifyGenerationError } from '../../observability/classifyError'

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * 码 → **整键**。存整键而不是在别处拼 `agentLaneError.${code}`：整键字面量才是死键门岗认的
 * 精确引用，拼出来的动态前缀会盖掉整个命名空间的死键检测（`src/i18n/translationKey.ts` 的理由）。
 * `satisfies` 让编译器顺带校验每个键真的在词典里，且一个码都不许漏。
 */
export const LANE_ERROR_TEXT_KEY = {
  agent_lane_bridge_absent: 'agentLaneError.agent_lane_bridge_absent',
  agent_lane_closed: 'agentLaneError.agent_lane_closed',
  agent_lane_disposed: 'agentLaneError.agent_lane_disposed',
  agent_lane_opening: 'agentLaneError.agent_lane_opening',
  agent_lane_owner_mismatch: 'agentLaneError.agent_lane_owner_mismatch',
  agent_lane_workspace_stale: 'agentLaneError.agent_lane_workspace_stale',
  agent_lane_invalid_command: 'agentLaneError.agent_lane_invalid_command',
  agent_lane_request_duplicate: 'agentLaneError.agent_lane_request_duplicate',
  agent_lane_provider_error: 'agentLaneError.agent_lane_provider_error',
  agent_lane_model_unconfigured: 'agentLaneError.agent_lane_model_unconfigured',
  agent_skill_unavailable: 'agentLaneError.agent_skill_unavailable',
  project_binding_stale: 'agentLaneError.project_binding_stale',
  project_identity_unavailable: 'agentLaneError.project_identity_unavailable',
  project_agent_unavailable: 'agentLaneError.project_agent_unavailable',
  agent_lane_conversation_missing: 'agentLaneError.agent_lane_conversation_missing',
  agent_lane_conversation_exists: 'agentLaneError.agent_lane_conversation_exists',
  agent_lane_conversation_in_use: 'agentLaneError.agent_lane_conversation_in_use',
  agent_lane_busy_running: 'agentLaneError.agent_lane_busy_running',
  agent_lane_approval_missing: 'agentLaneError.agent_lane_approval_missing',
  agent_lane_execute_failed: 'agentLaneError.agent_lane_execute_failed',
} as const satisfies Record<LaneErrorCode, TranslationKey>

/**
 * 把跨进程来的任意一格**当字符串用之前**先收成字符串。
 *
 * 这一层是用户看到字之前的最后一道。它的类型说 `diagnostic: string` / `message: string`，但
 * 那是**我们这侧的声明**，不是运行时保证：自定义 Error 子类过 IPC 会掉类型、只剩普通字段
 * （方案「先查别人」里 VS Code 踩过的那条），preload 与渲染层版本不齐时这一格就可能是
 * `undefined`。此时 `raw.trim()` 抛 TypeError——而抛的位置正是**接错误的 catch 里**，
 * 于是这次失败连一句兜底话都没有，用户什么都看不到。那比印出一句英文原文更糟。
 *
 * 所以这里不信类型、只看值：不是字符串就当空串，由调用处走兜底句那一档。
 */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 一次 lane 命令的失败。**带着码过来**，不是一句话——`Error.message` 只是为了让它在
 * 日志/断点里仍然看得懂，读它的人要的是 `laneCode`。
 */
export class LaneCommandFailure extends Error {
  readonly laneCode: LaneErrorCode
  /** 诊断串：日志与「技术详情」用。**不是界面文案。** */
  readonly diagnostic: string
  constructor(laneCode: LaneErrorCode, diagnostic: string) {
    // 收在**构造处**，不是等到取文案时才收：这个构造器就长在 IPC 边界上
    // （`new LaneCommandFailure(result.code, result.diagnostic)`），实参是刚过完桥的原始格。
    // 早一步收，`this.diagnostic` 对所有下游就都是字符串了；晚一步收，连这里的模板拼接
    // 都可能先抛——而它跑在 catch 里，抛出去就等于这次失败彻底消失。
    const text = asText(diagnostic)
    super(`${laneCode}${text ? `: ${text}` : ''}`)
    this.name = 'LaneCommandFailure'
    this.laneCode = laneCode
    this.diagnostic = text
  }
}

/** 有没有中日韩字。仓库里 electron 侧的存量人话文案是中文的（`check:i18n` 的 electron 基线在收），
 * 它们已经是**给人看的**，不该被这条防线一并打成兜底句；一句拉丁散句则永远是泄漏。 */
function hasHan(value: string): boolean {
  return /[㐀-鿿豈-﫿]/u.test(value)
}

/**
 * 未被任何分类认领的原始串，能不能直接印给用户？
 *
 * 判据是**形状**（有没有汉字、是不是机器码），不是子串匹配——子串匹配正是
 * `nomiErrorCodes.ts` 当初要替掉的那一族（文案一改分类就断）。
 */
function showableRaw(raw: string): boolean {
  const text = raw.trim()
  if (!text) return false
  if (looksLikeMachineCode(text)) return false
  return hasHan(text)
}

/**
 * 把任意一个失败变成**一句可以印在界面上的话**。
 *
 * 三档：
 *   ① 带 lane 码（且不是兜底码）→ 按码取本地化文案。原始串一个字都不进界面。
 *   ② 兜底码 / 普通 Error → 交给生成域那份分类器（供应商配额、内容安全、余额…这些用户
 *      **必须**读到的服务商原话仍旧照常露出，D4「缺口明着标」）。
 *   ③ 分类器也不认（`unknown`）且原始串是拉丁散句 → 一句通用的本地化提示，原始串进 console。
 *      这一档就是这次泄漏的落点，现在 fail-closed。
 */
export function laneFailureText(error: unknown, t: Translate): string {
  const code: LaneErrorCode | null = error instanceof LaneCommandFailure && isLaneErrorCode(error.laneCode) ? error.laneCode
    : isLaneErrorCode(error instanceof Error ? asText(error.message).trim() : '') ? asText((error as Error).message).trim() as LaneErrorCode
      : null
  if (code && code !== 'agent_lane_execute_failed') return t(LANE_ERROR_TEXT_KEY[code])

  const raw = asText(error instanceof LaneCommandFailure ? error.diagnostic
    : error instanceof Error ? error.message : typeof error === 'string' ? error : '')
  if (!raw.trim()) return t('agentResident.sendFailed')

  const report = classifyGenerationError(raw)
  if (report.kind === 'unknown' && !showableRaw(report.reason)) {
    // 用户读不到的东西不留在界面上，但**必须**留在某处——否则这条错误就彻底消失了。
    console.error('[lane] unclassified failure', { code, diagnostic: raw })
    return t('agentResident.sendFailed')
  }
  return report.providerMessage ? `${report.reason}：${report.providerMessage}` : report.reason
}
