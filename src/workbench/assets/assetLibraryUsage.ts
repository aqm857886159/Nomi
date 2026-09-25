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

/**
 * 素材格子的选择规则（唯一 owner）：普通点＝换选；⌘/Ctrl 点（以及右上角对勾）＝加进 / 移出；
 * Shift 点＝从锚点连选（叠 ⌘/Ctrl 时并入已选）。
 */
export function nextAssetSelection(
  current: ReadonlySet<string>,
  visibleIds: readonly string[],
  targetId: string,
  anchorId: string | null,
  event: Pick<AssetGridActivationEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>,
): ReadonlySet<string> {
  const additive = event.metaKey || event.ctrlKey
  if (event.shiftKey && anchorId) {
    const anchorIndex = visibleIds.indexOf(anchorId)
    const targetIndex = visibleIds.indexOf(targetId)
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const next = additive ? new Set(current) : new Set<string>()
      for (let index = Math.min(anchorIndex, targetIndex); index <= Math.max(anchorIndex, targetIndex); index += 1) next.add(visibleIds[index])
      return next
    }
  }
  if (additive) {
    const next = new Set(current)
    if (next.has(targetId)) next.delete(targetId)
    else next.add(targetId)
    return next
  }
  if (current.size === 1 && current.has(targetId)) return current
  return new Set([targetId])
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
    ...(asset.thumbUrl && asset.thumbUrl !== asset.renderUrl ? { thumbUrl: asset.thumbUrl } : {}),
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
