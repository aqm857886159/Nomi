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
/**
 * 约数的口径（缺省 = 按公开价的这次约数）：
 * - `output-estimate`：只算了输出、实际按 token 结算 → 键上印「≈」；
 * - `upper-bound`：按请求里的上限预扣、出完按实际产出结算（今天只有图层分离：上限 = 层数）→ 键上印「≤」，悬停说清按上限估。
 */
export type VendorPriceBasis = "output-estimate" | "upper-bound";
export type VendorPricePreview = { usd: number; credits: number; source: string; basis?: VendorPriceBasis };
