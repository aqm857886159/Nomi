// 素材文件夹 hook（素材面收敛 2026-07-22 转正）：读写 per-project `.nomi/folders.json`（IPC），
// 乐观更新+写穿。归属键=素材 renderUrl（素材池双源身份）。素材库「项目素材」tab 唯一消费者。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { getDesktopBridge, type DesktopAssetFoldersState } from '../../desktop/bridge'
import { confirmDialog } from '../../design'
import { ASSET_LIBRARY_DRAG_MIME, parseAssetLibraryDragItems } from './assetLibraryDrag'

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

/**
 * 面板的文件夹交互（抽出防 Panel 巨壳,R9）：落夹 / 删夹确认。
 * 归类不另起一种拖拽：格子只发素材库那一份拖拽载荷（画布、时间轴、文件夹都认它），
 * 落在文件夹上＝归类，落在画布上＝复制一张卡（2026-09-25 用户：「拖出也无法复制」）。
 */
export function useAssetFolderInteractions(args: {
  folderApi: UseAssetFoldersResult
  setActiveFolderId: React.Dispatch<React.SetStateAction<string | null>>
}): {
  handleFolderDropAssets: (folderId: string | null, event: React.DragEvent<HTMLElement>) => void
  handleDeleteFolder: (folderId: string) => void
} {
  const { folderApi, setActiveFolderId } = args
  const { t } = useTranslation()

  const handleFolderDropAssets = React.useCallback((folderId: string | null, event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault()
    const renderUrls = parseAssetLibraryDragItems(event.dataTransfer.getData(ASSET_LIBRARY_DRAG_MIME)).map((item) => item.renderUrl)
    if (renderUrls.length > 0) folderApi.assignAssets(renderUrls, folderId)
  }, [folderApi])

  const handleDeleteFolder = React.useCallback((folderId: string): void => {
    const folder = folderApi.state.folders.find((item) => item.id === folderId)
    if (!folder) return
    void confirmDialog({
      title: t('assetLibrary.confirmDeleteFolderTitle', { label: folder.label }),
      message: t('assetLibrary.confirmDeleteFolderMessage'),
      confirmLabel: t('assetLibrary.delete'),
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) return
      folderApi.deleteFolder(folderId)
      setActiveFolderId((current) => (current === folderId ? null : current))
    })
  }, [folderApi, setActiveFolderId, t])

  return { handleFolderDropAssets, handleDeleteFolder }
}
