import React from 'react'
import { getDesktopBridge, type DesktopAssetDto } from '../../desktop/bridge'
import { buildWorkspaceFileUrl } from '../explorer/workspaceFileDrag'
import type { AssetKind, AssetRef } from './assetTypes'

type AllProjectAssetsState = {
  assets: AssetRef[]
  loading: boolean
  refresh: () => void
}

const ASSET_PAGE_LIMIT = 500

function parseProjectIds(records: unknown): string[] {
  if (!Array.isArray(records)) return []
  const ids = new Set<string>()
  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    const id = String((record as { id?: unknown }).id || '').trim()
    if (id) ids.add(id)
  }
  return [...ids]
}

function kindFromDesktopAsset(asset: DesktopAssetDto): AssetKind | null {
  const mediaType = typeof asset.data.mediaType === 'string' ? asset.data.mediaType.toLowerCase() : ''
  if (mediaType === 'image' || mediaType === 'video' || mediaType === 'audio') return mediaType
  const contentType = typeof asset.data.contentType === 'string' ? asset.data.contentType.toLowerCase() : ''
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  if (/\.(png|jpe?g|webp|gif|avif)$/i.test(asset.name)) return 'image'
  if (/\.(mp4|webm|mov|m4v)$/i.test(asset.name)) return 'video'
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(asset.name)) return 'audio'
  return null
}

function assetRefFromDesktopAsset(asset: DesktopAssetDto): AssetRef | null {
  if (asset.name.endsWith('.meta')) return null
  const kind = kindFromDesktopAsset(asset)
  if (!kind) return null
  const projectId = String(asset.projectId || '').trim()
  const relativePath = typeof asset.data.relativePath === 'string' ? asset.data.relativePath.trim() : ''
  if (!projectId || !relativePath) return null
  const url = typeof asset.data.url === 'string' && asset.data.url.trim()
    ? asset.data.url.trim()
    : buildWorkspaceFileUrl(projectId, relativePath)
  return {
    id: `${projectId}:${relativePath}`,
    kind,
    name: asset.name || relativePath.split('/').pop() || kind,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    renderUrl: url,
    ownerNodeId: typeof asset.data.ownerNodeId === 'string' && asset.data.ownerNodeId.trim()
      ? asset.data.ownerNodeId.trim()
      : undefined,
    source: 'project',
    origin: { source: 'project', projectId, relativePath },
  }
}

export function assetTimeValue(asset: AssetRef): number {
  const updated = asset.updatedAt ? Date.parse(asset.updatedAt) : 0
  if (Number.isFinite(updated) && updated > 0) return updated
  const created = asset.createdAt ? Date.parse(asset.createdAt) : 0
  if (Number.isFinite(created) && created > 0) return created
  const idTime = asset.id.match(/\d{12,}/)?.[0]
  return idTime ? Number(idTime) : 0
}

export function mergeAssetRefs(...groups: readonly (readonly AssetRef[])[]): AssetRef[] {
  const byKey = new Map<string, AssetRef>()
  for (const group of groups) {
    for (const asset of group) {
      const key = asset.renderUrl || asset.id
      if (!byKey.has(key)) byKey.set(key, asset)
    }
  }
  return [...byKey.values()].sort((left, right) => {
    const timeResult = assetTimeValue(right) - assetTimeValue(left)
    if (timeResult !== 0) return timeResult
    const nameResult = left.name.localeCompare(right.name, 'zh-CN')
    if (nameResult !== 0) return nameResult
    return left.id.localeCompare(right.id)
  })
}

export function useAllProjectAssets(): AllProjectAssetsState {
  const [assets, setAssets] = React.useState<AssetRef[]>([])
  const [loading, setLoading] = React.useState(false)
  const [version, setVersion] = React.useState(0)
  const refresh = React.useCallback(() => setVersion((value) => value + 1), [])

  React.useEffect(() => {
    let cancelled = false
    const loadAssets = async (): Promise<void> => {
      const desktop = getDesktopBridge()
      if (!desktop?.projects || !desktop.assets?.list) {
        setAssets([])
        setLoading(false)
        return
      }
      setLoading(true)
      const projectRecords = desktop.projects.listAsync ? await desktop.projects.listAsync() : desktop.projects.list()
      const projectIds = parseProjectIds(projectRecords)
      const loaded: AssetRef[] = []
      for (const projectId of projectIds) {
        let cursor: string | null = null
        do {
          try {
            const page = await desktop.assets.list({ projectId, cursor, limit: ASSET_PAGE_LIMIT })
            for (const asset of page.items) {
              const ref = assetRefFromDesktopAsset(asset)
              if (ref) loaded.push(ref)
            }
            cursor = page.cursor
          } catch {
            cursor = null
          }
        } while (cursor && !cancelled)
        if (cancelled) return
      }
      if (!cancelled) {
        setAssets(mergeAssetRefs(loaded))
        setLoading(false)
      }
    }
    void loadAssets().catch(() => {
      if (!cancelled) {
        setAssets([])
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [version])

  return { assets, loading, refresh }
}
