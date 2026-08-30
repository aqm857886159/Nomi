// 可执行模型解析（vendor 启用 + 模型启用 + key 解密）——从 runtime.ts 下沉（R12 净减，
// 依赖全在 catalog 域）；runtime re-export 保住 textTaskRunner/taskResultQuery 既有 import 面。
import { readCatalog } from "./catalogStore";
import { apiKeyDecryptStatus, decryptApiKeyRecord, decryptCustomConfigWithLegacy } from "./secrets";
import { selectExecutableModel, type BillingModelKind } from "./types";
import type { Model, Vendor } from "./types";
import { modelHasPublishedExecution } from "../shared/modelPublication";

export function findExecutableModel(
  vendorKey: string,
  modelKey: string,
  kind?: BillingModelKind,
): { vendor: Vendor; model: Model; apiKey: string; customConfig: Record<string, string> } {
  const state = readCatalog();
  const vendor = state.vendors.find((item) => item.key === vendorKey && item.enabled);
  if (!vendor) throw new Error(`Vendor is not enabled: ${vendorKey}`);
  // 精确 modelKey 优先于 alias（修双键 OR 误路由，selectExecutableModel 纯函数单测覆盖）。
  const model = selectExecutableModel(state.models, vendorKey, modelKey, kind);
  // 分**三**种说法。旧实现只分两种，把「类型登记错了」压进了 `Model is not enabled`——那句话是**假的**
  // （模型明明启用着），渲染层据此说「模型未配置·去模型接入页设置」，而用户去了那页只会看到一切正常，
  // 没有一个字指向真实缺口（接入时 guessModelKind 按关键词猜错了类型）。三分之后各归各的动作：
  //  · 记录整条不在了 = 已退役下线（seedBuiltins 退役清单主动移除）→ model-retired，给「换个模型」；
  //  · 记录在、但被停用                                        → model-config，给「去模型接入」；
  //  · 记录在、也启用着、只是 kind 与本次请求不符               → model-kind-mismatch，给「改成 X」。
  // 第三种带上两个 kind：错误文案要说得出「登记为什么、这里要什么」，渲染层不该去反猜。
  if (!model) {
    const registered = state.models.find(
      (item) => item.vendorKey === vendorKey && (item.modelKey === modelKey || item.modelAlias === modelKey),
    );
    if (!registered) throw new Error(`Model is retired: ${modelKey}`);
    if (registered.enabled && kind && registered.kind !== kind) {
      throw new Error(`Model kind mismatch: ${modelKey} (registered=${registered.kind}, requested=${kind})`);
    }
    throw new Error(`Model is not enabled: ${modelKey}`);
  }
  if (!modelHasPublishedExecution(model, { mappings: state.mappings })) {
    throw new Error(`Model is not published: ${modelKey}`);
  }
  const keyRecord = state.apiKeysByVendor[vendorKey];
  const apiKey = decryptApiKeyRecord(keyRecord);
  if (vendor.authType !== "none" && !apiKey) {
    // 分三种"没可执行 key"：旧实现一律 `API key missing`，把「key 在但当前宿主身份解不开」（真机实测：capability
    // 宿主与主 App 加密身份不符，safeStorage 静默返回空串，host.ts:23-32 点名此坑）也压成"没配"——
    // 用户去接入页只会看到 key 好端端在那儿，一个字都对不上真实缺口。据凭据三态健康度分开报（derive
    // 自 apiKeyDecryptStatus，vendor 名插值、不 hardcode 任何 vendor）：
    //   · missing = 真没配 → 让去配；
    //   · locked  = key 在、这个宿主身份解不动 → 让在 Nomi App 里重存该 key，或修正宿主身份（NOMI_APP_NAME 对齐）。
    // 三句都保留 `API key missing: <vendor>` 前缀，让既有 classifyError（→ auth 类）与 MCP 错误契约照常识别。
    const status = apiKeyDecryptStatus(keyRecord);
    throw new Error(
      status === "locked"
        ? `API key missing: ${vendorKey}（key 已保存但当前宿主身份解不开——多见于 MCP/命令行宿主与 Nomi 主程序加密身份不一致。请在 Nomi 应用里重新保存 ${vendorKey} 的 API Key，或让宿主以正确身份运行）`
        : status === "needs_resave"
          ? `API key missing: ${vendorKey}（旧版凭据不可用于认证——请在 Nomi 应用里重新保存 ${vendorKey} 的 API Key）`
          : `API key missing: ${vendorKey}（未配置——请在 Nomi 应用的模型接入里填入 ${vendorKey} 的 API Key）`,
    );
  }
  const customConfig = decryptCustomConfigWithLegacy(keyRecord, vendor.meta);
  return { vendor, model, apiKey, customConfig };
}

export function findExecutableModelForTask(
  vendorKey: string,
  modelKey: string,
  kind: BillingModelKind,
): { vendor: Vendor; model: Model; apiKey: string; customConfig: Record<string, string> } {
  if (modelKey) return findExecutableModel(vendorKey, modelKey, kind);
  const state = readCatalog();
  const model = state.models.find((item) => item.vendorKey === vendorKey && item.enabled && item.kind === kind
    && modelHasPublishedExecution(item, { mappings: state.mappings }));
  if (!model) throw new Error(`No enabled ${kind} model for vendor: ${vendorKey}`);
  return findExecutableModel(vendorKey, model.modelKey, kind);
}
