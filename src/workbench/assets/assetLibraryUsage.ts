import type { AssetLibraryDragPayload } from './assetLibraryDrag'
import type { AssetRef } from './assetTypes'

export type AssetLibraryUsageContext = 'canvas' | 'timeline'
export type AssetLibrarySourceFilter = 'all' | 'project'
export type AssetLibraryItemAction = 'preview' | 'select' | 'append'
export type AssetGridActivationEvent = {
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  detail: number
}

export const ASSET_LIBRARY_SOURCE_OPTIONS: Array<{
  value: AssetLibrarySourceFilter
  labelKey: string
}> = [
  { value: 'all', labelKey: 'assetLibrary.allAssets' },
  { value: 'project', labelKey: 'assetLibrary.projectAssets' },
]

export function resolveAssetLibraryItemAction(
  usage: AssetLibraryUsageContext,
  source: AssetLibrarySourceFilter,
): AssetLibraryItemAction {
  if (usage === 'timeline') return 'append'
  return source === 'project' ? 'select' : 'preview'
}

export function canManageAssetFolders(usage: AssetLibraryUsageContext): boolean {
  return usage === 'canvas'
}

export function shouldRunAssetItemAction(action: AssetLibraryItemAction, clickCount: number): boolean {
  return action !== 'append' || clickCount <= 1
}

export function isAssetGridActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' '
}

export function sourceOptionsForUsage(_usage: AssetLibraryUsageContext): typeof ASSET_LIBRARY_SOURCE_OPTIONS {
  return ASSET_LIBRARY_SOURCE_OPTIONS
}

/** A canvas result belongs to the active canvas; project files must match the active project. */
export function assetBelongsToProject(asset: Pick<AssetRef, 'origin'>, projectId: string | null): boolean {
  if (asset.origin.source === 'canvas') return true
  return Boolean(projectId && asset.origin.projectId === projectId)
}

export function assetToDragPayload(
  asset: AssetRef,
  dragAnchor?: AssetLibraryDragPayload['dragAnchor'],
): AssetLibraryDragPayload {
  return {
    kind: asset.kind,
    name: asset.name,
    renderUrl: asset.renderUrl,
    origin: asset.origin,
    ...(dragAnchor ? { dragAnchor } : {}),
  }
}

export function assetsForLibraryDrag(
  visibleAssets: readonly AssetRef[],
  selectedIds: ReadonlySet<string>,
  draggedAsset: AssetRef,
): AssetRef[] {
  if (!selectedIds.has(draggedAsset.id)) return [draggedAsset]
  return [
    draggedAsset,
    ...visibleAssets.filter((asset) => asset.id !== draggedAsset.id && selectedIds.has(asset.id)),
  ]
}
