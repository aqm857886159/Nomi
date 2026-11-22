/**
 * 内置连接上归代码管的行和格：退役行删掉、偏了的格放回种子、「整家删」这条记录——启动种子对账
 * （`applyBuiltinSeeds`）和存密钥时调用（2026-11-16）。
 * 从 seedBuiltins.ts / catalogStore.ts 拆出来：那两个文件已到体积冻结线，这几件事只读 curated 契约、不碰别的种子逻辑。
 */
import { BUILTIN_VENDOR_SEEDS, builtinVendorSeed } from "./builtinVendorSeeds";
import type { CatalogState, Mapping, Model, Vendor } from "./types";

/** curated 契约里这里用得到的那几格（由 seedBuiltins 传进来，避免循环依赖）。 */
type CuratedContract = Readonly<{ vendorKey: string; models: readonly { modelKey: string }[]; mappings: readonly { id: string }[] }>;

/** 删退役 curated 模型（按 vendorKey+modelKey 精确命中我们种的行）。返回是否变更。 */
export function pruneRetiredModels(models: Model[], vendorKey: string, retiredKeys: readonly string[]): boolean {
  let changed = false;
  for (let i = models.length - 1; i >= 0; i -= 1) {
    if (models[i].vendorKey === vendorKey && retiredKeys.includes(models[i].modelKey)) {
      models.splice(i, 1);
      changed = true;
    }
  }
  return changed;
}

/** 删退役 curated mapping（按稳定 seed id 精确命中；用户自建 mapping id 不在表里，不受影响）。返回是否变更。 */
export function pruneRetiredMappings(mappings: Mapping[], retiredIds: readonly string[]): boolean {
  let changed = false;
  for (let i = mappings.length - 1; i >= 0; i -= 1) {
    if (retiredIds.includes(mappings[i].id)) {
      mappings.splice(i, 1);
      changed = true;
    }
  }
  return changed;
}

/**
 * 内置连接上「只有代码写得动」的那几格，偏了就放回种子（2026-11-16，老用户自愈）。
 *
 * 0.24.x 起外部 Agent 交卡挂到内置连接上时，登记门照卡改写过整条连接行、给同名内置模型盖过认证标记；
 * 内置连接的范围判据随即不认它，整家的生成门一起关掉。登记门已经不写了，这里把已经写进去的收回来：
 *   · 连接行的 `assetIngestion`：界面上没有任何一处写它（设置页只改地址和开关），有值且偏离种子只可能是卡写的；
 *     行上没有这一格（比它早的老行、自定义中转）不是卡写的，不在这里补——那是另一件事，不顺手改；
 *   · 内置目录里的模型行上、来源是声明卡的认证标记和卡投影：内置档案说了算，卡的路由一起摘掉，
 *     让下面的 curated 对账把内置路由放回去。用户自己认证 / 自检盖的标记（来源不是声明卡）不动。
 * 地址（用户在设置页改过的就是用户的）和鉴权几格（接入向导写得动、分不清是谁写的）不在这里碰。
 */
export function restoreBuiltinOwnedFields(vendors: Vendor[], models: Model[], mappings: Mapping[], now: string, contracts: readonly CuratedContract[]): boolean {
  let changed = false;
  for (const seed of BUILTIN_VENDOR_SEEDS) {
    const index = vendors.findIndex((vendor) => vendor.key === seed.key);
    if (index >= 0 && vendors[index].assetIngestion !== undefined && JSON.stringify(vendors[index].assetIngestion ?? null) !== JSON.stringify(seed.assetIngestion ?? null)) {
      const { assetIngestion: _cardWritten, ...rest } = vendors[index];
      vendors[index] = { ...rest, ...(seed.assetIngestion ? { assetIngestion: seed.assetIngestion } : {}), updatedAt: now };
      changed = true;
    }
  }
  for (const contract of contracts) {
    const curatedKeys = new Set(contract.models.map((model) => model.modelKey));
    const curatedMappingIds = new Set(contract.mappings.map((mapping) => mapping.id));
    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      if (model.vendorKey !== contract.vendorKey || !curatedKeys.has(model.modelKey)) continue;
      const meta = (model.meta && typeof model.meta === "object" && !Array.isArray(model.meta) ? model.meta : {}) as Record<string, unknown>;
      const adapter = meta.adapter as { source?: unknown } | undefined;
      if (!adapter || adapter.source !== "declaration-card") continue;
      const { adapter: _a, declarationSource: _s, declarationProjection: _p, customCapabilityContract: _c, parameters: _params, ...kept } = meta;
      models[index] = { ...model, meta: kept, updatedAt: now };
      for (let at = mappings.length - 1; at >= 0; at -= 1) {
        const row = mappings[at];
        if (row.vendorKey === contract.vendorKey && row.modelKey === model.modelKey && !curatedMappingIds.has(row.id)) mappings.splice(at, 1);
      }
      changed = true;
    }
  }
  return changed;
}

