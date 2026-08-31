import type { DedupedModel, ModelProviderRef } from './modelIdentity'
import { getKnownVendor } from './knownVendors'
import type { NomiIdentityIconSource } from '../design'

const DOUBAO_LOGO = new URL('../assets/vendor-logos/doubao.png', import.meta.url).href
const MODELSCOPE_LOGO = new URL('../assets/vendor-logos/modelscope.png', import.meta.url).href
const MINIMAX_LOGO = new URL('../assets/vendor-logos/minimax.png', import.meta.url).href
const ELEVENLABS_LOGO = new URL('../assets/vendor-logos/elevenlabs.png', import.meta.url).href
const MESHY_LOGO = new URL('../assets/vendor-logos/meshy.png', import.meta.url).href

function shortGlyph(value: string): string | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined
  const first = Array.from(normalized)[0]
  return /[a-z]/i.test(first) ? first.toUpperCase() : first
}

export function providerIdentityIcon(vendorKey?: string | null, vendorName?: string | null): NomiIdentityIconSource {
  const key = String(vendorKey || '').trim()
  const known = key ? getKnownVendor(key) : undefined
  return {
    kind: 'provider',
    ...(known?.logo ? { src: known.logo } : {}),
    ...(known?.glyph || shortGlyph(String(vendorName || key)) ? { fallback: known?.glyph || shortGlyph(String(vendorName || key)) } : {}),
  }
}

function explicitArchetypeId(provider: ModelProviderRef): string {
  const meta = provider.option.meta
  if (!meta || typeof meta !== 'object') return ''
  const id = (meta as { archetypeId?: unknown }).archetypeId
  return typeof id === 'string' ? id.trim().toLowerCase() : ''
}

/** Model branding is derived only from curated/certified identity, never from an unknown custom label. */
export function modelIdentityIcon(model: DedupedModel): NomiIdentityIconSource {
  const archetypes = model.providers.map(explicitArchetypeId).filter(Boolean)
  if (archetypes.some((id) => /^(?:seedance|seedream|doubao-tts|dreamina)/.test(id))) {
    return { kind: 'model', src: DOUBAO_LOGO, fallback: 'D' }
  }
  if (archetypes.some((id) => id.startsWith('modelscope-'))) {
    return { kind: 'model', src: MODELSCOPE_LOGO, fallback: 'M' }
  }
  if (archetypes.some((id) => id.startsWith('minimax-'))) {
    return { kind: 'model', src: MINIMAX_LOGO, fallback: 'M' }
  }
  if (archetypes.some((id) => id.startsWith('eleven-'))) {
    return { kind: 'model', src: ELEVENLABS_LOGO, fallback: 'E' }
  }
  if (archetypes.some((id) => id === 'meshy-7')) {
    return { kind: 'model', src: MESHY_LOGO, fallback: 'M' }
  }
  return { kind: 'model' }
}
