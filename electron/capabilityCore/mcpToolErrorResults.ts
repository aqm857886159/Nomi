import type { ResultLocale } from './mcpToolResults'
import { confirmPublicError } from '../shared/generationFailure'
import { GENERATION_INPUT_INVALID_CODE } from '../shared/agentCapabilities/admissionRejectionHints'
import { toolErrorHint, toolUserActionHint } from '../shared/generationFailureCopy'

type Ctx = { locale: ResultLocale }
const L = (ctx: Ctx, zh: string, en: string): string => (ctx.locale === 'en' ? en : zh)

const OPEN_NEW_PROJECT_SESSION = 'Open a new project session and retry'

/** A6 · 错误 → 人话原因 + 恢复动作 + 诊断信息（未知错误不编内容，原样透传 message）。 */
export function buildToolErrorOutcome(
  toolName: string,
  error: unknown,
  locale: ResultLocale = 'zh-CN',
): { text: string; outcome: Record<string, unknown> } {
  const ctx: Ctx = { locale }
  const rawMessage = error instanceof Error ? error.message : String(error)
  const errorRecord = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const structuredCode = typeof errorRecord.code === 'string'
    ? errorRecord.code
    : typeof errorRecord.errorCode === 'string' ? errorRecord.errorCode : null
  // 公开码「确证」只在共享判定处做：字段里的码（登记过的）或原文里的整词码；这里只做外部助手的受众投影。
  const confirmed = confirmPublicError(structuredCode ?? undefined, rawMessage)
  const code = confirmed.code
  const hintForMessage = code ? toolErrorHint(code) : null
  const message = confirmed.codeOnly && structuredCode
    ? structuredCode
    // 有登记过 zh/en 人话时 `message` 也跟着 locale 走：否则 en 宿主拿到的是中文原句（R15）。
    // 没登记的码仍原样透传 rawMessage（不编内容）。
    // `generation_input_invalid` 的正文是我们写的那句可行动的话，原样保留（只补恢复动作）。
    : hintForMessage && code !== GENERATION_INPUT_INVALID_CODE ? L(ctx, hintForMessage.zh, hintForMessage.en) : rawMessage
  const nextAction = typeof errorRecord.nextAction === 'string'
    ? errorRecord.nextAction
    : structuredCode && toolUserActionHint(structuredCode)?.action === 'reselect_project'
      ? OPEN_NEW_PROJECT_SESSION
      : undefined
  const policyDetails = confirmed.policy
    ? {
        ...(nextAction ? { nextAction } : {}),
        // `phase` 随三段式 rollout 一起删除（2026-09-21）：没有生产者了，再透传就是永远为空的一格。
        ...(typeof errorRecord.capability === 'string' ? { capability: errorRecord.capability } : {}),
      }
    : {}
  // 可执行细节（currentRevision / missing 字段名…）。人话原因说的是「哪一类错」，
  // 细节说的是「该拿什么值」——只有后者能让模型不用再猜。
  const details = errorRecord.details && typeof errorRecord.details === 'object' && !Array.isArray(errorRecord.details)
    ? errorRecord.details as Record<string, string | number>
    : null
  const hint = code ? toolErrorHint(code) : null
  const userAction = code ? toolUserActionHint(code) : null
  const recover = hint ? hint.recover.map((r) => L(ctx, r.zh, r.en)) : []
  const text = [
    `✗ ${userAction ? L(ctx, userAction.zh, userAction.en) : hint && code !== GENERATION_INPUT_INVALID_CODE ? L(ctx, hint.zh, hint.en) : message}`,
    userAction ? null : code ? `${L(ctx, '诊断', 'diagnostic')} ${code}` : null,
    details ? Object.entries(details).map(([key, value]) => `${key}=${value}`).join(' ') : null,
    ...(!userAction ? recover.map((line, index) => `${index + 1}. ${line}`) : []),
  ].filter(Boolean).join('\n')
  return {
    text,
    outcome: {
      kind: 'error', tool: toolName, errorCode: code, message,
      ...(details ? { details } : {}),
      recoveryActions: userAction ? [L(ctx, userAction.zh, userAction.en)] : recover,
      ...(userAction ? { nextActions: [userAction.action] } : {}),
      ...policyDetails,
    },
  }
}
