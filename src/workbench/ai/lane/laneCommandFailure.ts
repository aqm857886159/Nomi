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
import {
  laneErrorI18nKey, looksLikeMachineCode, isLaneErrorCode,
  type LaneErrorCode,
} from '../../../../electron/shared/agentLane/laneErrorCodes'
import { classifyGenerationError } from '../../observability/classifyError'

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * 一次 lane 命令的失败。**带着码过来**，不是一句话——`Error.message` 只是为了让它在
 * 日志/断点里仍然看得懂，读它的人要的是 `laneCode`。
 */
export class LaneCommandFailure extends Error {
  readonly laneCode: LaneErrorCode
  /** 诊断串：日志与「技术详情」用。**不是界面文案。** */
  readonly diagnostic: string
  constructor(laneCode: LaneErrorCode, diagnostic: string) {
    super(`${laneCode}${diagnostic ? `: ${diagnostic}` : ''}`)
    this.name = 'LaneCommandFailure'
    this.laneCode = laneCode
    this.diagnostic = diagnostic
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
  const code: LaneErrorCode | null = error instanceof LaneCommandFailure ? error.laneCode
    : isLaneErrorCode(error instanceof Error ? error.message.trim() : '') ? (error as Error).message.trim() as LaneErrorCode
      : null
  if (code && code !== 'agent_lane_execute_failed') return t(laneErrorI18nKey(code))

  const raw = error instanceof LaneCommandFailure ? error.diagnostic
    : error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!raw.trim()) return t('agentResident.sendFailed')

  const report = classifyGenerationError(raw)
  if (report.kind === 'unknown' && !showableRaw(report.reason)) {
    // 用户读不到的东西不留在界面上，但**必须**留在某处——否则这条错误就彻底消失了。
    console.error('[lane] unclassified failure', { code, diagnostic: raw })
    return t('agentResident.sendFailed')
  }
  return report.providerMessage ? `${report.reason}：${report.providerMessage}` : report.reason
}
