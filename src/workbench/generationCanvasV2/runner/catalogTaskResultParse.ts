import {
  type TaskAssetDto,
  type TaskKind,
  type TaskResultDto,
} from '../../api/taskApi'
import type {
  GenerationCanvasNode,
  GenerationNodeResult,
  GenerationProvenance,
  GenerationResultType,
} from '../model/generationCanvasTypes'
import { asFiniteNumber, asTrimmedString, selectedModelKey } from './catalogTaskResolve'

const TEXT_TASK_KINDS = new Set<TaskKind>(['chat', 'prompt_refine', 'image_to_prompt'])

/**
 * C5: 从 chat 任务的 raw 响应里取出模型生成的文本。runtime 文本分支直接 POST
 * /v1/chat/completions 并把响应原样放进 raw（assets 为空），所以这里要兼容
 * OpenAI（choices[].message.content）与 Anthropic Messages（content[].text）两种形状。
 */
function extractTextFromChatRaw(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const record = raw as Record<string, unknown>
  const choices = record.choices
  if (Array.isArray(choices) && choices.length) {
    const first = choices[0] as Record<string, unknown> | undefined
    const message = first?.message as Record<string, unknown> | undefined
    const content = message?.content
    if (typeof content === 'string') return content.trim()
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part === 'string' ? part : asTrimmedString((part as Record<string, unknown>)?.text)))
        .filter(Boolean)
        .join('')
        .trim()
    }
    const legacyText = asTrimmedString(first?.text)
    if (legacyText) return legacyText
  }
  const content = record.content
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => asTrimmedString((part as Record<string, unknown>)?.text))
      .filter(Boolean)
      .join('')
      .trim()
    if (joined) return joined
  }
  return asTrimmedString(record.text)
}

function firstAsset(result: TaskResultDto, expectedType: GenerationResultType): TaskAssetDto {
  const asset = result.assets.find((item) => item.type === expectedType && asTrimmedString(item.url))
  if (!asset) {
    const label = expectedType === 'image' ? '图片' : '视频'
    throw new Error(`模型任务完成但没有返回${label}地址`)
  }
  return asset
}

function generationTypeForTask(taskKind: TaskKind): GenerationResultType {
  if (taskKind === 'text_to_video' || taskKind === 'image_to_video') return 'video'
  return 'image'
}

function readFailureMessageFromRaw(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  const record = raw as Record<string, unknown>
  const direct = [
    record.message,
    record.error,
    record.errorMessage,
    record.failureReason,
    record.reason,
  ]
  for (const value of direct) {
    const text = asTrimmedString(value)
    if (text) return text
  }
  const nested = [record.raw, record.response, record.data, record.result]
  for (const value of nested) {
    const text = readFailureMessageFromRaw(value)
    if (text) return text
  }
  return ''
}

function describeTaskFailure(result: TaskResultDto): string {
  const rawMessage = readFailureMessageFromRaw(result.raw)
  const suffix = [
    result.id ? `taskId=${result.id}` : '',
    result.kind ? `kind=${result.kind}` : '',
  ].filter(Boolean).join(', ')
  const prefix = rawMessage || '模型任务执行失败'
  return suffix ? `${prefix} (${suffix})` : prefix
}

function readDurationSeconds(node: GenerationCanvasNode): number | undefined {
  const meta = node.meta || {}
  return asFiniteNumber(meta.durationSeconds) ?? asFiniteNumber(meta.videoDuration)
}

export function normalizeCatalogTaskResult(
  result: TaskResultDto,
  node: GenerationCanvasNode,
): GenerationNodeResult {
  if (result.status === 'failed') {
    throw new Error(describeTaskFailure(result))
  }
  // C5: 文本任务没有 asset，文本在 raw 里。单独成支，不走下面的图片/视频 asset 逻辑。
  if (TEXT_TASK_KINDS.has(result.kind)) {
    const text = extractTextFromChatRaw(result.raw)
    if (!text) throw new Error('模型任务完成但没有返回文本内容')
    const provenance = extractProvenanceFromTaskResult(result)
    return {
      id: `${node.id}-${result.id || Date.now()}`,
      type: 'text',
      text,
      model: selectedModelKey(node) || undefined,
      taskId: result.id,
      taskKind: 'text',
      raw: result.raw,
      createdAt: Date.now(),
      ...(provenance ? { provenance } : {}),
    }
  }
  const inferredType = generationTypeForTask(result.kind)
  // Prefer actual asset type over taskKind inference — if the API returns a video asset, show video
  const firstVideoAsset = result.assets.find((item) => item.type === 'video' && asTrimmedString(item.url))
  const firstImageAsset = result.assets.find((item) => item.type === 'image' && asTrimmedString(item.url))
  const asset = firstVideoAsset || firstImageAsset || result.assets.find((item) => asTrimmedString(item.url))
  if (!asset) throw new Error(inferredType === 'video' ? '模型任务完成但没有返回视频地址' : '模型任务完成但没有返回图片地址')
  const type = (asset.type === 'video' || asset.type === 'image') ? asset.type : inferredType
  // E11: propagate provenance from electron TaskResult into the node result.
  const provenance = extractProvenanceFromTaskResult(result)
  return {
    id: `${node.id}-${result.id || Date.now()}`,
    type,
    url: asset.url,
    thumbnailUrl: asset.thumbnailUrl || undefined,
    model: selectedModelKey(node) || undefined,
    durationSeconds: type === 'video' ? readDurationSeconds(node) : undefined,
    taskId: result.id,
    taskKind: type,
    assetId: asset.assetId || undefined,
    assetRefId: asset.assetRefId || undefined,
    raw: result.raw,
    createdAt: Date.now(),
    ...(provenance ? { provenance } : {}),
  }
}

/**
 * E11: Extract provenance from electron TaskResult.
 *
 * The runtime attaches a `provenance` sibling field at the TaskResult level
 * (see electron/runtime.ts runTask). This helper validates the minimum
 * required field (`timestamp`) and returns a clean GenerationProvenance
 * for the renderer to embed in node.result.provenance.
 *
 * Returns undefined for legacy results (e.g., from v0.4.0 cached tasks).
 */
function extractProvenanceFromTaskResult(result: TaskResultDto): GenerationProvenance | undefined {
  const raw = (result as TaskResultDto & { provenance?: unknown }).provenance
  if (!raw || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  const ts = typeof rec.timestamp === 'number' ? rec.timestamp : Date.now()
  return {
    timestamp: ts,
    ...(typeof rec.provider === 'string' ? { provider: rec.provider } : {}),
    ...(typeof rec.modelKey === 'string' ? { modelKey: rec.modelKey } : {}),
    ...(typeof rec.modelVersion === 'string' ? { modelVersion: rec.modelVersion } : {}),
    ...(typeof rec.prompt === 'string' ? { prompt: rec.prompt } : {}),
    ...(typeof rec.negativePrompt === 'string' ? { negativePrompt: rec.negativePrompt } : {}),
    ...(typeof rec.seed === 'number' ? { seed: rec.seed } : {}),
    ...(rec.params && typeof rec.params === 'object' ? { params: rec.params as Record<string, unknown> } : {}),
    ...(typeof rec.vendorRequestId === 'string' ? { vendorRequestId: rec.vendorRequestId } : {}),
    ...(typeof rec.agentRunId === 'string' ? { agentRunId: rec.agentRunId } : {}),
  }
}
