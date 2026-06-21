import type { DesktopBridge } from '../../desktop/bridge'
import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'
import type { TimelineClip } from '../timeline/timelineTypes'
import type { WorkbenchProjectRecordV1 } from './projectRecordSchema'

type BlobLikeRecord = {
  url?: string
  thumbnailUrl?: string
}

function isBlobUrl(value: string | undefined): value is string {
  return typeof value === 'string' && value.startsWith('blob:')
}

function isDataMediaUrl(value: string | undefined): value is string {
  return typeof value === 'string' && /^data:(image|video|audio)\//i.test(value)
}

function recordUrlFieldsHaveBlob(input: BlobLikeRecord | undefined): boolean {
  return Boolean(input && (isBlobUrl(input.url) || isBlobUrl(input.thumbnailUrl)))
}

function recordHasBlobMediaUrls(record: WorkbenchProjectRecordV1): boolean {
  const payload = record.payload
  for (const node of payload.generationCanvas.nodes) {
    if (recordUrlFieldsHaveBlob(node.result)) return true
    for (const item of node.history || []) {
      if (recordUrlFieldsHaveBlob(item)) return true
    }
  }
  for (const track of payload.timeline.tracks) {
    for (const clip of track.clips) {
      if (clip && typeof clip === 'object' && recordUrlFieldsHaveBlob(clip as BlobLikeRecord)) {
        return true
      }
    }
  }
  return false
}

function recordUrlFieldsHaveDataMedia(input: BlobLikeRecord | undefined): boolean {
  return Boolean(input && (isDataMediaUrl(input.url) || isDataMediaUrl(input.thumbnailUrl)))
}

function countUrlFieldsDataMedia(input: BlobLikeRecord | undefined): number {
  if (!input) return 0
  let count = 0
  if (isDataMediaUrl(input.url)) count += 1
  if (isDataMediaUrl(input.thumbnailUrl)) count += 1
  return count
}

function countRecordDataMediaUrls(record: WorkbenchProjectRecordV1): number {
  const payload = record.payload
  let count = 0
  for (const node of payload.generationCanvas.nodes) {
    count += countUrlFieldsDataMedia(node.result)
    for (const item of node.history || []) {
      count += countUrlFieldsDataMedia(item)
    }
  }
  for (const track of payload.timeline.tracks) {
    for (const clip of track.clips) {
      if (clip && typeof clip === 'object') count += countUrlFieldsDataMedia(clip as BlobLikeRecord)
    }
  }
  return count
}

async function blobUrlToDataUrl(url: string): Promise<string | null> {
  return blobUrlToDataUrlWithFetcher(url, async (input: string) => {
    try {
      const response = await fetch(input)
      if (!response.ok) return null
      return await response.blob()
    } catch {
      return null
    }
  })
}

async function blobUrlToDataUrlWithFetcher(
  url: string,
  fetchBlob: (input: string) => Promise<Blob | null>,
): Promise<string | null> {
  try {
    const blob = await fetchBlob(url)
    if (!blob) return null
    return await blobToDataUrl(blob)
  } catch {
    return null
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      if (result) resolve(result)
      else reject(new Error('failed to read blob data url'))
    }
    reader.onerror = () => reject(new Error('failed to read blob'))
    reader.readAsDataURL(blob)
  })
}

async function upgradeRecordUrlFields<T extends BlobLikeRecord>(
  input: T,
  fetchBlob?: (url: string) => Promise<Blob | null>,
): Promise<T> {
  let changed = false
  const next = { ...input }
  if (isBlobUrl(next.url)) {
    const converted = fetchBlob ? await blobUrlToDataUrlWithFetcher(next.url, fetchBlob) : await blobUrlToDataUrl(next.url)
    if (converted) {
      next.url = converted
      changed = true
    }
  }
  if (isBlobUrl(next.thumbnailUrl)) {
    const converted = fetchBlob ? await blobUrlToDataUrlWithFetcher(next.thumbnailUrl, fetchBlob) : await blobUrlToDataUrl(next.thumbnailUrl)
    if (converted) {
      next.thumbnailUrl = converted
      changed = true
    }
  }
  return changed ? next : input
}

