import { toast } from '../../../ui/toast'
import { hostedAssetUrl, importWorkbenchRemoteAssetUrl, type WorkbenchAssetDto } from '../../api/assetUploadApi'
import { dataUrlToFile } from './persistNodeImage'
import {
  importLocalMediaFilesToGenerationCanvas,
  type GenerationAssetImportResult,
  type ImportImageFilesOptions,
} from './assetImportAdapter'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

const IMAGE_URL_EXTENSION = /\.(?:png|jpe?g|webp|gif|avif|bmp|svg)(?:[?#].*)?$/i
const IMAGE_MIME_EXTENSION: Record<string, string> = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
}

type ClipboardTextSource = 'html' | 'uri-list' | 'plain'

type ClipboardImageUrlCandidate = {
  url: string
  trustAsImage: boolean
  source: ClipboardTextSource
}

export type ClipboardImagePasteOptions = {
  basePosition: { x: number; y: number }
  categoryId?: string
  clipboardData?: DataTransfer | null
  fetchImage?: typeof fetch
  importRemoteUrl?: (url: string, fileName: string) => Promise<WorkbenchAssetDto | null>
  importOptions?: Partial<ImportImageFilesOptions>
}

export type ClipboardImagePasteResult = {
  handled: boolean
  importedCount: number
  failedCount: number
  skippedTooLargeCount: number
  skippedOverLimitCount: number
  usedExternalUrl: boolean
}

function emptyResult(handled = false): ClipboardImagePasteResult {
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

function isImageFile(file: File | null | undefined): file is File {
  return Boolean(file && file.type.startsWith('image/'))
}

export function extractClipboardImageFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return []
  const files: File[] = []
  const seen = new Set<string>()
  const add = (file: File | null | undefined) => {
    if (!isImageFile(file)) return
    const key = fileKey(file)
    if (seen.has(key)) return
    seen.add(key)
    files.push(file)
  }
  Array.from(data.files || []).forEach(add)
  Array.from(data.items || []).forEach((item) => {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) return
    add(item.getAsFile())
  })
  return files
}

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

function isRemoteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function isFileUrl(url: string): boolean {
  return /^file:\/\//i.test(url)
}

function isDirectDisplayImageUrl(url: string): boolean {
  return (
    isDataImageUrl(url) ||
    /^nomi-local:\/\//i.test(url) ||
    ((isRemoteUrl(url) || isFileUrl(url)) && IMAGE_URL_EXTENSION.test(url))
  )
}

function isSupportedClipboardImageUrl(url: string): boolean {
  return isDataImageUrl(url) || /^nomi-local:\/\//i.test(url) || isRemoteUrl(url) || isFileUrl(url)
}

function extractHtmlImageUrl(html: string): string {
  const imgTags = html.match(/<img\b[^>]*>/gi) || []
  for (const tag of imgTags) {
    const src = normalizeClipboardUrl(readAttribute(tag, 'src'))
    if (src) return src
    const srcset = firstSrcsetUrl(readAttribute(tag, 'srcset'))
    if (srcset) return normalizeClipboardUrl(srcset)
  }
  return ''
}

function firstUriListUrl(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#')) || ''
}

export function extractClipboardImageUrl(data: DataTransfer | null | undefined): ClipboardImageUrlCandidate | null {
  if (!data) return null
  const htmlUrl = normalizeClipboardUrl(extractHtmlImageUrl(data.getData('text/html') || ''))
  if (htmlUrl && isSupportedClipboardImageUrl(htmlUrl)) return { url: htmlUrl, trustAsImage: true, source: 'html' }

  const uriListUrl = normalizeClipboardUrl(firstUriListUrl(data.getData('text/uri-list') || ''))
  if (uriListUrl && isDirectDisplayImageUrl(uriListUrl)) {
    return { url: uriListUrl, trustAsImage: true, source: 'uri-list' }
  }

  const plainUrl = normalizeClipboardUrl((data.getData('text/plain') || '').split(/\s+/)[0] || '')
  if (!plainUrl) return null
  const trustAsImage = isDirectDisplayImageUrl(plainUrl)
  if (trustAsImage || isRemoteUrl(plainUrl)) return { url: plainUrl, trustAsImage, source: 'plain' }
  return null
}

function extensionForMime(type: string): string {
  return IMAGE_MIME_EXTENSION[type.toLowerCase()] || 'png'
}

