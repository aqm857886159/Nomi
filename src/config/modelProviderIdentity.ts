import { getKnownVendor } from './knownVendors'
import type { NomiIdentityIconSource } from '../design'

// 模型的身份图住 `modelFamilyIcons.ts`（家族 → 品牌图的唯一对照表）；这里只管「走哪家供应商」的小标。
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
