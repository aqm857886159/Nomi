import crypto from 'node:crypto'

import { verifyMcpClient, type AuthenticatedMcpClient } from './security'

export type McpConnectionContext = Readonly<{
  authenticatedClient: AuthenticatedMcpClient
  principal: `mcp:${AuthenticatedMcpClient}`
  sessionId: string
  connectionNonce: string
}>

export type McpConnectionContextInput = Readonly<{
  client: unknown
  proof: unknown
  randomSecret?: () => string
}>

export type TransportedMcpConnectionContextInput = Readonly<{
  client: unknown
  proof: unknown
  connectionAttestation: unknown
}>

export class McpConnectionAuthenticationError extends Error {
  readonly code = 'mcp_connection_unauthenticated'

  constructor(message = 'A verified MCP client connection is required') {
    super(message)
    this.name = 'McpConnectionAuthenticationError'
  }
}

const connectionAttestations = new WeakMap<McpConnectionContext, string>()
const verifiedConnectionContexts = new WeakSet<object>()

function transportSecret(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length < 43 || normalized.length > 200 || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new McpConnectionAuthenticationError('MCP transport connection attestation is invalid')
  }
  return normalized
}

function deriveTransportIdentity(secret: string, purpose: 'session' | 'nonce'): string {
  return crypto.createHmac('sha256', secret)
    .update(`nomi-mcp-connection:v2:${purpose}`)
    .digest('base64url')
}

function verifiedClient(client: unknown, proof: unknown): AuthenticatedMcpClient {
  const authenticatedClient = verifyMcpClient(client, proof)
  if (!authenticatedClient) throw new McpConnectionAuthenticationError()
  return authenticatedClient
}

function freezeContext(
  authenticatedClient: AuthenticatedMcpClient,
  connectionAttestation: string,
): McpConnectionContext {
  const context = Object.freeze({
    authenticatedClient,
    principal: `mcp:${authenticatedClient}` as const,
    sessionId: `mcp-session:${deriveTransportIdentity(connectionAttestation, 'session')}`,
    connectionNonce: deriveTransportIdentity(connectionAttestation, 'nonce'),
  })
  verifiedConnectionContexts.add(context)
  return context
}

/** Exact-object runtime proof shared by direct stdio and loopback-bound contexts. */
export function assertVerifiedMcpConnectionContext(
  value: unknown,
): asserts value is McpConnectionContext {
  if (!value || typeof value !== 'object' || !verifiedConnectionContexts.has(value)) {
    throw new McpConnectionAuthenticationError('MCP connection was not minted by a verified transport')
  }
}

/**
 * Mint one immutable identity for a concrete MCP transport connection. The
 * authenticated principal comes only from Nomi's client proof; tool arguments
 * never participate in this construction.
 */
export function createMcpConnectionContext(input: McpConnectionContextInput): McpConnectionContext {
  const authenticatedClient = verifiedClient(input.client, input.proof)
  const randomSecret = input.randomSecret ?? (() => crypto.randomBytes(32).toString('base64url'))
  const connectionAttestation = transportSecret(randomSecret())
  const context = freezeContext(authenticatedClient, connectionAttestation)
  connectionAttestations.set(context, connectionAttestation)
  return context
}

/**
 * Reconstruct the same connection closure after a local loopback hop. Client
 * proof is re-verified here, while the transport-only secret deterministically
 * derives the public session/nonce claims. Those claims can appear in a lease;
 * the secret never does, so copying a lease cannot recreate this connection.
 */
export function bindMcpConnectionContext(input: TransportedMcpConnectionContextInput): McpConnectionContext {
  const authenticatedClient = verifiedClient(input.client, input.proof)
  return freezeContext(authenticatedClient, transportSecret(input.connectionAttestation))
}

/**
 * Return the loopback attestation only for the exact context minted by this
 * module. A structurally identical object cannot recover it. Keep this value
 * in transport headers only; never place it in tool arguments, results, logs,
 * selection handles, or leases.
 */
export function getMcpConnectionAttestation(connection: McpConnectionContext): string {
  const attestation = connectionAttestations.get(connection)
  if (!attestation) {
    throw new McpConnectionAuthenticationError('MCP connection was not minted by this transport')
  }
  return attestation
}