function fileNameFromImageUrl(url: string, type: string): string {
  try {
    const parsed = new URL(url)
    const segment = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '')
    const clean = segment.replace(/[?#].*$/, '').trim()
    if (clean && /\.[a-z0-9]{2,5}$/i.test(clean)) return clean
  } catch {
    /* fall through */
  }
  return `clipboard-image.${extensionForMime(type)}`
}

async function imageUrlToFile(url: string, fetchImage: typeof fetch): Promise<File | null> {
  if (isDataImageUrl(url)) return dataUrlToFile(url, `clipboard-image-${Date.now()}.png`)
  if (!isRemoteUrl(url)) return null
  const response = await fetchImage(url)
  if (!response.ok) return null
  const blob = await response.blob()
  const type = blob.type || response.headers.get('content-type') || ''
  if (!type.startsWith('image/')) return null
  return new File([blob], fileNameFromImageUrl(url, type), { type })
}

async function importRemoteImageUrl(url: string, options: ClipboardImagePasteOptions): Promise<WorkbenchAssetDto | null> {
  if (!isRemoteUrl(url)) return null
  const fileName = fileNameFromImageUrl(url, 'image/png')
  const importRemoteUrl = options.importRemoteUrl ?? ((remoteUrl: string, name: string) =>
    importWorkbenchRemoteAssetUrl(remoteUrl, name))
  return importRemoteUrl(url, fileName)
}

function resultFromImport(result: GenerationAssetImportResult): ClipboardImagePasteResult {
  return {
    handled: true,
    importedCount: result.created.length,
    failedCount: result.failedCount,
    skippedTooLargeCount: result.skippedTooLargeCount,
    skippedOverLimitCount: result.skippedOverLimitCount,
    usedExternalUrl: false,
  }
}

async function importImageFiles(files: File[], options: ClipboardImagePasteOptions): Promise<ClipboardImagePasteResult> {
  const result = await importLocalMediaFilesToGenerationCanvas(files, {
    basePosition: options.basePosition,
    categoryId: options.categoryId,
    ...options.importOptions,
  })
  return resultFromImport(result)
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const segment = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '').replace(/\.[^.]+$/, '')
    return segment.trim() || parsed.hostname || '网页图片'
  } catch {
    return '网页图片'
  }
}

function createClipboardImageNode(input: {
  url: string
  options: ClipboardImagePasteOptions
  providerUrl?: string
  asset?: WorkbenchAssetDto | null
  usedExternalUrl: boolean
}): ClipboardImagePasteResult {
  const { asset, options, providerUrl, url, usedExternalUrl } = input
  const store = useGenerationCanvasStore.getState()
  const node = store.addNode({
    kind: 'asset',
    title: titleFromUrl(providerUrl || url),
    prompt: '',
    position: {
      x: Math.max(40, Math.round(options.basePosition.x)),
      y: Math.max(40, Math.round(options.basePosition.y)),
    },
    categoryId: options.categoryId,
  })
  const result = {
    id: `clipboard-url-${node.id}-${Date.now()}`,
    type: 'image' as const,
    url,
    providerUrl,
    assetId: asset?.id,
    raw: asset ? { asset } : undefined,
    createdAt: Date.now(),
  }
  store.updateNode(node.id, {
    result,
    history: [result],
    status: 'success',
    meta: {
      ...(node.meta || {}),
      source: 'clipboard-url',
      uploadStatus: usedExternalUrl ? 'external-url' : 'uploaded',
      localOnly: false,
      ...(asset?.data?.contentType ? { contentType: asset.data.contentType } : {}),
    },
  })
  return { ...emptyResult(true), importedCount: 1, usedExternalUrl }
}

function createExternalImageUrlNode(url: string, options: ClipboardImagePasteOptions): ClipboardImagePasteResult {
  return createClipboardImageNode({
    url,
    options,
    providerUrl: isRemoteUrl(url) ? url : undefined,
    usedExternalUrl: true,
  })
}

export async function pasteClipboardImageToGenerationCanvas(
  options: ClipboardImagePasteOptions,
): Promise<ClipboardImagePasteResult> {
  const data = options.clipboardData
  const files = extractClipboardImageFiles(data)
  if (files.length > 0) return importImageFiles(files, options)

  const candidate = extractClipboardImageUrl(data)
  if (!candidate) return emptyResult(false)

  try {
    const asset = await importRemoteImageUrl(candidate.url, options)
    const localUrl = hostedAssetUrl(asset)
    if (localUrl) {
      return createClipboardImageNode({
        url: localUrl,
        options,
        providerUrl: candidate.url,
        asset,
        usedExternalUrl: false,
      })
    }
  } catch {
    /* Desktop remote import may be unavailable in tests/web or blocked by the remote host. */
  }

  const fetchImage = options.fetchImage ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
  if (fetchImage) {
    try {
      const file = await imageUrlToFile(candidate.url, fetchImage)
      if (file) return importImageFiles([file], options)
    } catch {
      /* If the browser blocks the request, a trusted image URL can still be displayed directly. */
    }
  }

  if (candidate.trustAsImage) return createExternalImageUrlNode(candidate.url, options)
  return emptyResult(false)
}

export function showClipboardImagePasteNotes(result: ClipboardImagePasteResult): void {
  if (!result.handled) return
  const notes: string[] = []
  if (result.skippedOverLimitCount > 0) notes.push(`超过 8 张，已忽略 ${result.skippedOverLimitCount} 张`)
  if (result.skippedTooLargeCount > 0) notes.push(`${result.skippedTooLargeCount} 张图片过大`)
  if (result.failedCount > 0) notes.push(`${result.failedCount} 张图片导入失败`)
  if (result.usedExternalUrl) notes.push('网页图片已作为外链引用')
  if (notes.length) toast(notes.join('；'), result.failedCount > 0 ? 'error' : 'info')
}
