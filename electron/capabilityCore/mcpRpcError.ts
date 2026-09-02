/** Structured error boundary shared by the local RPC client and MCP transport. */
import { RpcError } from './rpcError'

export type RpcErrorWireDetails = Readonly<{
  message?: string
  code?: string
  errorCode?: string
  nextAction?: string
  phase?: string
  capability?: string
}>

export type RpcErrorWirePayload = string | RpcErrorWireDetails

export class RpcTransportError extends Error {
  readonly code?: string
  readonly errorCode?: string
  readonly nextAction?: string
  readonly phase?: string
  readonly capability?: string

  constructor(message: string, details: RpcErrorWireDetails) {
    super(message)
    this.name = 'RpcTransportError'
    this.code = details.code
    this.errorCode = details.errorCode ?? details.code
    this.nextAction = details.nextAction
    this.phase = details.phase
    this.capability = details.capability
  }
}

/** Serialize local RPC failures without dropping the typed policy recovery contract. */
export function rpcErrorWirePayload(error: unknown): RpcErrorWirePayload {
  const message = error instanceof Error ? error.message : String(error)
  if (!(error instanceof RpcError) || !error.code) return message
  return {
    message,
    code: error.code,
    nextAction: error.nextAction,
    phase: error.phase,
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
  if (details && (details.code || details.errorCode || details.nextAction || details.phase || details.capability)) {
    return new RpcTransportError(message, details)
  }
  return new Error(message)
}
