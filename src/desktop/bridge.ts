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
  /**
   * 后端选择（导出主权决策点）：
   * - 'filtergraph'：资产可本地解析 → ffmpeg 直读源文件渲染（所见即所得），renderer **不录 WebM**。
   * - 'webm'：资产无法本地解析 → renderer 录 canvas WebM 上传，主进程转码（降级）。
   */
  backend: 'filtergraph' | 'webm'
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

/** 应用信息（功能需求1 查看版本号）。canAutoInstall：未签名 mac 无法就地装，走手动下载兜底（真相源在主进程）。 */
export type DesktopAppInfo = { version: string; platform: string; arch: string; canAutoInstall: boolean }

export type DesktopBrowserViewBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type DesktopBrowserAssetOverlayDockMode = 'left' | 'right' | null

export type DesktopBrowserChromeMenuItem = {
  id?: string
  label?: string
  description?: string
  type?: 'normal' | 'separator'
  enabled?: boolean
}

export type DesktopBrowserChromeMenuResult = {
  id: string | null
}

export type DesktopBrowserAssetOverlayRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type DesktopBrowserAssetOverlayCaptureRequest = {
  requestId: string
  url: string
  mediaType?: 'image' | 'video'
  title?: string
  fileName?: string
  sourceRect?: DesktopBrowserAssetOverlayRect
}

export type DesktopBrowserAssetOverlayConfig = {
  opened: boolean
  viewId: number | null
  bounds: DesktopBrowserViewBounds | null
  captureEnabled?: boolean
  captureRequest?: DesktopBrowserAssetOverlayCaptureRequest | null
  promptRequest?: unknown | null
}

export type DesktopBrowserAssetOverlayState = {
  opened: boolean
  dockMode?: DesktopBrowserAssetOverlayDockMode
  popoverRect?: DesktopBrowserAssetOverlayRect | null
  captureEnabled?: boolean
}

