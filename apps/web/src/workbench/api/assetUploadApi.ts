import { useUploadRuntimeStore } from '../../domain/upload-runtime/store/uploadRuntimeStore'
import { WORKBENCH_API_BASE, withWorkbenchAuth, workbenchApiFetch } from './http'
import type { TaskKind } from './taskApi'

export type ServerAssetDto = {
  id: string
  name: string
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
  userId: string
  projectId?: string | null
}

export type UploadServerAssetMeta = {
  prompt?: string | null
  vendor?: string | null
  modelKey?: string | null
  taskKind?: TaskKind | string | null
  projectId?: string | null
  ownerNodeId?: string | null
}

const inflightAssetUploadRequests = new Map<string, Promise<ServerAssetDto>>()

export function buildWorkbenchAssetUploadRequestKey(
  file: File,
  name?: string,
  meta?: UploadServerAssetMeta,
): string {
  const fileName = typeof file.name === 'string' ? file.name.trim() : ''
  const fileSize = typeof file.size === 'number' && Number.isFinite(file.size) ? String(file.size) : ''
  const lastModified =
    typeof file.lastModified === 'number' && Number.isFinite(file.lastModified)
      ? String(file.lastModified)
      : ''
  const fileType = typeof file.type === 'string' ? file.type.trim().toLowerCase() : ''
  const uploadName = typeof name === 'string' ? name.trim() : ''
  const prompt = typeof meta?.prompt === 'string' ? meta.prompt.trim() : ''
  const vendor = typeof meta?.vendor === 'string' ? meta.vendor.trim() : ''
  const modelKey = typeof meta?.modelKey === 'string' ? meta.modelKey.trim() : ''
  const taskKind = typeof meta?.taskKind === 'string' ? String(meta.taskKind).trim() : ''
  const projectId = typeof meta?.projectId === 'string' ? meta.projectId.trim() : ''
  return [
    fileName,
    fileSize,
    lastModified,
    fileType,
    uploadName,
    prompt,
    vendor,
    modelKey,
    taskKind,
    projectId,
  ].join('|')
}

export async function listWorkbenchServerAssets(input?: {
  limit?: number
  cursor?: string | null
  projectId?: string | null
  kind?: string | null
}): Promise<{ items: ServerAssetDto[]; cursor: string | null }> {
  const params = new URLSearchParams()
  if (input?.limit) params.set('limit', String(input.limit))
  if (input?.cursor) params.set('cursor', input.cursor)
  if (input?.projectId) params.set('projectId', input.projectId)
  if (input?.kind) params.set('kind', input.kind)
  const url = params.toString()
    ? `${WORKBENCH_API_BASE}/assets?${params.toString()}`
    : `${WORKBENCH_API_BASE}/assets`
  const response = await workbenchApiFetch(url, withWorkbenchAuth())
  if (!response.ok) throw new Error(`list assets failed: ${response.status}`)
  return response.json() as Promise<{ items: ServerAssetDto[]; cursor: string | null }>
}

