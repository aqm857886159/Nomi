import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'

function asTrimmedString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function firstUrl(value: unknown): string {
  const direct = asTrimmedString(value)
  if (/^https?:\/\//i.test(direct) || direct.startsWith('/')) return direct
  if (!value || typeof value !== 'object') return ''
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstUrl(item)
      if (found) return found
    }
    return ''
  }
  const record = value as Record<string, unknown>
  for (const key of ['url', 'b64_json', 'video_url', 'videoUrl', 'image_url', 'imageUrl']) {
    const found = firstUrl(record[key])
    if (found) return found
  }
  for (const key of ['data', 'content', 'output', 'outputs', 'result', 'results', 'images', 'videos']) {
    const found = firstUrl(record[key])
    if (found) return found
  }
  return ''
}

export function normalizeHuobaoImageResponse(
  response: unknown,
  node: GenerationCanvasNode,
): GenerationNodeResult {
  const url = firstUrl(response)
  if (!url) throw new Error('生成渠道图片生成成功但没有返回图片地址')
  return {
    id: `result-${node.id}-${Date.now()}`,
    type: 'image',
    url,
    model: asTrimmedString(node.meta?.modelKey) || asTrimmedString(node.meta?.imageModel) || undefined,
    taskKind: 'image',
    raw: {
      provider: 'huobao',
      response,
    },
    createdAt: Date.now(),
  }
}

export function normalizeHuobaoVideoTask(response: unknown): {
  taskId?: string
  url?: string
  status?: string
  raw: unknown
} {
  const record = response && typeof response === 'object' ? response as Record<string, unknown> : {}
  const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {}
  return {
    taskId:
      asTrimmedString(record.id) ||
      asTrimmedString(record.task_id) ||
      asTrimmedString(record.taskId) ||
      asTrimmedString(data.id) ||
      asTrimmedString(data.task_id) ||
      asTrimmedString(data.taskId),
    url: firstUrl(response),
    status: asTrimmedString(record.status) || asTrimmedString(data.status),
    raw: response,
  }
}

export function normalizeHuobaoVideoResponse(
  response: unknown,
  node: GenerationCanvasNode,
  durationSeconds?: number,
): GenerationNodeResult {
  const url = firstUrl(response)
  if (!url) throw new Error('生成渠道视频生成成功但没有返回视频地址')
  const task = normalizeHuobaoVideoTask(response)
  return {
    id: `result-${node.id}-${task.taskId || Date.now()}`,
    type: 'video',
    url,
    taskId: task.taskId,
    taskKind: 'video',
    durationSeconds,
    model: asTrimmedString(node.meta?.modelKey) || asTrimmedString(node.meta?.videoModel) || undefined,
    raw: {
      provider: 'huobao',
      response,
    },
    createdAt: Date.now(),
  }
}
