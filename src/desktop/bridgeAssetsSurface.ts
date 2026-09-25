/**
 * 素材面（列表 / 导入 / 落盘 / 文件夹）的桥面形状。
 *
 * 从 src/desktop/bridge.ts 抽出来（R9）。只搬家、不改形状；bridge.ts 用
 * `assets: DesktopAssetsSurface` 组装。
 */
import type { MediaImportRejection, StorageCapacity } from '../../electron/shared/contracts/mediaImportPolicy'
import type { AssetLocalizationEvent } from '../../electron/shared/assets/assetLocalizationEvent'
import type { DesktopAssetDto, DesktopAssetFoldersState } from './bridgeMedia'

export type DesktopAssetsSurface = {
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
  /**
   * 单节点的「字节正在进项目」生命周期，一条通道两种用法：
   * 生成结果本地化只发一次（无 bytes）= 开始；本地导入在拷贝流上连发（带 copiedBytes/totalBytes，
   * 首条带 previewUrl）= 进度。订阅方按 projectId+nodeId 认领。
   */
  onLocalizationStarted?: (cb: (payload: AssetLocalizationEvent) => void) => () => void
  importRemoteUrl: (payload: {
    projectId: string
    projectBinding?: import('../../electron/shared/projectBinding').ProjectBinding
    url: string
    kind?: string
    fileName?: string
    ownerNodeId?: string | null
  }) => Promise<import('../../electron/shared/contracts/assetImportResult').AssetImportResult<DesktopAssetDto>>
  importFile: (payload: {
    projectId: string
    projectBinding?: import('../../electron/shared/projectBinding').ProjectBinding
    fileName: string
    contentType?: string
    bytes: ArrayBuffer
    kind?: string
    /** 导入进度广播的收件人：主进程按它把拷贝字节回报给画布上那张卡。 */
    ownerNodeId?: string | null
  }) => Promise<import('../../electron/shared/contracts/assetImportResult').AssetImportResult<DesktopAssetDto>>
  /** Electron 原生 File 直传 preload；路径只在隔离桥内解析，大文件不复制进 renderer 内存。 */
  importNativeFile?: (file: File, payload: {
    projectId: string
    projectBinding?: import('../../electron/shared/projectBinding').ProjectBinding
    fileName: string
    contentType?: string
    kind?: string
  }) => Promise<import('../../electron/shared/contracts/assetImportResult').AssetImportResult<DesktopAssetDto> | null>
  copyFiles?: (payload: { projectId: string; paths: string[] }) => Promise<{
    created: DesktopAssetDto[]
    /** 被准入闸挡下的文件，带机器可读原因与数字（渲染层据此说人话）。 */
    rejected: Array<{ fileName: string; rejection: MediaImportRejection }>
    failedCount: number
  }>
  /** 项目盘剩余空间快照：导入上限从磁盘派生，不是常量。量不到 → null。 */
  storageCapacity?: (payload: { projectId: string }) => Promise<StorageCapacity | null>
  /** 本机能解哪些视频 codec：启动时探一次送进主进程，决定导入要不要转码。 */
  reportVideoCodecs?: (payload: { codecs: string[] }) => Promise<void>
  copyProjectAsset?: (payload: { sourceProjectId: string; targetProjectId: string; relativePath: string }) => Promise<DesktopAssetDto>
  /** 播放懒自愈：nomi-local 视频解不了（HEVC 存量/供应商 HEVC 产物）→ 转码出新 MP4 资产；不适用 → null。 */
  ensurePlayable?: (payload: { url: string }) => Promise<DesktopAssetDto | null>
  /** 老节点补封面：按 nomi-local URL 取（必要时派生）落盘边界的预览。 */
  ensurePreview?: (payload: { url: string }) => Promise<{ thumbnailUrl?: string } | null>
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
