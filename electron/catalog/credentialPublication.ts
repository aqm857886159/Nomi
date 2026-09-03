import type { CatalogState } from "./types";

/**
 * 名实一致：凭据落成 enabled===false 时，其 vendor 必须退出「已接入/可用」投影，否则首页按
 * vendor.enabled 显示「已接入 / N 个可使用」而 resolveTextBrainKeys 拿不到模型（假成功）。
 * 完整根因、同类入口清单与不变量见 docs/fixes/2026-09-01-credential-enable-honesty.root-cause.json。
 *
 * 由 applyApiKeyUpsert 调用——所有凭据写入（渲染层 IPC、整包导入、主进程 mutateCatalog）唯一汇合的
 * 最内层边界，且就地改内存 state 随调用方那一次 writeCatalog 落盘，故不变量被全部写入方继承且原子生效。
 * 触发条件即「凭据停用」，认证 promote 一族一律写 enabled:true，构造上不触发，无需 skip 逃生口（P1）。
 * 只翻 enabled+updatedAt（不绕 applyVendorUpsert 重建行），vendor 的 name/meta/顺序原样保留。
 */
export function depublishVendorForDisabledCredential(state: CatalogState, vendorKey: string, now: string): void {
  if (!state.vendors.some((vendor) => vendor.key === vendorKey && vendor.enabled)) return;
  state.vendors = state.vendors.map((vendor) =>
    vendor.key === vendorKey ? { ...vendor, enabled: false, updatedAt: now } : vendor,
  );
}
