import {
  type TaskRequestDto,
  type TaskResultDto,
  fetchWorkbenchTaskResultByVendor,
  runWorkbenchTaskByVendor,
} from '../../api/taskApi'
import type {
  GenerationCanvasNode,
  GenerationNodeResult,
} from '../model/generationCanvasTypes'
import type { ResolvedGenerationReferences } from './generationReferenceResolver'
import { resolveArchetypeForModel } from '../../../config/modelArchetypes'
import { buildArchetypeInputParams } from '../nodes/controls/archetypeMeta'
import { projectPromptForSend } from '../../assets/promptMentions'
import {
  type CatalogTaskActionOptions,
  asFiniteNumber,
  asTrimmedString,
  readStringArray,
  resolveExecutableNodeFromCatalog,
  resolveTaskKind,
  selectedModelKey,
  selectedVendor,
  uniqueStrings,
} from './catalogTaskResolve'
import { normalizeCatalogTaskResult } from './catalogTaskResultParse'

// 重导出：实现已拆到 catalogTaskResolve（节点→vendor/model/kind 选择）与
// catalogTaskResultParse（raw/asset/failure/provenance 解析），但 catalogTaskActions
// 对外公共导出面保持不变，外部 import 路径无需改动。
export type { CatalogTaskActionOptions } from './catalogTaskResolve'
export { normalizeCatalogTaskResult } from './catalogTaskResultParse'

const TERMINAL_STATUSES = new Set(['succeeded', 'failed'])

function buildReferenceExtras(
  node: GenerationCanvasNode,
  references: Partial<ResolvedGenerationReferences>,
): Record<string, unknown> {
  const meta = node.meta || {}
  const referenceImages = uniqueStrings([
    ...readStringArray(meta.referenceImages),
    ...(references.referenceImages || []),
  ])
  const styleReferenceImages = uniqueStrings([
    ...readStringArray(meta.styleReferenceImages),
    ...(references.styleReferenceImages || []),
  ])
  const characterReferenceImages = uniqueStrings([
    ...readStringArray(meta.characterReferenceImages),
    ...(references.characterReferenceImages || []),
  ])
  const compositionReferenceImages = uniqueStrings([
    ...readStringArray(meta.compositionReferenceImages),
    ...(references.compositionReferenceImages || []),
  ])
  // 认得档案的模型 → renderer 据**当前模式**把参考值打成完整 snake input（含 per-mode enum），放进
  // extras.archetypeInput，runtime 原样铺进 params（M1/M2/M3）。别的模式的残留键根本不进结果（互斥）。
  // 认不出 → 现有无条件带首/尾帧（非档案模型走老路）。
  const archetype = resolveArchetypeForModel({
    modelKey: asTrimmedString(meta.modelKey),
    modelAlias: asTrimmedString(meta.modelAlias),
    meta,
  })
  if (archetype) {
    const archetypeInput = buildArchetypeInputParams(meta, archetype, {
      firstFrameUrl: asTrimmedString(references.firstFrameUrl) || null,
      lastFrameUrl: asTrimmedString(references.lastFrameUrl) || null,
    })
    return {
      ...(referenceImages.length ? { referenceImages } : {}),
      archetypeInput,
      ...(styleReferenceImages.length ? { styleReferenceImages } : {}),
      ...(characterReferenceImages.length ? { characterReferenceImages } : {}),
      ...(compositionReferenceImages.length ? { compositionReferenceImages } : {}),
    }
  }

  const firstFrameUrl = asTrimmedString(references.firstFrameUrl) || asTrimmedString(meta.firstFrameUrl)
  const lastFrameUrl = asTrimmedString(references.lastFrameUrl) || asTrimmedString(meta.lastFrameUrl)
  return {
    ...(referenceImages.length ? { referenceImages } : {}),
    ...(firstFrameUrl ? { firstFrameUrl } : {}),
    ...(lastFrameUrl ? { lastFrameUrl } : {}),
    ...(styleReferenceImages.length ? { styleReferenceImages } : {}),
    ...(characterReferenceImages.length ? { characterReferenceImages } : {}),
    ...(compositionReferenceImages.length ? { compositionReferenceImages } : {}),
  }
}