export async function upgradeWorkbenchProjectMediaUrls(
  record: WorkbenchProjectRecordV1,
  options?: {
    fetchBlob?: (url: string) => Promise<Blob | null>
  },
): Promise<WorkbenchProjectRecordV1> {
  if (!recordHasBlobMediaUrls(record)) return record

  const fetchBlob = options?.fetchBlob
  const payload = record.payload
  const nextNodes = await Promise.all(payload.generationCanvas.nodes.map(async (node) => {
    let changed = false
    const nextNode = { ...node }
    if (nextNode.result && typeof nextNode.result === 'object') {
      const upgradedResult = await upgradeRecordUrlFields(nextNode.result, fetchBlob)
      if (upgradedResult !== nextNode.result) {
        changed = true
        nextNode.result = upgradedResult as typeof nextNode.result
      }
    }
    if (Array.isArray(nextNode.history) && nextNode.history.length) {
      const nextHistory = await Promise.all(nextNode.history.map(async (item) => upgradeRecordUrlFields(item, fetchBlob)))
      if (nextHistory.some((item, index) => item !== nextNode.history?.[index])) {
        changed = true
        nextNode.history = nextHistory as typeof nextNode.history
      }
    }
    return changed ? nextNode : node
  }))

  const nextTracks = await Promise.all(payload.timeline.tracks.map(async (track) => {
    let changed = false
    const nextTrack = { ...track }
    const nextClips = await Promise.all(track.clips.map(async (clip) => {
      if (!clip || typeof clip !== 'object') return clip
      const nextClip = { ...clip }
      const upgraded = await upgradeRecordUrlFields(nextClip as BlobLikeRecord, fetchBlob)
      if (upgraded !== nextClip) {
        changed = true
        return upgraded
      }
      return clip
    }))
    if (changed) {
      nextTrack.clips = nextClips as typeof track.clips
      return nextTrack
    }
    return track
  }))

  const nextGenerationCanvas = nextNodes.some((node, index) => node !== payload.generationCanvas.nodes[index])
    ? { ...payload.generationCanvas, nodes: nextNodes }
    : payload.generationCanvas
  const nextTimeline = nextTracks.some((track, index) => track !== payload.timeline.tracks[index])
    ? { ...payload.timeline, tracks: nextTracks }
    : payload.timeline

  if (nextGenerationCanvas === payload.generationCanvas && nextTimeline === payload.timeline) {
    return record
  }

  return {
    ...record,
    payload: {
      ...payload,
      generationCanvas: nextGenerationCanvas,
      timeline: nextTimeline,
    },
  }
}

type LocalizeDataUrlOptions = {
  desktop: DesktopBridge
  projectId: string
  maxItems?: number
}

type LocalizeDataUrlStats = {
  localized: number
  skipped: number
  errors: number
}

const DEFAULT_DATA_URL_LOCALIZE_LIMIT = 12

function fileSafePart(value: string): string {
  return value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'media'
}

function fileExtensionForDataUrl(value: string | undefined, result: BlobLikeRecord & { type?: unknown }): string {
  const mime = typeof value === 'string' ? value.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase() : ''
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'video/webm') return 'webm'
  if (mime === 'video/quicktime') return 'mov'
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return 'wav'
  if (mime === 'audio/mpeg') return 'mp3'
  if (result.type === 'video') return 'mp4'
  if (result.type === 'audio') return 'mp3'
  return 'png'
}

function fileNameForResult(prefix: string, ownerId: string, result: BlobLikeRecord & { type?: unknown }, field: 'url' | 'thumbnailUrl'): string {
  return `${fileSafePart(prefix)}-${fileSafePart(ownerId)}-${field}.${fileExtensionForDataUrl(result[field], result)}`
}

