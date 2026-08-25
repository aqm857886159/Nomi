import type { ProfileKind } from '../../electron/catalog/types'

export type CustomCallDraftIdentity = {
  vendorKey: string
  modelKey: string
  label: string
  kind: 'text' | 'image' | 'video' | 'audio' | 'model3d'
}

export type CustomCallDraftBridge = {
  customCallDraftCreate?: (payload: {
    vendorName: string
    baseUrl: string
    apiKey: string
    authType: 'none' | 'bearer'
    modelKey: string
    kind: CustomCallDraftIdentity['kind']
  }) => { ok: true; identity: CustomCallDraftIdentity } | { ok: false; error: string }
  customCallDraftFinalize?: (payload: { vendorKey: string; modelKey: string; script: string }) =>
    { ok: true; identity: CustomCallDraftIdentity } | { ok: false; error: string }
}

export type CustomCallTranscriptEntry = {
  method: string
  url: string
  status: 'ok' | 'error'
  durationMs: number
  requestPreview?: string
  responsePreview?: string
  errorMessage?: string
}

export type CustomCallTestResult = {
  ok: boolean
  assets: string[]
  text?: string
  errorMessage?: string
  transcript: CustomCallTranscriptEntry[]
  durationMs: number
}

export type CustomCallTestRunSnapshot = {
  id: string
  vendorKey: string
  modelKey: string
  modeId?: string
  taskKind?: ProfileKind
  state: 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled'
  scriptDigest: string
  result?: CustomCallTestResult
  startedAt: string
  updatedAt: string
}

export type CustomCallBridge = CustomCallDraftBridge & {
  customCallConfigGet?: (vendorKey: string) => Promise<Array<{ name: string; hasValue: true }>>
  customCallConfigSave?: (
    vendorKey: string,
    payload: { entries: Array<{ name: string; value?: string; keepFrom?: string }> },
  ) => Array<{ name: string; hasValue: true }>
  customCallContract?: () => {
    variables: Array<{ name: string; type: string }>
    returnContract?: string
    templates: Array<{ id: string; script: string }>
  }
  customCallAiInstruction?: (payload: {
    vendorKey: string
    modelKey: string
    material: string
    currentScript?: string
    lastError?: string
    taskKind?: ProfileKind
    modeId?: string
  }) => string
  customCallTestRun?: (payload: {
    runId: string
    vendorKey: string
    modelKey: string
    script: string
    taskKind?: ProfileKind
    modeId?: string
    prompt?: string
    params?: Record<string, unknown>
  }) => Promise<CustomCallTestRunSnapshot | null>
  customCallTestGet?: (payload: { runId: string }) => Promise<CustomCallTestRunSnapshot | null>
  customCallTestLatest?: (payload: {
    vendorKey: string
    modelKey: string
    modeId?: string
    script: string
  }) => Promise<{ run: CustomCallTestRunSnapshot | null; matchesScript: boolean }>
  customCallTestCancel?: (payload: { runId: string }) => Promise<CustomCallTestRunSnapshot | null>
}
