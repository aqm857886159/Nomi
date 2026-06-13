import type { ExportJobEvent, ExportJobSnapshot } from '../../electron/export/exportJobManager'
import type { WorkspaceFileListResult } from '../../electron/workspace/workspaceFileIndex'
import type { ProviderKind } from './providerKind'

export type { ProviderKind }

/** 落盘的对话消息(conversation 域;draft/附件是 session 域不落盘)。 */
export type PersistedAiMessage = { id: string; role: string; content: string }

/** 一条会话线程(v2 会话历史)。messages=该线程气泡;title=一句话摘要(首句兜底)。 */
export type PersistedThread = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: PersistedAiMessage[]
}
/** 一个面板(创作/画布)的会话列表 + 当前活动线程。 */
export type PersistedConversationArea = { activeId: string | null; threads: PersistedThread[] }
/** conversations.json v2:两个面板各一份会话列表。 */
export type PersistedConversationsV2 = {
  v: 2
  creation: PersistedConversationArea
  generation: PersistedConversationArea
  committedProposal?: unknown
}

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
    revealProjectFolder: (payload: { projectId: string }) => Promise<{ ok: boolean }>
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
    download: (payload: {
      url: string
      suggestedName?: string
    }) => Promise<{ ok: boolean; canceled?: boolean; path?: string }>
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
    runTextStream: (payload: unknown) => Promise<{ streamId: string }>
    cancelTextStream: (streamId: string) => Promise<unknown>
    onTextEvent: (streamId: string, callback: (event: unknown) => void) => () => void
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
    /** S1b 诚实探针:LLM 是否还记得这个会话(气泡在而记忆空 → 必须画「新会话」分隔线)。 */
    chatV2SessionAlive?: (sessionKey: string) => Promise<{ alive: boolean }>
    onChatV2Event: (sessionId: string, callback: (event: unknown) => void) => () => void
  }
  /** S5-a/b 画布事件 → 单写者日志仓库(seq/脱敏/截断在主进程单点);read 供 hydrate 尾部重放与轨迹。 */
  events?: {
    append: (projectId: string, events: unknown[]) => Promise<{ ok: boolean; count: number; lastSeq: number }>
    read: (projectId: string, fromSeq: number) => Promise<{ ok: boolean; events: unknown[] }>
  }
  /** S9 项目记忆卡:get=增量提炼+读;update=pin/纠正(text→origin:user);remove=删+墓碑。 */
  memory?: {
    get: (projectId: string) => Promise<{ ok: boolean; facts: unknown[] }>
    update: (projectId: string, factId: string, patch: { text?: string; pinned?: boolean }) => Promise<{ ok: boolean; facts: unknown[] }>
    remove: (projectId: string, factId: string) => Promise<{ ok: boolean; facts: unknown[] }>
  }
  /** S4-2b 技术自检结果广播(主进程异步旁路 → 节点 ⚠ 投影)。 */
  review?: {
    onEvent: (callback: (payload: unknown) => void) => () => void
  }
  /** S1b-3 对话持久化(conversation 域独立文件,不混画布 payload)。committedProposal=S6-5 事务回执(审计 A6),形状由画布层校验。 */
  conversations?: {
    read: (projectId: string) => Promise<{ ok: boolean; conversations: PersistedConversationsV2 | null }>
    write: (projectId: string, payload: { creation: PersistedConversationArea; generation: PersistedConversationArea; committedProposal?: unknown }) => Promise<{ ok: boolean }>
  }
  onboarding: {
    start: (payload: {
      docsUrl: string
      userApiKey: string
      targetKind?: 'text' | 'image' | 'video' | 'audio'
      maxSteps?: number
      agent?: {
        providerKind?: ProviderKind
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
      providerKind?: ProviderKind
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
      /** 专家强制指定的协议。省略 + autoProbe=true 时由主进程探测。 */
      providerKind?: ProviderKind
      /** true = 自动探测 chat↔responses（anthropic 按 hostname 提示）。 */
      autoProbe?: boolean
      headers?: Record<string, string>
    }) => Promise<{
      ok: boolean
      status?: number
      error?: string
      /** 探测/确认成功的协议——渲染层据此显示「用的是 X 协议」并存盘。 */
      detectedKind?: ProviderKind
    }>
    listModels: (payload: {
      baseUrl: string
      apiKey: string
      providerKind?: ProviderKind
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
