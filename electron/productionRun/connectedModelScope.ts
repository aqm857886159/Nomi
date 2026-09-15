import { readCatalog } from "../catalog/catalogStore";
import { deriveModelListing, type ModelListingEntry } from "../catalog/modelCatalogListing";

/**
 * 2026-09-14 设置页删冗余（审计 §⑥ 7）：全局「允许的供应商 / 允许的模型」白名单已删。
 *
 * 过去 run 级 policy 的 allowedProviders/allowedModels 从设置里的 161 个复选框来，默认空数组，
 * 而 `approvalPolicy.ts` 的判据是 `includes` → **空 = 全拒**：新装 Nomi 的 MCP 代跑必然被
 * `provider-not-approved` 拒掉，直到用户去勾满那些框。现在的 owner 是目录的接入状态：
 * **已接入（key 在且解得开，或本地免 key）的供应商与其已发布模型 = 默认放行**；每次提交在
 * 付费确认卡上定这次用哪家/哪个模型（`approval.allowedProviders` 仍只含用户看过的那份计划）。
 * 草稿建的 run 仍按候选圈定范围（`productionGenerationOperationStore`），不走这里。
 */
export type ConnectedModelScope = { allowedProviders: string[]; allowedModels: string[] };

export function connectedModelScope(listing: readonly ModelListingEntry[]): ConnectedModelScope {
  const connected = listing.filter((entry) => entry.keyStatus === "ok");
  return {
    allowedProviders: [...new Set(connected.map((entry) => entry.vendor))],
    allowedModels: [...new Set(connected.map((entry) => entry.modelKey))],
  };
}

export function readConnectedModelScope(): ConnectedModelScope {
  return connectedModelScope(deriveModelListing(readCatalog()));
}
