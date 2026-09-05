import type { DesktopAssetDto } from '../../../desktop/bridge'
import { getDesktopBridge } from '../../../desktop/bridge'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import { resolveCapabilityProjectId } from '../../capability/capabilityProjectBinding'
import { workbenchAdoptionPorts } from '../../adoption/adoptionStorePorts'
import type { TimelineClip, TimelineState } from '../timelineTypes'
import { ASSET_SOURCE_USAGE_LIMIT } from '../../../../electron/shared/agentCapabilities/assetRead'

export type MediaToolCallName =
  | 'get_media'
  | 'inspect_media'
  | 'search_media'
  | 'inspect_source_range'
  | 'read_waveform'

type JsonRecord = Record<string, unknown>
type MediaKind = 'image' | 'video' | 'audio'

type ProjectMediaAsset = {
  dto: DesktopAssetDto
  id: string
  projectId: string
  name: string
  kind: MediaKind
  renderUrl: string
  relativePath: string
}

type MediaTechnicalMetadata = {
  durationSeconds?: number
  width?: number
  height?: number
  fps?: number
  videoCodec?: string
  audioCodec?: string
  hasAudio?: boolean
  sampleRate?: number
  channels?: number
}

type WaveformBucket = {
  startSeconds: number
  endSeconds: number
  peak: number
  rms: number
}

export type MediaToolRuntime = {
  listProjectAssets: (projectId: string) => Promise<DesktopAssetDto[]>
  inspectAsset: (asset: ProjectMediaAsset) => Promise<MediaTechnicalMetadata>
  readWaveform: (
    asset: ProjectMediaAsset,
    range: { startSeconds: number; endSeconds?: number; buckets: number },
  ) => Promise<{
    durationSeconds: number
    sampleRate: number
    channels: number
    startSeconds: number
    endSeconds: number
    buckets: WaveformBucket[]
  }>
  readTimeline: () => TimelineState
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function finitePositive(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function finiteNonNegative(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number`)
  }
  return value
}

function positiveInteger(value: unknown, field: string, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} must be an integer between 1 and ${maximum}`)
  }
  return value
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
  return value
}

function stringArg(input: JsonRecord, field: string): string {
  const value = typeof input[field] === 'string' ? input[field].trim() : ''
  if (!value) throw new Error(`${field} is required`)
  return value
}

function mediaKind(dto: DesktopAssetDto): MediaKind | null {
  const data = asRecord(dto.data)
  const mediaType = typeof data.mediaType === 'string' ? data.mediaType.toLowerCase() : ''
  if (mediaType === 'image' || mediaType === 'video' || mediaType === 'audio') return mediaType
  const contentType = typeof data.contentType === 'string' ? data.contentType.toLowerCase() : ''
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  if (/\.(png|jpe?g|webp|gif|avif)$/i.test(dto.name)) return 'image'
  if (/\.(mp4|webm|mov|m4v)$/i.test(dto.name)) return 'video'
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(dto.name)) return 'audio'
  return null
}

function toProjectMediaAsset(dto: DesktopAssetDto, projectId: string): ProjectMediaAsset | null {
  const kind = mediaKind(dto)
  const data = asRecord(dto.data)
  const assetProjectId = typeof dto.projectId === 'string' ? dto.projectId.trim() : projectId
  const renderUrl = typeof data.url === 'string' ? data.url.trim() : ''
  const relativePath = typeof data.relativePath === 'string' ? data.relativePath.trim() : ''
  if (!kind || !dto.id || assetProjectId !== projectId) return null
  return {
    dto,
    id: dto.id,
    projectId,
    name: dto.name || dto.id,
    kind,
    renderUrl,
    relativePath,
  }
}

function compactMedia(asset: ProjectMediaAsset): JsonRecord {
  const data = asRecord(asset.dto.data)
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    createdAt: asset.dto.createdAt,
    updatedAt: asset.dto.updatedAt,
    ...(typeof data.contentType === 'string' && data.contentType.trim() ? { contentType: data.contentType.trim() } : {}),
    ...(finitePositive(data.size) !== undefined ? { sizeBytes: Math.round(finitePositive(data.size)!) } : {}),
    ...(typeof data.ownerNodeId === 'string' && data.ownerNodeId.trim() ? { ownerNodeId: data.ownerNodeId.trim() } : {}),
  }
}

