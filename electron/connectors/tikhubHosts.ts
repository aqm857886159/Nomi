// TikHub 候选域名单 —— 双域名全球化的**单一 owner**（connector 定义、出站、选路都从这里取）。
//
// TikHub 官方两域（一手 api.tikhub.io/openapi.json，V5.3.2，checkedAt 2026-09-01）：
//   · api.tikhub.io  ：主域（Production base）。
//   · api.tikhub.dev ：加速域，spec 明写「🇨🇳 大陆用户请使用 https://api.tikhub.dev（无需代理，直接可用）」——
//                       主域在大陆被墙（用户实战研究事实），故需按最优线路自动选。
// 单拎一份、零依赖：tikhubConnector.ts（出站 + connector 定义）与 tikhubRoute.ts（选路）都 import 它，
// 避免两者互相 import 成环。

export const TIKHUB_HOST_PRIMARY = "api.tikhub.io";
export const TIKHUB_HOST_ACCELERATED = "api.tikhub.dev";

/** 候选域清单（allowedOrigins 覆盖全部；实测选路在这两者间挑）。 */
export const TIKHUB_HOSTS = [TIKHUB_HOST_PRIMARY, TIKHUB_HOST_ACCELERATED] as const;

/** 凭据 vendorKey / connectorId（复用 catalog apiKeysByVendor 的 safeStorage 存储，不另起加密管线）。 */
export const TIKHUB_CONNECTOR_ID = "tikhub";
