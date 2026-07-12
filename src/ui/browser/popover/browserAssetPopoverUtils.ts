import type { CSSProperties } from 'react'
import type { DesktopAssetDto } from '../../../desktop/bridge'
import type { BrowserAssetCanvasImportItem } from '../overlay/globalAssetPopoverEvents'
import type { BrowserAssetLibraryState } from '../assets/browserAssetLibraryStorage'
import type { NomiBrowserAsset } from '../assets/browserAssetData'
import type { BrowserPromptExtractionMode } from '../prompt/browserPromptExtraction'
import { BROWSER_PROMPT_EXTRACTION_MODE_LABELS } from '../prompt/browserPromptExtraction'
import type {
  AssetPopoverDockMode,
  BrowserAssetPromptCaptureRequest,
  BrowserAssetPromptReference,
  BrowserAssetRemoteImportInput,
  MarqueeState,
} from './browserAssetPopoverTypes'
import {
  ASSET_GRID_COLUMN_GAP,
  ASSET_GRID_COMPACT_MAX_COLUMNS,
  ASSET_GRID_COMPACT_MIN_COLUMN_WIDTH,
  ASSET_GRID_HORIZONTAL_PADDING,
  ASSET_GRID_MIN_COLUMN_WIDTH,
  BROWSER_IMAGE_DRAG_MIME,
  DOCK_DEFAULT_WIDTH,
  DOCK_GAP,
  DOCK_MAX_WIDTH_RATIO,
  LEGACY_BROWSER_ASSET_DRAG_MIME,
  NOMI_ASSET_DRAG_MIME,
  PROMPT_MASONRY_COLUMN_GAP,
  PROMPT_MASONRY_MAX_COLUMNS,
  PROMPT_MASONRY_MIN_COLUMN_WIDTH,
} from './browserAssetPopoverConstants'
import { FLOATING_WINDOW_MIN_WIDTH, type FloatingWindowBoundsRect, type FloatingWindowRect } from '../window/useResizableFloatingWindow'

export function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

export function getAssetGridColumnCount(windowWidth: number, compact: boolean): number {
  const availableWidth = Math.max(0, windowWidth - ASSET_GRID_HORIZONTAL_PADDING)
  const minColumnWidth = compact ? ASSET_GRID_COMPACT_MIN_COLUMN_WIDTH : ASSET_GRID_MIN_COLUMN_WIDTH
  const rawCount = Math.floor((availableWidth + ASSET_GRID_COLUMN_GAP) / (minColumnWidth + ASSET_GRID_COLUMN_GAP))
  const maxColumns = compact ? ASSET_GRID_COMPACT_MAX_COLUMNS : Number.POSITIVE_INFINITY
  return clampNumber(rawCount, 1, maxColumns)
}

export function getPromptMasonryColumnCount(windowWidth: number): number {
  const availableWidth = Math.max(0, windowWidth - ASSET_GRID_HORIZONTAL_PADDING)
  const rawCount = Math.floor(
    (availableWidth + PROMPT_MASONRY_COLUMN_GAP) / (PROMPT_MASONRY_MIN_COLUMN_WIDTH + PROMPT_MASONRY_COLUMN_GAP),
  )
  return clampNumber(rawCount, 1, PROMPT_MASONRY_MAX_COLUMNS)
}

export function createDockedWindowRect(
  bounds: FloatingWindowBoundsRect,
  dockMode: Exclude<AssetPopoverDockMode, null>,
  preferredWidth = DOCK_DEFAULT_WIDTH,
  gap = DOCK_GAP,
): FloatingWindowRect {
  const maxWidth = Math.max(
    FLOATING_WINDOW_MIN_WIDTH,
    Math.min(bounds.width - gap * 2, Math.floor(bounds.width * DOCK_MAX_WIDTH_RATIO)),
  )
  const width = clampNumber(Math.round(preferredWidth), FLOATING_WINDOW_MIN_WIDTH, maxWidth)
  return {
    left: dockMode === 'left' ? bounds.left + gap : bounds.right - gap - width,
    top: bounds.top + gap,
    width,
    height: Math.max(0, bounds.height - gap * 2),
  }
}

export function normalizeMarqueeRect(rect: MarqueeState): CSSProperties {
  const left = Math.min(rect.startX, rect.currentX)
  const top = Math.min(rect.startY, rect.currentY)
  return { left, top, width: Math.abs(rect.currentX - rect.startX), height: Math.abs(rect.currentY - rect.startY) }
}

