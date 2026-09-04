import {
  getMcpConnectionAttestation,
  type McpConnectionContext,
} from './mcpConnectionContext'

export type McpLoopbackRpcRequestInput = Readonly<{
  token: string
  clientProof: string
  connection: McpConnectionContext
  method: string
  params: Record<string, unknown>
  planConfirmed?: boolean
  spendConfirmed?: boolean
  documentConfirmed?: boolean
  requestId?: string
  signal?: AbortSignal
}>

/** One request shape for both packaged-Node and in-Electron loopback clients. */
export function createMcpLoopbackRpcRequest(input: McpLoopbackRpcRequestInput): RequestInit {
  return {
    method: 'POST',
    // The bearer may be stripped by Fetch on a cross-origin redirect, but
    // custom client-proof and connection-attestation headers are not. A local
    // RPC endpoint therefore never gets to redirect this authenticated hop.
    redirect: 'error',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.token}`,
      'x-nomi-mcp-client': input.connection.authenticatedClient,
      'x-nomi-mcp-client-proof': input.clientProof,
      'x-nomi-mcp-connection-attestation': getMcpConnectionAttestation(input.connection),
    },
    body: JSON.stringify({
      method: input.method,
      params: input.params,
      ...(input.planConfirmed ? { planConfirmed: true } : {}),
      ...(input.spendConfirmed ? { spendConfirmed: true } : {}),
      ...(input.documentConfirmed ? { documentConfirmed: true } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    }),
    signal: input.signal,
  }
}
