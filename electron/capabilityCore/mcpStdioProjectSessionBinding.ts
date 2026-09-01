import type { McpGenerationPolicy } from './mcpGenerationPolicy'
import { createMcpConnectionContext } from './mcpConnectionContext'
import {
  createProductionProjectSessionRuntime,
  createVerifiedProjectSessionBinding,
  type VerifiedProjectSessionBinding,
} from './projectSessionRuntime'
import {
  MCP_CLIENT_ENV,
  MCP_CLIENT_PROOF_ENV,
} from './security'

/**
 * Production-only empty-args stdio assembly. Both route choices receive this
 * one binding; no lease authority, resolver, principal, or nonce is injectable
 * as an independent optional seam.
 */
export function createProductionMcpStdioProjectSessionBinding(
  generationPolicy: McpGenerationPolicy,
): VerifiedProjectSessionBinding {
  const connection = createMcpConnectionContext({
    client: process.env[MCP_CLIENT_ENV],
    proof: process.env[MCP_CLIENT_PROOF_ENV],
  })
  const runtime = createProductionProjectSessionRuntime({
    generationPolicy,
    getOpenProjectSelection: () => null,
    isServerAllowlisted: () => false,
  })
  return createVerifiedProjectSessionBinding(runtime, connection)
}
