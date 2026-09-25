// 供应商产物（生成出的图 / 视频 / 音频）从远端取回的**唯一一条线路策略**。
//
// 为什么要单独成一个 owner（2026-09-25 用户报「Agent 付费卡生成的视频早就出好了，节点一直转圈」）：
// 同一段供应商视频，普通「生成」那条路（`importRemoteAsset` ← `localizeTaskAsset`）用的是
// 60 秒 / 200MB / 这家供应商自己的线路；Agent 付费卡那条路（`generationOutputMaterializer`）
// 自己又调了一次 `hardenedFetch`，只给了 maxBytes——于是超时落回 hardenedFetch 的缺省 20 秒、
// 也不走供应商线路。一段 15 秒的成片在慢一点的 CDN 上 20 秒传不完，付费卡那条路就每一轮都
// 下载超时、每一轮都重来，节点永远停在「生成中」，而普通生成那条路同一个文件照样落得下来。
// `downloadAsset.fetchAssetBytes` 的注释早就写着「另存与生成本地化必须同一条线路、同一组上限」，
// 那次只收了两处，第三处（付费卡）漏在外面——这就是「三份各写一遍、其中一份漂了」的形状。
// 现在三处都调这里：线路、超时、上限只有一份。
import type { HardenedFetchResult } from "../hardenedFetch";
import { hardenedFetch } from "../hardenedFetch";
import { providerDispatcher, type ProviderNetworkConfig } from "../providerNetwork";

/** 一次取回的墙钟上限。视频成片比图大一个数量级，20 秒的通用缺省对它不够。 */
export const PROVIDER_MEDIA_FETCH_TIMEOUT_MS = 60_000;
/**
 * 单个产物的字节上限。沿用素材导入原来那一个数（本次只是把三处收成一处，不新增上限）；
 * 取回与「已经在内存里的 data: 产物」都问这里，不各带一个数字。
 */
export function exceedsProviderMediaCap(byteLength: number): boolean {
  return byteLength > providerMediaCap();
}

function providerMediaCap(): number {
  return 200 * 1024 * 1024;
}

export type ProviderMediaFetchOptions = {
  /**
   * 允许的 content-type 前缀；缺省 = 图 / 视频 / 音频 / 二进制流。`'any'` = 不按类型拦
   * （「另存到磁盘」那条：用户要的就是原样字节，类型不是它的判据）。
   */
  allowContentTypes?: readonly string[] | 'any';
  /**
   * 产出这条 URL 的那家供应商自己的线路（`Vendor.network`）。**谁产的 URL 就用谁的路**：
   * 给某家单独配了代理时，提交走那条代理、取回却走应用默认线路，是同一次生成的两半在两条路上。
   */
  providerNetwork?: ProviderNetworkConfig;
  /** 仅供主进程内部已配置的本地服务（本地 ComfyUI / E2E 回环夹具）；渲染层与 Agent 无法注入。 */
  trustedPrivateOrigin?: string;
};

const DEFAULT_MEDIA_CONTENT_TYPES = ["image/", "video/", "audio/", "application/octet-stream"] as const;

export async function fetchProviderMedia(url: string, options: ProviderMediaFetchOptions = {}): Promise<HardenedFetchResult> {
  // 连接池只属于这一次取回（与 vendorHttp 同一条纪律）：建了必关，不散给调用方各记一遍。
  const providerRoute = options.providerNetwork ? providerDispatcher({ network: options.providerNetwork }) : undefined;
  try {
    return await hardenedFetch(url, {
      timeoutMs: PROVIDER_MEDIA_FETCH_TIMEOUT_MS,
      maxBytes: providerMediaCap(),
      ...(options.allowContentTypes === 'any' ? {} : { allowContentTypes: options.allowContentTypes ?? DEFAULT_MEDIA_CONTENT_TYPES }),
      ...(options.trustedPrivateOrigin ? { allowedPrivateOrigins: [options.trustedPrivateOrigin] } : {}),
      ...(providerRoute ? { dispatcher: providerRoute } : {}),
    });
  } finally {
    if (providerRoute) void providerRoute.close().catch(() => undefined);
  }
}
