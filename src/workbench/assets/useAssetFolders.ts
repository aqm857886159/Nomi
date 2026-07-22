// 素材文件夹 hook（素材面收敛 2026-07-22 转正）：读写 per-project `.nomi/folders.json`（IPC），
// 乐观更新+写穿。归属键=素材 renderUrl（素材池双源身份）。素材库「项目素材」tab 唯一消费者。
import React from 'react'
import { getDesktopBridge, type DesktopAssetFoldersState } from '../../desktop/bridge'
import { confirmDialog } from '../../design'
import {
  ASSET_FOLDER_ASSIGN_MIME,
  ASSET_LIBRARY_DRAG_MIME,
  parseAssetLibraryDragItems,
  parseFolderAssignDrag,
  serializeFolderAssignDrag,
} from './assetLibraryDrag'

export const EMPTY_FOLDERS_STATE: DesktopAssetFoldersState = { version: 1, folders: [], assignments: {} }

export type UseAssetFoldersResult = {
  state: DesktopAssetFoldersState
  available: boolean
  createFolder: (label: string) => void
  deleteFolder: (folderId: string) => void
  assignAssets: (renderUrls: readonly string[], folderId: string | null) => void
}

/** 当前文件夹作用域过滤（纯函数,供单测）：root=未归属素材;夹内=归属该夹的素材。 */
export function assetsForFolderScope<T extends { renderUrl: string }>(
  assets: readonly T[],
  assignments: Record<string, string>,
  activeFolderId: string | null,
): T[] {
  if (!activeFolderId) return assets.filter((asset) => !assignments[asset.renderUrl])
  return assets.filter((asset) => assignments[asset.renderUrl] === activeFolderId)
}

/** 各夹素材计数（纯函数,供瓦片角标;只数当前可见集合内的）。 */
export function folderCountsForAssets(
  assets: readonly { renderUrl: string }[],
  assignments: Record<string, string>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const asset of assets) {
    const folderId = assignments[asset.renderUrl]
    if (folderId) counts.set(folderId, (counts.get(folderId) ?? 0) + 1)
  }
  return counts
}

