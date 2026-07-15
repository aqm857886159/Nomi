import React from 'react'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { BrowserAssetLibraryState } from '../assets/browserAssetLibraryStorage'
import type { NomiBrowserAsset, NomiBrowserAssetSource, NomiBrowserAssetTab } from '../assets/browserAssetData'
import type { AssetContextMenuState, BlankContextMenuState } from './browserAssetPopoverTypes'
import type { FloatingWindowRect } from '../window/useResizableFloatingWindow'
import {
  ASSET_CONTEXT_MENU_ESTIMATED_HEIGHT,
  ASSET_CONTEXT_MENU_MARGIN,
  ASSET_CONTEXT_MENU_WIDTH,
  BLANK_CONTEXT_MENU_ESTIMATED_HEIGHT,
  BLANK_CONTEXT_MENU_WIDTH,
  LEGACY_BROWSER_ASSET_DRAG_MIME,
  NOMI_ASSET_DRAG_MIME,
} from './browserAssetPopoverConstants'
import {
  assetDragPayloadToIds,
  assetTypeFromFile,
  browserAssetFromDesktopAsset,
  browserAssetStorageKey,
  clampNumber,
  contentTypeFromFile,
  upsertBrowserAsset,
} from './browserAssetPopoverUtils'

type UseBrowserAssetActionsOptions = {
  activeFolderId: string | null
  currentFolder: NomiBrowserAsset | null
  libraryState: BrowserAssetLibraryState
  promptLibrarySourceKey: NomiBrowserAssetSource
  assetById: ReadonlyMap<string, NomiBrowserAsset>
  mergedAssets: readonly NomiBrowserAsset[]
  filteredAssets: readonly NomiBrowserAsset[]
  selectedAssets: readonly NomiBrowserAsset[]
  selectedIds: ReadonlySet<string>
  windowRect: FloatingWindowRect
  popoverOpen: boolean
  rootRef: React.RefObject<HTMLDivElement | null>
  previewUrlsRef: React.MutableRefObject<string[]>
  onCreateFolder?: (folder: NomiBrowserAsset) => void
  onAssetSelect?: (asset: NomiBrowserAsset) => void
  updateLibraryState: (updater: (current: BrowserAssetLibraryState) => BrowserAssetLibraryState) => void
  setActiveSource: React.Dispatch<React.SetStateAction<NomiBrowserAssetSource>>
  setActiveTab: React.Dispatch<React.SetStateAction<NomiBrowserAssetTab>>
  setActivePromptCategory: React.Dispatch<React.SetStateAction<string>>
  setActiveFolderId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setLocalAssets: React.Dispatch<React.SetStateAction<NomiBrowserAsset[]>>
  setPersistedAssets: React.Dispatch<React.SetStateAction<NomiBrowserAsset[]>>
  setAssetContextMenu: React.Dispatch<React.SetStateAction<AssetContextMenuState | null>>
  setBlankContextMenu: React.Dispatch<React.SetStateAction<BlankContextMenuState | null>>
  setFiltersOpen: React.Dispatch<React.SetStateAction<boolean>>
  setActionsOpen: React.Dispatch<React.SetStateAction<boolean>>
  setPromptDetailAssetId: React.Dispatch<React.SetStateAction<string | null>>
  setRenamingAssetId: React.Dispatch<React.SetStateAction<string | null>>
}