export function rectsIntersect(left: DOMRect, right: DOMRect): boolean {
  return left.left <= right.right && left.right >= right.left && left.top <= right.bottom && left.bottom >= right.top
}

export function assetTypeFromFile(file: File): NomiBrowserAsset['type'] {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'prompt'
}

export function contentTypeFromFile(file: File): string {
  if (file.type) return file.type
  const name = file.name.toLowerCase()
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'text/markdown'
  if (name.endsWith('.txt')) return 'text/plain'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.gif')) return 'image/gif'
  if (name.endsWith('.mp4')) return 'video/mp4'
  if (name.endsWith('.webm')) return 'video/webm'
  if (name.endsWith('.mov')) return 'video/quicktime'
  return 'application/octet-stream'
}

function parseAssetTime(value?: string): number {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

export function browserAssetTimeValue(asset: NomiBrowserAsset): number {
  const explicitTime = Math.max(
    parseAssetTime(asset.updatedAt),
    parseAssetTime(asset.createdAt),
    parseAssetTime(asset.promptCard?.savedAt),
  )
  if (explicitTime > 0) return explicitTime
  const idTime = asset.id.match(/\d{12,}/)?.[0]
  return idTime ? Number(idTime) : 0
}

function isPromptAssetFileName(fileName: string): boolean {
  return /\.(md|markdown|txt)$/i.test(fileName)
}

function assetTypeFromDesktopAsset(asset: DesktopAssetDto): NomiBrowserAsset['type'] | null {
  const mediaType = typeof asset.data.mediaType === 'string' ? asset.data.mediaType.toLowerCase() : ''
  if (mediaType === 'image') return 'image'
  if (mediaType === 'video') return 'video'
  const contentType = typeof asset.data.contentType === 'string' ? asset.data.contentType.toLowerCase() : ''
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (/\.(mp4|webm|mov|m4v)$/i.test(asset.name)) return 'video'
  if (/\.(png|jpe?g|webp|gif|avif)$/i.test(asset.name)) return 'image'
  if (contentType.startsWith('text/') || isPromptAssetFileName(asset.name)) return 'prompt'
  return null
}

function browserAssetStorageKeyFromDesktopAsset(asset: DesktopAssetDto): string {
  const url = typeof asset.data.url === 'string' ? asset.data.url : ''
  return url ? `url:${url}` : `id:${asset.id}`
}

function browserAssetLibraryHasDesktopAsset(asset: DesktopAssetDto, libraryState?: BrowserAssetLibraryState): boolean {
  if (!libraryState) return false
  return Object.prototype.hasOwnProperty.call(
    libraryState.folderAssignments,
    browserAssetStorageKeyFromDesktopAsset(asset),
  )
}

export function shouldShowDesktopAssetInBrowserPopover(asset: DesktopAssetDto, libraryState?: BrowserAssetLibraryState): boolean {
  const kind = typeof asset.data.kind === 'string' ? asset.data.kind : ''
  if (asset.data.ownerNodeId) return false
  if (kind === 'browser-capture') return true
  if (kind === 'browser-upload') return true
  return browserAssetLibraryHasDesktopAsset(asset, libraryState)
}

function browserAssetSubtitleFromDesktopAsset(asset: DesktopAssetDto): string {
  const kind = typeof asset.data.kind === 'string' ? asset.data.kind : ''
  if (kind === 'browser-capture') return '网页素材'
  if (kind === 'browser-upload') return '本地导入'
  if (kind === 'upload') return '本地导入'
  return '项目素材'
}

export function browserAssetFromDesktopAsset(asset: DesktopAssetDto): NomiBrowserAsset | null {
  if (asset.name.endsWith('.meta')) return null
  const type = assetTypeFromDesktopAsset(asset)
  if (!type) return null
  const url = typeof asset.data.url === 'string' ? asset.data.url : ''
  const subtitle = browserAssetSubtitleFromDesktopAsset(asset)
  // 显示名优先用网页捕捞时抓到的人类标题(alt/title/文档标题，落在 sidecar.title)，
  // 而不是原始文件名——防盗链图的 URL 文件名常是哈希(263fcbf8…)，直接当名字没法认(用户 2026-07-13 抓出)。
  const sidecarTitle = typeof asset.data.title === 'string' ? asset.data.title.trim() : ''
  return {
    id: asset.id,
    type,
    source: 'my',
    title: sidecarTitle || asset.name || (type === 'video' ? '项目视频' : type === 'image' ? '项目图片' : '本地文本'),
    subtitle,
    previewUrl: type === 'prompt' ? undefined : url || undefined,
    tags: [subtitle],
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  }
}

export function browserAssetUrlKey(asset: NomiBrowserAsset): string {
  if (asset.promptCard) return ''
  return asset.previewUrl || ''
}

export function browserAssetStorageKey(asset: NomiBrowserAsset): string {
  if (asset.promptCard) return `prompt:${asset.id}`
  return asset.previewUrl ? `url:${asset.previewUrl}` : `id:${asset.id}`
}

function promptTextFromBrowserAsset(asset: NomiBrowserAsset): string {
  const promptCardPrompt = asset.promptCard?.prompt.trim()
  if (promptCardPrompt) return promptCardPrompt
  const subtitle = asset.subtitle?.trim() ?? ''
  if (subtitle && !['本地文本', '本地导入', '网页素材', '项目素材'].includes(subtitle)) return subtitle
  return asset.title
}

export function browserAssetToCanvasImportItem(asset: NomiBrowserAsset): BrowserAssetCanvasImportItem | null {
  if (asset.type === 'folder' || asset.status === 'loading' || asset.status === 'error') return null
  if (asset.type === 'prompt') {
    return { id: asset.id, type: 'prompt', title: asset.title, subtitle: asset.subtitle, prompt: promptTextFromBrowserAsset(asset) }
  }
  const previewUrl = asset.previewUrl?.trim()
  if (!previewUrl) return null
  return { id: asset.id, type: asset.type, title: asset.title, subtitle: asset.subtitle, previewUrl }
}

export function isBrowserAssetCanvasImportItem(asset: BrowserAssetCanvasImportItem | null): asset is BrowserAssetCanvasImportItem {
  return Boolean(asset)
}

export function mergeBrowserAssetGroups(...groups: readonly (readonly NomiBrowserAsset[])[]): NomiBrowserAsset[] {
  const merged: NomiBrowserAsset[] = []
  const seenIds = new Set<string>()
  const seenUrls = new Set<string>()
  for (const group of groups) {
    for (const asset of group) {
      const urlKey = browserAssetUrlKey(asset)
      if (seenIds.has(asset.id) || (urlKey && seenUrls.has(urlKey))) continue
      merged.push(asset)
      seenIds.add(asset.id)
      if (urlKey) seenUrls.add(urlKey)
    }
  }
  return merged
}

export function upsertBrowserAsset(current: readonly NomiBrowserAsset[], asset: NomiBrowserAsset): NomiBrowserAsset[] {
  const urlKey = browserAssetUrlKey(asset)
  return [asset, ...current.filter((item) => item.id !== asset.id && (!urlKey || browserAssetUrlKey(item) !== urlKey))]
}

function firstUsableImageUrlFromText(text: string): string {
  const candidates = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  for (const candidate of candidates) {
    if (/^(https?:\/\/|data:image\/)/i.test(candidate)) return candidate
  }
  return ''
}

function imageUrlFromHtml(html: string): { url: string; title?: string } | null {
  if (!html.trim()) return null
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const image = doc.querySelector('img')
    const url = image?.getAttribute('src') || image?.getAttribute('data-src') || ''
    if (!url) return null
    return { url, title: image?.getAttribute('alt') || image?.getAttribute('title') || undefined }
  } catch {
    return null
  }
}

export function fileNameFromRemoteAssetUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const segment = parsed.pathname.split('/').filter(Boolean).pop()
    return segment ? decodeURIComponent(segment) : `browser-resource-${Date.now()}`
  } catch {
    return `browser-resource-${Date.now()}`
  }
}

export function readBrowserImageDragPayload(dataTransfer: DataTransfer): BrowserAssetRemoteImportInput | null {
  const customPayload = dataTransfer.getData(BROWSER_IMAGE_DRAG_MIME)
  if (customPayload) {
    try {
      const parsed = JSON.parse(customPayload) as { url?: unknown; title?: unknown }
      const url = typeof parsed.url === 'string' ? parsed.url.trim() : ''
      if (url) {
        return { url, title: typeof parsed.title === 'string' ? parsed.title.trim() || undefined : undefined, fileName: fileNameFromRemoteAssetUrl(url), mediaType: 'image' }
      }
    } catch {
      // Ignore malformed drag payloads and fall back to standard browser data.
    }
  }
  const uriListUrl = firstUsableImageUrlFromText(dataTransfer.getData('text/uri-list'))
  if (uriListUrl) return { url: uriListUrl, fileName: fileNameFromRemoteAssetUrl(uriListUrl), mediaType: 'image' }
  const htmlImage = imageUrlFromHtml(dataTransfer.getData('text/html'))
  if (htmlImage) return { ...htmlImage, fileName: fileNameFromRemoteAssetUrl(htmlImage.url), mediaType: 'image' }
  const plainUrl = firstUsableImageUrlFromText(dataTransfer.getData('text/plain'))
  return plainUrl ? { url: plainUrl, fileName: fileNameFromRemoteAssetUrl(plainUrl), mediaType: 'image' } : null
}

