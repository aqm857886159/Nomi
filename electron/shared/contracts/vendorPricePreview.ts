import type { TaskRequest } from '../../taskTypes'

export type VendorPriceRequest = { vendorKey: string; request: TaskRequest };
/** Preview of a public rate, never a consumable approval or a record of actual billing. */
export type VendorPriceQuery = {
  vendorKey: string; modelId: string; kind: "image" | "video"; resolution?: string; size?: string; quality?: string;
  durationSec?: number; count: number; referenceCount: number; hasAudio?: boolean; hasVideoInput?: boolean;
};
export type VendorPricePreview = { usd: number; credits: number; source: string; basis?: "output-estimate" };
/** The listing's own reason for having no fixed rate: billed by tokens, or by tiers the request cannot pick up front. */
export type PublicPriceGap = "token" | "tiered";
export type PublicPriceListing = { quote: VendorPricePreview | null; gap: PublicPriceGap | null };
