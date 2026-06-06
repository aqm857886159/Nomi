import { getDesktopBridge, type DesktopBridge } from '../desktop/bridge'
import type { ProviderKind } from '../desktop/providerKind'

export type BillingModelKind = 'text' | 'image' | 'video' | 'audio'

export type ProfileKind =
  | 'chat'
  | 'prompt_refine'
  | 'text_to_image'
  | 'image_to_prompt'
  | 'image_to_video'
  | 'text_to_video'
  | 'image_edit'
  | 'text_to_audio'
  | 'image_to_audio'

export type ModelCatalogVendorAuthType = 'none' | 'bearer' | 'x-api-key' | 'query'
export type ModelCatalogVendorProviderKind = ProviderKind

export type ModelCatalogIntegrationChannelKind =
  | 'official_provider'
  | 'aggregator_gateway'
  | 'private_proxy'
  | 'local_runtime'
  | 'custom_endpoint'

export type AgentsChatRequestDto = {
  vendor?: string
  prompt: string
  displayPrompt?: string
  sessionKey?: string
  canvasProjectId?: string
  canvasFlowId?: string
  chatContext?: unknown
  mode?: 'chat' | 'auto' | string
  temperature?: number
  systemPrompt?: string
}

export type AgentUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type AgentsChatResponseDto = {
  id?: string
  text: string
  raw?: unknown
  toolCalls?: unknown[]
  artifacts?: unknown[]
  /** Token usage for this turn (was previously buried in `raw` and dropped). */
  usage?: AgentUsage
}

/** Coerce the SDK's loosely-typed usage object into AgentUsage (0-filled). */
export function coerceAgentUsage(raw: unknown): AgentUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const usage: AgentUsage = {
    promptTokens: num(r.promptTokens ?? r.inputTokens),
    completionTokens: num(r.completionTokens ?? r.outputTokens),
    totalTokens: num(r.totalTokens),
  }
  if (!usage.totalTokens) usage.totalTokens = usage.promptTokens + usage.completionTokens
  if (!usage.promptTokens && !usage.completionTokens && !usage.totalTokens) return undefined
  return usage
}

export type AgentsChatToolStreamPayload = Record<string, unknown>

export type AgentsChatStreamEvent =
  | { event: 'initial'; data: { requestId: string; messageId?: string } }
  | { event: 'content'; data: { delta: string; text: string } }
  | { event: 'tool'; data: AgentsChatToolStreamPayload }
  | { event: 'tool-call'; data: { sessionId: string; toolCallId: string; toolName: string; args: unknown } }
  | { event: 'tool-result'; data: { toolCallId: string; toolName: string; result: unknown } }
  | { event: 'tool-error'; data: { toolCallId: string; toolName: string; message: string } }
  | { event: 'step-finish'; data: { finishReason: string } }
  | { event: 'result'; data: { response: AgentsChatResponseDto } }
  | { event: 'error'; data: { message: string; code?: string } }
  | { event: 'done'; data: { reason: 'finished' | 'error' } }

export type AgentChatV2ToolDecision =
  | { ok: true; result?: unknown }
  | { ok: false; message?: string }

export type AgentChatV2Session = {
  sessionId: string
  confirmTool: (toolCallId: string, decision: AgentChatV2ToolDecision) => Promise<void>
  cancel: () => Promise<void>
}

export type ModelCatalogVendorDto = {
  key: string
  name: string
  enabled: boolean
  hasApiKey?: boolean
  baseUrlHint?: string | null
  authType?: ModelCatalogVendorAuthType
  authHeader?: string | null
  authQueryParam?: string | null
  providerKind?: ModelCatalogVendorProviderKind
  meta?: unknown
  createdAt: string
  updatedAt: string
}

export type ModelCatalogModelDto = {
  modelKey: string
  vendorKey: string
  modelAlias?: string | null
  labelZh: string
  kind: BillingModelKind
  enabled: boolean
  meta?: unknown
  pricing?: {
    cost: number
    enabled: boolean
    createdAt?: string
    updatedAt?: string
    specCosts: Array<{
      specKey: string
      cost: number
      enabled: boolean
      createdAt?: string
      updatedAt?: string
    }>
  }
  createdAt: string
  updatedAt: string
}

export type HttpOperationDto = {
  method: string
  path: string
  headers?: Record<string, string>
  query?: Record<string, unknown>
  body?: unknown
  response_mapping?: Record<string, unknown>
  provider_meta_mapping?: Record<string, unknown>
}

export type ModelCatalogMappingDto = {
  id: string
  vendorKey: string
  taskKind: ProfileKind
  name: string
  enabled: boolean
  create: HttpOperationDto
  query?: HttpOperationDto
  statusMapping?: Record<string, string[]>
  createdAt: string
  updatedAt: string
}

