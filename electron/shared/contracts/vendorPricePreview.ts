import type { TaskRequest } from '../../taskTypes'

export type VendorPriceRequest = { vendorKey: string; request: TaskRequest };
/** Preview of a public rate, never a consumable approval or a record of actual billing. */
export type VendorPriceQuery = {
  vendorKey: string; modelId: string; kind: "image" | "video"; resolution?: string; size?: string; quality?: string;
  durationSec?: number; count: number; referenceCount: number; hasAudio?: boolean; hasVideoInput?: boolean;
  /**
   * 图层分离（一张输入图 → 底图 + 透明图层）：`maxImages` 是请求里的层数上限（含底图），`size` 是清晰度档。
   * 供应商按「上限 × 档位单价 + 输入图费」预扣、按实际层数结算，所以这里给的是预扣口径的约数，不是实际扣费。
   */
  layerSplit?: { maxImages: number };
};
export type VendorPricePreview = { usd: number; credits: number; source: string; basis?: "output-estimate" };
