import React from 'react'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import { getDesktopBridge } from '../../../desktop/bridge'
import { getTextBrain } from '../../../workbench/api/promptLibraryApi'
import { runWorkbenchTaskByVendor } from '../../../workbench/api/taskApi'
import type { BrowserAssetLibraryState } from '../assets/browserAssetLibraryStorage'
import type { NomiBrowserAsset } from '../assets/browserAssetData'
import {
  extractTextFromTaskResult,
  parseBrowserPromptExtraction,
  type BrowserPromptExtractionMode,
} from '../prompt/browserPromptExtraction'
import type {
  BrowserAssetCaptureRequest,
  BrowserAssetPromptCaptureRequest,
  BrowserAssetPromptReference,
  BrowserAssetRemoteImportInput,
  BrowserPromptExtractionTemplateSettings,
} from './browserAssetPopoverTypes'
import {
  browserAssetStorageKey,
  createPromptCardAsset,
  fileNameFromRemoteAssetUrl,
  promptExtractionModeFromRequest,
  promptReferenceImagesFromRequest,
  referenceResultDataUrl,
  referenceResultUrl,
  upsertBrowserAsset,
} from './browserAssetPopoverUtils'
import { browserPromptExtractionPromptFromSettings } from '../prompt/browserPromptExtractionSettings'

type UseBrowserAssetCaptureImportOptions = {
  activeFolderId: string | null
  promptExtractionSettings: BrowserPromptExtractionTemplateSettings
  browserCaptureRequest?: BrowserAssetCaptureRequest | null
  browserPromptCaptureRequest?: BrowserAssetPromptCaptureRequest | null
  onImportRemoteAsset?: (input: BrowserAssetRemoteImportInput) => Promise<NomiBrowserAsset>
  setPopoverOpen: (open: boolean) => void
  setActiveSource: React.Dispatch<React.SetStateAction<NomiBrowserAsset['source']>>
  setActiveTab: React.Dispatch<React.SetStateAction<NomiBrowserAsset['type'] | 'all'>>
  setActiveFolderId: React.Dispatch<React.SetStateAction<string | null>>
  setLocalAssets: React.Dispatch<React.SetStateAction<NomiBrowserAsset[]>>
  setPersistedAssets: React.Dispatch<React.SetStateAction<NomiBrowserAsset[]>>
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  updateLibraryState: (updater: (current: BrowserAssetLibraryState) => BrowserAssetLibraryState) => void
}

