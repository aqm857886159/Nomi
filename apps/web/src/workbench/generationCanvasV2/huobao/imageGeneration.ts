import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import {
  adaptHuobaoImageRequest,
  defaultHuobaoRequest,
  type HuobaoRequest,
} from './providerAdapters'
import { normalizeHuobaoImageResponse } from './responseAdapters'

export type HuobaoImageGenerationOptions = {
  referenceImages?: unknown
  request?: HuobaoRequest
}

function asTrimmedString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
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
  ;['url', 'imageUrl', 'image_url', 'referenceImages', 'references', 'assetInputs', 'images'].forEach((key) => {
    collectUrls(record[key], output)
  })
  return output
}

function uniqueUrls(values: unknown[]): string[] {
  return Array.from(new Set(values.flatMap((value) => collectUrls(value))))
}

export function buildHuobaoImageRequest(node: GenerationCanvasNode, options: HuobaoImageGenerationOptions = {}) {
  const prompt = asTrimmedString(node.prompt)
  if (!prompt) throw new Error('image prompt is required')

  const meta = node.meta || {}
  const modelKey =
    asTrimmedString(meta.modelKey) ||
    asTrimmedString(meta.imageModel) ||
    asTrimmedString(meta.modelAlias)
  if (!modelKey) throw new Error('image model is required')
  const referenceImages = uniqueUrls([options.referenceImages, node.references, meta.referenceImages, meta.assetInputs])
  const image = referenceImages[0]

  return adaptHuobaoImageRequest({
    model: modelKey,
    prompt,
    size: asTrimmedString(meta.size) || asTrimmedString(meta.imageSize),
    quality: asTrimmedString(meta.quality) || asTrimmedString(meta.imageQuality),
    style: asTrimmedString(meta.style) || asTrimmedString(meta.imageStyle),
    image,
  })
}

export async function runHuobaoImageGeneration(
  node: GenerationCanvasNode,
  options: HuobaoImageGenerationOptions = {},
): Promise<GenerationNodeResult> {
  const requestData = buildHuobaoImageRequest(node, options)
  const response = await (options.request || defaultHuobaoRequest)({
    url: '/v1/images/generations',
    method: 'POST',
    data: requestData,
  })
  return normalizeHuobaoImageResponse(response, node)
}
