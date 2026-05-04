import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import {
  adaptHuobaoVideoRequest,
  defaultHuobaoRequest,
  type HuobaoRequest,
} from './providerAdapters'
import {
  normalizeHuobaoVideoResponse,
  normalizeHuobaoVideoTask,
} from './responseAdapters'

export type HuobaoVideoGenerationOptions = {
  referenceImages?: unknown
  upstreamResultUrls?: unknown
  firstFrameUrl?: string
  lastFrameUrl?: string
  request?: HuobaoRequest
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

function asTrimmedString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function asPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return undefined
}

function collectUrls(value: unknown, output: string[] = []): string[] {
  const direct = asTrimmedString(value)
  if (/^https?:\/\//i.test(direct) || direct.startsWith('/')) {
    output.push(direct)
    return output
  }
  if (!value || typeof value !== 'object') return output
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, output))
    return output
  }
  const record = value as Record<string, unknown>
  ;[
    'url',
    'imageUrl',
    'image_url',
    'videoUrl',
    'video_url',
    'referenceImages',
    'references',
    'firstFrameUrl',
    'first_frame_url',
    'lastFrameUrl',
    'last_frame_url',
  ].forEach((key) => collectUrls(record[key], output))
  return output
}

function uniqueUrls(values: unknown[]): string[] {
  return Array.from(new Set(values.flatMap((value) => collectUrls(value))))
}

function buildVideoTaskUrl(taskId: string): string {
  return `/v1/video/task/${encodeURIComponent(taskId)}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function buildHuobaoVideoRequest(node: GenerationCanvasNode, options: HuobaoVideoGenerationOptions = {}) {
  const prompt = asTrimmedString(node.prompt)
  if (!prompt) throw new Error('video prompt is required')

  const meta = node.meta || {}
  const modelKey =
    asTrimmedString(meta.modelKey) ||
    asTrimmedString(meta.videoModel) ||
    asTrimmedString(meta.modelAlias)
  if (!modelKey) throw new Error('video model is required')
  const durationSeconds = asPositiveNumber(meta.durationSeconds) || asPositiveNumber(meta.videoDuration)
  const referenceImages = uniqueUrls([
    options.referenceImages,
    options.upstreamResultUrls,
    node.references,
    meta.referenceImages,
    meta.firstFrameUrl,
    meta.first_frame_url,
  ])
  const firstFrameImage =
    asTrimmedString(options.firstFrameUrl) ||
    asTrimmedString(meta.firstFrameUrl) ||
    asTrimmedString(meta.first_frame_url) ||
    referenceImages[0]
  const lastFrameImage =
    asTrimmedString(options.lastFrameUrl) ||
    asTrimmedString(meta.lastFrameUrl) ||
    asTrimmedString(meta.last_frame_url)

  return {
    request: adaptHuobaoVideoRequest({
      model: modelKey,
      prompt,
      resolution: asTrimmedString(meta.resolution) || asTrimmedString(meta.videoResolution),
      size: asTrimmedString(meta.size) || asTrimmedString(meta.videoSize) || asTrimmedString(meta.aspectRatio) || asTrimmedString(meta.aspect),
      seconds: durationSeconds,
      firstFrameImage,
      lastFrameImage,
    }),
    durationSeconds,
  }
}

export async function runHuobaoVideoGeneration(
  node: GenerationCanvasNode,
  options: HuobaoVideoGenerationOptions = {},
): Promise<GenerationNodeResult> {
  const request = options.request || defaultHuobaoRequest
  const { request: requestData, durationSeconds } = buildHuobaoVideoRequest(node, options)
  const createResponse = await request({
    url: '/v1/video/generations',
    method: 'POST',
    data: requestData,
  })
  const createdTask = normalizeHuobaoVideoTask(createResponse)
  if (createdTask.url) return normalizeHuobaoVideoResponse(createResponse, node, durationSeconds)
  if (!createdTask.taskId) throw new Error('生成渠道视频生成没有返回任务编号或视频地址')

  const timeoutMs = options.pollTimeoutMs ?? 10 * 60 * 1000
  const intervalMs = options.pollIntervalMs ?? 5000
  const startedAt = Date.now()

  while (Date.now() - startedAt <= timeoutMs) {
    const taskResponse = await request({
      url: buildVideoTaskUrl(createdTask.taskId),
      method: 'GET',
    })
    const task = normalizeHuobaoVideoTask(taskResponse)
    if (task.url || task.status === 'completed' || task.status === 'succeeded') {
      return normalizeHuobaoVideoResponse(taskResponse, node, durationSeconds)
    }
    if (task.status === 'failed' || task.status === 'error') {
      throw new Error('生成渠道视频生成失败')
    }
    await sleep(intervalMs)
  }

  throw new Error('生成渠道视频生成超时')
}
