import type { CSSProperties } from 'react'
import type { DesktopAssetDto } from '../../../desktop/bridge'
import type { BrowserAssetCanvasImportItem } from '../overlay/globalAssetPopoverEvents'
import type { NomiBrowserAsset } from '../assets/browserAssetData'
import type { BrowserPromptExtractionMode } from '../prompt/browserPromptExtraction'
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

/** 托盘=图/视频捕捞收件箱：本地拖入只认媒体文件，其余（文本等）走素材库上传。 */
export function assetTypeFromFile(file: File): NomiBrowserAsset['type'] | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  const name = file.name.toLowerCase()
  if (/\.(png|jpe?g|webp|gif|avif)$/.test(name)) return 'image'
  if (/\.(mp4|webm|mov|m4v)$/.test(name)) return 'video'
  return null
}

export function contentTypeFromFile(file: File): string {
  if (file.type) return file.type
  const name = file.name.toLowerCase()
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
  const explicitTime = Math.max(parseAssetTime(asset.updatedAt), parseAssetTime(asset.createdAt))
  if (explicitTime > 0) return explicitTime
  const idTime = asset.id.match(/\d{12,}/)?.[0]
  return idTime ? Number(idTime) : 0
}

export function browserAssetDisplaySubtitle(asset: NomiBrowserAsset): string {
  const concreteSubtitle = asset.subtitle?.trim()
  if (asset.status === 'loading') return '下载中...'
  if (asset.status === 'error') return concreteSubtitle || '下载失败'
  if (concreteSubtitle) return concreteSubtitle
  return asset.type === 'image' ? '图片' : '视频'
}

export function isBrowserAssetDraggable(asset: NomiBrowserAsset): boolean {
  return asset.status !== 'loading' && asset.status !== 'error'
}

// 结构化错误码（主进程 [nomi-capture:<code>] 前缀）→ 文案 + 唯一下一步。
// 每种失败必须映射到一个可行动动作（2026-07-22 审计 P1：通用「请重试」让用户重复必败动作）。
const CAPTURE_ERROR_CODE_MESSAGES: Record<string, string> = {
  'forbidden': '网站拒绝了下载（可能要登录）——先在浏览器里登录该网站再捕捞',
  'not-found': '素材链接已失效——回到页面重新选一次',
  'html-not-media': '网站返回的是网页而不是图片/视频（防盗链或人机验证）——通过验证后重试',
  'too-large': '素材超过 200MB 上限——换小一点的素材',
  'timeout': '下载超时——网络慢或站点限流，稍后重试',
  'blocked-by-client': '请求被浏览器安全策略拦截——重新捕捞一次',
  'mse-stream': '这是流媒体视频（边播边传），没有可下载的原件——回到视频页让画面可见后重试保存当前帧',
  'black-frame': '视频当前是黑屏/无画面——先在页面里播放到有清晰画面的一帧，再保存当前帧',
  'network': '网络连接失败——检查网络后重试',
}

export function browserAssetImportErrorMessage(reason: string, url: string): string {
  // 不锚行首：渲染层拿到的是 IPC 包裹后的 message（Error invoking remote method …: Error: [nomi-capture:…]）。
  const code = /\[nomi-capture:([a-z-]+)\]/i.exec(reason)?.[1]?.toLowerCase()
  if (code && CAPTURE_ERROR_CODE_MESSAGES[code]) return CAPTURE_ERROR_CODE_MESSAGES[code]
  // 旧构建/渲染层自产错误没有 code——按字符串归类（保留旧口径）。
  if (/来源页面会话|source page session/i.test(reason)) return '来源网页已关闭，请重新拖入'
  if (/timed out|超时/i.test(reason)) return '下载超时，请重试'
  if (/HTTP\s*(401|403)|forbidden|hotlink|referer/i.test(reason)) return '网站拒绝下载（可能需要登录）'
  if (/HTTP\s*(404|410)/i.test(reason)) return '网页素材已失效'
  if (/不是图片或视频|not supported media|media type/i.test(reason)) return '网站返回的不是图片或视频'
  if (/too large|200\s*MiB|超过.*MB/i.test(reason)) return '素材超过 200MB'
  if (/^blob:/i.test(url)) return '网页临时资源已失效'
  return '下载失败，请重试'
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
  return null
}

// 素材卡副标题（曾是三处 mapper 的共享单源；mapper 收敛成一份后回归本文件私有）。
function browserAssetSubtitleFromDesktopAsset(asset: DesktopAssetDto): string {
  const kind = typeof asset.data.kind === 'string' ? asset.data.kind : ''
  if (kind === 'browser-capture') {
    // 来源质量诚实标注（审计 L4）：页面截图/视频当前帧不冒充原图——后续模型也据此知道输入质量。
    const quality = typeof asset.data.captureQuality === 'string' ? asset.data.captureQuality : ''
    if (quality === 'screenshot') return '页面截图'
    if (quality === 'frame') return '视频当前帧'
    // 动图（GIF/动画 WebP）诚实标注为「动态图」，不笼统当静态「网页原图」（后续用户/模型据此知道是动态参考）。
    if (asset.data.animated === true) return '动态图'
    return '网页原图'
  }
  if (kind === 'browser-upload') return '本地导入'
  if (kind === 'upload') return '本地导入'
  return '项目素材'
}

