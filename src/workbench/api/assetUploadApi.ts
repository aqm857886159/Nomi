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

export type UploadWorkbenchAssetMeta = {
  prompt?: string | null
  vendor?: string | null
  modelKey?: string | null
  taskKind?: TaskKind | string | null
  projectId?: string | null
  ownerNodeId?: string | null
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
  const arrayBuffer = await file.arrayBuffer()
  return desktop.assets.importFile({
    projectId: resolveProjectId(meta),
    fileName: name || file.name || 'asset',
    contentType: file.type || 'application/octet-stream',
    bytes: arrayBuffer,
    kind: 'upload',
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
    kind: 'upload',
    fileName: name,
    ownerNodeId: meta?.ownerNodeId || null,
  }) as Promise<WorkbenchAssetDto>
}

export async function recoverImportedWorkbenchLocalAssetFile(_file: File): Promise<WorkbenchAssetDto | null> {
  return null
}