async function localizeRecordDataUrlFields<T extends BlobLikeRecord & { type?: unknown }>(
  input: T,
  options: LocalizeDataUrlOptions & { ownerId: string; prefix: string },
  stats: LocalizeDataUrlStats,
): Promise<T> {
  let next: T | null = null
  const maxItems = options.maxItems ?? DEFAULT_DATA_URL_LOCALIZE_LIMIT
  for (const field of ['url', 'thumbnailUrl'] as const) {
    const value = input[field]
    if (!isDataMediaUrl(value)) continue
    if (stats.localized >= maxItems) {
      stats.skipped += 1
      continue
    }
    try {
      const imported = await options.desktop.assets.importRemoteUrl({
        projectId: options.projectId,
        url: value,
        kind: 'generated',
        fileName: fileNameForResult(options.prefix, options.ownerId, input, field),
        ownerNodeId: options.ownerId,
      })
      const hostedUrl = typeof imported.data?.url === 'string' ? imported.data.url.trim() : ''
      if (!hostedUrl) {
        stats.errors += 1
        continue
      }
      const draft: T = next || { ...input }
      draft[field] = hostedUrl
      next = draft
      stats.localized += 1
    } catch {
      stats.errors += 1
    }
  }
  return next || input
}

export async function localizeWorkbenchProjectDataUrls(
  record: WorkbenchProjectRecordV1,
  options: LocalizeDataUrlOptions,
): Promise<{ record: WorkbenchProjectRecordV1; stats: LocalizeDataUrlStats }> {
  const stats: LocalizeDataUrlStats = { localized: 0, skipped: 0, errors: 0 }
  const totalDataUrls = countRecordDataMediaUrls(record)
  if (totalDataUrls === 0) return { record, stats }

  const payload = record.payload
  const maxItems = options.maxItems ?? DEFAULT_DATA_URL_LOCALIZE_LIMIT

  let nextNodes: typeof payload.generationCanvas.nodes | null = null
  for (let index = 0; index < payload.generationCanvas.nodes.length; index += 1) {
    if (stats.localized >= maxItems) break
    const node = payload.generationCanvas.nodes[index]
    let changed = false
    const nextNode: GenerationCanvasNode = { ...node }
    if (nextNode.result && typeof nextNode.result === 'object') {
      const nextResult = await localizeRecordDataUrlFields(
        nextNode.result,
        { ...options, ownerId: nextNode.id, prefix: 'node-result' },
        stats,
      )
      if (nextResult !== nextNode.result) {
        nextNode.result = nextResult as GenerationNodeResult
        changed = true
      }
    }
    if (Array.isArray(nextNode.history) && nextNode.history.length) {
      let nextHistory: GenerationNodeResult[] | null = null
      for (let historyIndex = 0; historyIndex < nextNode.history.length; historyIndex += 1) {
        if (stats.localized >= maxItems) break
        const item = nextNode.history[historyIndex]
        const nextItem = await localizeRecordDataUrlFields(
          item,
          { ...options, ownerId: nextNode.id, prefix: `node-history-${historyIndex}` },
          stats,
        )
        if (nextItem !== item) {
          if (!nextHistory) nextHistory = [...nextNode.history]
          nextHistory[historyIndex] = nextItem
        }
      }
      if (nextHistory) {
        nextNode.history = nextHistory
        changed = true
      }
    }
    if (changed) {
      if (!nextNodes) nextNodes = [...payload.generationCanvas.nodes]
      nextNodes[index] = nextNode
    }
  }

  let nextTracks: typeof payload.timeline.tracks | null = null
  for (let trackIndex = 0; trackIndex < payload.timeline.tracks.length; trackIndex += 1) {
    if (stats.localized >= maxItems) break
    const track = payload.timeline.tracks[trackIndex]
    let nextClips: typeof track.clips | null = null
    for (let clipIndex = 0; clipIndex < track.clips.length; clipIndex += 1) {
      if (stats.localized >= maxItems) break
      const clip = track.clips[clipIndex]
      if (!clip || typeof clip !== 'object') continue
      const nextClip = await localizeRecordDataUrlFields(
        clip as TimelineClip & BlobLikeRecord,
        { ...options, ownerId: String((clip as TimelineClip).id || track.id), prefix: 'timeline-clip' },
        stats,
      )
      if (nextClip !== clip) {
        if (!nextClips) nextClips = [...track.clips]
        nextClips[clipIndex] = nextClip
      }
    }
    if (nextClips) {
      if (!nextTracks) nextTracks = [...payload.timeline.tracks]
      nextTracks[trackIndex] = { ...track, clips: nextClips }
    }
  }

  const nextGenerationCanvas = nextNodes
    ? { ...payload.generationCanvas, nodes: nextNodes }
    : payload.generationCanvas
  const nextTimeline = nextTracks
    ? { ...payload.timeline, tracks: nextTracks }
    : payload.timeline

  if (nextGenerationCanvas === payload.generationCanvas && nextTimeline === payload.timeline) {
    if (stats.localized >= maxItems) stats.skipped = Math.max(stats.skipped, totalDataUrls - stats.localized - stats.errors)
    return { record, stats }
  }
  if (stats.localized >= maxItems) stats.skipped = Math.max(stats.skipped, totalDataUrls - stats.localized - stats.errors)

  return {
    record: {
      ...record,
      payload: {
        ...payload,
        generationCanvas: nextGenerationCanvas,
        timeline: nextTimeline,
      },
    },
    stats,
  }
}