export async function uploadWorkbenchServerAssetFile(
  file: File,
  name?: string,
  meta?: UploadServerAssetMeta,
): Promise<ServerAssetDto> {
  const requestKey = buildWorkbenchAssetUploadRequestKey(file, name, meta)
  const effectiveFileName =
    (typeof name === 'string' && name.trim()) ||
    (typeof file.name === 'string' && file.name.trim()) ||
    '未命名文件'
  const trimmedProjectId = typeof meta?.projectId === 'string' && meta.projectId.trim() ? meta.projectId.trim() : ''
  const ownerNodeId = typeof meta?.ownerNodeId === 'string' && meta.ownerNodeId.trim() ? meta.ownerNodeId.trim() : ''
  const existing = inflightAssetUploadRequests.get(requestKey)
  if (existing) {
    useUploadRuntimeStore.getState().beginPendingUpload({
      id: requestKey,
      fileName: effectiveFileName,
      projectId: trimmedProjectId || null,
      ownerNodeId: ownerNodeId || null,
      startedAt: Date.now(),
    })
    return existing
  }
  useUploadRuntimeStore.getState().beginPendingUpload({
    id: requestKey,
    fileName: effectiveFileName,
    projectId: trimmedProjectId || null,
    ownerNodeId: ownerNodeId || null,
    startedAt: Date.now(),
  })

  const uploadPromise = (async (): Promise<ServerAssetDto> => {
    const trimmedPrompt = typeof meta?.prompt === 'string' && meta.prompt.trim() ? meta.prompt.trim() : ''
    const trimmedVendor = typeof meta?.vendor === 'string' && meta.vendor.trim() ? meta.vendor.trim() : ''
    const trimmedModelKey = typeof meta?.modelKey === 'string' && meta.modelKey.trim() ? meta.modelKey.trim() : ''
    const trimmedTaskKind = typeof meta?.taskKind === 'string' && String(meta.taskKind).trim() ? String(meta.taskKind).trim() : ''

    const hasMeta = Boolean(trimmedPrompt || trimmedVendor || trimmedModelKey || trimmedTaskKind || trimmedProjectId)
    if (hasMeta) {
      const form = new FormData()
      form.set('file', file)
      if (typeof name === 'string' && name.trim()) {
        form.set('name', name.trim())
      }
      if (trimmedPrompt) form.set('prompt', trimmedPrompt)
      if (trimmedVendor) form.set('vendor', trimmedVendor)
      if (trimmedModelKey) form.set('modelKey', trimmedModelKey)
      if (trimmedTaskKind) form.set('taskKind', trimmedTaskKind)
      if (trimmedProjectId) form.set('projectId', trimmedProjectId)

      const response = await workbenchApiFetch(`${WORKBENCH_API_BASE}/assets/upload`, withWorkbenchAuth({
        method: 'POST',
        headers: { 'x-tap-no-retry': '1' },
        body: form,
      }))
      if (!response.ok) throw new Error(`upload asset failed: ${response.status}`)
      return response.json() as Promise<ServerAssetDto>
    }

    const params = new URLSearchParams()
    if (typeof name === 'string' && name.trim()) params.set('name', name.trim())
    if (trimmedProjectId) params.set('projectId', trimmedProjectId)
    const url = params.toString()
      ? `${WORKBENCH_API_BASE}/assets/upload?${params.toString()}`
      : `${WORKBENCH_API_BASE}/assets/upload`
    const contentType = (file.type || '').split(';')[0].trim() || 'application/octet-stream'
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'x-tap-no-retry': '1',
    }
    if (typeof file.name === 'string' && file.name.trim()) {
      const fileName = file.name.trim()
      if (isIso88591HeaderValue(fileName)) headers['X-File-Name'] = fileName
    }
    if (typeof file.size === 'number' && Number.isFinite(file.size)) {
      headers['X-File-Size'] = String(file.size)
    }
    const response = await workbenchApiFetch(url, withWorkbenchAuth({ method: 'POST', headers, body: file }))
    if (!response.ok) throw new Error(`upload asset failed: ${response.status}`)
    return response.json() as Promise<ServerAssetDto>
  })()

  inflightAssetUploadRequests.set(requestKey, uploadPromise)
  try {
    return await uploadPromise
  } finally {
    inflightAssetUploadRequests.delete(requestKey)
    useUploadRuntimeStore.getState().finishPendingUpload(requestKey)
  }
}

function isIso88591HeaderValue(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code > 0xff) return false
  }
  return true
}

function sanitizeServerAssetUploadName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .trim()
    .slice(0, 160)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/]/g, '_')
}

function normalizeMimeType(raw: unknown): string {
  const value = typeof raw === 'string' ? raw : ''
  return (value.split(';')[0] || '').trim().toLowerCase()
}

function readAssetData(asset: ServerAssetDto): Record<string, unknown> {
  return asset.data && typeof asset.data === 'object' ? asset.data as Record<string, unknown> : {}
}

export async function recoverUploadedWorkbenchServerAssetFile(
  file: File,
  options?: { withinMs?: number },
): Promise<ServerAssetDto | null> {
  const withinMsRaw = options?.withinMs
  const withinMs = typeof withinMsRaw === 'number' && Number.isFinite(withinMsRaw)
    ? Math.max(1000, Math.min(10 * 60 * 1000, Math.trunc(withinMsRaw)))
    : 2 * 60 * 1000

  const wantedOriginalName = sanitizeServerAssetUploadName(file.name || '')
  const wantedSize = typeof file.size === 'number' && Number.isFinite(file.size) ? Number(file.size) : null
  const wantedContentType = normalizeMimeType(file.type || '')

  if (!wantedOriginalName && wantedSize == null) return null

  let listed: { items: ServerAssetDto[]; cursor: string | null } | null = null
  try {
    listed = await listWorkbenchServerAssets({ limit: 10 })
  } catch {
    return null
  }

  const now = Date.now()
  const items = Array.isArray(listed?.items) ? listed.items : []
  for (const asset of items) {
    const createdAtMs = Date.parse(asset.createdAt)
    if (Number.isFinite(createdAtMs) && withinMs > 0 && now - createdAtMs > withinMs) continue

    const data = readAssetData(asset)
    const kind = typeof data.kind === 'string' ? data.kind.trim().toLowerCase() : ''
    if (kind && kind !== 'upload') continue

    const originalName = sanitizeServerAssetUploadName(data.originalName || '')
    const size = typeof data.size === 'number' && Number.isFinite(data.size) ? Number(data.size) : null
    const contentType = normalizeMimeType(data.contentType || '')

    if (wantedSize != null) {
      if (size == null) continue
      if (size !== wantedSize) continue
    }
    if (wantedOriginalName) {
      if (!originalName) continue
      if (originalName !== wantedOriginalName) continue
    }
    if (wantedContentType && contentType && contentType !== wantedContentType) continue

    const url = typeof data.url === 'string' ? data.url.trim() : ''
    if (!url) continue
    return asset
  }

  return null
}
