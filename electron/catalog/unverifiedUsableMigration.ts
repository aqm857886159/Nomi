import { modelHasPublishedExecution } from "../shared/modelPublication";
import { isJsonRecord } from "../jsonUtils";
import type { CatalogState } from "./types";

/**
 * 一次性修正，不升目录版本号（已发的 v13 写入方照样读得懂）。D-1117-delete-verification：
 * 「验证」这一步删了，旧版因为「没验过 / 没验成」关掉的东西要还给创作者——
 *  · 旧版写过「待验证」标记的那家：连接和 key 打开（标记本身留在文件里，没人再读）；
 *  · 自动验证失败被关掉、而请求格式完整的模型：打开一次；
 *  · 没有失败记录的关闭（创作者手动关的）：不动。
 * 不再给模型写任何诊断状态——界面已经没有「未验证」这一档。
 */
export function repairUnverifiedUsable(state: CatalogState): CatalogState {
  if (state.unverifiedUsableRecovered) return state;
  // 旧标记按原始字段读：类型里已经没有它了，界面和执行端都拿不到。
  const pending = new Set(Object.entries(state.apiKeysByVendor)
    .filter(([, key]) => (key as { verificationPending?: unknown }).verificationPending === true)
    .map(([key]) => key));
  const recovered = new Set<string>();
  const models = state.models.map((model) => {
    const meta = isJsonRecord(model.meta) ? model.meta : {};
    const adapter = isJsonRecord(meta.adapter) ? meta.adapter : undefined;
    if (model.enabled || adapter?.state !== "failed") return model;
    const enabled = { ...model, enabled: true };
    if (!modelHasPublishedExecution(enabled, { mappings: state.mappings })) return model;
    recovered.add(model.vendorKey);
    return enabled;
  });
  const vendors = state.vendors.map((vendor) => pending.has(vendor.key) || recovered.has(vendor.key) ? { ...vendor, enabled: true } : vendor);
  const apiKeysByVendor = Object.fromEntries(Object.entries(state.apiKeysByVendor).map(([key, record]) => [key, pending.has(key) || recovered.has(key) ? { ...record, enabled: true } : record]));
  return { ...state, unverifiedUsableRecovered: true, models, vendors, apiKeysByVendor };
}
