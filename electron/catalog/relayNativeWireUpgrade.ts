/**
 * Legacy startup entry points retained for the main-process caller.
 * Stored wire shapes do not prove whether a user, AI or old default authored them.
 * Preserve every stored mapping and accepted query snapshot. Never probe credentials
 * or synthesize/rewrite a video route from a model name or endpoint response.
 * New video execution requires an explicit declaration at the normal catalog boundary.
 */
export async function upgradeRelayModelsToNativeWire(): Promise<never[]> {
  return [];
}

export function scheduleRelayNativeWireUpgrade(): void {
  // Intentionally no automatic wire migration: provenance is insufficient.
}
