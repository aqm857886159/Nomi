import type { TaskRequest } from '../../taskTypes'

export type VendorPriceRequest = { vendorKey: string; request: TaskRequest };
/** Preview of a public rate, never a consumable approval or a record of actual billing. */
export type VendorPriceQuery = {
  vendorKey: string; modelId: string; kind: "image" | "video"; resolution?: string; size?: string; quality?: string;
  durationSec?: number; count: number; referenceCount: number; hasAudio?: boolean; hasVideoInput?: boolean;
};
export type VendorPricePreview = { usd: number; credits: number; source: string; basis?: "output-estimate" };