export type ModelCatalogVendorApiKeyStatusDto = {
  vendorKey: string
  hasApiKey: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type ModelCatalogImportPackageDto = {
  version: string
  exportedAt?: string
  vendors: Array<{
    vendor: {
      key: string
      name: string
      enabled?: boolean
      baseUrlHint?: string | null
      authType?: ModelCatalogVendorAuthType
      authHeader?: string | null
      authQueryParam?: string | null
      meta?: unknown
    }
    apiKey?: {
      apiKey?: string
      enabled?: boolean
    }
    models?: Array<{
      modelKey: string
      vendorKey?: string
      modelAlias?: string | null
      labelZh: string
      kind: BillingModelKind
      enabled?: boolean
      meta?: unknown
      pricing?: ModelCatalogModelDto['pricing']
    }>
    mappings?: Array<{
      id?: string
      vendorKey?: string
      taskKind: ProfileKind
      name: string
      enabled?: boolean
      requestProfile?: unknown
      requestMapping?: unknown
      responseMapping?: unknown
    }>
  }>
}

export type ModelCatalogImportResultDto = {
  imported: {
    vendors: number
    models: number
    mappings: number
  }
  errors: string[]
}

export type ModelCatalogDocsFetchResultDto = {
  url: string
  finalUrl: string
  status: number
  contentType: string
  title: string | null
  text: string
  truncated: boolean
  diagnostics: string[]
}

export type ModelCatalogMappingTestRequestDto = {
  modelKey?: string
  prompt?: string
  stage?: 'create' | 'query' | string
  execute?: boolean
}

export type ModelCatalogMappingTestResultDto = {
  mappingId: string
  vendorKey: string
  taskKind: ProfileKind
  stage: string
  executed: boolean
  ok: boolean
  diagnostics: string[]
  request: unknown
  response?: unknown
}

function requireDesktopRuntime(feature: string): DesktopBridge {
  const desktop = getDesktopBridge()
  if (!desktop) throw new Error(`${feature} requires the Electron desktop runtime`)
  return desktop
}


/**
 * Real IPC-stream consumer. Subscribes to `nomi:agents:chatV2:event` and
 * relays each chunk as the existing `AgentsChatStreamEvent` shape so
 * downstream consumers (workbenchAiClient et al) keep working unchanged.
 *
 * Returns a stop function. Calling it cancels the underlying session and
 * unsubscribes the IPC listener.
 */
async function openDesktopAgentsChatStream(
  payload: AgentsChatRequestDto,
  handlers: {
    onEvent: (event: AgentsChatStreamEvent) => void
    onOpen?: () => void
    onError?: (error: Error) => void
    onSession?: (session: AgentChatV2Session) => void
  },
): Promise<() => void> {
  const desktop = requireDesktopRuntime('agents chat')

  let aborted = false
  let streamedText = ''
  let sessionId: string | null = null
  let unsubscribe: (() => void) | null = null

  handlers.onOpen?.()
  const requestId = `desktop-${Date.now()}`
  const messageId = `message-${Date.now()}`
  handlers.onEvent({ event: 'initial', data: { requestId, messageId } })

  const stop = async (): Promise<void> => {
    if (aborted) return
    aborted = true
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    if (sessionId) {
      try { await desktop.agents.cancelChatV2(sessionId) } catch { /* noop */ }
    }
  }

  try {
    const start = await desktop.agents.chatV2Start(payload)
    sessionId = start.sessionId

    unsubscribe = desktop.agents.onChatV2Event(sessionId, (rawEvent) => {
      if (aborted) return
      const evt = rawEvent as { type: string } & Record<string, unknown>
      switch (evt.type) {
        case 'content-delta': {
          const delta = String(evt.delta || '')
          if (!delta) return
          streamedText += delta
          handlers.onEvent({ event: 'content', data: { delta, text: streamedText } })
          return
        }
        case 'tool-call-pending': {
          handlers.onEvent({
            event: 'tool-call',
            data: {
              sessionId: sessionId!,
              toolCallId: String(evt.toolCallId),
              toolName: String(evt.toolName),
              args: evt.args,
            },
          })
          return
        }
        case 'tool-result': {
          handlers.onEvent({
            event: 'tool-result',
            data: {
              toolCallId: String(evt.toolCallId),
              toolName: String(evt.toolName),
              result: evt.result,
            },
          })
          return
        }
        case 'tool-error': {
          handlers.onEvent({
            event: 'tool-error',
            data: {
              toolCallId: String(evt.toolCallId),
              toolName: String(evt.toolName),
              message: String(evt.message || 'tool failed'),
            },
          })
          return
        }
        case 'step-finish': {
          handlers.onEvent({ event: 'step-finish', data: { finishReason: String(evt.finishReason || 'unknown') } })
          return
        }
        case 'result': {
          const inner = (evt.result as { id?: string; text?: string; usage?: unknown }) || {}
          const response: AgentsChatResponseDto = {
            id: typeof inner.id === 'string' ? inner.id : `agent-${Date.now()}`,
            text: typeof inner.text === 'string' ? inner.text : streamedText,
            raw: evt.result,
            toolCalls: [],
            artifacts: [],
            usage: coerceAgentUsage(inner.usage),
          }
          handlers.onEvent({ event: 'result', data: { response } })
          return
        }
        case 'error': {
          const message = String(evt.message || 'agent error')
          handlers.onError?.(new Error(message))
          handlers.onEvent({ event: 'error', data: { message } })
          return
        }
        case 'done': {
          const reason = (evt.reason === 'error' ? 'error' : 'finished') as 'finished' | 'error'
          handlers.onEvent({ event: 'done', data: { reason } })
          if (unsubscribe) {
            unsubscribe()
            unsubscribe = null
          }
          return
        }
      }
    })

    handlers.onSession?.({
      sessionId,
      confirmTool: async (toolCallId, decision) => {
        if (!sessionId) return
        await desktop.agents.confirmTool(sessionId, toolCallId, decision)
      },
      cancel: stop,
    })
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error))
    handlers.onError?.(err)
    handlers.onEvent({ event: 'error', data: { message: err.message } })
    handlers.onEvent({ event: 'done', data: { reason: 'error' } })
  }

  return () => {
    void stop()
  }
}