export function promptReferenceImagesFromRequest(request: BrowserAssetPromptCaptureRequest): BrowserAssetPromptReference[] {
  const fromRequest = Array.isArray(request.referenceImages)
    ? request.referenceImages.reduce<BrowserAssetPromptReference[]>((items, reference) => {
        const url = reference.url.trim()
        if (!url) return items
        items.push({
          url,
          ...(reference.title ? { title: reference.title } : {}),
          ...(reference.sourceUrl ? { sourceUrl: reference.sourceUrl } : {}),
        })
        return items
      }, [])
    : []
  if (fromRequest.length > 0) return fromRequest
  const sourceUrl = request.sourceUrl?.trim()
  return sourceUrl ? [{ url: sourceUrl, title: request.title, sourceUrl }] : []
}

export function promptExtractionModeFromRequest(request: BrowserAssetPromptCaptureRequest): BrowserPromptExtractionMode {
  return request.extractionMode === 'style' ? 'style' : 'replicate'
}

function promptExtractionModeLabel(mode: BrowserPromptExtractionMode): string {
  return BROWSER_PROMPT_EXTRACTION_MODE_LABELS[mode]
}

function promptAssetTitle(request: BrowserAssetPromptCaptureRequest, promptTitle?: string): string {
  const title = (promptTitle || request.title || request.pageTitle || '').trim()
  if (title) return title.slice(0, 48)
  if (promptExtractionModeFromRequest(request) === 'style') return request.sourceType === 'screenshot' ? '网页截图风格' : '画面风格'
  return request.sourceType === 'screenshot' ? '网页截图提示词' : '图片提示词'
}

function promptAssetSubtitle(asset: NomiBrowserAsset): string {
  const label = promptExtractionModeLabel(asset.promptCard?.extractionMode === 'style' ? 'style' : 'replicate')
  if (asset.status === 'loading') return `正在提取${label}...`
  if (asset.status === 'error') return `${label}提取失败`
  return label
}

export function referenceResultUrl(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const record = raw as Record<string, unknown>
  return typeof record.referenceUrl === 'string' ? record.referenceUrl.trim() : ''
}

export function referenceResultDataUrl(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const record = raw as Record<string, unknown>
  return typeof record.dataUrl === 'string' ? record.dataUrl.trim() : ''
}

export function createPromptCardAsset(input: {
  id: string
  request: BrowserAssetPromptCaptureRequest
  references: readonly BrowserAssetPromptReference[]
  prompt: string
  status: NomiBrowserAsset['status']
  title?: string
  savedAt?: string
  updatedAt?: string
}): NomiBrowserAsset {
  const savedAt = input.savedAt || new Date().toISOString()
  const updatedAt = input.updatedAt || new Date().toISOString()
  const previewUrl = input.references[0]?.url
  const extractionMode = promptExtractionModeFromRequest(input.request)
  const modeLabel = promptExtractionModeLabel(extractionMode)
  const asset: NomiBrowserAsset = {
    id: input.id,
    type: 'prompt',
    source: 'transcript',
    title: promptAssetTitle(input.request, input.title),
    tags: ['图片提示词', modeLabel],
    previewUrl,
    previewMediaType: previewUrl ? 'image' : undefined,
    status: input.status,
    createdAt: savedAt,
    updatedAt,
    promptCard: {
      referenceImages: input.references,
      prompt: input.prompt,
      promptType: 'image',
      extractionMode,
      savedAt,
    },
  }
  return { ...asset, subtitle: promptAssetSubtitle(asset) }
}

export function assetDragPayloadToIds(dataTransfer: DataTransfer): string[] {
  const payload = dataTransfer.getData(NOMI_ASSET_DRAG_MIME) || dataTransfer.getData(LEGACY_BROWSER_ASSET_DRAG_MIME)
  if (!payload) return []
  try {
    const parsed = JSON.parse(payload) as Array<{ id?: unknown }>
    if (!Array.isArray(parsed)) return []
    return parsed.map((asset) => (typeof asset.id === 'string' ? asset.id : '')).filter(Boolean)
  } catch {
    return []
  }
}
