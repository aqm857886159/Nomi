import type { ExportJobEvent, ExportJobSnapshot, ExportJobVerification } from '../../electron/export/exportJobManager'
import type { WorkspaceFileListResult } from '../../electron/workspace/workspaceFileIndex'
import type { WorkspaceSyncInspection } from '../../electron/shared/workspaceSyncContracts'
import type { ProviderKind } from './providerKind'
import type { DesktopMediaBridge, DesktopVideoDepthBridge } from './bridgeMedia'
import type { DesktopConnectorBridge } from './bridgeConnector'
import type { McpClientProfile, McpInfo, McpInstallResult, McpUninstallResult, McpVerifyResult } from './mcpBridgeTypes'
import type { DesktopSettingsBridge } from './settingsBridge'
import type { DesktopOnboardingBridge } from './onboardingBridgeTypes'
import type { DesktopProductionRunBridge } from './productionRunBridgeTypes'
import type { ComfyCandidateTestPayload, ComfyCandidateTestResult } from './comfyCandidateContracts'
import type { CanvasReadSurfaceBridge } from '../../electron/shared/surfacePortBinding'
import type { LaneBridge } from '../workbench/ai/lane/laneClient'
import type { GenerationResolvePlanEnvelope, GenerationResolvePlanRequest } from '../../electron/shared/videoCapabilities/planResolutionContracts'
export type { AssetLocalizationEvent } from '../../electron/shared/assets/assetLocalizationEvent'
export type { ProviderKind }
export type { DesktopAdapterModeResult, DesktopProviderAdapterRun, DesktopProviderRegistration } from './onboardingBridgeTypes'
export type { ScreenshotHotkeyStatus, DesktopAssetDto, DesktopAssetFolder, DesktopAssetFoldersState } from './bridgeMedia'
export type { DesktopDirectorBridge, DesktopDirectorMobileEvent, DesktopDirectorMobileStatus } from './directorBridgeTypes'
import type { DesktopDirectorBridge } from './directorBridgeTypes'

