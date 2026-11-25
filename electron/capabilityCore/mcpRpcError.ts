/**
 * Structured error boundary shared by the local RPC client and MCP transport.
 *
 * 2026-09-21：`phase` 这一格随 env flag 与三段式 rollout 一起删除。序列化那一半在主进程 lane
 * 就已经不再写它，这里是解码那一半——留着等于永远收不到、也永远读不出来的一个字段，而下一个人
 * 会照着它以为「阶段」还是一个 Nomi 回答得出来的问题。
 */
import { RpcError } from './rpcError'
import { buildToolErrorOutcome } from './mcpToolErrorResults'

type RpcErrorWireDetails = Readonly<{
  message?: string
  code?: string
  errorCode?: string
  nextAction?: string
  capability?: string
}>

type RpcErrorWirePayload = string | RpcErrorWireDetails

export class RpcTransportError extends Error {
  readonly code?: string
  readonly errorCode?: string
  readonly nextAction?: string
  readonly capability?: string

  constructor(message: string, details: RpcErrorWireDetails) {
    super(message)
    this.name = 'RpcTransportError'
    this.code = details.code
    this.errorCode = details.errorCode ?? details.code
    this.nextAction = details.nextAction
    this.capability = details.capability
  }
}

/** Serialize local RPC failures without dropping the typed policy recovery contract. */
export function rpcErrorWirePayload(error: unknown): RpcErrorWirePayload {
  const message = error instanceof Error ? error.message : String(error)
  if (!(error instanceof RpcError) || !error.code) {
    // Domain errors need the same public identity on direct and GUI RPC routes.
    // Reuse the MCP projection: never serialize arbitrary exception properties.
    const { outcome } = buildToolErrorOutcome('rpc', error)
    return typeof outcome.errorCode === 'string'
      ? { message: String(outcome.message), code: outcome.errorCode }
      : message
  }
  return {
    message,
    code: error.code,
    nextAction: error.nextAction,
    capability: error.capability,
  }
}

/** Preserve structured policy details when an RPC response crosses stdio. */
export function rpcErrorFromPayload(body: unknown, status: number): Error {
  const record = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const rawError = record.error
  const details = rawError && typeof rawError === 'object' && !Array.isArray(rawError)
    ? rawError as RpcErrorWireDetails
    : record.errorDetails && typeof record.errorDetails === 'object' && !Array.isArray(record.errorDetails)
      ? record.errorDetails as RpcErrorWireDetails
      : null
  const message = typeof rawError === 'string'
    ? rawError
    : details?.message || `RPC ${status}`
  if (details && (details.code || details.errorCode || details.nextAction || details.capability)) {
    return new RpcTransportError(message, details)
  }
  return new Error(message)
}
