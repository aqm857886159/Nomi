import { toast } from '../../../ui/toast'
import {
  hostedAssetUrl,
  importWorkbenchLocalAssetFile,
  importWorkbenchRemoteAssetUrl,
  recoverImportedWorkbenchLocalAssetFile,
  type WorkbenchAssetDto,
} from '../../api/assetUploadApi'
import { dataUrlToFile } from './persistNodeImage'
import {
  importLocalMediaFilesToGenerationCanvas,
  type GenerationAssetImportResult,
  type ImportImageFilesOptions,
} from './assetImportAdapter'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

const IMAGE_URL_EXTENSION = /\.(?:png|jpe?g|webp|gif|avif|bmp|svg)(?:[?#].*)?$/i
const VIDEO_URL_EXTENSION = /\.(?:mp4|m4v|mov|webm|ogv|ogg|avi)(?:[?#].*)?$/i
const MIME_EXTENSION: Record<string, string> = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-m4v': 'm4v',
  'video/x-msvideo': 'avi',
}

type ClipboardTextSource = 'html' | 'uri-list' | 'plain'
type ClipboardMediaKind = 'image' | 'video'

type ClipboardMediaUrlCandidate = {
  url: string
  kind: ClipboardMediaKind | null
  trustAsMedia: boolean
  source: ClipboardTextSource
}

export type ClipboardMediaPasteOptions = {
  basePosition: { x: number; y: number }
  categoryId?: string
  clipboardData?: DataTransfer | null
  fetchMedia?: typeof fetch
  fetchImage?: typeof fetch
  importRemoteUrl?: (url: string, fileName: string) => Promise<WorkbenchAssetDto | null>
  importOptions?: Partial<ImportImageFilesOptions>
}

export type ClipboardImagePasteOptions = ClipboardMediaPasteOptions

export type ClipboardMediaPasteResult = {
  handled: boolean
  importedCount: number
  failedCount: number
  skippedTooLargeCount: number
  skippedOverLimitCount: number
  usedExternalUrl: boolean
}

export type ClipboardImagePasteResult = ClipboardMediaPasteResult

function emptyResult(handled = false): ClipboardMediaPasteResult {
  return {
    handled,
    importedCount: 0,
    failedCount: 0,
    skippedTooLargeCount: 0,
    skippedOverLimitCount: 0,
    usedExternalUrl: false,
  }
}

function fileKey(file: File): string {
  return [file.name || '', file.type || '', file.size || 0, file.lastModified || 0].join('|')
}

function mediaKindFromMime(type: string | undefined | null): ClipboardMediaKind | null {
  if (!type) return null
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  return null
}

function isMediaFile(file: File | null | undefined): file is File {
  return Boolean(file && mediaKindFromMime(file.type))
}

export function extractClipboardMediaFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return []
  const files: File[] = []
  const seen = new Set<string>()
  const add = (file: File | null | undefined) => {
    if (!isMediaFile(file)) return
    const key = fileKey(file)
    if (seen.has(key)) return
    seen.add(key)
    files.push(file)
  }
  Array.from(data.files || []).forEach(add)
  Array.from(data.items || []).forEach((item) => {
    if (item.kind !== 'file' || !mediaKindFromMime(item.type)) return
    add(item.getAsFile())
  })
  return files
}

export const extractClipboardImageFiles = extractClipboardMediaFiles

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function readAttribute(tag: string, attribute: string): string {
  const match = new RegExp(`${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return decodeHtmlAttribute((match?.[1] || match?.[2] || match?.[3] || '').trim())
}

function firstSrcsetUrl(srcset: string): string {
  const first = srcset.split(',').map((item) => item.trim()).find(Boolean) || ''
  return first.split(/\s+/)[0] || ''
}

function normalizeClipboardUrl(value: string): string {
  return value.trim().replace(/^["'<(]+|[>"')]+$/g, '')
}

function isDataImageUrl(url: string): boolean {
  return /^data:image\//i.test(url)
}

function isDataMediaUrl(url: string): boolean {
  return /^data:(?:image|video)\//i.test(url)
}

function isRemoteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function isFileUrl(url: string): boolean {
  return /^file:\/\//i.test(url)
}

function mediaKindFromUrl(url: string): ClipboardMediaKind | null {
  if (isDataImageUrl(url) || IMAGE_URL_EXTENSION.test(url)) return 'image'
  if (/^data:video\//i.test(url) || VIDEO_URL_EXTENSION.test(url)) return 'video'
  return null
}

function isDirectDisplayMediaUrl(url: string): boolean {
  return (
    isDataMediaUrl(url) ||
    ((/^nomi-local:\/\//i.test(url) || isRemoteUrl(url) || isFileUrl(url)) && Boolean(mediaKindFromUrl(url)))
  )
}

function isSupportedClipboardMediaUrl(url: string): boolean {
  return isDataMediaUrl(url) || /^nomi-local:\/\//i.test(url) || isRemoteUrl(url) || isFileUrl(url)
}

function extractHtmlMediaCandidate(html: string): Pick<ClipboardMediaUrlCandidate, 'kind' | 'url'> | null {
  const imgTags = html.match(/<img\b[^>]*>/gi) || []
  for (const tag of imgTags) {
    const src = normalizeClipboardUrl(readAttribute(tag, 'src'))
    if (src) return { kind: 'image', url: src }
    const srcset = firstSrcsetUrl(readAttribute(tag, 'srcset'))
    if (srcset) return { kind: 'image', url: normalizeClipboardUrl(srcset) }
  }

  const videoTags = html.match(/<video\b[^>]*>/gi) || []
  for (const tag of videoTags) {
    const src = normalizeClipboardUrl(readAttribute(tag, 'src'))
    if (src) return { kind: 'video', url: src }
  }

  const sourceTags = html.match(/<source\b[^>]*>/gi) || []
  for (const tag of sourceTags) {
    const src = normalizeClipboardUrl(readAttribute(tag, 'src'))
    if (!src) continue
    const type = readAttribute(tag, 'type').toLowerCase()
    const kind = mediaKindFromMime(type) || mediaKindFromUrl(src)
    if (kind) return { kind, url: src }
  }

  return null
}

function firstUriListUrl(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#')) || ''
}

export function extractClipboardMediaUrl(data: DataTransfer | null | undefined): ClipboardMediaUrlCandidate | null {
  if (!data) return null
  const htmlCandidate = extractHtmlMediaCandidate(data.getData('text/html') || '')
  const htmlUrl = normalizeClipboardUrl(htmlCandidate?.url || '')
  if (htmlUrl && htmlCandidate && isSupportedClipboardMediaUrl(htmlUrl)) {
    return { url: htmlUrl, kind: htmlCandidate.kind, trustAsMedia: true, source: 'html' }
  }

  const uriListUrl = normalizeClipboardUrl(firstUriListUrl(data.getData('text/uri-list') || ''))
  if (uriListUrl && isDirectDisplayMediaUrl(uriListUrl)) {
    return { url: uriListUrl, kind: mediaKindFromUrl(uriListUrl), trustAsMedia: true, source: 'uri-list' }
  }

  const plainUrl = normalizeClipboardUrl((data.getData('text/plain') || '').split(/\s+/)[0] || '')
  if (!plainUrl) return null
  const kind = mediaKindFromUrl(plainUrl)
  const trustAsMedia = isDirectDisplayMediaUrl(plainUrl)
  if (trustAsMedia || isRemoteUrl(plainUrl)) return { url: plainUrl, kind, trustAsMedia, source: 'plain' }
  return null
}

export const extractClipboardImageUrl = extractClipboardMediaUrl

function extensionForMime(type: string): string {
  return MIME_EXTENSION[type.toLowerCase()] || 'bin'
}

function fallbackMimeForKind(kind: ClipboardMediaKind | null): string {
  if (kind === 'video') return 'video/mp4'
  if (kind === 'image') return 'image/png'
  return 'application/octet-stream'
}

function contentTypeFromDataUrl(url: string): string {
  return (/^data:([^;,]*?)(?:;base64)?,/i.exec(url)?.[1] || '').toLowerCase()
}

function fileNameFromMediaUrl(url: string, type: string, fallbackKind: ClipboardMediaKind | null = null): string {
  try {
    const parsed = new URL(url)
    const segment = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '')
    const clean = segment.replace(/[?#].*$/, '').trim()
    if (clean && /\.[a-z0-9]{2,5}$/i.test(clean)) return clean
  } catch {
    /* fall through */
  }
  const kind = mediaKindFromMime(type) || fallbackKind
  const label = kind || 'media'
  return `clipboard-${label}.${extensionForMime(type)}`
}

async function mediaUrlToFile(
  url: string,
  fetchMedia: typeof fetch,
  fallbackKind: ClipboardMediaKind | null,
): Promise<File | null> {
  if (isDataMediaUrl(url)) {
    const type = contentTypeFromDataUrl(url) || fallbackMimeForKind(fallbackKind)
    const kind = mediaKindFromMime(type) || fallbackKind || mediaKindFromUrl(url)
    if (!kind) return null
    return dataUrlToFile(url, fileNameFromMediaUrl(url, type, kind))
  }
  if (!isRemoteUrl(url)) return null
  const response = await fetchMedia(url)
  if (!response.ok) return null
  const blob = await response.blob()
  const type = blob.type || response.headers.get('content-type') || ''
  const kind = mediaKindFromMime(type) || fallbackKind
  if (!kind) return null
  return new File([blob], fileNameFromMediaUrl(url, type || fallbackMimeForKind(kind), kind), { type: type || fallbackMimeForKind(kind) })
}

async function importRemoteMediaUrl(
  url: string,
  options: ClipboardMediaPasteOptions,
  fallbackKind: ClipboardMediaKind | null,
): Promise<WorkbenchAssetDto | null> {
  if (!isRemoteUrl(url)) return null
  const kind = mediaKindFromUrl(url) || fallbackKind
  const fileName = fileNameFromMediaUrl(url, fallbackMimeForKind(kind), kind)
  const importRemoteUrl = options.importRemoteUrl ?? ((remoteUrl: string, name: string) =>
    importWorkbenchRemoteAssetUrl(remoteUrl, name))
  return importRemoteUrl(url, fileName)
}

function resultFromImport(result: GenerationAssetImportResult): ClipboardMediaPasteResult {
  return {
    handled: true,
    importedCount: result.created.length,
    failedCount: result.failedCount,
    skippedTooLargeCount: result.skippedTooLargeCount,
    skippedOverLimitCount: result.skippedOverLimitCount,
    usedExternalUrl: false,
  }
}

async function importMediaFiles(files: File[], options: ClipboardMediaPasteOptions): Promise<ClipboardMediaPasteResult> {
  const result = await importLocalMediaFilesToGenerationCanvas(files, {
    basePosition: options.basePosition,
    categoryId: options.categoryId,
    ...options.importOptions,
    exactPosition: options.importOptions?.exactPosition ?? true,
  })
  return resultFromImport(result)
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const segment = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '').replace(/\.[^.]+$/, '')
    return segment.trim() || parsed.hostname || '网页媒体'
  } catch {
    return '网页媒体'
  }
}

function kindFromAsset(asset: WorkbenchAssetDto | null | undefined, url: string, fallback: ClipboardMediaKind | null): ClipboardMediaKind | null {
  const contentType = typeof asset?.data?.contentType === 'string' ? asset.data.contentType : ''
  return mediaKindFromMime(contentType) || mediaKindFromUrl(url) || mediaKindFromUrl(hostedAssetUrl(asset)) || fallback
}

function createClipboardMediaNodeShell(input: {
  options: ClipboardMediaPasteOptions
  titleUrl: string
}): string {
  const { options, titleUrl } = input
  const store = useGenerationCanvasStore.getState()
  const node = store.addNode({
    kind: 'asset',
    title: titleFromUrl(titleUrl),
    prompt: '',
    position: {
      x: Math.round(options.basePosition.x),
      y: Math.round(options.basePosition.y),
    },
    categoryId: options.categoryId,
    exactPosition: true,
  })
  return node.id
}

function updateClipboardMediaNodeSuccess(input: {
  nodeId: string
  kind: ClipboardMediaKind
  url: string
  providerUrl?: string
  asset?: WorkbenchAssetDto | null
  usedExternalUrl: boolean
}): void {
  const { asset, kind, nodeId, providerUrl, url, usedExternalUrl } = input
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((candidate) => candidate.id === nodeId)
  const result = {
    id: `clipboard-url-${nodeId}-${Date.now()}`,
    type: kind,
    url,
    providerUrl,
    assetId: asset?.id,
    raw: asset ? { asset } : undefined,
    createdAt: Date.now(),
  }
  store.updateNode(nodeId, {
    error: undefined,
    progress: undefined,
    result,
    history: [result],
    status: 'success',
    meta: {
      ...(node?.meta || {}),
      source: 'clipboard-url',
      uploadStatus: usedExternalUrl ? 'external-url' : 'uploaded',
      localOnly: false,
      ...(asset?.data?.contentType ? { contentType: asset.data.contentType } : {}),
    },
  })
}

function createClipboardMediaNode(input: {
  kind: ClipboardMediaKind
  url: string
  options: ClipboardMediaPasteOptions
  providerUrl?: string
  asset?: WorkbenchAssetDto | null
  usedExternalUrl: boolean
}): ClipboardMediaPasteResult {
  const { options, providerUrl, url } = input
  const nodeId = createClipboardMediaNodeShell({ options, titleUrl: providerUrl || url })
  updateClipboardMediaNodeSuccess({ ...input, nodeId })
  return { ...emptyResult(true), importedCount: 1, usedExternalUrl: input.usedExternalUrl }
}

function createPendingClipboardMediaNode(candidate: ClipboardMediaUrlCandidate, options: ClipboardMediaPasteOptions): string {
  const nodeId = createClipboardMediaNodeShell({ options, titleUrl: candidate.url })
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((item) => item.id === nodeId)
  store.updateNode(nodeId, {
    error: undefined,
    progress: {
      phase: 'clipboard-import',
      message: '下载中',
      updatedAt: Date.now(),
    },
    status: 'running',
    meta: {
      ...(node?.meta || {}),
      source: 'clipboard-url',
      sourceUrl: candidate.url,
      uploadStatus: 'uploading',
      localOnly: false,
    },
  })
  return nodeId
}

function updateClipboardMediaNodeError(nodeId: string, message: string): void {
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((candidate) => candidate.id === nodeId)
  store.updateNode(nodeId, {
    error: message,
    progress: undefined,
    status: 'error',
    meta: {
      ...(node?.meta || {}),
      uploadStatus: 'failed',
      localOnly: false,
    },
  })
}

function createExternalMediaUrlNode(candidate: ClipboardMediaUrlCandidate, options: ClipboardMediaPasteOptions): ClipboardMediaPasteResult {
  const kind = candidate.kind
  if (!kind) return emptyResult(false)
  return createClipboardMediaNode({
    kind,
    url: candidate.url,
    options,
    providerUrl: isRemoteUrl(candidate.url) ? candidate.url : undefined,
    usedExternalUrl: true,
  })
}

async function uploadFetchedMediaFileToNode(
  nodeId: string,
  file: File,
  candidate: ClipboardMediaUrlCandidate,
  options: ClipboardMediaPasteOptions,
): Promise<boolean> {
  const kind = mediaKindFromMime(file.type) || candidate.kind || mediaKindFromUrl(file.name)
  if (!kind) return false
  const uploadFile = options.importOptions?.uploadFile ?? importWorkbenchLocalAssetFile
  const recoverFile = options.importOptions?.recoverFile ?? recoverImportedWorkbenchLocalAssetFile
  let asset: WorkbenchAssetDto | null
  try {
    asset = await uploadFile(file, file.name || titleFromUrl(candidate.url), { ownerNodeId: nodeId })
  } catch {
    asset = await recoverFile(file)
  }
  const localUrl = hostedAssetUrl(asset)
  if (!localUrl) return false
  updateClipboardMediaNodeSuccess({
    nodeId,
    kind,
    url: localUrl,
    providerUrl: candidate.url,
    asset,
    usedExternalUrl: false,
  })
  return true
}

async function pasteRemoteClipboardMediaUrl(
  candidate: ClipboardMediaUrlCandidate,
  options: ClipboardMediaPasteOptions,
): Promise<ClipboardMediaPasteResult> {
  const nodeId = createPendingClipboardMediaNode(candidate, options)
  try {
    const asset = await importRemoteMediaUrl(candidate.url, options, candidate.kind)
    const localUrl = hostedAssetUrl(asset)
    const kind = kindFromAsset(asset, candidate.url, candidate.kind)
    if (localUrl && kind) {
      updateClipboardMediaNodeSuccess({
        nodeId,
        kind,
        url: localUrl,
        providerUrl: candidate.url,
        asset,
        usedExternalUrl: false,
      })
      return { ...emptyResult(true), importedCount: 1 }
    }
  } catch {
    /* Desktop remote import may be unavailable in tests/web or blocked by the remote host. */
  }

  const fetchMedia = options.fetchMedia ?? options.fetchImage ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
  if (fetchMedia) {
    try {
      const file = await mediaUrlToFile(candidate.url, fetchMedia, candidate.kind)
      if (file && await uploadFetchedMediaFileToNode(nodeId, file, candidate, options)) {
        return { ...emptyResult(true), importedCount: 1 }
      }
    } catch {
      /* Fall through to the visible error node below. */
    }
  }

  updateClipboardMediaNodeError(nodeId, '网页媒体下载失败：该站点可能禁止跨域请求或开启防盗链。请先下载到本地，再复制或拖入画布。')
  return { ...emptyResult(true), failedCount: 1 }
}

export async function pasteClipboardMediaToGenerationCanvas(
  options: ClipboardMediaPasteOptions,
): Promise<ClipboardMediaPasteResult> {
  const data = options.clipboardData
  const files = extractClipboardMediaFiles(data)
  if (files.length > 0) return importMediaFiles(files, options)

  const candidate = extractClipboardMediaUrl(data)
  if (!candidate) return emptyResult(false)

  if (isRemoteUrl(candidate.url)) return pasteRemoteClipboardMediaUrl(candidate, options)

  const fetchMedia = options.fetchMedia ?? options.fetchImage ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
  if (fetchMedia) {
    try {
      const file = await mediaUrlToFile(candidate.url, fetchMedia, candidate.kind)
      if (file) return importMediaFiles([file], options)
    } catch {
      /* If the browser blocks the request, a trusted media URL can still be displayed directly. */
    }
  }

  if (candidate.trustAsMedia) return createExternalMediaUrlNode(candidate, options)
  return emptyResult(false)
}

export async function pasteClipboardImageToGenerationCanvas(
  options: ClipboardImagePasteOptions,
): Promise<ClipboardImagePasteResult> {
  return pasteClipboardMediaToGenerationCanvas(options)
}

export function showClipboardMediaPasteNotes(result: ClipboardMediaPasteResult): void {
  if (!result.handled) return
  const notes: string[] = []
  if (result.skippedOverLimitCount > 0) notes.push(`超过 8 个，已忽略 ${result.skippedOverLimitCount} 个`)
  if (result.skippedTooLargeCount > 0) notes.push(`${result.skippedTooLargeCount} 个媒体过大`)
  if (result.failedCount > 0) notes.push(`${result.failedCount} 个媒体导入失败`)
  if (result.usedExternalUrl) notes.push('网页媒体已作为外链引用')
  if (notes.length) toast(notes.join('；'), result.failedCount > 0 ? 'error' : 'info')
}

export const showClipboardImagePasteNotes = showClipboardMediaPasteNotes
