import React from 'react'
import { getDesktopBridge, type DesktopAssetDto } from '../../desktop/bridge'
import { buildWorkspaceFileUrl } from '../explorer/workspaceFileDrag'
import {
  assetAspectRatioFromMetadata,
  assetDimensionsFromMetadata,
  type AssetKind,
  type AssetRef,
} from './assetTypes'

type AllProjectAssetsState = {
  assets: AssetRef[]
  loading: boolean
  /** True when at least one project/page could not be read; visible results are partial. */
  partial: boolean
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

/** Project names are display-only provenance; never fold them into AssetOrigin. */
export function parseProjectNames(records: unknown): Map<string, string> {
  if (!Array.isArray(records)) return new Map()
  const names = new Map<string, string>()
  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    const id = String((record as { id?: unknown }).id || '').trim()
    const name = String((record as { name?: unknown }).name || '').trim()
    if (id && name) names.set(id, name)
  }
  return names
}

export function kindFromDesktopAsset(asset: DesktopAssetDto): AssetKind | null {
  const mediaType = typeof asset.data.mediaType === 'string' ? asset.data.mediaType.toLowerCase() : ''
  if (mediaType === 'image' || mediaType === 'video' || mediaType === 'audio' || mediaType === 'model3d') return mediaType
  const contentType = typeof asset.data.contentType === 'string' ? asset.data.contentType.toLowerCase() : ''
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  if (contentType === 'model/gltf-binary') return 'model3d'
  if (/\.(png|jpe?g|webp|gif|avif)$/i.test(asset.name)) return 'image'
  if (/\.(mp4|webm|mov|m4v)$/i.test(asset.name)) return 'video'
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(asset.name)) return 'audio'
  if (/\.glb$/i.test(asset.name)) return 'model3d'
  return null
}