/** 落盘的对话消息(conversation 域;draft/附件是 session 域不落盘)。 */
export type PersistedAiMessage = {
  id: string
  role: string
  content: string
  /** 分镜方案卡锚在这条消息上(方案随项目持久化,它的「家」也要一起落盘)。 */
  storyboardArtifact?: true
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
  /** 检测到本机跑着 fake-ip 本地代理（TUN 模式下 mode/activeUrl 会显示「直连」，但流量其实走代理）。 */
  localProxyDetected?: boolean
  /** 检测到的合成地址样本（如 `198.18.x.x`）；空串 = 未检测到。 */
  localProxySample?: string
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

// 浏览器一族的类型住在 ./bridgeBrowserTypes（R9：bridge.ts 是组装层）；原样 re-export，既有 import 面不变。
export type {
  DesktopBrowserViewBounds,
  DesktopBrowserAssetOverlayDockMode,
  DesktopBrowserChromeMenuItem,
  DesktopBrowserChromeMenuResult,
  DesktopBrowserAssetOverlayRect,
  DesktopBrowserAssetOverlayCaptureRequest,
  DesktopBrowserAssetOverlayConfig,
  DesktopBrowserAssetOverlayState,
  DesktopBrowserViewState,
  DesktopBrowserResourceCaptureRect,
  DesktopBrowserResourceCaptureEvent,
  DesktopBrowserPromptCaptureEvent,
  DesktopBrowserTextPromptSaveEvent,
  DesktopBrowserPromptReferenceResult,
} from './bridgeBrowserTypes'
import type { DesktopBrowserSurface } from './bridgeBrowserTypes'
import type { DesktopAssetsSurface } from './bridgeAssetsSurface'
import type { DesktopModelCatalogSurface } from './bridgeModelCatalogSurface'

// DesktopBrowserPromptScreenshotSelection **故意**不跟着搬走：它的 `reason` 字面量联合是
// check:vocabularies 在册的 debt site，而 debt 的身份含文件路径——搬家会被读成「新开一处 debt」。
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

export type DesktopBridge = DesktopMediaBridge &
  DesktopVideoDepthBridge & DesktopConnectorBridge & {
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
  telemetry?: {
    track: (payload: unknown) => Promise<{ queued: boolean }>
  }
  /** 渲染层 → 主进程日志的唯一通道。只许 `src/desktop/rendererLog.ts` 调用（见那里的头注释）。 */
  log?: {
    report: (entry: import('../../electron/shared/contracts/rendererLog').RendererLogEntry) => void
  }
  /**
   * 一键反馈。**不受「帮 Nomi 变好」开关管**（用户主动点的那一条）。
   * `preview` 只算清单不发东西；`send` 立刻返回，失败已在主进程入队重试。
   */
  feedback?: {
    preview: (payload: import('../../electron/shared/contracts/feedback').FeedbackReportRequest)
      => Promise<import('../../electron/shared/contracts/feedback').FeedbackReportPreview | null>
    send: (payload: import('../../electron/shared/contracts/feedback').FeedbackReportRequest)
      => Promise<import('../../electron/shared/contracts/feedback').FeedbackSendResult>
  }
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
    syncInspect?: (payload: string | { projectId: string; adopt?: boolean }) => Promise<WorkspaceSyncInspection>
    syncReveal?: (projectId: string) => Promise<{ ok: boolean }>
    syncCopyConflict?: (payload: { projectId: string; source?: 'local' | 'remote' }) => Promise<{ path: string }>
  }
  /** 系统通知（任务中心：跑完且窗口失焦才发）。声音与系统通知偏好由主进程统一判定。 */
  notifications?: {
    show: (payload: { title: string; body?: string; event?: import("../../electron/shared/contracts/attentionSound").AttentionSoundEvent }) => Promise<{ ok: boolean; reason?: string }>
  }
  projects: {
    list: () => unknown[]
    listAsync?: () => Promise<unknown[]>
    create: (record: unknown) => unknown
    read: (projectId: string) => unknown | null
    readAsync?: (projectId: string) => Promise<unknown | null>
    diagnose?: (projectId: string) => Promise<{ projectId: string; rootPath?: string; status: 'ok' | 'not-registered' | 'missing-folder' | 'missing-manifest' | 'corrupt-manifest' | 'id-mismatch'; recoverable: boolean; backupAvailable: boolean }>
    recover?: (projectId: string) => Promise<unknown>
    save: (projectId: string, record: unknown) => Promise<unknown>
    delete: (projectId: string) => { id: string; deleted: boolean }
  }
  assets: DesktopAssetsSurface
  browser?: DesktopBrowserSurface
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
  /** 导演台出片 + 手机虚拟相机。开发页 / 老 preload 没有这座桥 → 对话框明说需要桌面运行时。 */
  director?: DesktopDirectorBridge
  /** Generation strategy resolver GUI 窄 IPC：planning seam 在 main（候选/决策与 agent/MCP 同源），
    渲染层不自构候选。可选（`?`）：旧 preload 没有此口，调用方须兜住 undefined。 */
  generationStrategy?: {
    resolvePlan: (payload: GenerationResolvePlanRequest) => Promise<GenerationResolvePlanEnvelope>
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
    quoteSpend: (inputs: import("../../electron/shared/contracts/spendQuote").SpendQuoteInput[]) => Promise<import("../../electron/shared/contracts/spendQuote").PreparedSpendQuote>
    grantSpend: (payload: { nodeIds: string[]; maxAttemptsPerNode?: number; quoteId?: string }) => Promise<{ grantId: string }>
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
    generationEtaStats?: (projectId: string) => { ok: boolean; stats: unknown[] }
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
  modelCatalog: DesktopModelCatalogSurface
  skill: {
    /** 目录由 pi 的加载器给（async）：列表与导出是 Promise，导入与删除仍是同步回执。 */
    list: () => Promise<unknown[]>
    exportPackage: (dirName: string) => Promise<unknown>
    importPackage: (payload: unknown) => unknown
    deleteByDir: (dirName: string) => unknown
    /** 技能盘变了（导入/删除/Agent 的 author_skill 写完落盘）。可选：老 preload 无此口。 */
    onChanged?: (callback: () => void) => () => void
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
    installMcp: (client?: string) => McpInstallResult
    /** 撤销接入指定客户端：删 nomi 条目。默认 Claude Code。 */
    uninstallMcp: (client?: string) => McpUninstallResult
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
  /** The desktop conversation transport. */
  agentLane?: LaneBridge
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

/**
 * 整窗重载：桌面端走主进程的硬重载（连渲染进程一起换新），浏览器里退回 location.reload。
 * 根错误边界与分包错误边界共用这一份——从前两边各抄一份、各自 cast window 绕过这里的类型（2026-09-24 结构评审）。
 */
export function reloadRendererWindow(): void {
  try {
    const hardReloadWindow = getDesktopBridge()?.app?.hardReloadWindow
    if (hardReloadWindow) {
      hardReloadWindow()
      return
    }
  } catch {
    /* fall back to browser reload */
  }
  window.location.reload()
}