// A1.5 step 5：老项目规整。历史上「导入图 / 文件树拖入 / 切图裁剪旋转 / 全景截图」都存成
// kind:'image'，与真生成图混在一起。新版这些都是 kind:'asset'（无 composer 的素材卡）。
// 这里在加载时把符合「素材特征」的老 image 节点改判为 asset；保守谓词避免误伤真生成节点。
const LEGACY_ASSET_SOURCE_TAGS = new Set<string>([
  'local-drop',
  'asset-upload',
  'workspace-file',
  'image-crop',
  'image-rotate-left',
  'image-rotate-right',
  'image-flip-h',
  'image-flip-v',
  'panorama-screenshot',
])

function isLegacyMaterialImageNode(node: WorkbenchProjectRecordV1['payload']['generationCanvas']['nodes'][number]): boolean {
  if (node.kind !== 'image') return false
  // 真生成图带 provenance —— 一定保留为生成节点，绝不转素材。
  if (node.result?.provenance) return false
  const meta = node.meta || {}
  if (meta.localOnly === true) return true
  const source = typeof meta.source === 'string' ? meta.source : ''
  if (!source) return false
  if (LEGACY_ASSET_SOURCE_TAGS.has(source)) return true
  return source.startsWith('image-grid-split-') || source.startsWith('panorama-')
}

export function normalizeLegacyImageAssetKinds(record: WorkbenchProjectRecordV1): WorkbenchProjectRecordV1 {
  const payload = record.payload
  if (!payload.generationCanvas.nodes.some(isLegacyMaterialImageNode)) return record

  const nextNodes = payload.generationCanvas.nodes.map((node) => {
    if (!isLegacyMaterialImageNode(node)) return node
    return { ...node, kind: 'asset' as const }
  })
  return {
    ...record,
    payload: {
      ...payload,
      generationCanvas: { ...payload.generationCanvas, nodes: nextNodes },
    },
  }
}

export function assertWorkbenchProjectMediaUrlsPersistable(record: WorkbenchProjectRecordV1): void {
  const payload = record.payload
  for (const node of payload.generationCanvas.nodes) {
    if (isBlobUrl(node.result?.url)) {
      throw new Error(`本地项目记录包含不可持久化图片地址：${record.id}`)
    }
    for (const item of node.history || []) {
      if (isBlobUrl(item.url)) {
        throw new Error(`本地项目记录包含不可持久化图片地址：${record.id}`)
      }
    }
  }
  for (const track of payload.timeline.tracks) {
    for (const clip of track.clips) {
      if (isBlobUrl((clip as BlobLikeRecord).url)) {
        throw new Error(`本地项目记录包含不可持久化图片地址：${record.id}`)
      }
    }
  }
}
