import type { WorkbenchProjectRecordV1 } from './projectRecordSchema'

type BlobLikeRecord = {
  url?: string
  thumbnailUrl?: string
}

function isBlobUrl(value: string | undefined): value is string {
  return typeof value === 'string' && value.startsWith('blob:')
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
