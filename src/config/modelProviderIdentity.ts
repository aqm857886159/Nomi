import type { DedupedModel, ModelProviderRef } from './modelIdentity'
import { getKnownVendor } from './knownVendors'
import { VENDOR_LOGOS } from '../assets/vendor-logos'
import type { NomiIdentityIconSource } from '../design'

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
  // 即梦（Dreamina）必须排在豆包前面判，而且是**独立一条**：两者都是字节旗下产品，但品牌不同，
  // 不能共用一块牌子（2026-09-14 修：原先 `dreamina` 被并进豆包那条正则，即梦的四个模型
  // 在界面上挂的是豆包的头像）。
  if (archetypes.some((id) => id.startsWith('dreamina'))) {
    return { kind: 'model', src: VENDOR_LOGOS.dreamina, fallback: 'Jm' }
  }
  if (archetypes.some((id) => /^(?:seedance|seedream|doubao-tts)/.test(id))) {
    return { kind: 'model', src: VENDOR_LOGOS.doubao, fallback: 'D' }
  }
  if (archetypes.some((id) => id.startsWith('modelscope-'))) {
    return { kind: 'model', src: VENDOR_LOGOS.modelscope, fallback: 'M' }
  }
  if (archetypes.some((id) => id.startsWith('minimax-'))) {
    return { kind: 'model', src: VENDOR_LOGOS.minimax, fallback: 'M' }
  }
  if (archetypes.some((id) => id.startsWith('eleven-'))) {
    return { kind: 'model', src: VENDOR_LOGOS.elevenlabs, fallback: 'E' }
  }
  if (archetypes.some((id) => id === 'meshy-7')) {
    return { kind: 'model', src: VENDOR_LOGOS.meshy, fallback: 'M' }
  }
  return { kind: 'model' }
}
