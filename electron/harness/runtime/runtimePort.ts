import type { ZodTypeAny } from 'zod'
import type { CompiledPrompt, PromptCacheTelemetry } from '../context/promptPipe'

/** Nomi's boundary. SDK objects and types stay in the private pi directory. */
export interface NomiModelConfig {
  kind: 'openai-compatible' | 'openai-responses' | 'anthropic'
  providerId: string
  modelId: string
  baseURL: string
  authType: 'api-key' | 'none'
  apiKey?: string
  headers?: Record<string, string>
  contextWindow?: number
  maxOutputTokens?: number
  temperature?: number
}

export interface RuntimeToolDescriptor {
  name: string
  description: string
  schema: ZodTypeAny
}

export interface RuntimeToolCall {
  toolCallId: string
  toolName: string
  args: unknown
}

export type RuntimeToolDecision =
  | { ok: true; result?: unknown; effectiveArgs?: Record<string, unknown>; overridesDelta?: Record<string, unknown>; silent?: boolean; proposalId?: string }
  | { ok: false; message?: string; code?: string; denied?: boolean }

export interface RuntimeToolCallRecord extends RuntimeToolCall {
  status: 'ok' | 'denied' | 'cancelled' | 'error'
  decision?: RuntimeToolDecision
  result?: unknown
  error?: string
}

export interface RuntimeUsage {
  promptTokens: number
  completionTokens: number
  cachedPromptTokens: number
  totalTokens: number
}

export type RuntimeFinishReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'

export interface RuntimeErrorFacts {
  kind: 'http' | 'network' | 'timeout' | 'abort' | 'step-limit' | 'runtime'
  message: string
  code?: string
  status?: number
  body?: string
  url?: string
  timeoutPhase?: 'first-response' | 'idle'
}

export type RuntimeActivityEvent =
  | { type: 'content-delta'; delta: string }
  | ({ type: 'tool-call' } & RuntimeToolCall)
  | { type: 'tool-result'; toolCallId: string; toolName: string; result?: unknown; decision?: RuntimeToolDecision }
  | { type: 'tool-error'; toolCallId: string; toolName: string; message: string; denied?: boolean; cancelled?: boolean }
  | { type: 'step-finish'; step: number; finishReason: RuntimeFinishReason; usage: RuntimeUsage }
  | { type: 'warning'; error: RuntimeErrorFacts }

export interface RuntimeTurnRequest {
  cwd: string
  agentDir: string
  tempRoot: string
  model: NomiModelConfig
  systemPrompt: string
  user: {
    durableText: string
    currentContextText?: string
    images?: ReadonlyArray<{ mimeType: string; data: Uint8Array }>
    pdfs?: ReadonlyArray<{ fileName: string; data: Uint8Array }>
  }
  tools: readonly RuntimeToolDescriptor[]
  capability: { singleShot: true; maxSteps: 1 } | { singleShot?: false; maxSteps: 8 | 24 }
  /** Opaque, versioned working history; the caller owns thread binding/publication. */
  snapshot?: string
  compaction: { enabled: boolean; reserveTokens?: number; keepRecentTokens?: number }
  /** Hash-only prompt receipt; contents stay in the request's actual prompt slots. */
  promptReceipt?: Pick<CompiledPrompt, 'compileHash' | 'stablePrefixHash' | 'estimatedTokens' | 'byteLength' | 'warnings' | 'budgetWarning' | 'provenance' | 'taintedSourceRefs'>
}

export interface RuntimeTurnHooks {
  /** Synchronous activity delivery; do not await persistence inside SDK listeners. */
  emit(event: RuntimeActivityEvent): void
  /** The host already executes an approved action. The runtime never executes it again. */
  awaitToolConfirmation(call: RuntimeToolCall, signal: AbortSignal): Promise<RuntimeToolDecision>
  signal?: AbortSignal
  /** Main-process transport; never accepted from renderer DTOs. */
  fetch?: typeof globalThis.fetch
  /** Existing Nomi model-profile adjustment, not provider classification in this layer. */
  onPayload?(payload: Record<string, unknown>): Record<string, unknown> | void | Promise<Record<string, unknown> | void>
}

export interface RuntimeContextMetadata {
  normalRequests: number
  summaryRequests: number
  compactions: number
  retainedMessages: number
}

export interface RuntimeTurnResult {
  status: 'finished' | 'cancelled' | 'error'
  text: string
  finishReason: RuntimeFinishReason
  usage: RuntimeUsage
  toolCalls: RuntimeToolCallRecord[]
  /** Present only when the actual history could be exported after stable settlement. */
  snapshot?: string
  context?: RuntimeContextMetadata
  error?: RuntimeErrorFacts
  promptCache?: PromptCacheTelemetry
}

export type RunAgentTurn = (request: RuntimeTurnRequest, hooks: RuntimeTurnHooks) => Promise<RuntimeTurnResult>

/** Text reconstructed from an explicitly identified old UI thread, not SDK messages. */
export interface RuntimeLegacyTextTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface RuntimeSnapshotOptions {
  cwd: string
  tempRoot: string
}

export interface RuntimeSnapshotMetadata {
  retainedMessages: number
}

/** No sessions, model selection, tool execution or storage policy cross this codec seam. */
export interface RuntimeSnapshotCodec {
  importLegacy(turns: readonly RuntimeLegacyTextTurn[], options: RuntimeSnapshotOptions): Promise<string>
  inspect(snapshot: string, options: RuntimeSnapshotOptions): Promise<RuntimeSnapshotMetadata>
}
