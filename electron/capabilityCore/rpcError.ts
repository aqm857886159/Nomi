import type { McpGenerationCapability, McpGenerationPolicySnapshot } from './mcpGenerationPolicy'

export type RpcPolicyErrorCode =
  | 'feature_disabled'
  | 'phase_not_ready'
  | 'not_ready'
  | 'legacy_path_forbidden'
  | 'lease_required'
  | 'lease_invalid'
  | 'project_scope_changed'
  | 'lease_expired'
  | 'lease_revoked'
  | 'human_approval_required'
  | 'receipt_invalid'
  | 'receipt_expired'

export type RpcPolicyErrorDetails = Readonly<{
  code: RpcPolicyErrorCode
  nextAction: string
  phase: McpGenerationPolicySnapshot['phase']
  capability: McpGenerationCapability
}>

export class RpcError extends Error {
  readonly code?: RpcPolicyErrorCode
  readonly nextAction?: string
  readonly phase?: McpGenerationPolicySnapshot['phase']
  readonly capability?: McpGenerationCapability

  constructor(message: string, readonly httpStatus: number, details?: RpcPolicyErrorDetails) {
    super(message)
    this.code = details?.code
    this.nextAction = details?.nextAction
    this.phase = details?.phase
    this.capability = details?.capability
  }
}