/**
 * DesktopAssetDto → 托盘素材的唯一映射（此前 dialog/overlay 各持一份平行版，已收敛到这一份）。
 * 显示名优先用网页捕捞时抓到的人类标题(alt/title/文档标题，落在 sidecar.title)，
 * 其次调用方兜底标题（捕捞传入 title/fileName），再退原始文件名——
 * 防盗链图的 URL 文件名常是哈希(263fcbf8…)，直接当名字没法认(用户 2026-07-13 抓出)。
 */
export function browserAssetFromDesktopAsset(asset: DesktopAssetDto, fallbackTitle?: string): NomiBrowserAsset | null {
  if (asset.name.endsWith('.meta')) return null
  const type = assetTypeFromDesktopAsset(asset)
  if (!type) return null
  const url = typeof asset.data.url === 'string' ? asset.data.url : ''
  const relativePath = typeof asset.data.relativePath === 'string' ? asset.data.relativePath : undefined
  const subtitle = browserAssetSubtitleFromDesktopAsset(asset)
  const sidecarTitle = typeof asset.data.title === 'string' ? asset.data.title.trim() : ''
  return {
    id: asset.id,
    type,
    source: 'my',
    title: sidecarTitle || fallbackTitle?.trim() || asset.name || (type === 'video' ? '项目视频' : '项目图片'),
    subtitle,
    previewUrl: url || undefined,
    previewMediaType: type,
    relativePath,
    tags: [subtitle],
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  }
}

export function browserAssetUrlKey(asset: NomiBrowserAsset): string {
  return asset.previewUrl || ''
}

export function browserAssetToCanvasImportItem(asset: NomiBrowserAsset): BrowserAssetCanvasImportItem | null {
  if (asset.status === 'loading' || asset.status === 'error') return null
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

function mediaUrlFromHtml(html: string): { url: string; title?: string; mediaType: 'image' | 'video' } | null {
  if (!html.trim()) return null
  if (typeof DOMParser === 'undefined') {
    const videoTag = html.match(/<video\b[^>]*>/i)?.[0] || ''
    const posterUrl = videoTag.match(/\bposter\s*=\s*["']([^"']+)["']/i)?.[1] || ''
    const title = videoTag.match(/\btitle\s*=\s*["']([^"']+)["']/i)?.[1] || undefined
    return posterUrl ? { url: posterUrl, title, mediaType: 'image' } : null
  }
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const image = doc.querySelector('img')
    const imageUrl = image?.getAttribute('src') || image?.getAttribute('data-src') || ''
    if (imageUrl) return { url: imageUrl, title: image?.getAttribute('alt') || image?.getAttribute('title') || undefined, mediaType: 'image' }
    const video = doc.querySelector('video')
    const videoUrl = video?.getAttribute('src') || video?.querySelector('source')?.getAttribute('src') || ''
    if (videoUrl) return { url: videoUrl, title: video?.getAttribute('title') || undefined, mediaType: 'video' }
    const posterUrl = video?.getAttribute('poster') || ''
    return posterUrl ? { url: posterUrl, title: video?.getAttribute('title') || undefined, mediaType: 'image' } : null
  } catch {
    return null
  }
}

function mediaTypeFromRemoteUrl(url: string): 'image' | 'video' {
  return /\.(?:mp4|m4v|mov|webm|ogv|ogg|avi)(?:[?#]|$)/i.test(url) ? 'video' : 'image'
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
      const parsed = JSON.parse(customPayload) as { url?: unknown; title?: unknown; mediaType?: unknown }
      const url = typeof parsed.url === 'string' ? parsed.url.trim() : ''
      if (url) {
        const mediaType = parsed.mediaType === 'video' || parsed.mediaType === 'image'
          ? parsed.mediaType
          : mediaTypeFromRemoteUrl(url)
        return { url, title: typeof parsed.title === 'string' ? parsed.title.trim() || undefined : undefined, fileName: fileNameFromRemoteAssetUrl(url), mediaType }
      }
    } catch {
      // Ignore malformed drag payloads and fall back to standard browser data.
    }
  }
  const uriListUrl = firstUsableImageUrlFromText(dataTransfer.getData('text/uri-list'))
  if (uriListUrl) return { url: uriListUrl, fileName: fileNameFromRemoteAssetUrl(uriListUrl), mediaType: mediaTypeFromRemoteUrl(uriListUrl) }
  const htmlMedia = mediaUrlFromHtml(dataTransfer.getData('text/html'))
  if (htmlMedia) return { ...htmlMedia, fileName: fileNameFromRemoteAssetUrl(htmlMedia.url) }
  const plainUrl = firstUsableImageUrlFromText(dataTransfer.getData('text/plain'))
  return plainUrl ? { url: plainUrl, fileName: fileNameFromRemoteAssetUrl(plainUrl), mediaType: mediaTypeFromRemoteUrl(plainUrl) } : null
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