function metadataFromAsset(asset: ProjectMediaAsset): MediaTechnicalMetadata {
  const data = asRecord(asset.dto.data)
  const metadata: MediaTechnicalMetadata = {}
  const durationSeconds = finitePositive(data.durationSeconds) ?? finitePositive(data.duration)
  const width = finitePositive(data.width)
  const height = finitePositive(data.height)
  const fps = finitePositive(data.fps)
  const sampleRate = finitePositive(data.sampleRate)
  const channels = finitePositive(data.channels)
  if (durationSeconds !== undefined) metadata.durationSeconds = durationSeconds
  if (width !== undefined) metadata.width = Math.round(width)
  if (height !== undefined) metadata.height = Math.round(height)
  if (fps !== undefined) metadata.fps = fps
  if (sampleRate !== undefined) metadata.sampleRate = Math.round(sampleRate)
  if (channels !== undefined) metadata.channels = Math.round(channels)
  if (typeof data.videoCodec === 'string' && data.videoCodec.trim()) metadata.videoCodec = data.videoCodec.trim()
  if (typeof data.audioCodec === 'string' && data.audioCodec.trim()) metadata.audioCodec = data.audioCodec.trim()
  if (typeof data.hasAudio === 'boolean') metadata.hasAudio = data.hasAudio
  return metadata
}

function loadElementMetadata(asset: ProjectMediaAsset): Promise<MediaTechnicalMetadata> {
  const stored = metadataFromAsset(asset)
  if (!asset.renderUrl || typeof document === 'undefined') return Promise.resolve(stored)
  if (asset.kind === 'image') {
    return new Promise((resolve) => {
      const image = document.createElement('img')
      let timeout: number | undefined
      const finish = (extra: MediaTechnicalMetadata = {}) => {
        if (timeout !== undefined) window.clearTimeout(timeout)
        image.onload = null
        image.onerror = null
        image.removeAttribute('src')
        resolve({ ...stored, ...extra })
      }
      timeout = window.setTimeout(() => finish(), 10_000)
      image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => finish()
      image.src = asset.renderUrl
    })
  }
  return new Promise((resolve) => {
    const media = document.createElement(asset.kind === 'video' ? 'video' : 'audio')
    let timeout: number | undefined
    const finish = (extra: MediaTechnicalMetadata = {}) => {
      if (timeout !== undefined) window.clearTimeout(timeout)
      media.onloadedmetadata = null
      media.onerror = null
      media.removeAttribute('src')
      media.load()
      resolve({ ...stored, ...extra })
    }
    timeout = window.setTimeout(() => finish(), 10_000)
    media.preload = 'metadata'
    media.onloadedmetadata = () => finish({
      ...(Number.isFinite(media.duration) && media.duration > 0 ? { durationSeconds: media.duration } : {}),
      ...(media instanceof HTMLVideoElement && media.videoWidth > 0 ? { width: media.videoWidth, height: media.videoHeight } : {}),
    })
    media.onerror = () => finish()
    media.src = asset.renderUrl
  })
}

async function listProjectAssets(projectId: string): Promise<DesktopAssetDto[]> {
  const desktop = getDesktopBridge()
  if (!desktop?.assets?.list) throw new Error('Media tools require the Electron desktop runtime')
  const assets: DesktopAssetDto[] = []
  let cursor: string | null = null
  const seenCursors = new Set<string>()
  do {
    const page = await desktop.assets.list({ projectId, cursor, limit: 500 })
    assets.push(...page.items)
    cursor = page.cursor
    if (assets.length >= 5_000) break
    if (cursor && seenCursors.has(cursor)) throw new Error('Asset pagination returned a repeated cursor')
    if (cursor) seenCursors.add(cursor)
  } while (cursor)
  return assets
}

