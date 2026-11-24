import type { McpGenerationCapability } from './mcpGenerationPolicy'
import type { CapabilityTransportVerificationErrorCode, SurfacePortWireErrorCode } from '../shared/surfacePortBinding'
import type { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead'

/**
 * 2026-09-21：`feature_disabled` / `phase_not_ready` 随 env flag 与三段式 rollout 一起删除。
 * 「这个面开没开」不再是一个可以回答的问题——它永远开着，能不能做由租约、闸与人证回答。
 * `not_ready` 留着，但它现在只说一件事：**这个装配点没有装那个处理器**（宿主自己的装配问题），
 * 不再兼任「功能还没轮到你」。
 */
export type RpcPolicyErrorCode =
  | 'not_ready'
  | 'legacy_path_forbidden'
  | 'lease_required'
  | 'lease_invalid'
  | 'project_scope_changed'
  | 'project_binding_stale'
  | 'lease_expired'
  | 'lease_revoked'
  | 'human_approval_required'
  | 'receipt_invalid'
  | 'receipt_expired'

/**
 * C4：端口码与传输验证码从 owner derive，不再手抄。抄的那一份少了
 * `capability_receipt_unresolved` / `capability_target_stale` / `project_binding_stale` /
 * `capability_invocation_unverified` / `capability_policy_stale` —— 主进程抛得出这些码，
 * 而这个类型不认，于是 RPC 层要么类型上过不去、要么把它们降级成通用码。
 * 本地只留 MCP 连接/项目选择这三个它自己独有的。
 */
export type RpcProjectSessionErrorCode =
  | SurfacePortWireErrorCode
  | CapabilityTransportVerificationErrorCode
  | 'mcp_connection_unauthenticated'
  | 'project_selection_denied'
  | 'project_session_unavailable'

export type RpcPublicErrorCode = RpcPolicyErrorCode | RpcProjectSessionErrorCode

type RpcPublicCapability = McpGenerationCapability | typeof CANVAS_READ_CAPABILITY.id | 'project.session'
  | 'canvas.write' | 'canvas.delete' | 'document.read' | 'document.write'

export type RpcPolicyErrorDetails = Readonly<{
  code: RpcPolicyErrorCode
  nextAction: string
  capability: McpGenerationCapability
}>

type RpcPublicErrorDetails = Readonly<{
  code: RpcPublicErrorCode
  nextAction?: string
  capability?: RpcPublicCapability
}>

export class RpcError extends Error {
  readonly code?: RpcPublicErrorCode
  readonly nextAction?: string
  readonly capability?: RpcPublicCapability

  constructor(message: string, readonly httpStatus: number, details?: RpcPublicErrorDetails) {
    super(message)
    this.code = details?.code
    this.nextAction = details?.nextAction
    this.capability = details?.capability
  }
}