export function assetRefFromDesktopAsset(asset: DesktopAssetDto, sourceProjectName?: string): AssetRef | null {
  if (asset.name.endsWith('.meta')) return null
  const kind = kindFromDesktopAsset(asset)
  if (!kind) return null
  const projectId = String(asset.projectId || '').trim()
  const relativePath = typeof asset.data.relativePath === 'string' ? asset.data.relativePath.trim() : ''
  if (!projectId || !relativePath) return null
  const url = typeof asset.data.url === 'string' && asset.data.url.trim()
    ? asset.data.url.trim()
    : buildWorkspaceFileUrl(projectId, relativePath)
  const dimensions = assetDimensionsFromMetadata(asset.data, kind)
  const aspectRatio = dimensions
    ? dimensions.width / dimensions.height
    : assetAspectRatioFromMetadata(asset.data, kind)
  // 落盘边界派生的预览（sidecar thumbnailRelativePath）：素材库格子与拖上画布的节点都挂它，不挂 4K 源。
  const thumbnailRelativePath = typeof asset.data.thumbnailRelativePath === 'string' ? asset.data.thumbnailRelativePath.trim() : ''
  const thumbUrl = typeof asset.data.thumbnailUrl === 'string' && asset.data.thumbnailUrl.trim()
    ? asset.data.thumbnailUrl.trim()
    : thumbnailRelativePath ? buildWorkspaceFileUrl(projectId, thumbnailRelativePath) : ''
  return {
    id: `${projectId}:${relativePath}`,
    kind,
    name: asset.name || relativePath.split('/').pop() || kind,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    renderUrl: url,
    ...(thumbUrl ? { thumbUrl } : {}),
    ...(dimensions ? { dimensions } : {}),
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
    ...(sourceProjectName?.trim() ? { sourceProjectName: sourceProjectName.trim() } : {}),
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

/**
 * 「所有项目的素材」这一份清单的唯一 owner：**进程内一份、第一次用到时异步载入、素材变更就作废**。
 *
 * 为什么不再是「每个调用方挂载时自己扫一遍」：扫一遍 = 列出全部项目 + 每个项目分页拉素材 + 排序，
 * 开销跟用户一共有多少项目、多少素材走，和眼前这张画布无关。以前生成框每次挂载（= 每点一下卡）扫一遍、
 * 每张剪辑卡挂载扫一遍，量是对的、地方错了（2026-10-16 卡顿波可疑点 k）。
 *
 * 失效只有一个信号：素材写入层落盘即广播的 `assets.onUpdated`（任何导入路径都经过它），外加
 * 删项目时显式作废。排序在这里做一次（mergeAssetRefs），调用方拿到的就是排好的。
 */
type LibraryState = Readonly<{ assets: AssetRef[]; loading: boolean; partial: boolean; fresh: boolean }>

let libraryState: LibraryState = { assets: [], loading: true, partial: false, fresh: false }
let libraryGeneration = 0
let libraryInflight: Promise<AssetRef[]> | null = null
let stopWatchingAssetWrites: (() => void) | null = null
const libraryListeners = new Set<() => void>()

function publish(next: LibraryState): void {
  libraryState = next
  for (const listener of [...libraryListeners]) listener()
}

function watchAssetWrites(): void {
  if (stopWatchingAssetWrites) return
  const unsubscribe = getDesktopBridge()?.assets?.onUpdated?.(() => invalidateAllProjectAssets())
  if (unsubscribe) stopWatchingAssetWrites = unsubscribe
}

async function scanAllProjectAssets(isCurrent: () => boolean): Promise<{ assets: AssetRef[]; partial: boolean }> {
  const desktop = getDesktopBridge()
  if (!desktop?.projects || !desktop.assets?.list) return { assets: [], partial: false }
  let partial = false
  let projectRecords: unknown
  try {
    projectRecords = desktop.projects.listAsync ? await desktop.projects.listAsync() : desktop.projects.list()
  } catch {
    projectRecords = []
    partial = true
  }
  const projectNames = parseProjectNames(projectRecords)
  const loaded: AssetRef[] = []
  for (const projectId of parseProjectIds(projectRecords)) {
    let cursor: string | null = null
    do {
      try {
        const page = await desktop.assets.list({ projectId, cursor, limit: ASSET_PAGE_LIMIT })
        for (const asset of page.items) {
          const ref = assetRefFromDesktopAsset(asset, projectNames.get(projectId))
          if (ref) loaded.push(ref)
        }
        cursor = page.cursor
      } catch {
        partial = true
        cursor = null
      }
    } while (cursor && isCurrent())
    if (!isCurrent()) break
  }
  return { assets: mergeAssetRefs(loaded), partial }
}

/** 已经在内存里的清单；还没载过（或刚作废）→ null。同步、零 IO。 */
export function peekAllProjectAssets(): AssetRef[] | null {
  return libraryState.fresh ? libraryState.assets : null
}

/** 拿清单：内存里有就直接给；没有就载一次（同一时刻只有一趟在路上）。 */
export function loadAllProjectAssets(): Promise<AssetRef[]> {
  if (libraryState.fresh) return Promise.resolve(libraryState.assets)
  if (libraryInflight) return libraryInflight
  watchAssetWrites()
  const generation = ++libraryGeneration
  const isCurrent = () => generation === libraryGeneration
  if (!libraryState.loading) publish({ ...libraryState, loading: true })
  const inflight = scanAllProjectAssets(isCurrent).then(
    ({ assets, partial }) => {
      if (isCurrent()) publish({ assets, loading: false, partial, fresh: true })
      return assets
    },
    () => {
      if (isCurrent()) publish({ assets: [], loading: false, partial: true, fresh: true })
      return [] as AssetRef[]
    },
  ).finally(() => {
    if (libraryInflight === inflight) libraryInflight = null
  })
  libraryInflight = inflight
  return inflight
}

/** 素材变了：作废这一份。正在看清单的界面（订阅者）会自己重载，没人看就等下次用到再载。 */
export function invalidateAllProjectAssets(): void {
  libraryGeneration += 1
  libraryInflight = null
  publish({ ...libraryState, fresh: false })
}

function subscribeLibrary(listener: () => void): () => void {
  libraryListeners.add(listener)
  return () => { libraryListeners.delete(listener) }
}

const readLibrary = (): LibraryState => libraryState

/** 要**看**清单的界面（素材库面板）：订阅这一份，挂上时没有就载。只想作废的调用方直接用 invalidateAllProjectAssets。 */
export function useAllProjectAssets(): AllProjectAssetsState {
  const state = React.useSyncExternalStore(subscribeLibrary, readLibrary, readLibrary)
  React.useEffect(() => {
    if (!state.fresh) void loadAllProjectAssets()
  }, [state.fresh])
  const refresh = React.useCallback(() => {
    invalidateAllProjectAssets()
    void loadAllProjectAssets()
  }, [])
  return { assets: state.assets, loading: state.loading || !state.fresh, partial: state.partial, refresh }
}

/** 仅供单测：回到「进程刚起、什么都没载」。 */
export function resetAllProjectAssetsForTest(): void {
  libraryGeneration += 1
  libraryInflight = null
  stopWatchingAssetWrites?.()
  stopWatchingAssetWrites = null
  libraryListeners.clear()
  libraryState = { assets: [], loading: true, partial: false, fresh: false }
}
