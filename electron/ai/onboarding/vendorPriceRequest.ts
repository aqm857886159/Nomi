import type { CatalogState } from '../../catalog/types'
import { selectTaskMapping } from '../../catalog/types'
import { modelReferenceSelection } from '../../catalog/modelCatalogListing'
import { applyHeadlessParamDefaults } from '../../catalog/taskParams'
import { buildProfileHttpRequest } from '../../catalog/profileHttpRequest'
import { normalizeApimartCanonicalModelId } from '../../catalog/apimartModelIds'
import { isJsonRecord } from '../../jsonUtils'
import type { VendorPriceQuery, VendorPriceRequest } from '../../shared/contracts/vendorPricePreview'
import { builtinVendorKeyOfKey } from '../../shared/builtinVendorIdentity'

/**
 * 请求体里会进约价查询的键：它们的值改变价格，由下面 priceQueryFromRequest 逐个读出来。
 * `image_urls` 读成输入图张数（除图层分离外，带输入图一律不报价——输入图另收费，单靠输出价算不出）；
 * `layer_decomposition` / `layer_decomposition_options` 读成图层分离的开关与层数上限（docs.apimart.ai seedream-5-5 Billing，2026-11-26）。
 */
export const PRICE_QUERY_KEYS: ReadonlySet<string> = new Set(['model', 'n', 'count', 'quality', 'resolution', 'duration', 'size', 'audio', 'generate_audio',
  'image_urls', 'layer_decomposition', 'layer_decomposition_options'])
/** 任何 APIMart 模型上都不改价、约价时直接忽略的键（内容本身、随机种子、水印、比例）。 */
export const PRICE_IGNORED_KEYS: ReadonlySet<string> = new Set(['prompt', 'negative_prompt', 'aspect_ratio', 'seed', 'watermark'])
/**
 * 只在核过该模型官方计费段之后才忽略的键：计费公式没列它、或明说不计费。
 * 按发给供应商的线上模型名登记（规范化之后的 body.model），不按目录里的 modelKey。
 * 别的模型带同名键（文档没核或说不清）仍整体不报价，所以不放进全局名单。
 */
export const PRICE_IGNORED_KEYS_BY_WIRE_MODEL: Readonly<Record<string, ReadonlySet<string>>> = {
  // docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation.md 的 Billing（2026-11-26）：「seconds × resolution tier」；
  // nsfw_check 原文「The moderation call itself is not billed」；output_format / return_last_frame 不在计费因素里。
  'seedance-2.5': new Set(['output_format', 'return_last_frame', 'nsfw_check']),
}
/** 已知键里「可能改价或文档没说清、约价还不会处理」的：带它就不报价（保守，宁可不报也不报错价）。每个键写理由和出处。 */
export const PRICE_UNQUOTABLE_KEYS: Readonly<Record<string, string>> = {
  output_format: '除 Seedance 2.5 外没核过各模型计费页；Seedream 5.0 Pro 页按实际像素计费、没提格式（docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation.md）',
  nsfw_check: '计费文档说不清：Seedream 5.0 Pro 页只说「adding no moderation cost」，没写开启后的审核费（同上）；Seedance 2.5 页明说不计费，已按模型登记',
  return_last_frame: '除 Seedance 2.5 外没核过计费页',
  mode: 'kling-v3 的 std / pro 档位，约价查询不会读它，计费页没核过',
  grounding: 'flux-3-image 的联网检索开关，计费页没核过',
  steps: 'flux-3-image-klein 的采样步数，计费页没核过',
  source_task_id: 'MiniMax-H3-Regeneration 的重生成来源任务，按来源任务计费，约价不会处理',
  background: '图片只有 auto 才不改价（priceQueryFromRequest 里单独放行），其余值会改价',
}

/** 约价怎么对待一个请求体的键。unclassified = 没人登记过，目录新加了键会落到这里。 */
export type PriceKeyClass = 'query' | 'ignored' | 'unquotable' | 'unclassified'
export function classifyPriceKey(wireModel: string, key: string): PriceKeyClass {
  if (PRICE_QUERY_KEYS.has(key)) return 'query'
  if (PRICE_IGNORED_KEYS.has(key) || PRICE_IGNORED_KEYS_BY_WIRE_MODEL[wireModel]?.has(key)) return 'ignored'
  return key in PRICE_UNQUOTABLE_KEYS ? 'unquotable' : 'unclassified'
}