/**
 * 整家删除记录，连同旧盘的认法（一次性，只对还没有 `suppressedBuiltinVendors` 这一格的旧盘跑；跑过就落下这一格，哪怕是空的）：
 * 0.24.x 整家删是把这家每个内置模型逐条记进 `suppressedBuiltinModels`。某家**每一个**内置模型都在删除记录里
 * = 当年整家删的，收成一条整家记录、摘掉那几条逐模型记录（之后再存密钥就整家回来）。只记了一部分的是单删，原样不动。
 * 只跑一次是必须的：新盘上整家回来之后，单删的那几条照旧留着、盘上内置模型也还没种回来的那一瞬，不能又被认成整家删。
 */
type WholeVendorDeletions = { vendors: string[]; models: NonNullable<CatalogState["suppressedBuiltinModels"]>; changed: boolean; suppression: Partial<CatalogState> };

/** `suppression`：有变化时要写回目录的两格（没变化是空对象）。 */
export function wholeVendorDeletions(state: CatalogState, contracts: readonly CuratedContract[]): WholeVendorDeletions {
  const vendors = [...(state.suppressedBuiltinVendors ?? [])];
  let models = [...(state.suppressedBuiltinModels ?? [])];
  if (state.suppressedBuiltinVendors !== undefined) return { vendors, models, changed: false, suppression: {} };
  let changed = true; // 落下这一格 = 旧盘认法跑过了
  for (const vendorKey of new Set(contracts.map((contract) => contract.vendorKey))) {
    const curated = new Set(contracts.filter((contract) => contract.vendorKey === vendorKey).flatMap((contract) => contract.models.map((model) => model.modelKey)));
    if (vendors.includes(vendorKey) || curated.size === 0) continue;
    const suppressedKeys = new Set(models.filter((row) => row.vendorKey === vendorKey).map((row) => row.modelKey));
    // 「每个内置模型都在删除记录里」按**那份盘当时认得的**内置模型算：之后版本新收的内置模型当年还不存在、
    // 不可能被记上，所以判据是「有删除记录，且盘上一个内置模型都不剩」（单删的家盘上总还留着别的内置模型）。
    if (suppressedKeys.size === 0 || state.models.some((row) => row.vendorKey === vendorKey && curated.has(row.modelKey))) continue;
    vendors.push(vendorKey);
    models = models.filter((row) => row.vendorKey !== vendorKey);
    changed = true;
  }
  return { vendors, models, changed, suppression: { suppressedBuiltinModels: models, suppressedBuiltinVendors: vendors } };
}

/** 存一次这家的密钥 = 要整家删掉的内置连接回来：摘掉整家删除记录。摘了返回 true（调用方随即重种内置模型）。 */
export function liftWholeVendorDeletion(state: CatalogState, vendorKey: string): boolean {
  if (!state.suppressedBuiltinVendors?.includes(vendorKey)) return false;
  state.suppressedBuiltinVendors = state.suppressedBuiltinVendors.filter((vendor) => vendor !== vendorKey);
  return true;
}

/**
 * 这条内置连接是不是用户整家删掉的、且存一次密钥就回来（还没存）。不要密钥的内置家（本地 ComfyUI 等）
 * 没有「存密钥」这一步，不在此列——删了照旧不回，不能告诉人「存密钥就回来」。
 * 目录读不了就当不是——这只用来把拒绝说清楚。
 */
export function vendorDeletedUntilKeySaved(vendorKey: string, read: () => Readonly<CatalogState>): boolean {
  if (builtinVendorSeed(vendorKey)?.authType === "none") return false;
  try { return read().suppressedBuiltinVendors?.includes(vendorKey) === true; } catch { return false; }
}
