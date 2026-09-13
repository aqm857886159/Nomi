// 把 `shared/modelAvailability` 那条纯判据接到真实目录上（主进程侧唯一入口）。
//
// 为什么要这一层薄壳：判据本身必须是纯的（渲染层也要按同一个枚举读结论），但「这家钥匙此刻
// 解不解得开」只有主进程问得了钥匙串，而且**一次 safeStorage 往返不便宜**。这里负责：
//   ① 把 CatalogState 里的 vendor/mapping/钥匙拼成判据的入参；
//   ② 每次批量派生只为每家探一次钥匙，且**同一份 memo** 同时供「可用性」和「钥匙三态」两个问题用——
//      两份 memo 就是两次往返、两行重复的解密失败日志（这正是 PR #— 之前修过的那个坑）。
// 判据本身一个字都不在这儿——要改「什么叫可用」，改 shared/modelAvailability.ts。
import { apiKeyDecryptStatus, credentialRecordCounts, type ApiKeyDecryptStatus, type KeyStatusProbe } from "./secrets";
import type { CatalogState, Model, Vendor } from "./types";
import { deriveModelAvailability, type ModelAvailability } from "../shared/modelAvailability";

export type CatalogAvailability = {
  /** 这一行模型现在能不能用（不能就说清是哪一档）。 */
  of: (model: Model) => ModelAvailability;
  /**
   * 这家钥匙此刻的健康度。`authType === "none"` 的本地家没有钥匙可解，恒 `ok` 且**不探**。
   * 与 `of` 共用同一份 per-vendor memo：同一批里谁先问都只解一次。
   */
  credentialStatusFor: (vendorKey: string) => ApiKeyDecryptStatus;
};

/** 每家只探一次钥匙的批量派生器。同一批里 N 个模型共用一次 safeStorage 往返。 */
export function createCatalogAvailability(
  state: CatalogState,
  probe: KeyStatusProbe = apiKeyDecryptStatus,
): CatalogAvailability {
  const vendorByKey = new Map<string, Vendor>(state.vendors.map((vendor) => [vendor.key, vendor]));
  const credentialCache = new Map<string, ApiKeyDecryptStatus>();
  const credentialStatusFor = (vendorKey: string): ApiKeyDecryptStatus => {
    if (vendorByKey.get(vendorKey)?.authType === "none") return "ok";
    const cached = credentialCache.get(vendorKey);
    if (cached) return cached;
    const record = state.apiKeysByVendor[vendorKey];
    // 记录本身就不算数（没配过 / 被用户停用）时连探针都不调：注入假探针的测试也得守这条，
    // 否则「停用的 key 不许去开钥匙串」只是生产里的口头承诺。
    const status = credentialRecordCounts(record) ? probe(record) : "missing";
    credentialCache.set(vendorKey, status);
    return status;
  };
  return {
    credentialStatusFor,
    of: (model: Model): ModelAvailability => deriveModelAvailability({
      model,
      vendor: vendorByKey.get(model.vendorKey) ?? null,
      // 惰性：前面几档就否掉时压根不去开钥匙串（见 shared/modelAvailability.ts 的入参注释）。
      credentialStatus: () => credentialStatusFor(model.vendorKey),
      evidence: { mappings: state.mappings },
    }),
  };
}

/** 单条模型的可用性。批量场景请用 `createCatalogAvailability`（否则每条都开一次钥匙串）。 */
export function catalogModelAvailability(state: CatalogState, model: Model): ModelAvailability {
  return createCatalogAvailability(state).of(model);
}

/** 这个模型现在能不能用（只要布尔的调用点用这个，别再各自解读 reason）。 */
export function catalogModelIsUsable(state: CatalogState, model: Model): boolean {
  return catalogModelAvailability(state, model).usable;
}
