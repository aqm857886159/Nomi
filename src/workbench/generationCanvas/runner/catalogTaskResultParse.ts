import i18n from '../../../i18n'
import {
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

// transcribe(Whisper) 也是「无 asset、文本在 raw」——同走文本支（raw.text 由 extractTextFromChatRaw 末尾捕获）。
const TEXT_TASK_KINDS = new Set<TaskKind>(['chat', 'prompt_refine', 'image_to_prompt', 'transcribe'])

/**
 * C5: 从 chat 任务的 raw 响应里取出模型生成的文本。runtime 文本分支直接 POST
 * /v1/chat/completions 并把响应原样放进 raw（assets 为空），所以这里要兼容
 * OpenAI（choices[].message.content）与 Anthropic Messages（content[].text）两种形状。
 */
function extractTextFromChatRaw(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const record = raw as Record<string, unknown>
  // APIMart MiniMax-H3 Context-IR 是异步 profile：完成态文本位于
  // data.result.prompt（不是 OpenAI choices，也不是视频 assets）。保留通用 shape 读取，
  // 让 prompt_refine mapping 与已有文本节点/优化器共用同一归一出口。
  const data = record.data
  if (data && typeof data === 'object') {
    const result = (data as Record<string, unknown>).result
    if (result && typeof result === 'object') {
      const prompt = asTrimmedString((result as Record<string, unknown>).prompt)
      if (prompt) return prompt
    }
  }
  const directResult = record.result
  if (directResult && typeof directResult === 'object') {
    const prompt = asTrimmedString((directResult as Record<string, unknown>).prompt)
    if (prompt) return prompt
  }
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

function generationTypeForTask(taskKind: TaskKind): GenerationResultType {
  if (taskKind === 'text_to_video' || taskKind === 'image_to_video') return 'video'
  if (taskKind === 'text_to_audio') return 'audio'
  if (taskKind === 'text_to_3d' || taskKind === 'image_to_3d') return 'model3d'
  return 'image'
}

/**
 * 终态失败 → 抛给 runner 的 message。真实原因取 `result.error`（主进程按 profile 声明的
 * error_message 映射取出的上游原话，见 electron/tasks/responseParsing）。
 *
 * 这里**不再自己解析 raw**：那份形状猜测读不到 kie `data.failMsg`、runninghub `errorMessage`
 * 一类家族专属路径，也不下钻对象型的 `error`，于是每家的失败都退化成一句「模型任务执行失败」
 * （2026-07-30 用户真机报的就是它）。猜测逻辑已合并进主进程那个唯一读点。
 */
function describeTaskFailure(result: TaskResultDto): string {
  const suffix = [
    result.id ? `taskId=${result.id}` : '',
    result.kind ? `kind=${result.kind}` : '',
  ].filter(Boolean).join(', ')
  const prefix = asTrimmedString(result.error) || i18n.t('generationCommon.error.taskFailed')
  return suffix ? `${prefix} (${suffix})` : prefix
}

function readDurationSeconds(asset: { durationSeconds?: unknown } | null | undefined): number | undefined {
  return asFiniteNumber(asset?.durationSeconds)
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
    if (!text) throw new Error(i18n.t('generationCommon.error.noText'))
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
  const firstAudioAsset = result.assets.find((item) => item.type === 'audio' && asTrimmedString(item.url))
  const asset = firstVideoAsset || firstImageAsset || firstAudioAsset || result.assets.find((item) => asTrimmedString(item.url))
  if (!asset) throw new Error(i18n.t(inferredType === 'video' ? 'generationCommon.error.noVideoUrl' : inferredType === 'audio' ? 'generationCommon.error.noAudio' : 'generationCommon.error.noImageUrl'))
  const type = (asset.type === 'video' || asset.type === 'image' || asset.type === 'audio') ? asset.type : inferredType
  // E11: propagate provenance from electron TaskResult into the node result.
  const provenance = extractProvenanceFromTaskResult(result)
  return {
    id: `${node.id}-${result.id || Date.now()}`,
    type,
    url: asset.url,
    thumbnailUrl: asset.thumbnailUrl || undefined,
    ...(asset.providerUrl ? { providerUrl: asset.providerUrl } : {}),
    model: selectedModelKey(node) || undefined,
    durationSeconds: type === 'video' ? readDurationSeconds(asset) : undefined,
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
