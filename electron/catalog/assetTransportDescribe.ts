// 「本机素材现在实际往哪传」的描述层（设置页那张状态卡的数据源）。
//
// **为什么必须住在主进程**：通道优先级只有一份真相 —— resolveAssetIngestionWithFallback。
// 渲染层若照着规则自己再算一遍，就多出第二个真相源：以后加一条通道、改一次顺序，卡片会和
// 真实行为悄悄对不上，而**说谎的状态卡比没有状态卡更坏**（用户会照着它做隐私判断）。
// 所以这里不复刻任何规则，只调那个正在跑的解析器，取它排出来的第一名。
//
// 描述的是「未指定目标供应商时的默认路由」。目标是本地 ComfyUI 时另走它自己的 /upload/image
// （素材根本不出本机，比这里报的更安全），不为这个特例加分支。

import { resolveAssetIngestionWithFallback } from "./assetLocalization";
import { ingestionVisibility, type AssetTransportVisibility } from "./assetTransportPolicy";
import type { AssetIngestion, AssetMediaKind } from "./types";

export type AssetChannelDescription = {
  kind: AssetMediaKind;
  /** 这条通道属于哪家；匿名公共托管为 null。 */
  vendorKey: string | null;
  /** 实际收文件的主机名（如 kieai.redpandaai.co / litterbox.catbox.moe）；无端点的策略为 null。 */
  host: string | null;
  visibility: AssetTransportVisibility;
  /** 链接有效期（秒）；通道没声明则为 null。 */
  ttlSeconds: number | null;
};

type DescribeCatalog = {
  vendors: Array<{ key?: string; assetIngestion?: AssetIngestion }>;
  getApiKey: (vendorKey: string) => string | null;
};

/** 描述三种真实输入：图片、视频、音频的通道能力可能不同，不能把音频藏在视频文案里。 */
const DESCRIBED_KINDS: ReadonlyArray<AssetMediaKind> = ["image", "video", "audio"];

function hostOf(ingestion: AssetIngestion): string | null {
  // anon-chain 自己没有端点，真正收文件的是链上第一跳（litterbox）——它失败才轮到第二跳，
  // 所以「现在走哪」的诚实答案就是第一跳，ttl 也取它的（链上声明的是全链保守下限，会低报）。
  if (ingestion.strategy === "anon-chain") {
    const first = ingestion.chain[0];
    return first ? hostOf(first) : null;
  }
  if (ingestion.strategy === "inline-base64" || ingestion.strategy === "none") return null;
  try {
    return new URL(ingestion.endpoint).host;
  } catch {
    return ingestion.endpoint;
  }
}

function ttlOf(ingestion: AssetIngestion): number | null {
  if (ingestion.strategy === "anon-chain") {
    const first = ingestion.chain[0];
    if (first) return ttlOf(first);
  }
  return ingestion.ttlSeconds ?? null;
}

/**
 * 每种媒体类型现在会走的第一条通道。返回空数组项 = 该类型无任何可用通道（诚实地报 null 通道，
 * 让界面说「传不出去」，而不是假装有）。
 */
export function describeAssetTransportChannels(catalog: DescribeCatalog): AssetChannelDescription[] {
  return DESCRIBED_KINDS.map((kind) => {
    const winner = resolveAssetIngestionWithFallback(null, catalog.vendors, catalog.getApiKey, kind)[0];
    if (!winner) return { kind, vendorKey: null, host: null, visibility: "provider-private" as const, ttlSeconds: null };
    return {
      kind,
      vendorKey: winner.vendorKey,
      host: hostOf(winner.ingestion),
      visibility: ingestionVisibility(winner.ingestion),
      ttlSeconds: ttlOf(winner.ingestion),
    };
  });
}
