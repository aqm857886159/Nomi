// 可执行模型解析（vendor 启用 + 模型启用 + key 解密）——从 runtime.ts 下沉（R12 净减，
// 依赖全在 catalog 域）；runtime re-export 保住 textTaskRunner/taskResultQuery 既有 import 面。
import { readCatalog } from "./catalogStore";
import { decryptApiKeyRecord } from "./secrets";
import { selectExecutableModel, type BillingModelKind } from "./types";
import type { Model, Vendor } from "./types";

export function findExecutableModel(
  vendorKey: string,
  modelKey: string,
  kind?: BillingModelKind,
): { vendor: Vendor; model: Model; apiKey: string } {
  const state = readCatalog();
  const vendor = state.vendors.find((item) => item.key === vendorKey && item.enabled);
  if (!vendor) throw new Error(`Vendor is not enabled: ${vendorKey}`);
  // 精确 modelKey 优先于 alias（修双键 OR 误路由，selectExecutableModel 纯函数单测覆盖）。
  const model = selectExecutableModel(state.models, vendorKey, modelKey, kind);
  if (!model) throw new Error(`Model is not enabled: ${modelKey}`);
  const apiKey = decryptApiKeyRecord(state.apiKeysByVendor[vendorKey]);
  if (vendor.authType !== "none" && !apiKey) throw new Error(`API key missing: ${vendorKey}`);
  return { vendor, model, apiKey };
}

export function findExecutableModelForTask(
  vendorKey: string,
  modelKey: string,
  kind: BillingModelKind,
): { vendor: Vendor; model: Model; apiKey: string } {
  if (modelKey) return findExecutableModel(vendorKey, modelKey, kind);
  const state = readCatalog();
  const model = state.models.find((item) => item.vendorKey === vendorKey && item.enabled && item.kind === kind);
  if (!model) throw new Error(`No enabled ${kind} model for vendor: ${vendorKey}`);
  return findExecutableModel(vendorKey, model.modelKey, kind);
}
