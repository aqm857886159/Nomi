// 托盘动作（素材面收敛 2026-07-22 切片D）：文件夹/提示词动作已随各自切片退役；
// 删除从「localStorage 软删」改为真删——落盘文件经 workspace.deleteFiles 进系统回收站，
// 素材库同步消失（与 AssetLibraryPanel 同一口径），不再有「托盘删了库里还在」的分裂。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import { getDesktopBridge } from '../../../desktop/bridge'
import { confirmDialog } from '../../../design'
import { toast } from '../../toast'
import type { NomiBrowserAsset, NomiBrowserAssetTab } from '../assets/browserAssetData'
import type { AssetContextMenuState } from './browserAssetPopoverTypes'
import type { FloatingWindowRect } from '../window/useResizableFloatingWindow'
import {
  ASSET_CONTEXT_MENU_ESTIMATED_HEIGHT,
  ASSET_CONTEXT_MENU_MARGIN,
  ASSET_CONTEXT_MENU_WIDTH,
  LEGACY_BROWSER_ASSET_DRAG_MIME,
  NOMI_ASSET_DRAG_MIME,
} from './browserAssetPopoverConstants'
import {
  assetTypeFromFile,
  browserAssetFromDesktopAsset,
  clampNumber,
  contentTypeFromFile,
  isBrowserAssetDraggable,
  upsertBrowserAsset,
} from './browserAssetPopoverUtils'

type UseBrowserAssetActionsOptions = {
  filteredAssets: readonly NomiBrowserAsset[]
  selectedAssets: readonly NomiBrowserAsset[]
  selectedIds: ReadonlySet<string>
  windowRect: FloatingWindowRect
  popoverOpen: boolean
  rootRef: React.RefObject<HTMLDivElement | null>
  previewUrlsRef: React.MutableRefObject<string[]>
  refreshPersistedAssets: () => Promise<void>
  setActiveTab: React.Dispatch<React.SetStateAction<NomiBrowserAssetTab>>
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setLocalAssets: React.Dispatch<React.SetStateAction<NomiBrowserAsset[]>>
  setPersistedAssets: React.Dispatch<React.SetStateAction<NomiBrowserAsset[]>>
  setAssetContextMenu: React.Dispatch<React.SetStateAction<AssetContextMenuState | null>>
  setFiltersOpen: React.Dispatch<React.SetStateAction<boolean>>
  setDeleteConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>
}

