export type VendorPreferenceEntry = { vendorKey: string; name: string }

export function orderConfiguredVendors(entries: readonly VendorPreferenceEntry[], savedOrder: readonly string[]): VendorPreferenceEntry[] {
  const byKey = new Map(entries.map((entry) => [entry.vendorKey, entry]))
  const seen = new Set<string>()
  const ordered: VendorPreferenceEntry[] = []
  for (const key of savedOrder) {
    const entry = byKey.get(key)
    if (entry && !seen.has(key)) { ordered.push(entry); seen.add(key) }
  }
  for (const entry of entries) {
    if (!seen.has(entry.vendorKey)) { ordered.push(entry); seen.add(entry.vendorKey) }
  }
  return ordered
}