export function useBrowserAssetActions({
  activeFolderId,
  currentFolder,
  libraryState,
  promptLibrarySourceKey,
  assetById,
  mergedAssets,
  filteredAssets,
  selectedAssets,
  selectedIds,
  windowRect,
  popoverOpen,
  rootRef,
  previewUrlsRef,
  onCreateFolder,
  onAssetSelect,
  updateLibraryState,
  setActiveSource,
  setActiveTab,
  setActivePromptCategory,
  setActiveFolderId,
  setSelectedIds,
  setLocalAssets,
  setPersistedAssets,
  setAssetContextMenu,
  setBlankContextMenu,
  setFiltersOpen,
  setActionsOpen,
  setPromptDetailAssetId,
  setRenamingAssetId,
}: UseBrowserAssetActionsOptions): {
  createFolder: () => void
  beginRenameFolder: (folderId: string) => void
  commitRenameFolder: (folderId: string, title: string) => void
  cancelRenameFolder: () => void
  addLocalFiles: (files: readonly File[]) => void
  handleUploadFiles: (event: React.ChangeEvent<HTMLInputElement>) => void
  selectAsset: (asset: NomiBrowserAsset, event: React.MouseEvent<HTMLDivElement>) => void
  openAssetContextMenu: (asset: NomiBrowserAsset, event: React.MouseEvent<HTMLDivElement>) => void
  openBlankContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void
  openPromptDetail: (asset: NomiBrowserAsset) => void
  openFolder: (folder: NomiBrowserAsset) => void
  openAssetRoot: () => void
  exitCurrentFolder: () => void
  selectAssetSource: (source: NomiBrowserAssetSource) => void
  deleteSelectedAssets: () => void
  handleTileDragStart: (asset: NomiBrowserAsset, event: React.DragEvent<HTMLDivElement>) => void
  handleTileDragOver: (asset: NomiBrowserAsset, event: React.DragEvent<HTMLDivElement>) => void
  handleTileDrop: (asset: NomiBrowserAsset, event: React.DragEvent<HTMLDivElement>) => void
} {
  const folderCountRef = React.useRef(0)

  const createFolder = React.useCallback(() => {
    setBlankContextMenu(null)
    setAssetContextMenu(null)
    folderCountRef.current += 1
    const now = new Date().toISOString()
    const nextFolderIndex = libraryState.folders.length + folderCountRef.current
    const folder: NomiBrowserAsset = {
      id: `local-folder-${Date.now()}-${folderCountRef.current}`,
      type: 'folder',
      source: 'my',
      title: nextFolderIndex === 1 ? '新建文件夹' : `新建文件夹 ${nextFolderIndex}`,
      subtitle: '文件夹',
      count: 0,
      tags: ['文件夹'],
      parentFolderId: activeFolderId,
      createdAt: now,
      updatedAt: now,
    }
    setActiveSource('my')
    setActiveTab('all')
    updateLibraryState((current) => ({ ...current, folders: [folder, ...current.folders] }))
    setSelectedIds(new Set([folder.id]))
    // 新建即进入重命名态（同 OS 文件管理器）：省一次「右键 → 重命名」。
    setRenamingAssetId(folder.id)
    onCreateFolder?.(folder)
  }, [activeFolderId, libraryState.folders.length, onCreateFolder, setActiveSource, setActiveTab, setAssetContextMenu, setBlankContextMenu, setRenamingAssetId, setSelectedIds, updateLibraryState])

  // 文件夹重命名：进入态（tile 标题原位变输入框）→ 提交写 libraryState（localStorage + 跨实例同步事件）。
  const beginRenameFolder = React.useCallback((folderId: string): void => {
    setAssetContextMenu(null)
    setBlankContextMenu(null)
    setSelectedIds(new Set([folderId]))
    setRenamingAssetId(folderId)
  }, [setAssetContextMenu, setBlankContextMenu, setRenamingAssetId, setSelectedIds])

  const commitRenameFolder = React.useCallback((folderId: string, title: string): void => {
    setRenamingAssetId(null)
    const nextTitle = title.trim()
    if (!nextTitle) return
    updateLibraryState((current) => {
      const target = current.folders.find((folder) => folder.id === folderId)
      if (!target || target.title === nextTitle) return current
      const updatedAt = new Date().toISOString()
      return {
        ...current,
        folders: current.folders.map((folder) => (folder.id === folderId ? { ...folder, title: nextTitle, updatedAt } : folder)),
      }
    })
  }, [setRenamingAssetId, updateLibraryState])

  const cancelRenameFolder = React.useCallback((): void => {
    setRenamingAssetId(null)
  }, [setRenamingAssetId])

  const addLocalFiles = React.useCallback((files: readonly File[]): void => {
    const fileList = [...files]
    if (fileList.length === 0) return
    const projectId = getDesktopActiveProjectId()
    const desktopAssets = getDesktopBridge()?.assets
    const persistImport = projectId && desktopAssets?.importFile ? { projectId, importFile: desktopAssets.importFile } : null
    const batchTime = Date.now()
    const uploaded = fileList.map((file, index): NomiBrowserAsset => {
      const type = assetTypeFromFile(file)
      const now = new Date(batchTime + index).toISOString()
      let previewUrl: string | undefined
      if (type === 'image') {
        previewUrl = URL.createObjectURL(file)
        previewUrlsRef.current.push(previewUrl)
      }
      return {
        id: `local-upload-${batchTime}-${index}`,
        type,
        source: 'my',
        title: file.name || '未命名素材',
        subtitle: persistImport ? '保存中...' : type === 'prompt' ? '本地文本' : '本地导入',
        previewUrl,
        tags: ['本地导入'],
        parentFolderId: activeFolderId,
        status: persistImport ? 'loading' : undefined,
        createdAt: now,
        updatedAt: now,
      }
    })
    setActiveSource('my')
    setActiveTab('all')
    setLocalAssets((current) => [...uploaded, ...current])
    setSelectedIds(new Set(uploaded.map((asset) => asset.id)))
    if (!persistImport) return
    uploaded.forEach((pendingAsset, index) => {
      const file = fileList[index]
      if (!file) return
      void (async () => {
        try {
          const persisted = await persistImport.importFile({
            projectId: persistImport.projectId,
            fileName: file.name || pendingAsset.title || 'asset',
            contentType: contentTypeFromFile(file),
            bytes: await file.arrayBuffer(),
            kind: 'browser-upload',
          })
          const mapped = browserAssetFromDesktopAsset(persisted)
          const readyAsset: NomiBrowserAsset = {
            ...(mapped ?? pendingAsset),
            parentFolderId: activeFolderId,
            status: 'ready',
            subtitle: mapped?.subtitle ?? (pendingAsset.type === 'prompt' ? '本地文本' : '本地导入'),
          }
          setLocalAssets((current) => current.map((asset) => (asset.id === pendingAsset.id ? readyAsset : asset)))
          setPersistedAssets((current) => upsertBrowserAsset(current, readyAsset))
          updateLibraryState((current) => ({
            ...current,
            folderAssignments: { ...current.folderAssignments, [browserAssetStorageKey(readyAsset)]: activeFolderId },
          }))
          setSelectedIds((current) => {
            if (!current.has(pendingAsset.id)) return current
            const next = new Set(current)
            next.delete(pendingAsset.id)
            next.add(readyAsset.id)
            return next
          })
        } catch {
          setLocalAssets((current) => current.map((asset) => asset.id === pendingAsset.id ? { ...asset, subtitle: '保存失败', status: 'error' } : asset))
        }
      })()
    })
  }, [activeFolderId, previewUrlsRef, setActiveSource, setActiveTab, setLocalAssets, setPersistedAssets, setSelectedIds, updateLibraryState])

  const handleUploadFiles = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    addLocalFiles(files)
  }, [addLocalFiles])

  const selectAsset = React.useCallback((asset: NomiBrowserAsset, event: React.MouseEvent<HTMLDivElement>) => {
    setAssetContextMenu(null)
    setBlankContextMenu(null)
    setSelectedIds((current) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        const next = new Set(current)
        if (next.has(asset.id)) next.delete(asset.id)
        else next.add(asset.id)
        return next
      }
      return new Set([asset.id])
    })
    onAssetSelect?.(asset)
  }, [onAssetSelect, setAssetContextMenu, setBlankContextMenu, setSelectedIds])

  const openAssetContextMenu = React.useCallback((asset: NomiBrowserAsset, event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    setFiltersOpen(false)
    setActionsOpen(false)
    setBlankContextMenu(null)
    setSelectedIds((current) => (current.has(asset.id) ? current : new Set([asset.id])))
    onAssetSelect?.(asset)
    setAssetContextMenu({
      assetId: asset.id,
      x: clampNumber(event.clientX - windowRect.left, ASSET_CONTEXT_MENU_MARGIN, Math.max(ASSET_CONTEXT_MENU_MARGIN, windowRect.width - ASSET_CONTEXT_MENU_WIDTH - ASSET_CONTEXT_MENU_MARGIN)),
      y: clampNumber(event.clientY - windowRect.top, ASSET_CONTEXT_MENU_MARGIN, Math.max(ASSET_CONTEXT_MENU_MARGIN, windowRect.height - ASSET_CONTEXT_MENU_ESTIMATED_HEIGHT - ASSET_CONTEXT_MENU_MARGIN)),
    })
  }, [onAssetSelect, setActionsOpen, setAssetContextMenu, setBlankContextMenu, setFiltersOpen, setSelectedIds, windowRect.height, windowRect.left, windowRect.top, windowRect.width])

  const openBlankContextMenu = React.useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement | null
    if (target?.closest('[data-browser-asset-tile="true"],button,input,textarea,select,[contenteditable="true"]')) return
    event.preventDefault()
    event.stopPropagation()
    setFiltersOpen(false)
    setActionsOpen(false)
    setAssetContextMenu(null)
    setSelectedIds(new Set())
    setBlankContextMenu({
      x: clampNumber(event.clientX - windowRect.left, ASSET_CONTEXT_MENU_MARGIN, Math.max(ASSET_CONTEXT_MENU_MARGIN, windowRect.width - BLANK_CONTEXT_MENU_WIDTH - ASSET_CONTEXT_MENU_MARGIN)),
      y: clampNumber(event.clientY - windowRect.top, ASSET_CONTEXT_MENU_MARGIN, Math.max(ASSET_CONTEXT_MENU_MARGIN, windowRect.height - BLANK_CONTEXT_MENU_ESTIMATED_HEIGHT - ASSET_CONTEXT_MENU_MARGIN)),
    })
  }, [setActionsOpen, setAssetContextMenu, setBlankContextMenu, setFiltersOpen, setSelectedIds, windowRect.height, windowRect.left, windowRect.top, windowRect.width])

  const openPromptDetail = React.useCallback((asset: NomiBrowserAsset): void => {
    if (asset.promptCard) setPromptDetailAssetId(asset.id)
  }, [setPromptDetailAssetId])

  const openFolder = React.useCallback((folder: NomiBrowserAsset): void => {
    if (folder.type !== 'folder') return
    setActiveFolderId(folder.id)
    setActiveTab('all')
    setSelectedIds(new Set())
    setAssetContextMenu(null)
    setBlankContextMenu(null)
  }, [setActiveFolderId, setActiveTab, setAssetContextMenu, setBlankContextMenu, setSelectedIds])

  const openAssetRoot = React.useCallback((): void => {
    setActiveFolderId(null)
    setActiveTab('all')
    setSelectedIds(new Set())
    setAssetContextMenu(null)
    setBlankContextMenu(null)
  }, [setActiveFolderId, setActiveTab, setAssetContextMenu, setBlankContextMenu, setSelectedIds])

  const exitCurrentFolder = React.useCallback((): void => {
    setActiveFolderId(currentFolder?.parentFolderId ?? null)
    setActiveTab('all')
    setActivePromptCategory('all')
    setSelectedIds(new Set())
    setAssetContextMenu(null)
    setBlankContextMenu(null)
  }, [currentFolder?.parentFolderId, setActiveFolderId, setActivePromptCategory, setActiveTab, setAssetContextMenu, setBlankContextMenu, setSelectedIds])

  const selectAssetSource = React.useCallback((source: NomiBrowserAssetSource): void => {
    setActiveSource(source)
    setActiveTab(source === promptLibrarySourceKey ? 'prompt' : 'all')
    setActivePromptCategory('all')
    setActiveFolderId(null)
    setSelectedIds(new Set())
    setAssetContextMenu(null)
    setBlankContextMenu(null)
  }, [promptLibrarySourceKey, setActiveFolderId, setActivePromptCategory, setActiveSource, setActiveTab, setAssetContextMenu, setBlankContextMenu, setSelectedIds])

  const deleteSelectedAssets = React.useCallback((): void => {
    if (selectedIds.size === 0) return
    setAssetContextMenu(null)
    setBlankContextMenu(null)
    const selectedIdSet = new Set(selectedIds)
    const folderIdsToDelete = new Set<string>()
    const collectFolder = (folderId: string): void => {
      if (folderIdsToDelete.has(folderId)) return
      folderIdsToDelete.add(folderId)
      for (const asset of mergedAssets) if (asset.type === 'folder' && (asset.parentFolderId ?? null) === folderId) collectFolder(asset.id)
    }
    for (const id of selectedIdSet) {
      const asset = assetById.get(id)
      if (asset?.type === 'folder') collectFolder(asset.id)
    }
    const deletedKeys = new Set<string>()
    for (const asset of mergedAssets) {
      if (selectedIdSet.has(asset.id) && asset.type !== 'folder') deletedKeys.add(browserAssetStorageKey(asset))
      if (asset.parentFolderId && folderIdsToDelete.has(asset.parentFolderId) && asset.type !== 'folder') deletedKeys.add(browserAssetStorageKey(asset))
    }
    updateLibraryState((current) => {
      const nextDeletedKeys = new Set(current.deletedAssetKeys)
      deletedKeys.forEach((key) => nextDeletedKeys.add(key))
      const nextAssignments = { ...current.folderAssignments }
      deletedKeys.forEach((key) => delete nextAssignments[key])
      return {
        folders: current.folders.filter((folder) => !folderIdsToDelete.has(folder.id) && !selectedIdSet.has(folder.id)),
        promptCards: current.promptCards.filter((asset) => !selectedIdSet.has(asset.id) && !deletedKeys.has(browserAssetStorageKey(asset))),
        promptCategories: current.promptCategories,
        folderAssignments: nextAssignments,
        deletedAssetKeys: [...nextDeletedKeys],
      }
    })
    setLocalAssets((current) => current.filter((asset) => !selectedIdSet.has(asset.id) && !deletedKeys.has(browserAssetStorageKey(asset))))
    setPersistedAssets((current) => current.filter((asset) => !selectedIdSet.has(asset.id) && !deletedKeys.has(browserAssetStorageKey(asset))))
    if (activeFolderId && folderIdsToDelete.has(activeFolderId)) setActiveFolderId(null)
    setSelectedIds(new Set())
  }, [activeFolderId, assetById, mergedAssets, selectedIds, setActiveFolderId, setAssetContextMenu, setBlankContextMenu, setLocalAssets, setPersistedAssets, setSelectedIds, updateLibraryState])

  const moveAssetsToFolder = React.useCallback((assetIds: readonly string[], targetFolderId: string): void => {
    const targetFolder = assetById.get(targetFolderId)
    if (targetFolder?.type !== 'folder') return
    const movingIds = new Set(assetIds.filter((id) => id !== targetFolderId))
    if (movingIds.size === 0) return
    const isFolderDescendant = (folderId: string, possibleAncestorId: string): boolean => {
      let current = assetById.get(folderId)?.parentFolderId ?? null
      while (current) {
        if (current === possibleAncestorId) return true
        current = assetById.get(current)?.parentFolderId ?? null
      }
      return false
    }
    updateLibraryState((current) => {
      const nextAssignments = { ...current.folderAssignments }
      const nextFolders = current.folders.map((folder) => {
        if (!movingIds.has(folder.id)) return folder
        if (folder.id === targetFolderId || isFolderDescendant(targetFolderId, folder.id)) return folder
        return { ...folder, parentFolderId: targetFolderId }
      })
      for (const id of movingIds) {
        const asset = assetById.get(id)
        if (!asset || asset.type === 'folder') continue
        nextAssignments[browserAssetStorageKey(asset)] = targetFolderId
      }
      return { ...current, folders: nextFolders, folderAssignments: nextAssignments }
    })
    setSelectedIds(new Set([...movingIds]))
  }, [assetById, setSelectedIds, updateLibraryState])

  const selectAllVisibleAssets = React.useCallback((): void => {
    if (filteredAssets.length > 0) setSelectedIds(new Set(filteredAssets.map((asset) => asset.id)))
  }, [filteredAssets, setSelectedIds])

  React.useEffect(() => {
    if (!popoverOpen) return undefined
    const handleDeleteKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return
      if (selectedIds.size === 0) return
      event.preventDefault()
      event.stopPropagation()
      deleteSelectedAssets()
    }
    window.addEventListener('keydown', handleDeleteKey, { capture: true })
    return () => window.removeEventListener('keydown', handleDeleteKey, { capture: true })
  }, [deleteSelectedAssets, popoverOpen, selectedIds.size])

  React.useEffect(() => {
    if (!popoverOpen) return undefined
    const handleSelectAllKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'a' || (!event.ctrlKey && !event.metaKey) || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return
      const insidePopover = target ? rootRef.current?.contains(target) : false
      if (!insidePopover && document.activeElement !== document.body) return
      if (filteredAssets.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      selectAllVisibleAssets()
    }
    window.addEventListener('keydown', handleSelectAllKey, { capture: true })
    return () => window.removeEventListener('keydown', handleSelectAllKey, { capture: true })
  }, [filteredAssets.length, popoverOpen, rootRef, selectAllVisibleAssets])

  const handleTileDragStart = React.useCallback((asset: NomiBrowserAsset, event: React.DragEvent<HTMLDivElement>) => {
    const dragSelection = selectedIds.has(asset.id) ? selectedAssets : [asset]
    const serializedSelection = JSON.stringify(dragSelection)
    event.dataTransfer.setData(NOMI_ASSET_DRAG_MIME, serializedSelection)
    event.dataTransfer.setData(LEGACY_BROWSER_ASSET_DRAG_MIME, serializedSelection)
    event.dataTransfer.setData('text/plain', dragSelection.map((item) => item.title).join('\n'))
    event.dataTransfer.effectAllowed = 'copyMove'
  }, [selectedAssets, selectedIds])

  const handleTileDragOver = React.useCallback((asset: NomiBrowserAsset, event: React.DragEvent<HTMLDivElement>) => {
    if (asset.type !== 'folder') return
    const types = Array.from(event.dataTransfer.types)
    if (!types.includes(NOMI_ASSET_DRAG_MIME) && !types.includes(LEGACY_BROWSER_ASSET_DRAG_MIME)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const handleTileDrop = React.useCallback((asset: NomiBrowserAsset, event: React.DragEvent<HTMLDivElement>) => {
    if (asset.type !== 'folder') return
    const draggedIds = assetDragPayloadToIds(event.dataTransfer)
    if (draggedIds.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    moveAssetsToFolder(draggedIds, asset.id)
  }, [moveAssetsToFolder])

  return {
    createFolder,
    beginRenameFolder,
    commitRenameFolder,
    cancelRenameFolder,
    addLocalFiles,
    handleUploadFiles,
    selectAsset,
    openAssetContextMenu,
    openBlankContextMenu,
    openPromptDetail,
    openFolder,
    openAssetRoot,
    exitCurrentFolder,
    selectAssetSource,
    deleteSelectedAssets,
    handleTileDragStart,
    handleTileDragOver,
    handleTileDrop,
  }
}
