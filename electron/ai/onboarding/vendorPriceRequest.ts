import type { CatalogState } from '../../catalog/types'
import { selectTaskMapping } from '../../catalog/types'
import { modelReferenceSelection } from '../../catalog/modelCatalogListing'
import { applyHeadlessParamDefaults } from '../../catalog/taskParams'
import { buildProfileHttpRequest } from '../../catalog/profileHttpRequest'
import { normalizeApimartCanonicalModelId } from '../../catalog/apimartModelIds'
import { isJsonRecord } from '../../jsonUtils'
import type { VendorPriceQuery, VendorPriceRequest } from '../../shared/contracts/vendorPricePreview'
import { builtinVendorKeyOfKey } from '../../shared/builtinVendorIdentity'

const PRICE_FIELDS = new Set(['model', 'prompt', 'negative_prompt', 'n', 'count', 'quality', 'resolution', 'duration', 'aspect_ratio', 'size', 'seed', 'watermark', 'audio', 'generate_audio'])

/** Only supported text-to-media bodies can be priced without inspecting external input assets. */
export function priceQueryFromRequest(payload: VendorPriceRequest, catalog: CatalogState): VendorPriceQuery | null {
  const vendorKey = payload?.vendorKey
  const request = payload?.request
  if (typeof vendorKey !== 'string' || builtinVendorKeyOfKey(vendorKey) !== 'apimart' || !request) return null
  const kind = request.kind === 'text_to_image' ? 'image' : request.kind === 'text_to_video' ? 'video' : null
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
    const extras = applyHeadlessParamDefaults(request.extras, modelReferenceSelection(vendorKey, model, request.kind), mapping.create.defaultParams, mapping.create.body)
    const rendered = buildProfileHttpRequest({ vendor, model, operation: mapping.create, apiKey: '', request: { ...request, extras } })
    const url = new URL(rendered.url)
    if (rendered.method !== 'POST' || url.origin !== new URL(vendor.baseUrlHint || '').origin
        || url.pathname !== (kind === 'image' ? '/v1/images/generations' : '/v1/videos/generations')) return null
    const body = transform ? normalizeApimartCanonicalModelId(rendered.body) : rendered.body
    if (!isJsonRecord(body) || typeof body.model !== 'string' || !body.model.trim()) return null
    if (Object.keys(body).some(key => !PRICE_FIELDS.has(key))) return null
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
      referenceCount: 0, hasAudio: audio ?? undefined, hasVideoInput: false }
  } catch {
    // Incomplete drafts, non-HTTP calls, and unrecognized templates have no public quote.
    return null
  }
}