export function buildCatalogTaskRequest(
  node: GenerationCanvasNode,
  options: CatalogTaskActionOptions = {},
): { vendor: string; request: TaskRequestDto } {
  const vendor = selectedVendor(node)
  if (!vendor) throw new Error('请先在模型管理里选择一个可用模型')
  const modelKey = selectedModelKey(node)
  if (!modelKey) throw new Error('请先选择模型')
  const rawPrompt = asTrimmedString(node.prompt)
  if (!rawPrompt) throw new Error('prompt is required')
  // @ 内联引用投影(R6 单源):发送前把 prompt 里的 @[asset:url] 标记转成 character{N}
  // (N = url 在 referenceImageUrls 有序数组里的位置)。纯文字 prompt 无标记 → 原样(no-op)。
  const prompt = projectPromptForSend(rawPrompt, readStringArray((node.meta || {}).referenceImageUrls))

  const references = options.references || {}
  const kind = resolveTaskKind(node, references)
  const meta = node.meta || {}
  const width = asFiniteNumber(meta.width)
  const height = asFiniteNumber(meta.height)
  const steps = asFiniteNumber(meta.steps)
  const cfgScale = asFiniteNumber(meta.cfgScale)
  const seed = asFiniteNumber(meta.seed)

  return {
    vendor,
    request: {
      kind,
      prompt,
      ...(typeof seed === 'number' ? { seed } : {}),
      ...(typeof width === 'number' ? { width } : {}),
      ...(typeof height === 'number' ? { height } : {}),
      ...(typeof steps === 'number' ? { steps } : {}),
      ...(typeof cfgScale === 'number' ? { cfgScale } : {}),
      extras: {
        ...meta,
        modelKey,
        modelAlias: asTrimmedString(meta.modelAlias) || modelKey,
        nodeId: node.id,
        nodeKind: node.kind,
        ...buildReferenceExtras(node, references),
      },
    },
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

async function waitForCatalogTaskResult(
  vendor: string,
  request: TaskRequestDto,
  initialResult: TaskResultDto,
  options: CatalogTaskActionOptions,
): Promise<TaskResultDto> {
  if (TERMINAL_STATUSES.has(initialResult.status)) return initialResult
  const pollIntervalMs = options.pollIntervalMs ?? 1500
  const defaultTimeout = (request.kind === 'text_to_video' || request.kind === 'image_to_video') ? 300000 : 120000
  const pollTimeoutMs = options.pollTimeoutMs ?? defaultTimeout
  const startedAt = Date.now()
  const fetchResult = options.fetchTaskResult || fetchWorkbenchTaskResultByVendor

  let current = initialResult
  while (!TERMINAL_STATUSES.has(current.status)) {
    if (Date.now() - startedAt > pollTimeoutMs) {
      throw new Error(`模型任务轮询超时: ${initialResult.id}`)
    }
    await delay(pollIntervalMs)
    const response = await fetchResult({
      taskId: initialResult.id,
      vendor,
      taskKind: request.kind,
      prompt: request.prompt,
      modelKey: asTrimmedString(request.extras?.modelKey) || null,
    })
    current = response.result
  }
  return current
}

export async function runCatalogGenerationTask(
  node: GenerationCanvasNode,
  options: CatalogTaskActionOptions = {},
): Promise<GenerationNodeResult> {
  const executableNode = await resolveExecutableNodeFromCatalog(node, options)
  const { vendor, request } = buildCatalogTaskRequest(executableNode, options)
  const runTask = options.runTask || runWorkbenchTaskByVendor
  const initialResult = await runTask(vendor, request)
  const finalResult = await waitForCatalogTaskResult(vendor, request, initialResult, options)
  return normalizeCatalogTaskResult(finalResult, executableNode)
}
