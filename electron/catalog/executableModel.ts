// 可执行模型解析（vendor 启用 + 模型启用 + key 解密）——从 runtime.ts 下沉（R12 净减，
// 依赖全在 catalog 域）；runtime re-export 保住 textTaskRunner/taskResultQuery 既有 import 面。
import { listModelCatalogModels, readCatalog } from "./catalogStore";
import { apiKeyDecryptStatus, decryptApiKeyRecord, decryptCustomConfigWithLegacy } from "./secrets";
import { billingKindForTaskKind, selectExecutableModel, type BillingModelKind, type ProfileKind } from "./types";
import type { Model, Vendor } from "./types";
import { catalogModelAvailability, createCatalogAvailability } from "./catalogModelAvailability";
import { orderByVendorPreference } from "../shared/contracts/vendorPreference";
import { rowServesMode, type PublishedExecution } from "../shared/modelPublication";
import type { ModelAvailability } from "../shared/modelAvailability";

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
  // 「能不能用」的判据只有一处（catalogModelAvailability → shared/modelAvailability）。这里不再
  // 自己拼 published / key 两条——本函数额外要做的只是**把明文 key 解出来**并按三态给人话。
  // 没发布也归 model-config（去模型接入）：重试一万次都一样。措辞要带「Model is not configured」，错误卡靠它分类。
  const availability = catalogModelAvailability(state, model);
  if (!availability.usable && availability.reason === "model_unpublished") {
    throw new Error(`Model is not configured: ${modelKey} (not published: no verified route yet)`);
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
  const availability = createCatalogAvailability(state);
  const model = state.models.find((item) => item.vendorKey === vendorKey && item.kind === kind
    && availability.of(item).usable);
  if (!model) throw new Error(`No enabled ${kind} model for vendor: ${vendorKey}`);
  return findExecutableModel(vendorKey, model.modelKey, kind);
}


export type ExecutableModel = { vendor: Vendor; model: Model; apiKey: string; customConfig: Record<string, string> };

/**
 * 「哪些模型此刻能跑这个**模式**」的唯一答案（2026-10-19，拆解转写腿根因修复）。
 *
 * 为什么必须按模式问、而不是按 kind 问：audio 这个 kind 里有配音、音乐、音效、转写四种完全不同的事。
 * 旧的 `findExecutableModelAnyVendor("audio")` 只问 kind——目录序里第一个能用的 audio 行是 Suno / 某个 TTS 时，
 * 拆解的转写腿就拿它去发转写请求（没有转写 mapping → 落到默认 Whisper 路径 → 供应商 4xx）。
 * 同一时刻渲染层的转写 chip 走 `useModelOptionsState('audio','transcribe')`，按模式问，于是「哪些模型能转写」
 * 有两个答案：chip 说一个，引擎跑另一个。
 *
 * 现在两边读**同一份投影**（`listModelCatalogModels`，渲染层经 IPC 拿到的就是它）、过**同一条判据**
 * （`rowServesMode`，渲染层 `optionsFromRows` 也调它）。返回顺序按供应商偏好（#682 那份全局顺序）。
 */
export function modeCandidates(
  mode: ProfileKind,
  orderedVendorKeys: readonly string[] = [],
): ReadonlyArray<Model & PublishedExecution & { availability: ModelAvailability }> {
  const rows = listModelCatalogModels({ kind: billingKindForTaskKind(mode), enabled: true }).filter((row) => rowServesMode(row, mode));
  return orderByVendorPreference(rows, orderedVendorKeys, (item) => item.vendorKey);
}

/**
 * 按模式解出一行可执行模型（自动挑）。`accept` 是调用方在同一份候选上再收窄一步（例：「改用云端重试」排除本机引擎）。
 *
 * 返回的 vendor/model **必须**能被 `findExecutableModel` 原样解出来：报价卡上的那一行
 * 和 runTask 真会扣费的那一行是同一行，靠的就是两边走同一个解析器。
 */
export function findExecutableModelForMode(
  mode: ProfileKind,
  options: { orderedVendorKeys?: readonly string[]; accept?: (model: Model) => boolean } = {},
): ExecutableModel | null {
  for (const model of modeCandidates(mode, options.orderedVendorKeys)) {
    if (options.accept && !options.accept(model)) continue;
    try {
      // 走同一个解析器：key 解不开这类问题在这里就被挡掉，不会把一行解不出来的模型报给用户。
      return findExecutableModel(model.vendorKey, model.modelKey, billingKindForTaskKind(mode));
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 显式点名一行模型跑某个模式：能跑就解出来，不能跑就**抛一句说得出原因的话**（不悄悄换别家）。
 * 判据与 `modeCandidates` 同一条：先过 `findExecutableModel`（启用 / 发布 / 钥匙三态各有原话），再问它发布了这个模式没有。
 */
export function findExecutableModelInMode(vendorKey: string, modelKey: string, mode: ProfileKind): ExecutableModel {
  const resolved = findExecutableModel(vendorKey, modelKey, billingKindForTaskKind(mode));
  const row = listModelCatalogModels({ kind: billingKindForTaskKind(mode), enabled: true })
    .find((item) => item.vendorKey === resolved.vendor.key && item.modelKey === resolved.model.modelKey);
  if (!row || !rowServesMode(row, mode)) {
    throw new Error(`Model does not serve ${mode}: ${modelKey}（published=${(row?.publishedModes ?? []).join("/") || "none"}）`);
  }
  return resolved;
}