export function useBrowserAssetActions({
  filteredAssets,
  selectedAssets,
  selectedIds,
  windowRect,
  popoverOpen,
  rootRef,
  previewUrlsRef,
  refreshPersistedAssets,
  setActiveTab,
  setSelectedIds,
  setLocalAssets,
  setPersistedAssets,
  setAssetContextMenu,
  setFiltersOpen,
  setDeleteConfirmOpen,
}: UseBrowserAssetActionsOptions): {
  addLocalFiles: (files: readonly File[]) => void
  selectAsset: (asset: NomiBrowserAsset, event: React.MouseEvent<HTMLDivElement>) => void
  openAssetContextMenu: (asset: NomiBrowserAsset, event: React.MouseEvent<HTMLDivElement>) => void
  deleteSelectedAssets: () => void
  handleTileDragStart: (asset: NomiBrowserAsset, event: React.DragEvent<HTMLDivElement>) => void
} {
  const { t } = useTranslation()
  const addLocalFiles = React.useCallback((files: readonly File[]): void => {
    // 收件箱只收图/视频；其他类型（文本等）去素材库上传，不在这里静默变卡。
    const mediaFiles = [...files].flatMap((file) => {
      const type = assetTypeFromFile(file)
      return type ? [{ file, type }] : []
    })
    if (mediaFiles.length === 0) {
      if (files.length > 0) toast(t('browserAssets.onlyImagesAndVideos'), 'warning')
      return
    }
    const projectId = getDesktopActiveProjectId()
    const desktopAssets = getDesktopBridge()?.assets
    const persistImport = projectId && desktopAssets?.importFile ? { projectId, importFile: desktopAssets.importFile } : null
    const batchTime = Date.now()
    const uploaded = mediaFiles.map(({ file, type }, index): NomiBrowserAsset => {
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
        title: file.name || t('browserAssets.unnamedAsset'),
        subtitle: persistImport ? t('browserAssets.saving') : t('browserAssets.localImport'),
        previewUrl,
        tags: ['本地导入'],
        status: persistImport ? 'loading' : undefined,
        createdAt: now,
        updatedAt: now,
      }
    })
    setActiveTab('all')
    setLocalAssets((current) => [...uploaded, ...current])
    setSelectedIds(new Set(uploaded.map((asset) => asset.id)))
    if (!persistImport) return
    uploaded.forEach((pendingAsset, index) => {
      const file = mediaFiles[index]?.file
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
            status: 'ready',
            subtitle: mapped?.subtitle ?? t('browserAssets.localImport'),
          }
          setLocalAssets((current) => current.map((asset) => (asset.id === pendingAsset.id ? readyAsset : asset)))
          setPersistedAssets((current) => upsertBrowserAsset(current, readyAsset))
          setSelectedIds((current) => {
            if (!current.has(pendingAsset.id)) return current
            const next = new Set(current)
            next.delete(pendingAsset.id)
            next.add(readyAsset.id)
            return next
          })
        } catch {
          setLocalAssets((current) => current.map((asset) => asset.id === pendingAsset.id ? { ...asset, subtitle: t('browserAssets.saveFailed'), status: 'error' } : asset))
        }
      })()
    })
  }, [previewUrlsRef, setActiveTab, setLocalAssets, setPersistedAssets, setSelectedIds, t])

  const selectAsset = React.useCallback((asset: NomiBrowserAsset, event: React.MouseEvent<HTMLDivElement>) => {
    setAssetContextMenu(null)
    setSelectedIds((current) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        const next = new Set(current)
        if (next.has(asset.id)) next.delete(asset.id)
        else next.add(asset.id)
        return next
      }
      return new Set([asset.id])
    })
  }, [setAssetContextMenu, setSelectedIds])

  const openAssetContextMenu = React.useCallback((asset: NomiBrowserAsset, event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    setFiltersOpen(false)
    setSelectedIds((current) => (current.has(asset.id) ? current : new Set([asset.id])))
    setAssetContextMenu({
      assetId: asset.id,
      x: clampNumber(event.clientX - windowRect.left, ASSET_CONTEXT_MENU_MARGIN, Math.max(ASSET_CONTEXT_MENU_MARGIN, windowRect.width - ASSET_CONTEXT_MENU_WIDTH - ASSET_CONTEXT_MENU_MARGIN)),
      y: clampNumber(event.clientY - windowRect.top, ASSET_CONTEXT_MENU_MARGIN, Math.max(ASSET_CONTEXT_MENU_MARGIN, windowRect.height - ASSET_CONTEXT_MENU_ESTIMATED_HEIGHT - ASSET_CONTEXT_MENU_MARGIN)),
    })
  }, [setAssetContextMenu, setFiltersOpen, setSelectedIds, windowRect.height, windowRect.left, windowRect.top, windowRect.width])

  const deleteInFlightRef = React.useRef(false)
  const deleteSelectedAssets = React.useCallback((): void => {
    if (selectedAssets.length === 0) return
    // 确认弹窗期间再按 Delete/再点删除不重入（否则确认请求排队、二次确认会重复删）。
    if (deleteInFlightRef.current) return
    setAssetContextMenu(null)
    const assetsToDelete = [...selectedAssets]
    void (async () => {
      deleteInFlightRef.current = true
      try {
        // 确认弹窗溢出整卡片：开合期间通知承载方扩热区（原生 overlay 下否则点不到）。
        setDeleteConfirmOpen(true)
        const confirmed = await confirmDialog({
          title: t('browserAssets.confirmDeleteCount', { count: assetsToDelete.length }),
          message: t('browserAssets.deleteToTrashHint'),
          confirmLabel: t('browserAssets.delete'),
          danger: true,
        }).finally(() => setDeleteConfirmOpen(false))
        if (!confirmed) return
        const selectedIdSet = new Set(assetsToDelete.map((asset) => asset.id))
        const relativePaths = assetsToDelete.flatMap((asset) => (asset.relativePath ? [asset.relativePath] : []))
        if (relativePaths.length > 0) {
          const projectId = getDesktopActiveProjectId()
          const deleteFiles = getDesktopBridge()?.workspace?.deleteFiles
          if (!projectId || !deleteFiles) {
            toast(t('browserAssets.deleteUnsupported'), 'error')
            return
          }
          const result = await deleteFiles({ projectId, relativePaths })
          if (result.failedCount > 0) toast(t('browserAssets.deleteCountFailed', { count: result.failedCount }), 'warning')
        }
        // 会话内临时卡（无落盘文件）直接从本地状态移除；落盘桶重拉对账真实盘面
        // （deleteFiles 不广播 nomi:assets:updated，必须手动重拉）。
        setLocalAssets((current) => current.filter((asset) => !selectedIdSet.has(asset.id)))
        setPersistedAssets((current) => current.filter((asset) => !selectedIdSet.has(asset.id)))
        setSelectedIds(new Set())
        if (relativePaths.length > 0) await refreshPersistedAssets()
      } catch (error) {
        console.error('[nomi:browser] 删除素材失败:', error)
        toast(t('browserAssets.deleteFailedPermission'), 'error')
      } finally {
        deleteInFlightRef.current = false
      }
    })()
  }, [refreshPersistedAssets, selectedAssets, setAssetContextMenu, setDeleteConfirmOpen, setLocalAssets, setPersistedAssets, setSelectedIds, t])

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
    if (!isBrowserAssetDraggable(asset)) {
      event.preventDefault()
      return
    }
    const dragSelection = selectedIds.has(asset.id) ? selectedAssets : [asset]
    const serializedSelection = JSON.stringify(dragSelection)
    event.dataTransfer.setData(NOMI_ASSET_DRAG_MIME, serializedSelection)
    event.dataTransfer.setData(LEGACY_BROWSER_ASSET_DRAG_MIME, serializedSelection)
    event.dataTransfer.setData('text/plain', dragSelection.map((item) => item.title).join('\n'))
    event.dataTransfer.effectAllowed = 'copyMove'
  }, [selectedAssets, selectedIds])

  return {
    addLocalFiles,
    selectAsset,
    openAssetContextMenu,
    deleteSelectedAssets,
    handleTileDragStart,
  }
}
