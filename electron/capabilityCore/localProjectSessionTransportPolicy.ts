import { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead'
import { RpcError } from './dispatcher'

const PROJECT_SESSION_ONLY_METHODS = new Set([
  CANVAS_READ_CAPABILITY.id,
  'timeline.read',
  'timeline.write',
  'asset.read',
  'export.read',
  'nomi_session_open',
])

/**
 * A local capability bearer authenticates a process, not an MCP transport
 * principal or connection. Until the internal VerifiedCaller binding lands,
 * these routes must fail closed instead of accepting a bare project id or
 * inventing an MCP session.
 */
export function assertLocalBearerProjectSessionRoute(method: string): void {
  if (!PROJECT_SESSION_ONLY_METHODS.has(method)) return
  throw new RpcError('A verified project-session transport is required for this method', 403)
}