export function useBrowserAssetCaptureImport({
  activeFolderId,
  promptExtractionSettings,
  browserCaptureRequest,
  browserPromptCaptureRequest,
  onImportRemoteAsset,
  setPopoverOpen,
  setActiveSource,
  setActiveTab,
  setActiveFolderId,
  setLocalAssets,
  setPersistedAssets,
  setSelectedIds,
  updateLibraryState,
}: UseBrowserAssetCaptureImportOptions): {
  importRemoteAssetToLibrary: (input: BrowserAssetRemoteImportInput) => Promise<void>
} {
  const handledCaptureRequestIdRef = React.useRef<string | null>(null)
  const handledPromptRequestIdRef = React.useRef<string | null>(null)

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
      } catch {
        setLocalAssets((current) =>
          current.map((asset) => asset.id === pendingId ? { ...asset, subtitle: '下载失败', status: 'error' } : asset),
        )
      }
    },
    [activeFolderId, onImportRemoteAsset, setActiveSource, setActiveTab, setLocalAssets, setPersistedAssets, setSelectedIds, updateLibraryState],
  )

  const upsertPromptCardAsset = React.useCallback(
    (asset: NomiBrowserAsset): void => {
      updateLibraryState((current) => ({ ...current, promptCards: upsertBrowserAsset(current.promptCards, asset) }))
    },
    [updateLibraryState],
  )

  const preparePromptReference = React.useCallback(
    async (
      request: BrowserAssetPromptCaptureRequest,
      initialReferences: readonly BrowserAssetPromptReference[],
    ): Promise<{ references: BrowserAssetPromptReference[]; modelImageUrl: string }> => {
      const desktop = getDesktopBridge()
      const browserBridge = desktop?.browser
      const projectId = getDesktopActiveProjectId()
      const sourceUrl = request.sourceUrl?.trim() || initialReferences[0]?.sourceUrl || initialReferences[0]?.url || ''
      if (request.sourceType === 'screenshot' && request.viewId && browserBridge?.capturePromptScreenshot) {
        const captured = await browserBridge.capturePromptScreenshot({
          viewId: request.viewId,
          ...(projectId ? { projectId } : {}),
          fileName: request.fileName,
          title: request.title,
          sourceRect: request.sourceRect,
        })
        const referenceUrl = referenceResultUrl(captured) || referenceResultDataUrl(captured)
        const dataUrl = referenceResultDataUrl(captured) || referenceUrl
        return {
          references: referenceUrl ? [{ url: referenceUrl, title: request.title, sourceUrl: sourceUrl || request.pageUrl }] : [...initialReferences],
          modelImageUrl: dataUrl || request.modelImageUrl || referenceUrl || sourceUrl,
        }
      }
      if (request.viewId && /^(https?:\/\/|blob:)/i.test(sourceUrl) && browserBridge?.capturePromptImage) {
        const captured = await browserBridge.capturePromptImage({
          viewId: request.viewId,
          ...(projectId ? { projectId } : {}),
          url: sourceUrl,
          fileName: request.fileName,
          title: request.title,
        })
        const referenceUrl = referenceResultUrl(captured) || referenceResultDataUrl(captured)
        const dataUrl = referenceResultDataUrl(captured) || referenceUrl
        return {
          references: referenceUrl ? [{ url: referenceUrl, title: request.title, sourceUrl }] : [...initialReferences],
          modelImageUrl: dataUrl || request.modelImageUrl || referenceUrl || sourceUrl,
        }
      }
      return { references: [...initialReferences], modelImageUrl: request.modelImageUrl || sourceUrl || initialReferences[0]?.url || '' }
    },
    [],
  )

  const runPromptExtraction = React.useCallback(
    async (modelImageUrl: string, mode: BrowserPromptExtractionMode): Promise<{ title: string; prompt: string }> => {
      if (!modelImageUrl) throw new Error('没有可分析的参考图')
      const brain = await getTextBrain()
      if (!brain) throw new Error('请先在「模型接入」里启用一个支持图片输入的文本模型')
      const result = await runWorkbenchTaskByVendor(brain.vendor, {
        kind: 'image_to_prompt',
        prompt: browserPromptExtractionPromptFromSettings(promptExtractionSettings, mode),
        extras: {
          modelKey: brain.modelKey,
          referenceImages: [modelImageUrl],
          temperature: mode === 'style' ? 0.2 : 0.35,
          maxTokens: mode === 'style' ? 1800 : 1600,
        },
      })
      const text = extractTextFromTaskResult(result)
      if (!text) throw new Error('模型没有返回提示词')
      const parsed = parseBrowserPromptExtraction(text, mode)
      if (!parsed.prompt) throw new Error('模型没有返回可用提示词')
      return parsed
    },
    [promptExtractionSettings],
  )

  const extractPromptToAssetCard = React.useCallback(
    async (request: BrowserAssetPromptCaptureRequest): Promise<void> => {
      const cardId = `browser-prompt-${request.requestId}`
      const extractionMode = promptExtractionModeFromRequest(request)
      const initialReferences = promptReferenceImagesFromRequest(request)
      const pendingAsset = createPromptCardAsset({ id: cardId, request, references: initialReferences, prompt: '', status: 'loading' })
      setActiveSource('transcript')
      setActiveTab('prompt')
      setActiveFolderId(null)
      setPopoverOpen(true)
      upsertPromptCardAsset(pendingAsset)
      setSelectedIds(new Set([cardId]))
      let latestReferences: readonly BrowserAssetPromptReference[] = initialReferences
      try {
        const prepared = await preparePromptReference(request, initialReferences)
        latestReferences = prepared.references
        upsertPromptCardAsset(createPromptCardAsset({ id: cardId, request, references: prepared.references, prompt: '', status: 'loading', savedAt: pendingAsset.promptCard?.savedAt }))
        const extracted = await runPromptExtraction(prepared.modelImageUrl, extractionMode)
        upsertPromptCardAsset(createPromptCardAsset({ id: cardId, request, references: prepared.references, prompt: extracted.prompt, status: 'ready', title: extracted.title, savedAt: pendingAsset.promptCard?.savedAt }))
        setSelectedIds(new Set([cardId]))
      } catch (error) {
        upsertPromptCardAsset(createPromptCardAsset({
          id: cardId,
          request,
          references: latestReferences,
          prompt: error instanceof Error ? error.message : '提示词提取失败',
          status: 'error',
          savedAt: pendingAsset.promptCard?.savedAt,
        }))
        setSelectedIds(new Set([cardId]))
      }
    },
    [preparePromptReference, runPromptExtraction, setActiveFolderId, setActiveSource, setActiveTab, setPopoverOpen, setSelectedIds, upsertPromptCardAsset],
  )

  React.useEffect(() => {
    if (!browserCaptureRequest) return
    if (handledCaptureRequestIdRef.current === browserCaptureRequest.requestId) return
    handledCaptureRequestIdRef.current = browserCaptureRequest.requestId
    void importRemoteAssetToLibrary(browserCaptureRequest)
  }, [browserCaptureRequest, importRemoteAssetToLibrary])

  React.useEffect(() => {
    if (!browserPromptCaptureRequest) return
    if (handledPromptRequestIdRef.current === browserPromptCaptureRequest.requestId) return
    handledPromptRequestIdRef.current = browserPromptCaptureRequest.requestId
    void extractPromptToAssetCard(browserPromptCaptureRequest)
  }, [browserPromptCaptureRequest, extractPromptToAssetCard])

  return { importRemoteAssetToLibrary }
}