async function decodeWaveform(
  asset: ProjectMediaAsset,
  range: { startSeconds: number; endSeconds?: number; buckets: number },
): Promise<{ durationSeconds: number; sampleRate: number; channels: number; startSeconds: number; endSeconds: number; buckets: WaveformBucket[] }> {
  if (asset.kind === 'image') throw new Error('read_waveform requires an audio or video asset')
  if (!asset.renderUrl) throw new Error('The selected asset has no readable local media source')
  const size = finitePositive(asRecord(asset.dto.data).size) ?? 0
  if (size > 128 * 1024 * 1024) throw new Error('waveform_asset_too_large: assets over 128 MB require a proxy waveform')

  const AudioContextConstructor = globalThis.AudioContext
    ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextConstructor) throw new Error('Web Audio decoding is unavailable in this runtime')

  const fetchController = new AbortController()
  const fetchTimeout = globalThis.setTimeout(() => fetchController.abort(), 15_000)
  let bytes: ArrayBuffer
  try {
    const response = await fetch(asset.renderUrl, { signal: fetchController.signal })
    if (!response.ok) throw new Error(`Unable to read media for waveform (${response.status})`)
    const contentLength = finitePositive(response.headers.get('content-length')) ?? 0
    if (contentLength > 128 * 1024 * 1024) throw new Error('waveform_asset_too_large: assets over 128 MB require a proxy waveform')
    bytes = await response.arrayBuffer()
  } finally {
    globalThis.clearTimeout(fetchTimeout)
  }
  if (bytes.byteLength > 128 * 1024 * 1024) throw new Error('waveform_asset_too_large: assets over 128 MB require a proxy waveform')

  const context = new AudioContextConstructor()
  try {
    let decodeTimeout: ReturnType<typeof setTimeout> | undefined
    const decoded = await Promise.race([
      context.decodeAudioData(bytes.slice(0)),
      new Promise<never>((_resolve, reject) => {
        decodeTimeout = globalThis.setTimeout(() => reject(new Error('Audio decode timed out')), 20_000)
      }),
    ]).finally(() => {
      if (decodeTimeout !== undefined) globalThis.clearTimeout(decodeTimeout)
    })
    const durationSeconds = decoded.duration
    const startSeconds = Math.min(range.startSeconds, durationSeconds)
    const endSeconds = Math.min(range.endSeconds ?? durationSeconds, durationSeconds)
    if (endSeconds <= startSeconds) throw new Error('Waveform range is empty or outside the media duration')
    const startSample = Math.floor(startSeconds * decoded.sampleRate)
    const endSample = Math.min(decoded.length, Math.ceil(endSeconds * decoded.sampleRate))
    const samplesPerBucket = Math.max(1, Math.ceil((endSample - startSample) / range.buckets))
    const buckets: WaveformBucket[] = []
    for (let index = 0; index < range.buckets; index += 1) {
      const bucketStart = startSample + index * samplesPerBucket
      const bucketEnd = Math.min(endSample, bucketStart + samplesPerBucket)
      if (bucketStart >= bucketEnd) break
      const stride = Math.max(1, Math.floor((bucketEnd - bucketStart) / 2_048))
      let peak = 0
      let sumSquares = 0
      let sampleCount = 0
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const samples = decoded.getChannelData(channel)
        for (let sample = bucketStart; sample < bucketEnd; sample += stride) {
          const amplitude = Math.abs(samples[sample] ?? 0)
          peak = Math.max(peak, amplitude)
          sumSquares += amplitude * amplitude
          sampleCount += 1
        }
      }
      buckets.push({
        startSeconds: bucketStart / decoded.sampleRate,
        endSeconds: bucketEnd / decoded.sampleRate,
        peak: Number(Math.min(1, peak).toFixed(4)),
        rms: Number(Math.sqrt(sumSquares / Math.max(1, sampleCount)).toFixed(4)),
      })
    }
    return {
      durationSeconds,
      sampleRate: decoded.sampleRate,
      channels: decoded.numberOfChannels,
      startSeconds,
      endSeconds,
      buckets,
    }
  } catch (error) {
    const wrapped = new Error(`waveform_decode_failed: ${error instanceof Error ? error.message : String(error)}`) as Error & { cause?: unknown }
    wrapped.cause = error
    throw wrapped
  } finally {
    await context.close().catch(() => undefined)
  }
}

const defaultRuntime: MediaToolRuntime = {
  listProjectAssets,
  inspectAsset: loadElementMetadata,
  readWaveform: decodeWaveform,
  readTimeline: () => workbenchAdoptionPorts.readTimeline(),
}

/**
 * 素材库按 projectId 在主进程寻址——不需要项目正开着。所以已校验的 lease projectId 优先，
 * 没给才回退 GUI 当前项目（应用内调用者）。解析规则住在 capabilityProjectBinding.ts。
 */
function scopeProjectId(boundProjectId?: unknown): string {
  return resolveCapabilityProjectId(
    boundProjectId,
    getDesktopActiveProjectId,
    'project_scope_required: an active project is required for media tools',
  )
}

async function mediaAssets(runtime: MediaToolRuntime, boundProjectId?: unknown): Promise<ProjectMediaAsset[]> {
  const projectId = scopeProjectId(boundProjectId)
  return (await runtime.listProjectAssets(projectId))
    .map((asset) => toProjectMediaAsset(asset, projectId))
    .filter((asset): asset is ProjectMediaAsset => Boolean(asset))
}

async function requireMedia(assetId: string, runtime: MediaToolRuntime, boundProjectId?: unknown): Promise<ProjectMediaAsset> {
  const asset = (await mediaAssets(runtime, boundProjectId)).find((candidate) => candidate.id === assetId)
  if (!asset) throw new Error(`media_not_found: ${assetId}`)
  return asset
}

function clipUsesAsset(clip: TimelineClip, asset: ProjectMediaAsset): boolean {
  if (asset.renderUrl && clip.url === asset.renderUrl) return true
  if (clip.sourceNodeId === asset.id || clip.sourceNodeId === `asset:${asset.id}`) return true
  return Boolean(asset.relativePath && clip.sourceNodeId === `asset:${asset.relativePath}`)
}

