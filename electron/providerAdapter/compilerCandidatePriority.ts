export function prioritizeCompilerCandidates<T extends { vendorKey: string }>(
  candidates: readonly T[],
  targetVendorKey?: string,
): T[] {
  const seenVendors = new Set<string>();
  const firstPerVendor: T[] = [];
  const remaining: T[] = [];
  for (const candidate of candidates) {
    if (seenVendors.has(candidate.vendorKey)) remaining.push(candidate);
    else {
      seenVendors.add(candidate.vendorKey);
      firstPerVendor.push(candidate);
    }
  }
  const prioritized = [...firstPerVendor, ...remaining];
  if (!targetVendorKey) return prioritized;
  return [
    ...prioritized.filter((candidate) => candidate.vendorKey !== targetVendorKey),
    ...prioritized.filter((candidate) => candidate.vendorKey === targetVendorKey),
  ];
}