export type DesktopBrowserViewState = {
  viewId: number
  tabId: string
  url: string
  title: string
  favicon?: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

export type DesktopBrowserResourceCaptureRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type DesktopBrowserResourceCaptureEvent =
  | {
      ok: true
      viewId: number
      tabId: string
      url: string
      mediaType: 'image' | 'video'
      title?: string
      fileName?: string
      pageUrl?: string
      pageTitle?: string
      sourceRect?: DesktopBrowserResourceCaptureRect
    }
  | {
      ok: false
      viewId: number
      tabId: string
      reason: 'empty' | 'error'
      message?: string
    }

export type DesktopBrowserPromptCaptureEvent =
  | {
      ok: true
      viewId: number
      tabId: string
      url: string
      title?: string
      fileName?: string
      pageUrl?: string
      pageTitle?: string
      extractionMode?: 'replicate' | 'style'
      sourceRect?: DesktopBrowserResourceCaptureRect
    }
  | {
      ok: false
      viewId: number
      tabId: string
      reason: 'empty' | 'error'
      message?: string
    }

export type DesktopBrowserTextPromptSaveEvent =
  | {
      ok: true
      viewId: number
      tabId: string
      prompt: string
      promptType: string
      pageUrl?: string
      pageTitle?: string
    }
  | {
      ok: false
      viewId: number
      tabId: string
      reason: 'error'
      message?: string
    }

export type DesktopBrowserPromptReferenceResult = {
  dataUrl: string
  referenceUrl: string
  fileName: string
  title?: string
  sourceUrl?: string
  pageUrl?: string
  pageTitle?: string
  asset?: DesktopAssetDto
  sourceRect?: DesktopBrowserResourceCaptureRect
}

export type DesktopBrowserPromptScreenshotSelection =
  | {
      ok: true
      rect: {
        left: number
        top: number
        width: number
        height: number
      }
    }
  | {
      ok: false
      reason?: 'cancelled' | 'error'
      message?: string
    }

/** 主进程更新状态广播（功能需求2/3）。renderer 状态机纯 derive 自此事件。 */
export type DesktopUpdateEvent =
  | { type: 'checking' }
  | { type: 'up-to-date' }
  | { type: 'available'; version: string; notes: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

export type DesktopBridge = {
  platform: string
  /** 窗口控制（Windows 自绘标题栏用；mac 原生 chrome 时不调用）。老 preload 可能无此口。 */
  window?: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    confirmClose?: (requestId: string) => void
    cancelClose?: (requestId: string) => void
    onCloseRequest?: (cb: (payload: { requestId: string }) => void) => () => void
    onMaximized: (cb: (maximized: boolean) => void) => () => void
  }
  app?: {
    reopenLibraryWindow: () => void
    hardReloadWindow?: () => void
  }
  startupProbe?: {
    enabled: boolean
    mark: (label: string, payload?: Record<string, unknown>) => void
  }
  workspace: {
    selectFolder: () => Promise<{ canceled: true } | { canceled: false; rootPath: string }>
    openFolder: (payload: { rootPath: string; initialize?: boolean; name?: string }) => Promise<unknown>
    listFiles: (payload: { projectId: string; limit?: number }) => Promise<WorkspaceFileListResult>
    revealFile: (payload: { projectId: string; relativePath: string }) => Promise<{ ok: boolean }>
    deleteFiles?: (payload: {
      projectId: string
      relativePaths: string[]
    }) => Promise<{ ok: boolean; deletedCount: number; failedCount: number }>
    revealProjectFolder: (payload: { projectId: string }) => Promise<{ ok: boolean }>
  }
  projects: {
    list: () => unknown[]
    listAsync?: () => Promise<unknown[]>
    create: (record: unknown) => unknown
    read: (projectId: string) => unknown | null
    readAsync?: (projectId: string) => Promise<unknown | null>
    save: (projectId: string, record: unknown) => unknown
    saveAsync?: (projectId: string, record: unknown) => Promise<unknown>
    delete: (projectId: string) => { id: string; deleted: boolean }
  }
  browserCapture: {
    open: (payload: { projectId: string }) => Promise<{ ok: boolean }>
    navigate: (payload: { url: string }) => Promise<{ ok: boolean }>
    back: () => Promise<{ ok: boolean }>
    forward: () => Promise<{ ok: boolean }>
    reload: () => Promise<{ ok: boolean }>
    screenshot: () => Promise<{ ok: boolean }>
    openExternal: () => Promise<{ ok: boolean }>
    requestState: () => Promise<{ ok: boolean }>
    e2eCapture: (payload: { url: string; kind?: string }) => Promise<{ ok: boolean; error?: string }>
    onState: (cb: (state: {
      url: string
      title: string
      loading: boolean
      canGoBack: boolean
      canGoForward: boolean
    }) => void) => () => void
    onCaptureDone: (cb: (payload: { ok: boolean; name?: string; error?: string }) => void) => () => void
    onImported: (cb: (payload: { projectId: string; name: string }) => void) => () => void
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
  browser?: {
    createView: (payload: { tabId: string; partition?: string }) => Promise<{ viewId: number }>
    destroyView: (payload: { viewId: number }) => void
    navigate: (payload: { viewId: number; url: string }) => void
    back: (payload: { viewId: number }) => void
    forward: (payload: { viewId: number }) => void
    reload: (payload: { viewId: number }) => void
    resize: (payload: { viewId: number; bounds: DesktopBrowserViewBounds }) => void
    show: (payload: { viewId: number }) => void
    hide: (payload: { viewId: number }) => void
    importImage: (payload: {
      viewId: number
      projectId: string
      url: string
      fileName?: string
      title?: string
    }) => Promise<DesktopAssetDto>
    importMedia?: (payload: {
      viewId: number
      projectId: string
      url: string
      fileName?: string
      title?: string
      mediaType?: 'image' | 'video'
    }) => Promise<DesktopAssetDto>
    capturePromptImage?: (payload: {
      viewId: number
      projectId?: string
      url: string
      fileName?: string
      title?: string
    }) => Promise<DesktopBrowserPromptReferenceResult>
    capturePromptScreenshot?: (payload: {
      viewId: number
      projectId?: string
      fileName?: string
      title?: string
      sourceRect?: {
        left: number
        top: number
        width: number
        height: number
      }
    }) => Promise<DesktopBrowserPromptReferenceResult>
    readPromptExtractionSettings?: (payload: {
      projectId: string
    }) => Promise<{ ok: boolean; settings: unknown | null; error?: string }>
    writePromptExtractionSettings?: (payload: {
      projectId: string
      settings: unknown
    }) => Promise<{ ok: boolean; settings?: unknown; error?: string }>
    selectPromptScreenshot?: (payload: { viewId: number }) => Promise<DesktopBrowserPromptScreenshotSelection>
    setPromptCategories?: (payload: {
      viewId: number
      categories: Array<{ id: string; label: string }>
    }) => void
    setResourceCapture?: (payload: { viewId: number; enabled: boolean }) => void
    captureResource?: (payload: { viewId: number }) => void
    showChromeMenu?: (payload: {
      x: number
      y: number
      width?: number
      items: DesktopBrowserChromeMenuItem[]
    }) => Promise<DesktopBrowserChromeMenuResult>
    assetOverlay?: {
      open: (payload: {
        viewId: number | null
        bounds: DesktopBrowserViewBounds
        captureRequest?: DesktopBrowserAssetOverlayCaptureRequest
        promptRequest?: unknown
      }) => void
      updateHost: (payload: { viewId?: number | null; bounds: DesktopBrowserViewBounds }) => void
      close: () => void
      captureRequest: (payload: DesktopBrowserAssetOverlayCaptureRequest) => void
      promptRequest?: (payload: unknown) => void
      ready?: () => void
      setInteractive: (payload: { interactive: boolean }) => void
      setState: (payload: {
        dockMode?: DesktopBrowserAssetOverlayDockMode
        popoverRect?: DesktopBrowserAssetOverlayRect | null
        captureEnabled?: boolean
      }) => void
      importToCanvas?: (payload: { assets: unknown[] }) => void
      onConfig: (callback: (config: DesktopBrowserAssetOverlayConfig) => void) => () => void
      onState: (callback: (state: DesktopBrowserAssetOverlayState) => void) => () => void
      onImportToCanvas?: (callback: (payload: { assets?: unknown[] }) => void) => () => void
    }
    onPromptCapture?: (callback: (event: DesktopBrowserPromptCaptureEvent) => void) => () => void
    onTextPromptSave?: (callback: (event: DesktopBrowserTextPromptSaveEvent) => void) => () => void
    onResourceCapture?: (callback: (event: DesktopBrowserResourceCaptureEvent) => void) => () => void
    onState: (callback: (event: DesktopBrowserViewState) => void) => () => void
  }
  video: {
    /** 视频抽帧（首/尾帧/指定秒）→ 项目素材 nomi-local:// URL。通用基建，见 electron/video/extractVideoFrame.ts。 */
    extractFrame: (payload: {
      videoUrl: string
      which: 'first' | 'last' | number
      projectId: string
      forceRerun?: boolean
    }) => Promise<{ url: string }>
  }
  image: {
    /** 元素拆解：一张图 → Replicate qwen-image-layered → N 张落地 RGBA 图层 URL（对标 Lovart Edit Elements）。
     *  走付费令牌（grantId）；见 electron/image/decomposeLayers.ts。 */
    decomposeLayers: (payload: {
      nodeId?: string
      imageUrl: string
      numLayers?: number
      grantId?: string
      projectId?: string
    }) => Promise<{ layers: string[] }>
  }
  scene3d: {
    /** N 帧 PNG dataURL（沿相机轨迹采样）→ ffmpeg 拼 H.264 mp4 → 项目素材。
     *  AI 运镜工具的「轨迹→视频文件」桥，见 electron/video/framesToVideo.ts。 */
    framesToVideo: (payload: {
      projectId: string
      ownerNodeId?: string | null
      fileName?: string
      fps: number
      frames: string[]
    }) => Promise<{ url: string; assetId?: string }>
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
    grantSpend: (payload: { nodeIds: string[]; maxAttemptsPerNode?: number }) => Promise<{ grantId: string }>
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
    /** 会话历史:从线程气泡重建模型工作缓存(翻回旧对话接着聊)。 */
    seedChatV2Session?: (
      sessionKey: string,
      messages: Array<{ role: string; content: string }>,
    ) => Promise<{ ok: boolean }>
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
    update: (
      projectId: string,
      factId: string,
      patch: { text?: string; pinned?: boolean },
    ) => Promise<{ ok: boolean; facts: unknown[] }>
    remove: (projectId: string, factId: string) => Promise<{ ok: boolean; facts: unknown[] }>
    add: (projectId: string, text: string, kind?: string) => Promise<{ ok: boolean; facts: unknown[] }>
  }
  /** 提示词库:主进程聚合公开仓库提示词(图/视频)+1h 缓存,renderer 取全量后本地过滤。
   *  textBrain=节点提示词优化用的文本大脑键(不含 apiKey,渲染层据此走现成文本流式)。 */
  promptLibrary?: {
    list: () => Promise<{ ok: boolean; prompts: unknown[]; error?: string }>
    textBrain: () => Promise<{ ok: boolean; brain: { vendor: string; modelKey: string } | null }>
    /** 我的库(用户级·跨项目):手写攒的提示词 CRUD,返回全量供渲染层本地过滤。 */
    userList: () => Promise<{ ok: boolean; prompts: unknown[]; error?: string }>
    userAdd: (input: {
      title?: string
      prompt: string
      promptType: 'image' | 'video'
    }) => Promise<{ ok: boolean; prompts: unknown[]; error?: string }>
    userUpdate: (
      id: string,
      patch: { title?: string; prompt?: string; promptType?: 'image' | 'video' },
    ) => Promise<{ ok: boolean; prompts: unknown[]; error?: string }>
    userDelete: (id: string) => Promise<{ ok: boolean; prompts: unknown[]; error?: string }>
  }
  /** S4-2b 技术自检结果广播(主进程异步旁路 → 节点 ⚠ 投影)。 */
  review?: {
    onEvent: (callback: (payload: unknown) => void) => () => void
  }
  /** S1b-3 对话持久化(conversation 域独立文件,不混画布 payload)。committedProposal=S6-5 事务回执(审计 A6),形状由画布层校验。 */
  conversations?: {
    read: (projectId: string) => Promise<{ ok: boolean; conversations: PersistedConversationsV2 | null }>
    write: (
      projectId: string,
      payload: {
        creation: PersistedConversationArea
        generation: PersistedConversationArea
        committedProposal?: unknown
      },
    ) => Promise<{ ok: boolean }>
  }
  onboarding: {
    manualCommit: (payload: {
      vendorName: string
      baseUrl: string
      apiKey: string
      providerKind?: ProviderKind
      headers?: Record<string, string>
      models: Array<{ id: string; displayName?: string; kind?: 'text' | 'image' | 'video' | 'audio' }>
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
    /** 按 id 关键词猜模型类型（图片/视频/配音/文本），给「类型」下拉预填，用户可改（Issue #8）。 */
    guessKinds: (payload: { ids: string[] }) => Promise<{
      kinds: Record<string, 'text' | 'image' | 'video' | 'audio'>
    }>
  }
  /** 版本号 + 检查更新 + 一键更新（功能需求1/2/3）。check/download/install 用户显式触发，进度/状态走 onEvent。 */
  update?: {
    appInfo: () => Promise<DesktopAppInfo>
    check: () => Promise<{ ok: boolean; reason?: string }>
    download: () => Promise<{ ok: boolean }>
    install: () => Promise<{ ok: boolean }>
    /** 手动更新兜底：开浏览器到 GitHub 最新 release（未签名 mac 无法就地装时用）。 */
    openRelease: () => Promise<{ ok: boolean }>
    onEvent: (callback: (event: DesktopUpdateEvent) => void) => () => void
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
    probeComfyui: (baseUrl?: string) => Promise<
      { ok: true; summary: string; version?: string } | { ok: false; error: string }
    >
  }
  skill: {
    list: () => unknown[]
    exportPackage: (dirName: string) => unknown
    importPackage: (payload: unknown) => unknown
    deleteByDir: (dirName: string) => unknown
  }
  /** 即梦会员（dreamina CLI）：设备码登录/账户检测/安装（可选——老 preload 无此口）。 */
  dreamina?: {
    status: () => Promise<{
      installed: boolean
      loggedIn: boolean
      totalCredit: number | null
      vipLevel: string
      notMaestroVip: boolean
    }>
    loginStart: () => Promise<{ verificationUri: string; userCode: string; deviceCode: string; expiresAt: string }>
    loginPoll: (deviceCode: string) => Promise<{ status: 'success' | 'pending' | 'error'; message: string }>
    logout: () => Promise<{ ok: boolean }>
    install: () => Promise<{ ok: boolean; message: string }>
  }
  /** 能力核：上报当前打开项目，供外部调用的 A/B 守卫（可选——老 preload 无此口）。 */
  capability?: {
    setActiveProject: (projectId: string) => void
    /** 「接入 AI 编程助手」卡：读接入状态 + 各客户端配置片段。 */
    mcpInfo: () => {
      tokenReady: boolean
      rpcRunning: boolean
      server: { command: string; args: string[]; env?: Record<string, string> }
      clients: Record<'claude' | 'codex' | 'cursor', { installed: boolean; configPath: string; snippet: string }>
    }
    /** 一键写入指定客户端配置的 nomi 条目（合并 + 备份）。默认 Claude Code。 */
    installMcp: (client?: string) => { ok: boolean; client: string; configPath: string; backupPath: string | null }
    /** 撤销接入指定客户端：删 nomi 条目。默认 Claude Code。 */
    uninstallMcp: (client?: string) => { ok: boolean; client: string }
    /** A 模式实时桥：注册处理器，接主进程转发来的外部 MCP 画布读/写/付费确认。返回反注册函数。 */
    onApply?: (handler: (op: string, payload: unknown) => unknown | Promise<unknown>) => () => void
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
