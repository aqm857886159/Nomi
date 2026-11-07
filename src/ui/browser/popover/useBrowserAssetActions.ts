import { requestProjectAssetDeletion } from '../../../workbench/assets/assetFileDeletion'
// Tray deletion uses the same domain command and feedback as the asset library.
import React from 'react'
import { unwrapAssetImportResult } from '../../../../electron/shared/contracts/assetImportResult'
import { useTranslation } from 'react-i18next'
import { getDesktopBridge } from '../../../desktop/bridge'
import { confirmDialog } from '../../../design'
import { notify } from '../../notificationPolicy'
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
import { logRendererError } from '../../../desktop/rendererLog'

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
  presentFeedback: (message: string) => void
  /** 承载窗口给出的项目（见 NomiBrowserAssetPopoverProps.projectId）。 */
  projectId: string | null
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
  presentFeedback,
  projectId,
}: UseBrowserAssetActionsOptions): {
  addLocalFiles: (files: readonly File[]) => void
  selectAsset: (asset: NomiBrowserAsset, event: React.MouseEvent<HTMLDivElement>) => void
  openAssetContextMenu: (asset: NomiBrowserAsset, event: React.MouseEvent<HTMLDivElement>) => void
  deleteSelectedAssets: () => void
  handleTileDragStart: (asset: NomiBrowserAsset, event: React.DragEvent<HTMLDivElement>) => void
} {
  const { t } = useTranslation()
  const report = React.useCallback((message: string) => {
    notify({ identity: `browser-assets:${projectId ?? ''}`, reason: 'asset-action', level: 'inline', type: 'error', message, present: presentFeedback })
  }, [presentFeedback, projectId])
  const addLocalFiles = React.useCallback((files: readonly File[]): void => {
    presentFeedback('')
    // 收件箱只收图/视频；其他类型（文本等）去素材库上传，不在这里静默变卡。
    const mediaFiles = [...files].flatMap((file) => {
      const type = assetTypeFromFile(file)
      return type ? [{ file, type }] : []
    })
    if (mediaFiles.length === 0) {
      if (files.length > 0) report(t('browserAssets.onlyImagesAndVideos'))
      return
    }
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
        tags: [t('browserAssets.localImport')],
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
          const mapped = browserAssetFromDesktopAsset(unwrapAssetImportResult(persisted))
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
  }, [presentFeedback, report, previewUrlsRef, projectId, setActiveTab, setLocalAssets, setPersistedAssets, setSelectedIds, t])

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
    presentFeedback('')
    void (async () => {
      deleteInFlightRef.current = true
      try {
        // 确认弹窗溢出整卡片：开合期间通知承载方扩热区（原生 overlay 下否则点不到）。
        setDeleteConfirmOpen(true)
        const confirmed = await confirmDialog({
          title: t('assetLibrary.confirmDeleteTitle', { count: assetsToDelete.length }),
          message: t('assetLibrary.confirmDeleteMessage'),
          confirmLabel: t('assetLibrary.delete'),
          danger: true,
        }).finally(() => setDeleteConfirmOpen(false))
        if (!confirmed) return
        const selectedIdSet = new Set(assetsToDelete.map((asset) => asset.id))
        const relativePaths = assetsToDelete.flatMap((asset) => (asset.relativePath ? [asset.relativePath] : []))
        if (relativePaths.length > 0) {
          if (!projectId) {
            report(t('assetLibrary.deleteNoProject'))
            return
          }
          const outcomes = await requestProjectAssetDeletion(projectId, relativePaths)
          const kept = outcomes.reduce((count, outcome) => count + outcome.keptInUseCount, 0)
          const failed = outcomes.reduce((count, outcome) => count + outcome.failedFileCount, 0)
          const messages = [
            ...(kept ? [t('assetLibrary.keptInUse', { count: kept })] : []),
            ...(failed ? [t('assetLibrary.failedFiles', { count: failed })] : []),
          ]
          if (messages.length) report(messages.join(' '))
          // Kept or failed files stay selected/visible; a successful deletion is reflected by refresh.
          for (let index = 0; index < outcomes.length; index += 1) {
            if (outcomes[index].keptInUseCount || outcomes[index].failedFileCount) {
              for (const asset of assetsToDelete) if (asset.relativePath === relativePaths[index]) selectedIdSet.delete(asset.id)
            }
          }
        }
        // 会话内临时卡（无落盘文件）直接从本地状态移除；落盘桶重拉对账真实盘面
        // （真正回收会广播 nomi:assets:updated，托盘在命令结束后重拉）。
        setLocalAssets((current) => current.filter((asset) => !selectedIdSet.has(asset.id)))
        setPersistedAssets((current) => current.filter((asset) => !selectedIdSet.has(asset.id)))
        setSelectedIds(new Set())
        if (relativePaths.length > 0) await refreshPersistedAssets()
      } catch (error) {
        logRendererError('browser-asset-delete-failed', error)
        report(error instanceof Error ? error.message : t('browserAssets.deleteFailedPermission'))
      } finally {
        deleteInFlightRef.current = false
      }
    })()
  }, [presentFeedback, projectId, report, refreshPersistedAssets, selectedAssets, setAssetContextMenu, setDeleteConfirmOpen, setLocalAssets, setPersistedAssets, setSelectedIds, t])

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
