// Agent 工具失败 → 一条匿名遥测（2026-11-07）。
//
// 用户反馈「经常参数不合法 然后重试」；修完以后线上要能数出来：哪个工具、哪种失败、连到第几次、熔断拦没拦、
// 用的是哪一类模型。lane 在入参边界和 `after_tool` 各报一次失败事实（`OpenLaneOptions.onToolFailure`），
// 这里把它压成五格标识符——不带入参、不带正文、不带模型 id。
import { builtinVendorKeyOfKey } from '../shared/builtinVendorIdentity'
import { builtinVendorSeed, isLocalSeed } from '../catalog/builtinVendorSeeds'
import { TELEMETRY_IDENTIFIER_PATTERN, type AgentToolFailedProps, type ModelClass } from './telemetryEvents'
import { isGenerationProblemCode } from '../shared/generationProblem'

/** `reason` = 起草期被拒的闭合原因码（`generationProblem.ts`），只有 `generation_input_invalid` 那一档才有。 */
export type AgentToolFailureFact = Readonly<{ toolName: string; code: string; attempt: number; breakerTripped: boolean; reason?: string }>

/**
 * 模型只到「种类」：内置云端家 = builtin，种子在本机的内置家 = local，其余（用户自建 / 中转）= custom。
 * 判据和出门的模型目录同一个（`catalog/outboundVendor.ts`：判种子，不判当前地址）；没选模型按 custom 算。
 */
export function modelClassOfVendor(vendorKey: string | undefined): ModelClass {
  const seed = vendorKey ? builtinVendorSeed(builtinVendorKeyOfKey(vendorKey)) : undefined
  if (!seed) return 'custom'
  return isLocalSeed(seed) ? 'local' : 'builtin'
}

/**
 * 失败事实 → 事件的五格（+ 有闭合原因时的第六格 `reason`）。
 *
 * 工具名的闭合表在构造上：只有这条 lane **注册过**的工具会报失败（入参边界只包注册的工具，pi 也只对
 * 找得到的工具跑 `after_tool`），而注册的全是我们自己的名字（目录里的动词 + 编码工具 + `list_models` 这类原生工具）。
 * 这里再守一道形状：不是小写标识符就记 `other`。失败码过不了形状记 `unknown`；次数封顶 5。
 */
export function agentToolFailedProps(fact: AgentToolFailureFact, input: Readonly<{ vendorKey?: string }>): AgentToolFailedProps {
  const toolName = TELEMETRY_IDENTIFIER_PATTERN.test(fact.toolName) ? fact.toolName : 'other'
  const failureCode = TELEMETRY_IDENTIFIER_PATTERN.test(fact.code) ? fact.code : 'unknown'
  const attempt = Math.min(5, Math.max(1, Math.trunc(Number.isFinite(fact.attempt) ? fact.attempt : 1))) as AgentToolFailedProps['attempt']
  return {
    toolName, failureCode, attempt, breakerTripped: fact.breakerTripped, modelClass: modelClassOfVendor(input.vendorKey),
    // 不在码表里的原因不记（宁可少一格，也不让一个表外字符串出门）。
    ...(isGenerationProblemCode(fact.reason) ? { reason: fact.reason } : {}),
  }
}
