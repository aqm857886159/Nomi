import type { McpGenerationCapability, McpGenerationPolicySnapshot } from './mcpGenerationPolicy'
import type { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead'

export type RpcPolicyErrorCode =
  | 'feature_disabled'
  | 'phase_not_ready'
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

export type RpcProjectSessionErrorCode =
  | 'project_selection_denied'
  | 'project_identity_unavailable'
  | 'project_session_unavailable'
  | 'capability_authority_invalid'
  | 'capability_input_invalid'
  | 'capability_unsupported'
  | 'capability_output_invalid'
  | 'capability_timeout'
  | 'capability_cancelled'
  | 'capability_execution_failed'
  | 'surface_port_suspended'
  | 'surface_port_unavailable'
  | 'surface_port_stale'
  | 'surface_owner_mismatch'

export type RpcPublicErrorCode = RpcPolicyErrorCode | RpcProjectSessionErrorCode

export type RpcPublicCapability = McpGenerationCapability | typeof CANVAS_READ_CAPABILITY.id | 'project.session'
  | 'canvas.write' | 'canvas.delete' | 'document.read' | 'document.write'

export type RpcPolicyErrorDetails = Readonly<{
  code: RpcPolicyErrorCode
  nextAction: string
  phase: McpGenerationPolicySnapshot['phase']
  capability: McpGenerationCapability
}>

export type RpcPublicErrorDetails = Readonly<{
  code: RpcPublicErrorCode
  nextAction?: string
  phase?: McpGenerationPolicySnapshot['phase']
  capability?: RpcPublicCapability
}>

export class RpcError extends Error {
  readonly code?: RpcPublicErrorCode
  readonly nextAction?: string
  readonly phase?: McpGenerationPolicySnapshot['phase']
  readonly capability?: RpcPublicCapability

  constructor(message: string, readonly httpStatus: number, details?: RpcPublicErrorDetails) {
    super(message)
    this.code = details?.code
    this.nextAction = details?.nextAction
    this.phase = details?.phase
    this.capability = details?.capability
  }
}
