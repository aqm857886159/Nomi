// 托盘捕捞导入（素材面收敛 2026-07-22：提示词提取半边已迁出——
// 提取由浏览器侧 browserPromptExtractionRunner 直驱、产物入主提示词库，托盘只管接素材）。
import React from 'react'
import type { BrowserAssetLibraryState } from '../assets/browserAssetLibraryStorage'
import type { NomiBrowserAsset } from '../assets/browserAssetData'
import type { BrowserAssetCaptureRequest, BrowserAssetRemoteImportInput } from './browserAssetPopoverTypes'
import {
  browserAssetStorageKey,
  browserAssetImportErrorMessage,
  fileNameFromRemoteAssetUrl,
  upsertBrowserAsset,
} from './browserAssetPopoverUtils'

type UseBrowserAssetCaptureImportOptions = {
  activeFolderId: string | null
  browserCaptureRequest?: BrowserAssetCaptureRequest | null
  onImportRemoteAsset?: (input: BrowserAssetRemoteImportInput) => Promise<NomiBrowserAsset>
  setActiveSource: React.Dispatch<React.SetStateAction<NomiBrowserAsset['source']>>
  setActiveTab: React.Dispatch<React.SetStateAction<NomiBrowserAsset['type'] | 'all'>>
  setLocalAssets: React.Dispatch<React.SetStateAction<NomiBrowserAsset[]>>
  setPersistedAssets: React.Dispatch<React.SetStateAction<NomiBrowserAsset[]>>
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  updateLibraryState: (updater: (current: BrowserAssetLibraryState) => BrowserAssetLibraryState) => void
}

export function useBrowserAssetCaptureImport({
  activeFolderId,
  browserCaptureRequest,
  onImportRemoteAsset,
  setActiveSource,
  setActiveTab,
  setLocalAssets,
  setPersistedAssets,
  setSelectedIds,
  updateLibraryState,
}: UseBrowserAssetCaptureImportOptions): {
  importRemoteAssetToLibrary: (input: BrowserAssetRemoteImportInput) => Promise<void>
  retryCaptureImport: (assetId: string) => void
  dismissCaptureTransient: (assetId: string) => void
} {
  const handledCaptureRequestIdRef = React.useRef<string | null>(null)
  // 失败卡的原始输入留档：错误项不进 ready 列表、只在临时条里给 [重试]/[移除]（审计 P1）。
  const transientInputsRef = React.useRef(new Map<string, BrowserAssetRemoteImportInput>())

  const importRemoteAssetToLibrary = React.useCallback(
    async (input: BrowserAssetRemoteImportInput): Promise<void> => {
      const mediaType = input.mediaType === 'video' ? 'video' : 'image'
      const sourceLabel = 'requestId' in input ? '网页捕捞' : '网页拖拽'
      const now = new Date().toISOString()
      const pendingId = `browser-${mediaType}-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const title = input.title || input.fileName || fileNameFromRemoteAssetUrl(input.url)
      const pendingAsset: NomiBrowserAsset = {
        id: pendingId,
        type: mediaType,
        source: 'my',
        title,
        subtitle: '下载中...',
        tags: [sourceLabel],
        parentFolderId: activeFolderId,
        status: 'loading',
        createdAt: now,
        updatedAt: now,
      }
      transientInputsRef.current.set(pendingId, input)
      setActiveSource('my')
      setActiveTab('all')
      setLocalAssets((current) => [pendingAsset, ...current])
      setSelectedIds(new Set([pendingId]))
      if (!onImportRemoteAsset) {
        setLocalAssets((current) =>
          current.map((asset) => asset.id === pendingId ? { ...asset, subtitle: '无法导入网页素材', status: 'error' } : asset),
        )
        return
      }
      try {
        const imported = await onImportRemoteAsset(input)
        transientInputsRef.current.delete(pendingId)
        const readyAsset: NomiBrowserAsset = {
          ...imported,
          parentFolderId: activeFolderId,
          status: 'ready',
          createdAt: imported.createdAt ?? pendingAsset.createdAt,
          updatedAt: imported.updatedAt ?? pendingAsset.updatedAt,
        }
        setLocalAssets((current) => current.map((asset) => (asset.id === pendingId ? readyAsset : asset)))
        setPersistedAssets((current) => upsertBrowserAsset(current, readyAsset))
        updateLibraryState((current) => ({
          ...current,
          folderAssignments: { ...current.folderAssignments, [browserAssetStorageKey(readyAsset)]: activeFolderId },
        }))
        setSelectedIds(new Set([readyAsset.id]))
      } catch (error) {
        // 错误透明(别再吞成无信息的「下载失败」——用户 2026-07-13 报 Dribbble 图下载失败无从诊断)：
        // 把真实原因(超时/防盗链 403/内容类型/blob)带到卡片副标题，控制台留全文供排查。
        const reason = error instanceof Error ? error.message : String(error)
        console.error('[nomi:browser] 网页素材导入失败:', reason, input.url)
        const shortReason = browserAssetImportErrorMessage(reason, input.url)
        setLocalAssets((current) =>
          current.map((asset) => asset.id === pendingId ? { ...asset, subtitle: shortReason, status: 'error' } : asset),
        )
      }
    },
    [activeFolderId, onImportRemoteAsset, setActiveSource, setActiveTab, setLocalAssets, setPersistedAssets, setSelectedIds, updateLibraryState],
  )

  // 失败卡「重试」：用原始输入重新走完整导入（新卡替旧卡）；「移除」：临时卡直接消失。
  const dismissCaptureTransient = React.useCallback((assetId: string): void => {
    transientInputsRef.current.delete(assetId)
    setLocalAssets((current) => current.filter((asset) => asset.id !== assetId))
  }, [setLocalAssets])

  const retryCaptureImport = React.useCallback((assetId: string): void => {
    const input = transientInputsRef.current.get(assetId)
    if (!input) return
    dismissCaptureTransient(assetId)
    void importRemoteAssetToLibrary(input)
  }, [dismissCaptureTransient, importRemoteAssetToLibrary])

  React.useEffect(() => {
    if (!browserCaptureRequest) return
    if (handledCaptureRequestIdRef.current === browserCaptureRequest.requestId) return
    handledCaptureRequestIdRef.current = browserCaptureRequest.requestId
    void importRemoteAssetToLibrary(browserCaptureRequest)
  }, [browserCaptureRequest, importRemoteAssetToLibrary])

  return { importRemoteAssetToLibrary, retryCaptureImport, dismissCaptureTransient }
}