/** 图层分离请求读出的层数上限（含底图）：开关真为 true、选项里有正整数上限才算；否则 null（不是图层分离或读不清 → 不报价）。 */
function layerSplitMaxImages(body: Record<string, unknown>): number | null | undefined {
  if (body.layer_decomposition === undefined) return undefined
  const options = body.layer_decomposition_options
  const max = isJsonRecord(options) ? Number(options.max_images) : NaN
  return body.layer_decomposition === true && Number.isSafeInteger(max) && max >= 1 ? max : null
}

/**
 * 能报价的请求：文生图 / 文生视频（不带输入媒体），以及图层分离（改图里唯一能算的一种：
 * 输入图费是价目上的一个公开数，层数上限在请求里，见 vendorPricePreview.publicPriceFor 的图层分离一支）。
 */
export function priceQueryFromRequest(payload: VendorPriceRequest, catalog: CatalogState): VendorPriceQuery | null {
  const vendorKey = payload?.vendorKey
  const request = payload?.request
  if (typeof vendorKey !== 'string' || builtinVendorKeyOfKey(vendorKey) !== 'apimart' || !request) return null
  const kind = request.kind === 'text_to_image' || request.kind === 'image_edit' ? 'image' : request.kind === 'text_to_video' ? 'video' : null
  if (!kind || !isJsonRecord(request.extras)) return null
  const vendor = catalog.vendors.find(row => row.key === vendorKey && row.enabled)
  const model = catalog.models.find(row => row.vendorKey === vendorKey && row.modelKey === request.extras?.modelKey && row.enabled)
  if (!vendor || !model || model.kind !== kind || model.customCall) return null
  const selection = request.extras.archetype
  const mode = isJsonRecord(selection) ? selection.modeId : request.extras.modeId
  const modeId = typeof mode === 'string' ? mode : undefined
  const mapping = selectTaskMapping(catalog.mappings, vendorKey, request.kind, model.modelKey, modeId)
  if (!mapping?.create || mapping.create.process) return null
  const transform = mapping.create.request_transform
  if (transform && transform !== 'apimart-canonical-model-id') return null
  try {
    const extras = applyHeadlessParamDefaults(request.extras, modelReferenceSelection(vendorKey, model, request.kind, modeId), mapping.create.defaultParams, mapping.create.body)
    const rendered = buildProfileHttpRequest({ vendor, model, operation: mapping.create, apiKey: '', request: { ...request, extras } })
    const url = new URL(rendered.url)
    if (rendered.method !== 'POST' || url.origin !== new URL(vendor.baseUrlHint || '').origin
        || url.pathname !== (kind === 'image' ? '/v1/images/generations' : '/v1/videos/generations')) return null
    const body = transform ? normalizeApimartCanonicalModelId(rendered.body) : rendered.body
    if (!isJsonRecord(body) || typeof body.model !== 'string' || !body.model.trim()) return null
    // 只有「会进查询」或「核过不改价」的键放行；没登记的键（含 unquotable / unclassified）一律不报价。
    const quotable = (key: string) => ['query', 'ignored'].includes(classifyPriceKey(body.model as string, key))
      || (key === 'background' && kind === 'image' && body.background === 'auto')
    if (!Object.keys(body).every(quotable)) return null
    const inputs = body.image_urls
    if (inputs !== undefined && !Array.isArray(inputs)) return null
    const referenceCount = Array.isArray(inputs) ? inputs.length : 0
    const layerMax = layerSplitMaxImages(body)
    // 改图只有图层分离能算；其余带输入图的请求（含图层分离读不清的）不报价，也就不去问价目。
    if (layerMax === null || (request.kind === 'image_edit' ? layerMax === undefined : referenceCount > 0 || layerMax !== undefined)) return null
    const count = Number(body.n ?? body.count ?? 1)
    if (!Number.isSafeInteger(count) || count < 1) return null
    const durationSec = body.duration == null ? undefined : Number(body.duration)
    if (durationSec != null && (!Number.isFinite(durationSec) || durationSec <= 0)) return null
    const audio = body.generate_audio ?? body.audio
    if (audio != null && typeof audio !== 'boolean') return null
    return { vendorKey, modelId: body.model, kind, count, durationSec,
      size: typeof body.size === 'string' ? body.size : undefined,
      quality: typeof body.quality === 'string' ? body.quality : undefined,
      resolution: typeof body.resolution === 'string' ? body.resolution : undefined,
      referenceCount, hasAudio: audio ?? undefined, hasVideoInput: false,
      ...(layerMax ? { layerSplit: { maxImages: layerMax } } : {}) }
  } catch {
    // Incomplete drafts, non-HTTP calls, and unrecognized templates have no public quote.
    return null
  }
}