function makeFolderId(): string {
  return `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function useAssetFolders(projectId: string | null): UseAssetFoldersResult {
  const bridge = getDesktopBridge()
  const available = Boolean(projectId && bridge?.assets?.foldersGet && bridge?.assets?.foldersSave)
  const [state, setState] = React.useState<DesktopAssetFoldersState>(EMPTY_FOLDERS_STATE)

  React.useEffect(() => {
    let cancelled = false
    setState(EMPTY_FOLDERS_STATE)
    if (!projectId || !bridge?.assets?.foldersGet) return undefined
    void bridge.assets.foldersGet({ projectId })
      .then((result) => {
        if (!cancelled && result?.ok) setState(result.state)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // bridge 是模块级单例引用,依赖 projectId 即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const persist = React.useCallback(
    (updater: (current: DesktopAssetFoldersState) => DesktopAssetFoldersState): void => {
      setState((current) => {
        const next = updater(current)
        if (projectId && bridge?.assets?.foldersSave) {
          void bridge.assets.foldersSave({ projectId, state: next }).catch(() => undefined)
        }
        return next
      })
    },
    [bridge, projectId],
  )

  const createFolder = React.useCallback((label: string): void => {
    const trimmed = label.trim()
    if (!trimmed) return
    persist((current) => ({
      ...current,
      folders: [...current.folders, { id: makeFolderId(), label: trimmed, order: current.folders.length }],
    }))
  }, [persist])

  const deleteFolder = React.useCallback((folderId: string): void => {
    persist((current) => ({
      version: 1,
      folders: current.folders.filter((folder) => folder.id !== folderId),
      // 删夹不删素材:该夹归属清掉,素材回到未分类(never-wipe:文件本体不动)。
      assignments: Object.fromEntries(Object.entries(current.assignments).filter(([, value]) => value !== folderId)),
    }))
  }, [persist])

  const assignAssets = React.useCallback((renderUrls: readonly string[], folderId: string | null): void => {
    if (renderUrls.length === 0) return
    persist((current) => {
      const assignments = { ...current.assignments }
      for (const renderUrl of renderUrls) {
        if (!renderUrl) continue
        if (folderId) assignments[renderUrl] = folderId
        else delete assignments[renderUrl]
      }
      return { ...current, assignments }
    })
  }, [persist])

  return { state, available, createFolder, deleteFolder, assignAssets }
}

type DraggableAssetLike = { id: string; name: string; renderUrl: string }

/** 面板的文件夹交互三件套（抽出防 Panel 巨壳,R9）：归类拖拽起手/落夹/删夹确认。 */
export function useAssetFolderInteractions<T extends DraggableAssetLike>(args: {
  folderApi: UseAssetFoldersResult
  visibleAssetsRef: React.MutableRefObject<readonly T[]>
  selectedIdsRef: React.MutableRefObject<Set<string>>
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  lastSelectedIdRef: React.MutableRefObject<string | null>
  setActiveFolderId: React.Dispatch<React.SetStateAction<string | null>>
  /** = assetsForLibraryDrag（注入避免与 Panel 循环依赖）。 */
  collectSelection: (visible: readonly T[], selected: ReadonlySet<string>, dragged: T) => T[]
}): {
  handleFolderAssignDragStart: (asset: T, event: React.DragEvent<HTMLElement>) => void
  handleFolderDropAssets: (folderId: string | null, event: React.DragEvent<HTMLElement>) => void
  handleDeleteFolder: (folderId: string) => void
} {
  const { folderApi, visibleAssetsRef, selectedIdsRef, setSelectedIds, lastSelectedIdRef, setActiveFolderId, collectSelection } = args

  const handleFolderAssignDragStart = React.useCallback((asset: T, event: React.DragEvent<HTMLElement>): void => {
    const currentSelection = selectedIdsRef.current
    const selectedForDrag = collectSelection(visibleAssetsRef.current, currentSelection, asset)
    if (!currentSelection.has(asset.id)) {
      setSelectedIds(new Set([asset.id]))
      lastSelectedIdRef.current = asset.id
    }
    event.dataTransfer.setData(ASSET_FOLDER_ASSIGN_MIME, serializeFolderAssignDrag(selectedForDrag.map((item) => item.renderUrl)))
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', selectedForDrag.length > 1 ? `${selectedForDrag.length} 个素材` : asset.name)
  }, [collectSelection, lastSelectedIdRef, selectedIdsRef, setSelectedIds, visibleAssetsRef])

  const handleFolderDropAssets = React.useCallback((folderId: string | null, event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault()
    const assignUrls = parseFolderAssignDrag(event.dataTransfer.getData(ASSET_FOLDER_ASSIGN_MIME))
    const libraryUrls = parseAssetLibraryDragItems(event.dataTransfer.getData(ASSET_LIBRARY_DRAG_MIME)).map((item) => item.renderUrl)
    const renderUrls = assignUrls.length > 0 ? assignUrls : libraryUrls
    if (renderUrls.length > 0) folderApi.assignAssets(renderUrls, folderId)
  }, [folderApi])

  const handleDeleteFolder = React.useCallback((folderId: string): void => {
    const folder = folderApi.state.folders.find((item) => item.id === folderId)
    if (!folder) return
    void confirmDialog({
      title: `删除文件夹「${folder.label}」？`,
      message: '夹内素材回到未分类，不会删除任何文件。',
      confirmLabel: '删除',
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) return
      folderApi.deleteFolder(folderId)
      setActiveFolderId((current) => (current === folderId ? null : current))
    })
  }, [folderApi, setActiveFolderId])

  return { handleFolderAssignDragStart, handleFolderDropAssets, handleDeleteFolder }
}
