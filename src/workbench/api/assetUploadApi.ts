import { getDesktopActiveProjectId } from '../../desktop/activeProject'
import { getDesktopBridge, type DesktopBridge } from '../../desktop/bridge'
import type { TaskKind } from './taskApi'

export type WorkbenchAssetDto = {
  id: string
  name: string
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
  userId: string
  projectId?: string | null
}

/** 从落盘资产 DTO 取可持久化 URL（nomi-local://）；无则空串。单一实现，别在各 adapter 各抄一份（P1）。 */
export function hostedAssetUrl(asset: WorkbenchAssetDto | null | undefined): string {
  return typeof asset?.data?.url === 'string' ? asset.data.url.trim() : ''
}

/** 落盘边界派生的画布预览 URL（图片 ≤1024 缩略 / 视频 poster）；没派生出来则空串，调用方回落到源。 */
export function hostedAssetThumbnailUrl(asset: WorkbenchAssetDto | null | undefined): string {
  return typeof asset?.data?.thumbnailUrl === 'string' ? asset.data.thumbnailUrl.trim() : ''
}

/** 落盘边界探测到的源像素尺寸；缺失返回 null。 */
export function hostedAssetDimensions(asset: WorkbenchAssetDto | null | undefined): { width: number; height: number } | null {
  const width = asset?.data?.width
  const height = asset?.data?.height
  return typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0 ? { width, height } : null
}

export type UploadWorkbenchAssetMeta = {
  prompt?: string | null
  vendor?: string | null
  modelKey?: string | null
  taskKind?: TaskKind | string | null
  projectId?: string | null
  ownerNodeId?: string | null
  /** 资产分桶：用户上传='upload'（默认）；生成结果补救本地化='generated'（与主进程 localizeTaskAsset 同桶）。 */
  kind?: 'upload' | 'generated'
}

function requireDesktopRuntime(feature: string): DesktopBridge {
  const desktop = getDesktopBridge()
  if (!desktop) throw new Error(`${feature} requires the Electron desktop runtime`)
  return desktop
}

function resolveProjectId(meta?: UploadWorkbenchAssetMeta): string {
  const projectId = (meta?.projectId || getDesktopActiveProjectId() || '').trim()
  if (!projectId) throw new Error('projectId is required for local asset import')
  return projectId
}

export function buildWorkbenchAssetImportRequestKey(
  file: File,
  name?: string,
  meta?: UploadWorkbenchAssetMeta,
): string {
  const fileName = typeof file.name === 'string' ? file.name.trim() : ''
  const fileSize = typeof file.size === 'number' && Number.isFinite(file.size) ? String(file.size) : ''
  const lastModified =
    typeof file.lastModified === 'number' && Number.isFinite(file.lastModified)
      ? String(file.lastModified)
      : ''
  const fileType = typeof file.type === 'string' ? file.type.trim().toLowerCase() : ''
  const uploadName = typeof name === 'string' ? name.trim() : ''
  const projectId = typeof meta?.projectId === 'string' ? meta.projectId.trim() : ''
  const ownerNodeId = typeof meta?.ownerNodeId === 'string' ? meta.ownerNodeId.trim() : ''
  return [fileName, fileSize, lastModified, fileType, uploadName, projectId, ownerNodeId].join('|')
}

export async function listWorkbenchLocalAssets(): Promise<{ items: WorkbenchAssetDto[]; cursor: string | null }> {
  const projectId = getDesktopActiveProjectId()
  if (!projectId) return { items: [], cursor: null }
  const desktop = requireDesktopRuntime('local asset list')
  return desktop.assets.list({ projectId, limit: 200 }) as Promise<{ items: WorkbenchAssetDto[]; cursor: string | null }>
}

export async function importWorkbenchLocalAssetFile(
  file: File,
  name?: string,
  meta?: UploadWorkbenchAssetMeta,
): Promise<WorkbenchAssetDto> {
  const desktop = requireDesktopRuntime('local asset import')
  const request = {
    projectId: resolveProjectId(meta),
    fileName: name || file.name || 'asset',
    contentType: file.type || 'application/octet-stream',
    kind: 'upload' as const,
    // 导入进度广播的收件人：主进程按它把「已拷贝字节 / 总字节」回报给画布上那张卡。
    ownerNodeId: meta?.ownerNodeId || null,
  }
  if (desktop.assets.importNativeFile) {
    const imported = await desktop.assets.importNativeFile(file, request)
    if (imported) return imported as WorkbenchAssetDto
  }
  const arrayBuffer = await file.arrayBuffer()
  return desktop.assets.importFile({
    ...request,
    bytes: arrayBuffer,
  }) as Promise<WorkbenchAssetDto>
}

export async function importWorkbenchRemoteAssetUrl(
  url: string,
  name?: string,
  meta?: UploadWorkbenchAssetMeta,
): Promise<WorkbenchAssetDto> {
  const desktop = requireDesktopRuntime('remote asset import')
  return desktop.assets.importRemoteUrl({
    projectId: resolveProjectId(meta),
    url,
    kind: meta?.kind || 'upload',
    fileName: name,
    ownerNodeId: meta?.ownerNodeId || null,
  }) as Promise<WorkbenchAssetDto>
}

export async function recoverImportedWorkbenchLocalAssetFile(_file: File): Promise<WorkbenchAssetDto | null> {
  return null
}
