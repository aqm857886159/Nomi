/* eslint-disable react-refresh/only-export-components */
import React from 'react'
import { IconBrowser, IconBrush, IconPalette, IconWorld } from '../../../vendor/tablerIcons'
import type { DesktopAssetDto, DesktopBrowserAssetOverlayCaptureRequest, DesktopBrowserPromptCaptureEvent, DesktopBrowserResourceCaptureEvent, DesktopBrowserViewBounds } from '../../../desktop/bridge'
import { cn } from '../../../utils/cn'
import { BROWSER_PROMPT_EXTRACTION_MODE_LABELS, type BrowserPromptExtractionMode } from '../prompt/browserPromptExtraction'
import type { NomiBrowserAsset } from '../assets/browserAssetData'
import type { BrowserAssetPromptCaptureRequest } from '../popover/NomiBrowserAssetPopover'
import type { FloatingWindowBoundsRect } from '../window/useResizableFloatingWindow'

export type NomiBrowserDialogProps = {
  opened: boolean
  onClose: () => void
}

export type BrowserTab = {
  id: string
  viewId: number | null
  title: string
  url: string
  favicon?: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

export type BrowserBookmark = {
  id: string
  title: string
  url: string
  favicon?: string
  createdAt: number
}

export type BrowserTabContextMenu = {
  tabId: string
  x: number
  y: number
}

export type BrowserBookmarkContextMenu = {
  bookmarkId: string
  x: number
  y: number
}

export type BrowserPromptModePickerState = {
  x: number
  y: number
  tab: BrowserTab
}

export type ViewportRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type BrowserCaptureFlyoutRect = {
  left: number
  top: number
  width: number
  height: number
}

export type BrowserCaptureFlyout = {
  id: string
  url: string
  mediaType: 'image' | 'video'
  sourceRect: BrowserCaptureFlyoutRect
  targetRect: BrowserCaptureFlyoutRect
}

export const TAB_LIMIT = 30
export const BOOKMARKS_STORAGE_KEY = 'nomi.browser.bookmarks.v1'
export const CAPTURE_FLYOUT_MAX_WIDTH = 220
export const CAPTURE_FLYOUT_MAX_HEIGHT = 160
export const CAPTURE_FLYOUT_TARGET_WIDTH = 96
export const CAPTURE_FLYOUT_KEYFRAME_TIMES = [0, 0.18, 1]
export const BROWSER_VIEW_POPOVER_GAP = 10
export const BROWSER_ASSET_POPOVER_FALLBACK_WIDTH = 520
export const BROWSER_ASSET_POPOVER_FALLBACK_HEIGHT = 620
export const BROWSER_ASSET_POPOVER_FALLBACK_MARGIN = 18
export const PROMPT_MODE_PICKER_WIDTH = 224
export const PROMPT_MODE_PICKER_MARGIN = 8
export const PROMPT_MODE_PICKER_ESTIMATED_HEIGHT = 142
export const USE_NATIVE_BROWSER_ASSET_OVERLAY = true

export const DEFAULT_BOOKMARKS: BrowserBookmark[] = [
  {
    id: 'default-nomi',
    title: 'Nomi 官网',
    url: 'http://nomiaqm.com/',
    createdAt: 1,
  },
]

export const MATERIAL_SITE_SHORTCUTS = [
  { name: 'pinterest', url: 'https://www.pinterest.com/' },
  { name: 'film-grab', url: 'https://film-grab.com/' },
  { name: 'genery', url: 'https://genery.io/' },
  { name: 'behance', url: 'https://www.behance.net/' },
] as const

// 创作参考类快捷站点——空态页网格。8 张卡是最舒服的 4×2 密度：太少显得空，太多变站点堆。
export const BROWSER_START_SHORTCUTS = [
  { label: 'Pinterest', url: 'https://www.pinterest.com/', hint: '视觉灵感' },
  { label: 'Behance', url: 'https://www.behance.net/', hint: '设计作品集' },
  { label: 'Dribbble', url: 'https://dribbble.com/', hint: 'UI 灵感' },
  { label: 'ArtStation', url: 'https://www.artstation.com/', hint: '概念美术' },
  { label: '小红书', url: 'https://www.xiaohongshu.com/', hint: '中文种草' },
  { label: 'YouTube', url: 'https://www.youtube.com/', hint: '视频参考' },
  { label: 'Film Grab', url: 'https://film-grab.com/', hint: '电影分镜' },
  { label: 'X', url: 'https://x.com/', hint: '创作者动态' },
] as const

export const TOOL_BUTTON_CLASS = cn(
  'inline-grid size-8 shrink-0 place-items-center rounded-nomi-sm border-0 bg-transparent',
  'cursor-pointer text-nomi-ink-60 transition-[background,color] duration-[var(--nomi-transition-fast)]',
  'hover:bg-nomi-ink-05 hover:text-nomi-ink disabled:cursor-default disabled:text-nomi-ink-20 disabled:hover:bg-transparent',
)

export const TAB_CONTEXT_MENU_WIDTH = 176
export const TAB_CONTEXT_MENU_MARGIN = 8
export const TAB_CONTEXT_MENU_ITEM_CLASS = cn(
  'flex h-9 w-full items-center gap-2 rounded-nomi-sm border-0 bg-transparent px-2.5 text-left',
  'cursor-pointer text-body-sm text-nomi-ink transition-[background,color] duration-[var(--nomi-transition-fast)]',
  'hover:bg-nomi-ink-05 disabled:cursor-default disabled:text-nomi-ink-30 disabled:hover:bg-transparent',
)

export const BROWSER_DIALOG_TOP_ANCHOR_SELECTORS = ['.workbench-windowbar', '.nomi-library-page__windowbar']

export function createTabId(): string {
  return `browser-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createBlankTab(): BrowserTab {
  return {
    id: createTabId(),
    viewId: null,
    title: '新建标签页',
    url: '',
    canGoBack: false,
    canGoForward: false,
    loading: false,
  }
}

export function readBookmarks(): BrowserBookmark[] {
  if (typeof window === 'undefined') return DEFAULT_BOOKMARKS
  try {
    const raw = window.localStorage.getItem(BOOKMARKS_STORAGE_KEY)
    if (!raw) return DEFAULT_BOOKMARKS
    const parsed = JSON.parse(raw) as BrowserBookmark[]
    if (!Array.isArray(parsed)) return DEFAULT_BOOKMARKS
    return parsed.filter(
      (bookmark) => bookmark && typeof bookmark.url === 'string' && typeof bookmark.title === 'string',
    )
  } catch {
    return DEFAULT_BOOKMARKS
  }
}

export function writeBookmarks(bookmarks: BrowserBookmark[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(bookmarks))
}

export function clampTabContextMenuPosition(x: number, y: number, itemCount: number): { x: number; y: number } {
  if (typeof window === 'undefined') return { x, y }
  const estimatedHeight = tabContextMenuEstimatedHeight(itemCount)
  return {
    x: Math.min(
      Math.max(TAB_CONTEXT_MENU_MARGIN, x),
      window.innerWidth - TAB_CONTEXT_MENU_WIDTH - TAB_CONTEXT_MENU_MARGIN,
    ),
    y: Math.min(Math.max(TAB_CONTEXT_MENU_MARGIN, y), window.innerHeight - estimatedHeight - TAB_CONTEXT_MENU_MARGIN),
  }
}

export function tabContextMenuEstimatedHeight(itemCount: number): number {
  return itemCount * 36 + 16 + (itemCount > 2 ? 9 : 0)
}

export function toViewportRect(rect: DOMRect): ViewportRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

export function browserBoundsFromRect(rect: ViewportRect): DesktopBrowserViewBounds {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  }
}

export function sameBrowserViewBounds(
  left: DesktopBrowserViewBounds | null | undefined,
  right: DesktopBrowserViewBounds | null | undefined,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

export function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

export function viewportRectFromEdges(left: number, top: number, right: number, bottom: number): ViewportRect | null {
  const width = Math.max(0, right - left)
  const height = Math.max(0, bottom - top)
  if (width < 1 || height < 1) return null
  return { left, top, right, bottom, width, height }
}

export function intersectViewportRects(
  left: ViewportRect,
  right: Pick<ViewportRect, 'left' | 'top' | 'right' | 'bottom'>,
): ViewportRect | null {
  return viewportRectFromEdges(
    Math.max(left.left, right.left),
    Math.max(left.top, right.top),
    Math.min(left.right, right.right),
    Math.min(left.bottom, right.bottom),
  )
}

export function createFallbackAssetPopoverRect(containerRect: ViewportRect): FloatingWindowBoundsRect {
  const width = Math.min(
    BROWSER_ASSET_POPOVER_FALLBACK_WIDTH,
    Math.max(1, containerRect.width - BROWSER_ASSET_POPOVER_FALLBACK_MARGIN * 2),
  )
  const height = Math.min(
    BROWSER_ASSET_POPOVER_FALLBACK_HEIGHT,
    Math.max(1, containerRect.height - BROWSER_ASSET_POPOVER_FALLBACK_MARGIN * 2),
  )
  const left = clampNumber(
    containerRect.right - width - BROWSER_ASSET_POPOVER_FALLBACK_MARGIN,
    containerRect.left,
    containerRect.right - width,
  )
  const top = clampNumber(
    containerRect.top + BROWSER_ASSET_POPOVER_FALLBACK_MARGIN,
    containerRect.top,
    containerRect.bottom - height,
  )
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  }
}

export function browserViewRectAroundPopover(
  containerRect: ViewportRect,
  popoverRect: FloatingWindowBoundsRect | null,
  gap = BROWSER_VIEW_POPOVER_GAP,
): ViewportRect | null {
  if (!popoverRect) return containerRect
  const intersection = intersectViewportRects(containerRect, popoverRect)
  if (!intersection) return containerRect

  const candidates = [
    viewportRectFromEdges(containerRect.left, containerRect.top, intersection.left - gap, containerRect.bottom),
    viewportRectFromEdges(intersection.right + gap, containerRect.top, containerRect.right, containerRect.bottom),
    viewportRectFromEdges(containerRect.left, containerRect.top, containerRect.right, intersection.top - gap),
    viewportRectFromEdges(containerRect.left, intersection.bottom + gap, containerRect.right, containerRect.bottom),
  ].filter((rect): rect is ViewportRect => Boolean(rect))

  if (candidates.length === 0) return null
  return candidates.reduce((best, candidate) =>
    candidate.width * candidate.height > best.width * best.height ? candidate : best,
  )
}

export function measureBrowserDialogTopOffset(): number {
  if (typeof document === 'undefined') return 0
  for (const selector of BROWSER_DIALOG_TOP_ANCHOR_SELECTORS) {
    const node = document.querySelector(selector)
    if (!(node instanceof HTMLElement)) continue
    const rect = node.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return Math.max(0, Math.round(rect.bottom))
  }
  return 0
}

export function fitCaptureFlyoutSourceRect(rect: BrowserCaptureFlyoutRect): BrowserCaptureFlyoutRect {
  const width = Math.max(24, rect.width)
  const height = Math.max(24, rect.height)
  const scale = Math.min(1, CAPTURE_FLYOUT_MAX_WIDTH / width, CAPTURE_FLYOUT_MAX_HEIGHT / height)
  const nextWidth = Math.round(width * scale)
  const nextHeight = Math.round(height * scale)
  return {
    left: Math.round(rect.left + (width - nextWidth) / 2),
    top: Math.round(rect.top + (height - nextHeight) / 2),
    width: nextWidth,
    height: nextHeight,
  }
}

export function fallbackCaptureFlyoutSourceRect(node: HTMLElement | null): BrowserCaptureFlyoutRect | null {
  if (!node) return null
  const rect = node.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const width = Math.min(120, Math.max(72, rect.width * 0.18))
  const height = Math.round(width * 0.64)
  return {
    left: Math.round(rect.left + rect.width / 2 - width / 2),
    top: Math.round(rect.top + rect.height / 2 - height / 2),
    width: Math.round(width),
    height,
  }
}

export function captureFlyoutTargetRectFromPopover(rect: FloatingWindowBoundsRect | null): BrowserCaptureFlyoutRect | null {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  const width = Math.round(clampNumber(CAPTURE_FLYOUT_TARGET_WIDTH, 52, Math.max(52, rect.width - 32)))
  const height = Math.round(width * 0.64)
  const left = Math.round(rect.left + clampNumber(rect.width * 0.08, 12, 28))
  const preferredTop = rect.top + clampNumber(rect.height * 0.3, 94, 132)
  const top = Math.round(clampNumber(preferredTop, rect.top + 64, rect.bottom - height - 14))
  return { left, top, width, height }
}

export function captureFlyoutScale(source: BrowserCaptureFlyoutRect, target: BrowserCaptureFlyoutRect): number {
  const sourceWidth = Math.max(1, source.width)
  return Math.max(0.66, Math.min(0.92, target.width / sourceWidth))
}

export function sameBoundsRect(left: FloatingWindowBoundsRect | null, right: FloatingWindowBoundsRect | null): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return (
    Math.round(left.left) === Math.round(right.left) &&
    Math.round(left.top) === Math.round(right.top) &&
    Math.round(left.right) === Math.round(right.right) &&
    Math.round(left.bottom) === Math.round(right.bottom) &&
    Math.round(left.width) === Math.round(right.width) &&
    Math.round(left.height) === Math.round(right.height)
  )
}

export function canDownloadFromBrowserView(url: string): boolean {
  return /^(https?:\/\/|blob:)/i.test(url)
}

export function faviconForTab(tab: BrowserTab): JSX.Element {
  // 应用 CSP img-src 只放行 https:/data:/blob:——http 站的 favicon 加载会被拦并刷 console 错，
  // 干脆不发起请求，直接回退世界图标。
  if (tab.favicon && /^(https:|data:|blob:)/i.test(tab.favicon)) {
    return <img src={tab.favicon} alt="" className="size-4 rounded-nomi-sm" draggable={false} />
  }
  if (!tab.url) return <IconBrowser size={15} stroke={1.7} aria-hidden="true" />
  return <IconWorld size={15} stroke={1.7} aria-hidden="true" />
}

export function browserAssetFromDesktopAsset(asset: DesktopAssetDto, fallbackTitle: string): NomiBrowserAsset {
  const contentType = typeof asset.data.contentType === 'string' ? asset.data.contentType : ''
  const mediaType = asset.data.mediaType === 'video' || contentType.startsWith('video/') ? 'video' : 'image'
  const url = typeof asset.data.url === 'string' ? asset.data.url : ''
  // 显示名人类标题优先(sidecar.title=捕捞时抓的 alt/网页标题 → 捕捞传入 title → 文件名)。
  // 防盗链图 URL 文件名常是哈希，直接当名字认不出(用户 2026-07-13 抓出 263fcbf8…)。
  const sidecarTitle = typeof asset.data.title === 'string' ? asset.data.title.trim() : ''
  return {
    id: asset.id,
    type: mediaType,
    source: 'my',
    title: sidecarTitle || fallbackTitle || asset.name || '网页图片',
    subtitle: '网页素材',
    previewUrl: url,
    tags: ['网页素材'],
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  }
}

export function overlayCaptureRequestFromBrowserEvent(
  event: Extract<DesktopBrowserResourceCaptureEvent, { ok: true }>,
): DesktopBrowserAssetOverlayCaptureRequest {
  return {
    requestId: `browser-capture-${event.viewId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url: event.url,
    mediaType: event.mediaType,
    title: event.title || event.pageTitle || undefined,
    fileName: event.fileName || undefined,
    sourceRect: event.sourceRect,
  }
}

export function promptCaptureRequestFromBrowserEvent(
  event: Extract<DesktopBrowserPromptCaptureEvent, { ok: true }>,
): BrowserAssetPromptCaptureRequest {
  return {
    requestId: `browser-prompt-image-${event.viewId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceType: 'image',
    extractionMode: event.extractionMode === 'style' ? 'style' : 'replicate',
    viewId: event.viewId,
    sourceUrl: event.url,
    title: event.title || event.pageTitle || '网页图片提示词',
    fileName: event.fileName || undefined,
    pageUrl: event.pageUrl || undefined,
    pageTitle: event.pageTitle || undefined,
    referenceImages: [
      {
        url: event.url,
        title: event.title || event.pageTitle || undefined,
        sourceUrl: event.url,
      },
    ],
  }
}

export function PromptModeOption({
  mode,
  onSelect,
}: {
  mode: BrowserPromptExtractionMode
  onSelect: (mode: BrowserPromptExtractionMode) => void
}): JSX.Element {
  const styleMode = mode === 'style'
  const Icon = styleMode ? IconPalette : IconBrush
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-start gap-2 rounded-nomi-sm border-0 bg-transparent p-2 text-left text-caption text-nomi-ink-70 transition-colors hover:bg-nomi-ink-05 hover:text-nomi-ink"
      role="menuitem"
      onClick={() => onSelect(mode)}
    >
      <span
        className={cn(
          'mt-0.5 grid size-7 shrink-0 place-items-center rounded-pill',
          styleMode ? 'bg-nomi-accent-soft text-nomi-accent' : 'bg-nomi-ink-05 text-nomi-ink-65',
        )}
      >
        <Icon size={15} stroke={1.8} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-[1.25] text-nomi-ink">
          {BROWSER_PROMPT_EXTRACTION_MODE_LABELS[mode]}
        </span>
        <span className="mt-0.5 block text-micro leading-snug text-nomi-ink-45">
          {styleMode ? '提取配色、字体、构图、效果 JSON' : '还原主体、构图、光影和细节'}
        </span>
      </span>
    </button>
  )
}

