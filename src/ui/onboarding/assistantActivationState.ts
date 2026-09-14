import {
  BUILTIN_MCP_CLIENTS,
  MCP_CLIENT_REGISTRY,
  type BuiltinMcpClient,
} from '../../../electron/shared/mcpClientRegistry'

/** 内置客户端 key。唯一 owner 是 electron/shared/mcpClientRegistry.ts；渲染层只 derive。 */
export type AssistantClientKey = BuiltinMcpClient

/**
 * 宿主的显示名与排序——从注册表 derive。「用 AI 帮我接入」卡与「接入 AI 编程助手」卡两处都念这一份，
 * 各抄一份的后果是同一个宿主在两屏上叫不同的名字。这些是产品专名（Claude Code / Codex / …），不进 i18n。
 */
export const ASSISTANT_CLIENT_LABEL: Record<AssistantClientKey, string> = Object.fromEntries(
  BUILTIN_MCP_CLIENTS.map((key) => [key, MCP_CLIENT_REGISTRY[key].label]),
) as Record<AssistantClientKey, string>
export const ASSISTANT_CLIENT_ORDER: readonly AssistantClientKey[] = BUILTIN_MCP_CLIENTS

/** 宿主自己还有一道 MCP server 审批门（如 Cursor）：Nomi 握手成功不等于宿主已放行，徽章不判绿。 */
export function assistantRequiresHostApproval(key: AssistantClientKey): boolean {
  return MCP_CLIENT_REGISTRY[key].requiresHostApproval
}

export type AssistantVerifyPhase = 'checking' | 'ok' | 'broken' | null

export function resolveAssistantActivationState(input: {
  target: AssistantClientKey
  installed: boolean
  verifyPhase: AssistantVerifyPhase
  trustedHosts: readonly string[]
}): {
  broken: boolean
  /** 配置在、握手没断，但宿主那边还要自己批准一次——只说「已写入配置」，不说「已连通」。 */
  hostApprovalPending: boolean
  /** 该客户端是否是可信发起方（连上后允许自动发起制作）。 */
  trusted: boolean
  headerStatus: 'ok' | 'todo'
} {
  const broken = input.installed && input.verifyPhase === 'broken'
  const verified = input.installed && input.verifyPhase === 'ok'
  const hostApproval = assistantRequiresHostApproval(input.target)
  return {
    broken,
    hostApprovalPending: hostApproval && input.installed && !broken,
    trusted: input.trustedHosts.includes(input.target),
    headerStatus: verified && !hostApproval ? 'ok' : 'todo',
  }
}
