import type { ExportJobEvent, ExportJobSnapshot, ExportJobVerification } from '../../electron/export/exportJobManager'
import type { WorkspaceFileListResult } from '../../electron/workspace/workspaceFileIndex'
import type { ProviderKind } from './providerKind'
import type { DesktopMediaBridge } from './bridgeMedia'
import type { DesktopConnectorBridge } from './bridgeConnector'
import type { McpClientProfile, McpInfo, McpVerifyResult } from './mcpBridgeTypes'
import type { DesktopSettingsBridge } from './settingsBridge'
import type { DesktopOnboardingBridge } from './onboardingBridgeTypes'
import type { DesktopProductionRunBridge } from './productionRunBridgeTypes'
import type { CustomCallBridge } from './modelCatalogBridgeTypes'
import type { ComfyCandidateTestPayload, ComfyCandidateTestResult, ComfyWorkflowMutationResult } from './comfyCandidateContracts'
import type { CanvasReadSurfaceBridge } from '../../electron/shared/surfacePortBinding'
import type { ProjectAgentBridge } from './projectAgentBridgeTypes'
export type { ProjectAgentBridge, ProjectAgentCommandWire } from './projectAgentBridgeTypes'
export type { ProviderKind }
export type { DesktopAdapterModeResult, DesktopProviderAdapterRun, DesktopProviderRegistration } from './onboardingBridgeTypes'
export type { ScreenshotHotkeyStatus } from './bridgeMedia'

/** 落盘的对话消息(conversation 域;draft/附件是 session 域不落盘)。 */
export type PersistedAiMessage = {
  id: string
  role: string
  content: string
  /** 分镜方案卡锚在这条消息上(方案随项目持久化,它的「家」也要一起落盘)。 */
  storyboardPlan?: true
}

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

/** 代理三态：跟随系统探测 / 只对 Nomi 生效的自定义地址 / 强制直连。 */
export type DesktopProxyMode = 'system' | 'custom' | 'off'

/** 一种媒体类型现在实际走的上传通道（main 侧 describeAssetTransportChannels 的产物）。 */
export type AssetTransportChannelView = {
  kind: 'image' | 'video' | 'audio'
  /** 走哪家；匿名公共托管为 null。 */
  vendorKey: string | null
  /** 真正收文件的主机名；无端点策略为 null。 */
  host: string | null
  visibility: 'provider-private' | 'public-provider' | 'public-anonymous'
  ttlSeconds: number | null
}

/** 用户选了什么 × 实际生效什么。两者不一致时正是用户最需要看见的（如探到 SOCKS 但用不了）。 */
export type DesktopProxyStatus = {
  mode: DesktopProxyMode
  customUrl: string
  /** 实际生效的代理地址；直连时空串。 */
  activeUrl: string
  /** 探到但本版用不了（SOCKS 等）的人话详情；否则空串。 */
  unsupported: string
  source: 'env' | 'system' | 'custom' | ''
}

