import type { CatalogState } from "./types";

/** Explicit credential disablement depublishes atomically. */
export function depublishVendorForDisabledCredential(state: CatalogState, vendorKey: string, now: string): void {
  if (!state.vendors.some((vendor) => vendor.key === vendorKey && vendor.enabled)) return;
  state.vendors = state.vendors.map((vendor) =>
    vendor.key === vendorKey ? { ...vendor, enabled: false, updatedAt: now } : vendor,
  );
}