function sourceRangeUsages(timeline: TimelineState, asset: ProjectMediaAsset, startFrame: number, endFrame: number): JsonRecord[] {
  return timeline.tracks.flatMap((track) => track.clips.flatMap((clip) => {
    if (!clipUsesAsset(clip, asset)) return []
    const sourceStartFrame = clip.type === 'image' ? 0 : clip.offsetStartFrame
    const sourceEndFrame = clip.type === 'image' ? clip.frameCount : clip.frameCount - clip.offsetEndFrame
    if (sourceStartFrame >= endFrame || startFrame >= sourceEndFrame) return []
    return [{
      clipId: clip.id,
      trackId: track.id,
      timelineRange: { startFrame: clip.startFrame, endFrame: clip.endFrame },
      sourceWindow: { startFrame: sourceStartFrame, endFrame: sourceEndFrame },
    }]
  }))
}

export async function applyMediaToolCall(
  toolName: string,
  args: unknown,
  runtime: MediaToolRuntime = defaultRuntime,
): Promise<unknown> {
  const input = asRecord(args)
  switch (toolName as MediaToolCallName) {
    case 'get_media': {
      return { operation: toolName, media: compactMedia(await requireMedia(stringArg(input, 'assetId'), runtime, input.projectId)) }
    }
    case 'inspect_media': {
      const asset = await requireMedia(stringArg(input, 'assetId'), runtime, input.projectId)
      return {
        operation: toolName,
        media: compactMedia(asset),
        technical: await runtime.inspectAsset(asset),
        semanticInspection: 'not_performed',
      }
    }
    case 'search_media': {
      const query = typeof input.query === 'string' ? input.query.trim().toLocaleLowerCase() : ''
      const kinds = Array.isArray(input.kinds)
        ? new Set(input.kinds.filter((kind): kind is MediaKind => kind === 'image' || kind === 'video' || kind === 'audio'))
        : null
      const limit = input.limit === undefined ? 20 : positiveInteger(input.limit, 'limit', 100)
      const results = (await mediaAssets(runtime, input.projectId))
        .filter((asset) => !kinds || kinds.size === 0 || kinds.has(asset.kind))
        .filter((asset) => !query || asset.name.toLocaleLowerCase().includes(query))
        .sort((left, right) => Date.parse(right.dto.updatedAt) - Date.parse(left.dto.updatedAt) || left.id.localeCompare(right.id))
      return {
        operation: toolName,
        query,
        total: results.length,
        truncated: results.length > limit,
        media: results.slice(0, limit).map(compactMedia),
      }
    }
    case 'inspect_source_range': {
      const asset = await requireMedia(stringArg(input, 'assetId'), runtime, input.projectId)
      const startFrame = nonNegativeInteger(input.startFrame, 'startFrame')
      const endFrame = positiveInteger(input.endFrame, 'endFrame', Number.MAX_SAFE_INTEGER)
      if (endFrame <= startFrame) throw new Error('endFrame must be greater than startFrame')
      const timeline = runtime.readTimeline()
      const technical = await runtime.inspectAsset(asset)
      const knownSourceFrames = technical.durationSeconds
        ? Math.max(1, Math.round(technical.durationSeconds * timeline.fps))
        : undefined
      const usages = sourceRangeUsages(timeline, asset, startFrame, endFrame)
      return {
        operation: toolName,
        assetId: asset.id,
        timelineFps: timeline.fps,
        sourceRange: { startFrame, endFrame },
        valid: knownSourceFrames === undefined || endFrame <= knownSourceFrames,
        ...(knownSourceFrames !== undefined ? { knownSourceFrames } : {}),
        totalUsageCount: usages.length,
        truncated: usages.length > ASSET_SOURCE_USAGE_LIMIT,
        usages: usages.slice(0, ASSET_SOURCE_USAGE_LIMIT),
        semanticInspection: 'not_performed',
      }
    }
    case 'read_waveform': {
      const asset = await requireMedia(stringArg(input, 'assetId'), runtime, input.projectId)
      const startSeconds = input.startSeconds === undefined ? 0 : finiteNonNegative(input.startSeconds, 'startSeconds')
      const endSeconds = input.endSeconds === undefined ? undefined : finiteNonNegative(input.endSeconds, 'endSeconds')
      if (endSeconds !== undefined && endSeconds <= startSeconds) throw new Error('endSeconds must be greater than startSeconds')
      const buckets = input.buckets === undefined ? 64 : positiveInteger(input.buckets, 'buckets', 256)
      return {
        operation: toolName,
        assetId: asset.id,
        ...(await runtime.readWaveform(asset, { startSeconds, endSeconds, buckets })),
      }
    }
    default: return null
  }
}