export type AgentsChatStreamHandlers = {
  onEvent: (event: AgentsChatStreamEvent) => void
  onOpen?: () => void
  onError?: (error: Error) => void
  onSession?: (session: AgentChatV2Session) => void
}

export async function workbenchAgentsChatStream(
  payload: AgentsChatRequestDto,
  handlers: AgentsChatStreamHandlers,
): Promise<() => void> {
  return openDesktopAgentsChatStream(payload, handlers)
}


/** Wipe the shared backend conversation memory for a sessionKey ("新对话"). */
export async function clearWorkbenchAgentSession(sessionKey: string): Promise<void> {
  await requireDesktopRuntime('clear agent session').agents.clearChatV2Session(sessionKey)
}

export async function listModelCatalogVendors(): Promise<ModelCatalogVendorDto[]> {
  return requireDesktopRuntime('model catalog').modelCatalog.listVendors() as ModelCatalogVendorDto[]
}

export async function listModelCatalogModels(params?: {
  vendorKey?: string
  kind?: BillingModelKind
  enabled?: boolean
}): Promise<ModelCatalogModelDto[]> {
  return requireDesktopRuntime('model catalog').modelCatalog.listModels(params) as ModelCatalogModelDto[]
}

export async function listModelCatalogMappings(params?: {
  vendorKey?: string
  taskKind?: ProfileKind
  enabled?: boolean
}): Promise<ModelCatalogMappingDto[]> {
  return requireDesktopRuntime('model catalog').modelCatalog.listMappings(params) as ModelCatalogMappingDto[]
}

export async function upsertModelCatalogVendor(
  payload: Partial<ModelCatalogVendorDto> & Pick<ModelCatalogVendorDto, 'key' | 'name'>,
): Promise<ModelCatalogVendorDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.upsertVendor(payload) as ModelCatalogVendorDto
}

export async function deleteModelCatalogVendor(key: string): Promise<void> {
  requireDesktopRuntime('model catalog').modelCatalog.deleteVendor(key)
}

export async function upsertModelCatalogVendorApiKey(
  vendorKey: string,
  payload: { apiKey: string; enabled?: boolean },
): Promise<ModelCatalogVendorApiKeyStatusDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.upsertVendorApiKey(vendorKey, payload) as ModelCatalogVendorApiKeyStatusDto
}

export async function clearModelCatalogVendorApiKey(vendorKey: string): Promise<ModelCatalogVendorApiKeyStatusDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.clearVendorApiKey(vendorKey) as ModelCatalogVendorApiKeyStatusDto
}

export async function upsertModelCatalogModel(
  payload: Partial<ModelCatalogModelDto> & Pick<ModelCatalogModelDto, 'modelKey' | 'vendorKey' | 'labelZh' | 'kind'>,
): Promise<ModelCatalogModelDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.upsertModel(payload) as ModelCatalogModelDto
}

export async function deleteModelCatalogModel(vendorKey: string, modelKey: string): Promise<void> {
  requireDesktopRuntime('model catalog').modelCatalog.deleteModel(vendorKey, modelKey)
}

export async function upsertModelCatalogMapping(
  payload: Partial<ModelCatalogMappingDto> & Pick<ModelCatalogMappingDto, 'vendorKey' | 'taskKind' | 'name'>,
): Promise<ModelCatalogMappingDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.upsertMapping(payload) as ModelCatalogMappingDto
}

export async function deleteModelCatalogMapping(id: string): Promise<void> {
  requireDesktopRuntime('model catalog').modelCatalog.deleteMapping(id)
}

export async function exportModelCatalogPackage(params?: { includeApiKeys?: boolean }): Promise<ModelCatalogImportPackageDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.exportPackage(params) as ModelCatalogImportPackageDto
}

export async function importModelCatalogPackage(payload: ModelCatalogImportPackageDto): Promise<ModelCatalogImportResultDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.importPackage(payload) as ModelCatalogImportResultDto
}

export async function fetchModelCatalogDocs(payload: { url: string }): Promise<ModelCatalogDocsFetchResultDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.fetchDocs(payload) as Promise<ModelCatalogDocsFetchResultDto>
}

export async function testModelCatalogMapping(
  id: string,
  payload: ModelCatalogMappingTestRequestDto,
): Promise<ModelCatalogMappingTestResultDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.testMapping(id, payload) as Promise<ModelCatalogMappingTestResultDto>
}