export type DesktopProxyProbeAttempt = { target: string; ok: boolean; ms: number; error: string }
/** ok = 上传链里**任一** host 可达（那就送得出图）；tried 逐项留痕，用来看「是不是已经断了一半」。 */
export type DesktopProxyProbe = {
  ok: boolean
  ms: number
  target: string
  error: string
  tried: DesktopProxyProbeAttempt[]
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

export type DesktopAssetFolder = {
  id: string
  label: string
  order: number
}

export type DesktopAssetFoldersState = {
  version: 1
  folders: DesktopAssetFolder[]
  /** 素材 renderUrl → folderId。 */
  assignments: Record<string, string>
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

export type { ExportJobEvent, ExportJobSnapshot, ExportJobVerification }

/** 应用信息（功能需求1 查看版本号）。canAutoInstall：未签名 mac 无法就地装，走手动下载兜底（真相源在主进程）。 */
export type DesktopAppInfo = {
  version: string
  platform: string
  arch: string
  canAutoInstall: boolean
  canCheckUpdates: boolean
}

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

export type DesktopBridge = DesktopMediaBridge & DesktopConnectorBridge & {
  platform: string
  i18n?: {
    setLocale: (locale: 'zh-CN' | 'en') => void
    /** OS 原生 locale（如 'en-US' / 'zh-CN'）；仅真 Electron 有，jsdom/测试无 → 首启回落默认语言。老 preload 可能无此口。 */
    getSystemLocale?: () => string
  }
  /** 窗口控制（Windows 自绘标题栏用；mac 原生 chrome 时不调用）。老 preload 可能无此口。 */
  window?: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    confirmClose?: (requestId: string) => void
    cancelClose?: (requestId: string) => void
    onCloseRequest?: (cb: (payload: { requestId: string }) => void) => () => void
    onMaximized: (cb: (maximized: boolean) => void) => () => void
    onCanvasZoomShortcut?: (cb: (direction: -1 | 1) => void) => () => void
  }
  app?: {
    reopenLibraryWindow: () => void
    hardReloadWindow?: () => void
    /** 深链三形状：工程级只有 projectId；节点级带 nodeId；Run 级带 runId(+artifactId)。 */
    onProductionDeepLink?: (cb: (payload: { projectId: string; runId?: string; nodeId?: string; artifactId?: string }) => void) => () => void
  }
  clipboard?: {
    readFilePaths: () => Promise<string[]>
    getPathForFile?: (file: File) => string
  }
  settings?: DesktopSettingsBridge
  productionRuns?: DesktopProductionRunBridge
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
  /** 系统通知（任务中心：跑完且窗口失焦才发）。可选 —— 老 preload / 测试环境没有时调用端降级到自制提示音。 */
  notifications?: {
    show: (payload: { title: string; body?: string; silent?: boolean }) => Promise<{ ok: boolean; reason?: string }>
  }
  projects: {
    list: () => unknown[]
    listAsync?: () => Promise<unknown[]>
    create: (record: unknown) => unknown
    read: (projectId: string) => unknown | null
    readAsync?: (projectId: string) => Promise<unknown | null>
    diagnose?: (projectId: string) => Promise<{ projectId: string; rootPath?: string; status: 'ok' | 'not-registered' | 'missing-folder' | 'missing-manifest' | 'corrupt-manifest' | 'id-mismatch'; recoverable: boolean; backupAvailable: boolean }>
    recover?: (projectId: string) => Promise<unknown>
    save: (projectId: string, record: unknown) => unknown
    saveAsync?: (projectId: string, record: unknown) => Promise<unknown>
    delete: (projectId: string) => { id: string; deleted: boolean }
  }
  assets: {
    list: (payload: {
      projectId: string
      cursor?: string | null
      limit?: number
      kind?: string
    }) => Promise<{ items: DesktopAssetDto[]; cursor: string | null }>
    /** 素材文件夹（素材面收敛 2026-07-22 转正）：per-project 落盘 .nomi/folders.json,归属键=renderUrl。 */
    foldersGet?: (payload: { projectId: string }) => Promise<{ ok: boolean; state: DesktopAssetFoldersState; error?: string }>
    foldersSave?: (payload: { projectId: string; state: DesktopAssetFoldersState }) => Promise<{ ok: boolean; state: DesktopAssetFoldersState; error?: string }>
    /** 写入层落盘广播（nomi:assets:updated）——素材库面板/素材盒徽章的统一回流信号。 */
    onUpdated?: (cb: (payload: { projectId: string }) => void) => () => void
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
    /** Electron 原生 File 直传 preload；路径只在隔离桥内解析，大文件不复制进 renderer 内存。 */
    importNativeFile?: (file: File, payload: {
      projectId: string
      fileName: string
      contentType?: string
      kind?: string
    }) => Promise<DesktopAssetDto | null>
    copyFiles?: (payload: { projectId: string; paths: string[] }) => Promise<{ created: DesktopAssetDto[]; skippedUnsupportedCount: number; failedCount: number }>
    copyProjectAsset?: (payload: { sourceProjectId: string; targetProjectId: string; relativePath: string }) => Promise<DesktopAssetDto>
    /** 播放懒自愈：nomi-local 视频解不了（HEVC 存量/供应商 HEVC 产物）→ 转码出新 MP4 资产；不适用 → null。 */
    ensurePlayable?: (payload: { url: string }) => Promise<DesktopAssetDto | null>
    /**
     * 引导示例项目的预置成图 → 项目资产，回 clientId → nomi-local URL。
     * 必须走主进程：渲染侧只有构建产物 URL（dev 是 dev-server 地址、打包版是带哈希的 file://），
     * 那种易变值一旦被 addNodeResult 写进项目文件，换环境/重新构建就裂图（2026-07-30 根因修复）。
     */
    seedOnboardingDemo?: (payload: { projectId: string }) => Promise<Record<string, string>>
    download: (payload: {
      url: string
      suggestedName?: string
    }) => Promise<{ ok: boolean; canceled?: boolean; path?: string }>
    /** 自动另存（集中设置页开启时，生成完成即调；best-effort）+ 设置读写/选目录。 */
    autoSave?: (payload: { url: string; suggestedName?: string }) => Promise<{ ok: boolean; path?: string }>
    getAutoSavePrefs?: () => Promise<{ enabled: boolean; dir: string }>
    setAutoSavePrefs?: (payload: { enabled: boolean; dir: string }) => Promise<{ enabled: boolean; dir: string }>
    pickSaveDir?: () => Promise<{ dir: string }>
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
    importMedia: (payload: {
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
      }) => void
      updateHost: (payload: { viewId?: number | null; bounds: DesktopBrowserViewBounds }) => void
      close: () => void
      captureRequest: (payload: DesktopBrowserAssetOverlayCaptureRequest) => void
      ready?: () => void
      setInteractive: (payload: { interactive: boolean }) => void
      finishDrag?: () => void
      setState: (payload: {
        dockMode?: DesktopBrowserAssetOverlayDockMode
        popoverRect?: DesktopBrowserAssetOverlayRect | null
        captureEnabled?: boolean
      }) => void
      importToCanvas?: (payload: { assets: unknown[] }) => void
      canvasImportAvailable?: () => Promise<boolean>
      onConfig: (callback: (config: DesktopBrowserAssetOverlayConfig) => void) => () => void
      onState: (callback: (state: DesktopBrowserAssetOverlayState) => void) => () => void
      onImportToCanvas?: (callback: (payload: { assets?: unknown[] }) => void) => () => void
    }
    onPromptCapture?: (callback: (event: DesktopBrowserPromptCaptureEvent) => void) => () => void
    onTextPromptSave?: (callback: (event: DesktopBrowserTextPromptSaveEvent) => void) => () => void
    onResourceCapture?: (callback: (event: DesktopBrowserResourceCaptureEvent) => void) => () => void
    onState: (callback: (event: DesktopBrowserViewState) => void) => () => void
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
    list: () => Promise<ExportJobSnapshot[]>
    writeTempInput: (payload: DesktopExportTempInputWritePayload) => Promise<DesktopExportTempInputWriteResult>
    finishTempInput: (payload: { jobId: string }) => Promise<DesktopMp4ExportResult>
    status: (jobId: string) => Promise<ExportJobSnapshot>
    verify: (jobId: string) => Promise<ExportJobVerification>
    cancel: (jobId: string) => Promise<{ ok: boolean }>
    onEvent: (callback: (event: ExportJobEvent) => void) => () => void
    showInFolder: (payload: { projectId: string; relativePath: string }) => Promise<{ ok: boolean }>
  }
  tasks: {
    cancel?: (taskId: string) => Promise<{ ok: boolean }>
    run: (payload: unknown) => Promise<unknown>
    result: (payload: unknown) => Promise<unknown>
    runComfyCandidateTest?: (payload: ComfyCandidateTestPayload) => Promise<ComfyCandidateTestResult>
    cancelComfyCandidateTest?: (payload: { revisionId: string; modelKey: string; taskKind: string }) => Promise<{ ok: boolean }>
    grantSpend: (payload: { nodeIds: string[]; maxAttemptsPerNode?: number }) => Promise<{ grantId: string }>
    runTextStream: (payload: unknown) => Promise<{ streamId: string }>
    cancelTextStream: (streamId: string) => Promise<unknown>
    onTextEvent: (streamId: string, callback: (event: unknown) => void) => () => void
    /** ComfyUI ws 进度桥（P 轨）。旧 preload 可能没有 → 全部可选。 */
    comfyuiWatch?: (payload: { promptId: string; nodeId: string; projectId?: string; taskKind?: string; modelKey?: string | null; vendorKey?: string }) => Promise<{ ok: boolean }>
    comfyuiUnwatch?: (promptId: string) => Promise<void>
    comfyuiInterrupt?: (promptId: string) => Promise<{ ok: boolean; mode: 'targeted' | 'queue-only' | 'failed' }>
    onComfyuiProgress?: (callback: (event: unknown) => void) => () => void
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
    textBrain: () => Promise<{ ok: boolean; brain: { vendor: string; modelKey: string } | null; status: 'ok' | 'missing' }>
    /** 我的库(用户级·跨项目):手写攒的提示词 CRUD,返回全量供渲染层本地过滤。 */
    userList: () => Promise<{ ok: boolean; prompts: unknown[]; error?: string }>
    userAdd: (input: {
      title?: string
      prompt: string
      promptType: 'image' | 'video'
      tags?: string[]
      referenceImages?: { url: string; title?: string; sourceUrl?: string }[]
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
  onboarding: DesktopOnboardingBridge
  /** 版本号 + 检查更新 + 一键更新（功能需求1/2/3）。check/download/install 用户显式触发，进度/状态走 onEvent。 */
  update?: {
    appInfo: () => Promise<DesktopAppInfo>
    check: () => Promise<{ ok: boolean; reason?: string }>
    download: () => Promise<{ ok: boolean }>
    install: () => Promise<{ ok: boolean }>
    /** 手动更新兜底：开官网并按主进程提供的平台/架构直接下载安装包。 */
    openDownload: () => Promise<{ ok: boolean }>
    onEvent: (callback: (event: DesktopUpdateEvent) => void) => () => void
  }
  /**
   * 应用内代理设置（见 docs/plan/2026-08-01-in-app-proxy-setting.md）。
   * set 会**即时重装 dispatcher**并返回新状态，调用方直接用返回值刷 UI，不必重新 get。
   */
  proxy?: {
    get: () => Promise<{ ok: boolean; status: DesktopProxyStatus }>
    set: (payload: { mode: DesktopProxyMode; customUrl: string }) => Promise<{ ok: boolean; status: DesktopProxyStatus }>
    test: () => Promise<{ ok: boolean; result: DesktopProxyProbe; status: DesktopProxyStatus }>
  }
  /** 本机素材上传通道的现状描述。优先级规则只住 main（electron/catalog/assetTransportDescribe.ts），
   *  渲染层只显示、不重算——否则状态卡会和真实行为漂移。 */
  assetTransport?: {
    describeChannels: () => AssetTransportChannelView[]
  }
  modelCatalog: CustomCallBridge & {
    listVendors: () => unknown[]
    listModels: (params?: unknown) => unknown[]
    listMappings: (params?: unknown) => unknown[]
    health: () => unknown
    upsertVendor: (payload: unknown) => unknown
    deleteVendor: (key: string) => void
    upsertVendorApiKey: (vendorKey: string, payload: unknown) => unknown
    clearVendorApiKey: (vendorKey: string) => unknown
    upsertModel: (payload: unknown) => unknown
    /**
     * 改类型 = 改 kind + 按新 kind 重建调用通道（单事务，见 electron/catalog/modelRetype.ts）。
     * 刻意不复用 upsertModel：只改 kind 不重建通道等于把「类型错」换成「没有通道」，仍然跑不了。
     * 可选（`?`）：旧 preload 没有这个方法，调用方须自己兜住 undefined。
     */
    retypeModel?: (payload: { vendorKey: string; modelKey: string; kind: string }) => unknown
    deleteModel: (vendorKey: string, modelKey: string) => void
    deleteModels: (targets: { vendorKey: string; modelKey: string }[]) => void
    upsertMapping: (payload: unknown) => unknown
    deleteMapping: (id: string) => void
    exportPackage: (params?: unknown) => unknown
    importPackage: (payload: unknown) => unknown
    testMapping: (id: string, payload: unknown) => Promise<unknown>
    fetchDocs: (payload: unknown) => Promise<unknown>
    probeComfyui: (baseUrl?: string) => Promise<
      { ok: true; summary: string; version?: string; protocol?: 'enhanced' | 'compatibility' } | { ok: false; error: string }
    >
    /** 本地文本端口探测（Ollama 11434 / LM Studio 1234 / LocalAI 8080）+ 能力预检（判「支持 Agent / 仅对话 / 探不出」）。旧 preload 可能没有 → 可选。 */
    probeLocalTextEndpoints?: () => Promise<{ hits: Array<{ id: 'ollama' | 'lmstudio' | 'localai'; label: string; baseUrl: string; models: string[] }> }>
    probeLocalTextCapability?: (payload: { baseUrl: string; modelId: string }) => Promise<{ verdict: 'agent' | 'chat-only' | 'unknown'; detail?: string }>
    /** 校验 + 识别 workflow_api.json 可绑定节点（同步）。analysis 结构见 comfyuiWorkflowImport.WorkflowAnalysis。 */
    analyzeComfyWorkflow: (text: string) => { ok: true; analysis: unknown } | { ok: false; error: string }
    /** 缺件对账（异步问本机 /object_info）：缺节点类 + 引用了本机没有的模型文件 + combo 可选值。旧 preload 可能没有 → 可选。 */
    reconcileComfyWorkflow?: (text: string, vendorKey?: string) => Promise<
      | {
          ok: true
          serverReachable: boolean
          unknownNodeTypes: string[]
          missingEnumValues: Array<{ nodeId: string; classType: string; title?: string; inputKey: string; value: string }>
          enumOptions?: Array<{ classType: string; inputKey: string; options: string[] }>
        }
      | { ok: false; error: string }
    >
    /** 设置页批量缺件对账：整台实例共享一次 /object_info，结果按 id 回传。 */
    reconcileComfyWorkflows?: (items: Array<{ id: string; text: string }>, vendorKey?: string) => Promise<
      | {
          ok: true
          results: Array<{
            id: string
            result:
              | {
                  ok: true
                  serverReachable: boolean
                  unknownNodeTypes: string[]
                  missingEnumValues: Array<{ nodeId: string; classType: string; title?: string; inputKey: string; value: string }>
                  enumOptions?: Array<{ classType: string; inputKey: string; options: string[] }>
                }
              | { ok: false; error: string }
          }>
        }
      | { ok: false; error: string }
    >
    /** T1：贴什么格式都吃——界面格式借 ComfyUI 自己的前端转成 API 再分析。旧 preload 可能没有 → 可选。 */
    analyzeComfyWorkflowSmart?: (text: string, vendorKey?: string) => Promise<
      | { ok: true; analysis: unknown; convertedText?: string; sourceWorkflowText?: string }
      | { ok: false; error: string }
    >
    /** T2：读用户自己 ComfyUI 里的官方模板库（几百个）。null = 没连上/这台没有模板包。 */
    listComfyuiTemplates?: (vendorKey?: string) => Promise<Array<{
      name: string; title: string; description: string; group: string; groupType: string
      tags: string[]; tutorialUrl: string; thumbnailUrl: string
    }> | null>
    /** T2：取一个模板并备好导入所需（已转 API 格式 + 缺件对账 + combo 选项）。 */
    getComfyuiTemplateDetail?: (name: string, vendorKey?: string) => Promise<
      | {
          apiText: string
          uiWorkflowText: string
          unknownNodeTypes: string[]
          missingEnumValues: Array<{ nodeId: string; classType: string; title?: string; inputKey: string; value: string }>
          enumOptions: Array<{ classType: string; inputKey: string; options: string[] }>
          serverReachable: boolean
        }
      | { error: string }
    >
    /** ComfyUI 预置模板清单（S5）：静态数据，启用前走 reconcile 缺件闸。旧 preload 可能没有 → 可选。 */
    listComfyuiPresets?: () => Array<{
      key: string; labelZh: string; descZh: string; workflowText: string; binding: unknown
      models: Array<{ file: string; dir: string; url: string }>
    }>
    /** 按绑定落库为用户自有 model+mapping（同步）。enumOptions 可选 = combo 参数烤成真实文件下拉。 */
    importComfyWorkflow: (payload: { text: string; binding: unknown; labelZh: string; enumOptions?: unknown; vendorKey?: string; uiWorkflowText?: string }) =>
      ComfyWorkflowMutationResult
    /** 用同一 modelKey 更新已导入 workflow（同步）。 */
    updateComfyWorkflow?: (payload: { modelKey: string; text: string; binding: unknown; labelZh: string; enumOptions?: unknown; vendorKey?: string; uiWorkflowText?: string }) =>
      ComfyWorkflowMutationResult
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
    /** 「接入 AI 编程助手」卡：读接入状态 + 各客户端配置片段（类型见 mcpBridgeTypes）。 */
    mcpInfo: () => McpInfo
    /** 一键写入指定客户端配置的 nomi 条目（合并 + 备份）。默认 Claude Code。 */
    installMcp: (client?: string) => { ok: boolean; client: string; configPath: string; backupPath: string | null }
    /** 撤销接入指定客户端：删 nomi 条目。默认 Claude Code。 */
    uninstallMcp: (client?: string) => { ok: boolean; client: string }
    listCustomMcpProfiles?: () => Promise<McpClientProfile[]>
    registerCustomMcpProfile?: (profile: unknown) => Promise<McpClientProfile | null>
    removeCustomMcpProfile?: (key: string) => Promise<boolean>
    onMcpProfilesChanged?: (cb: () => void) => () => void
    /** 实连验证：真起一次配置里那条命令握手（老 preload 无此口）。「配置里有这行字」≠「还连得上」。 */
    verifyMcp?: (client?: string) => Promise<McpVerifyResult>
    /** A 模式实时桥：注册处理器，接主进程转发来的外部 MCP 画布读/写/付费确认。返回反注册函数。 */
    onApply?: (handler: (op: string, payload: unknown) => unknown | Promise<unknown>) => () => void
  }
  /** Main-issued read-only project Surface lifecycle; independent from capability.onApply. */
  surface?: CanvasReadSurfaceBridge
  /** The sole renderer transport for the app-process ProjectAgentHost. */
  projectAgent?: ProjectAgentBridge
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
