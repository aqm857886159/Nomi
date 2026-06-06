import type { ExportJobEvent, ExportJobSnapshot } from '../../electron/export/exportJobManager'
import type { WorkspaceFileListResult } from '../../electron/workspace/workspaceFileIndex'

export type DesktopAssetDto = {
  id: string
  name: string
  userId: string
  projectId?: string | null
  createdAt: string
  updatedAt: string
  data: Record<string, unknown>
}

export type DesktopMp4ExportResult = {
  absolutePath: string
  relativePath: string
  size: number
}

export type DesktopExportJobStartPayload = {
  projectId: string
  manifest: unknown
  outputName?: string
}

export type DesktopExportJobStartResult = {
  jobId: string
}

export type DesktopExportTempInputWritePayload = {
  jobId: string
  chunk: ArrayBuffer | Uint8Array | number[]
}

export type DesktopExportTempInputWriteResult = {
  ok: true
  size: number
}

export type { ExportJobEvent, ExportJobSnapshot }

export type DesktopBridge = {
  platform: string
  workspace: {
    selectFolder: () => Promise<{ canceled: true } | { canceled: false; rootPath: string }>
    openFolder: (payload: { rootPath: string; initialize?: boolean; name?: string }) => Promise<unknown>
    listFiles: (payload: { projectId: string; limit?: number }) => Promise<WorkspaceFileListResult>
    revealFile: (payload: { projectId: string; relativePath: string }) => Promise<{ ok: boolean }>
  }
  projects: {
    list: () => unknown[]
    create: (record: unknown) => unknown
    read: (projectId: string) => unknown | null
    save: (projectId: string, record: unknown) => unknown
    delete: (projectId: string) => { id: string; deleted: boolean }
  }
  assets: {
    list: (payload: {
      projectId: string
      cursor?: string | null
      limit?: number
      kind?: string
    }) => Promise<{ items: DesktopAssetDto[]; cursor: string | null }>
    importRemoteUrl: (payload: {
      projectId: string
      url: string
      kind?: string
      fileName?: string
      ownerNodeId?: string | null
    }) => Promise<DesktopAssetDto>
    importFile: (payload: {
      projectId: string
      fileName: string
      contentType?: string
      bytes: ArrayBuffer
      kind?: string
    }) => Promise<DesktopAssetDto>
  }
  exports: {
    startJob: (payload: DesktopExportJobStartPayload) => Promise<DesktopExportJobStartResult>
    writeTempInput: (payload: DesktopExportTempInputWritePayload) => Promise<DesktopExportTempInputWriteResult>
    finishTempInput: (payload: { jobId: string }) => Promise<DesktopMp4ExportResult>
    status: (jobId: string) => Promise<ExportJobSnapshot>
    cancel: (jobId: string) => Promise<{ ok: boolean }>
    onEvent: (callback: (event: ExportJobEvent) => void) => () => void
    showInFolder: (payload: { projectId: string; relativePath: string }) => Promise<{ ok: boolean }>
  }
  tasks: {
    run: (payload: unknown) => Promise<unknown>
    result: (payload: unknown) => Promise<unknown>
  }
  agents: {
    chatV2Start: (payload: unknown) => Promise<{ sessionId: string }>
    confirmTool: (
      sessionId: string,
      toolCallId: string,
      decision: { ok: true; result?: unknown } | { ok: false; message?: string },
    ) => Promise<{ ok: boolean; error?: string }>
    cancelChatV2: (sessionId: string) => Promise<{ ok: boolean; error?: string }>
    clearChatV2Session: (sessionKey: string) => Promise<{ ok: boolean; error?: string }>
    onChatV2Event: (sessionId: string, callback: (event: unknown) => void) => () => void
  }
  onboarding: {
    start: (payload: {
      docsUrl: string
      userApiKey: string
      targetKind?: 'text' | 'image' | 'video' | 'audio'
      maxSteps?: number
      agent?: {
        providerKind?: 'openai-compatible' | 'anthropic'
        baseUrl?: string
        modelId?: string
        apiKey?: string
      }
    }) => Promise<{ trialId: string }>
    cancel: (trialId: string) => Promise<{ ok: boolean; error?: string }>
    onEvent: (trialId: string, callback: (event: unknown) => void) => () => void
    manualCommit: (payload: {
      vendorName: string
      baseUrl: string
      apiKey: string
      providerKind?: 'openai-compatible' | 'anthropic'
      headers?: Record<string, string>
      models: Array<{ id: string; displayName?: string }>
    }) => Promise<{
      ok: boolean
      vendorKey?: string
      committed?: Array<{ modelKey: string; displayName: string }>
      error?: string
    }>
    testConnection: (payload: {
      baseUrl: string
      apiKey: string
      modelId?: string
      providerKind?: 'openai-compatible' | 'anthropic'
      headers?: Record<string, string>
    }) => Promise<{
      ok: boolean
      status?: number
      error?: string
    }>
    listModels: (payload: {
      baseUrl: string
      apiKey: string
      providerKind?: 'openai-compatible' | 'anthropic'
      headers?: Record<string, string>
    }) => Promise<{
      ok: boolean
      models?: string[]
      status?: number
      error?: string
    }>
  }
  modelCatalog: {
    listVendors: () => unknown[]
    listModels: (params?: unknown) => unknown[]
    listMappings: (params?: unknown) => unknown[]
    health: () => unknown
    upsertVendor: (payload: unknown) => unknown
    deleteVendor: (key: string) => void
    upsertVendorApiKey: (vendorKey: string, payload: unknown) => unknown
    clearVendorApiKey: (vendorKey: string) => unknown
    upsertModel: (payload: unknown) => unknown
    deleteModel: (vendorKey: string, modelKey: string) => void
    upsertMapping: (payload: unknown) => unknown
    deleteMapping: (id: string) => void
    exportPackage: (params?: unknown) => unknown
    importPackage: (payload: unknown) => unknown
    testMapping: (id: string, payload: unknown) => Promise<unknown>
    fetchDocs: (payload: unknown) => Promise<unknown>
  }
}

declare global {
  interface Window {
    nomiDesktop?: DesktopBridge
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  return window.nomiDesktop || null
}

export function isDesktopRuntime(): boolean {
  return Boolean(getDesktopBridge())
}
