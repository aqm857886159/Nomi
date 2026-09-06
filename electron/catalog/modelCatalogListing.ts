// 交付1 · nomi_list_models 的「真话」派生（纯函数，输入 CatalogState → 输出逐模型清单，可零依赖单测）。
//
// 旧 listAvailableModels 只 filter(enabled) 就说「已接入且可用」——不验 key（kie 没配 key 也列为可用，
// 调用它白白浪费一趟往返报「API key missing: kie」）、不说这个模型带不带得动参考。这里补两件真话：
//   ① keyStatus：ok / missing / locked（复用 secrets.apiKeyDecryptStatus 的三态健康度，P1 不另写解密探测）；
//   ② references：这个模型的 mapping body 到底带得动什么参考（复用 referenceReachability.bodyReferenceSupport，
//      与第三闸/UI 收窄同源判据，P1 不另写一份），跨该模型所有 mapping 汇总，并记下「哪个 taskKind 模式能带」。
// 已发布模型即使没 key 也照列并带状态；adapter staging/failed 新行则不进入生产清单。
import { apiKeyDecryptStatus, type ApiKeyDecryptStatus, type ApiKeyRecord } from "./secrets";
import { bodyReferenceSupport, type BodyReferenceSupport } from "./referenceReachability";
import { bodyReferencedParamKeys } from "./paramTranslate";
import type { ModelModeBody } from "./taskParams";
import { billingKindForTaskKind, type BillingModelKind, type CatalogState, type Mapping, type ProfileKind } from "./types";
import { modelHasPublishedExecution } from "../shared/modelPublication";
import { SINGLE_SHOT_GENERATION_MODULE_ID } from "../shared/generationModuleId";

/** 一个模型跨其所有 mapping 汇总出的参考承载力 + 是哪些模式（taskKind）带得动。 */
export type ModelReferenceSupport = BodyReferenceSupport & {
  /** 携带参考的 taskKind 模式（如 image_to_video / image_edit）——供拒发建议/选型时点名"用哪个模式"。 */
  referenceModes: ProfileKind[];
};

export type ModelListingEntry = {
  vendor: string;
  vendorName: string;
  modelKey: string;
  /**
   * 生成写工具（nomi_operation_plan）要的 `{moduleId, providerId, modelId}` 三元组里的第一项。
   * 修复前它**不出现在任何读工具的输出里**，外部宿主只能猜（探针猜了 `image`，plan 通过、preview 立刻回
   * `Unknown module: image`）。`providerId` = 本行的 `vendor`、`modelId` = 本行的 `modelKey`，
   * 三项现在都从这一行读得到 —— 写工具接受的东西，读工具认得。
   */
  moduleId: string;
  kind: string;
  label: string;
  /** 这个模型此刻能不能真用：ok=key 在且解得开；missing=没配 key；locked=key 在但当前宿主身份解不开。 */
  keyStatus: ApiKeyDecryptStatus;
  /** 一句人话状态（诚实敞口，D4）：ok 报可用；missing/locked 各报缺口 + 该干什么。 */
  statusReason: string;
  /** 该模型带得动的参考类别 + 承载模式（无 mapping 或纯文生 → 全 false / 空）。 */
  references: ModelReferenceSupport;
};

/** 解密探测缝（house DI）：默认用真 apiKeyDecryptStatus（走 safeStorage 钥匙串）；测试可注入 spy 数解密次数。 */
export type KeyStatusProbe = (record: ApiKeyRecord | undefined) => ApiKeyDecryptStatus;

/** authType==='none' 的 vendor 不需要 key（如本地 ComfyUI）——恒 ok，不参与 key 探测。 */
function keyStatusForModel(
  state: CatalogState,
  vendorKey: string,
  authType: string | undefined,
  probe: KeyStatusProbe,
): ApiKeyDecryptStatus {
  if (authType === "none") return "ok";
  return probe(state.apiKeysByVendor[vendorKey]);
}

/** 一句人话状态（vendor 名插值，不 hardcode 任何 vendor）。 */
function statusReasonFor(keyStatus: ApiKeyDecryptStatus, vendorName: string): string {
  switch (keyStatus) {
    case "ok":
      return "已接入且可用";
    case "locked":
      return `${vendorName} 的 API Key 已保存但当前宿主身份解不开（多见于 MCP/命令行宿主与 Nomi 主程序加密身份不一致）；请在 Nomi 应用里重新保存该 Key，或让宿主以正确身份运行`;
    case "needs_resave":
      return `${vendorName} 的 API Key 来自旧版明文存储；请在 Nomi 应用里重新保存后再使用`;
    case "missing":
    default:
      return `未配置 ${vendorName} 的 API Key；请先在 Nomi 应用的模型接入里填入`;
  }
}

/**
 * 这个模型能用到的所有 mapping（精确绑定该 modelKey 的 + generic 无 modelKey 的通用模板）。
 * **单一真相源**：list_models 的参考承载力汇总与 runtime 的拒发建议（modelModeBodies）都用它，不各写一份（P1）。
 */
export function mappingsForModel(mappings: Mapping[], vendorKey: string, modelKey: string, modelAlias: string | null | undefined): Mapping[] {
  return mappings.filter(
    (m) =>
      m.vendorKey === vendorKey &&
      (m.modelKey === undefined || m.modelKey === "" || m.modelKey === modelKey || (modelAlias ? m.modelKey === modelAlias : false)),
  );
}

/** 这个模型**所有启用模式**的 (taskKind, create body)——供 L3 拒发建议判"哪个模式带得动携带的参考"（交付4）。 */
export function modelModeBodies(mappings: Mapping[], vendorKey: string, modelKey: string, modelAlias: string | null | undefined): ModelModeBody[] {
  return mappingsForModel(mappings, vendorKey, modelKey, modelAlias)
    .filter((m) => m.enabled)
    .map((m) => ({ taskKind: m.taskKind, body: m.create?.body }));
}

/** 跨该模型所有 mapping 汇总参考承载力（任一 mapping 能发 = 能发；记下携带参考的 taskKind）。 */
function referenceSupportForModel(modelMappings: Mapping[]): ModelReferenceSupport {
  const out: ModelReferenceSupport = { image: false, video: false, audio: false, multiImage: false, referenceModes: [] };
  const modes = new Set<ProfileKind>();
  for (const mapping of modelMappings) {
    if (!mapping.enabled) continue;
    const support = bodyReferenceSupport(mapping.create?.body);
    out.image ||= support.image;
    out.video ||= support.video;
    out.audio ||= support.audio;
    out.multiImage ||= support.multiImage;
    if (support.image || support.video || support.audio) modes.add(mapping.taskKind);
  }
  // 稳定排序（输出确定性，便于快照/断言）。
  out.referenceModes = [...modes].sort();
  return out;
}

/**
 * 该模型**视频类模式的 body 真实引用了哪些参数键**（W2 §3 两跳判据的原料）。
 *
 * 为什么要它：两跳要把首帧图喂进模型的 first_frame 槽——但不是每家 video 模型都有这个槽。硬塞
 * firstFrameUrl 给读不到它的模型只会被 L3 护栏拦（白跑一趟 + 一条看不懂的错）。故「支不支持首帧」
 * 必须**从目录 body derive**（与 referenceModeForIntent 同一份源，P1），不 hardcode 家名。
 *
 * 纯函数（输入 CatalogState）。返回去重 + 字典序的键名数组（顺序稳定，便于断言）。
 */
export function videoBodyKeysForModel(
  state: CatalogState,
  vendorKey: string,
  modelKey: string,
): string[] {
  const model = state.models.find((m) => m.vendorKey === vendorKey && m.modelKey === modelKey
    && modelHasPublishedExecution(m, { mappings: state.mappings }));
  const modelMappings = mappingsForModel(state.mappings, vendorKey, modelKey, model?.modelAlias);
  const keys = new Set<string>();
  for (const mapping of modelMappings) {
    if (billingKindForTaskKind(mapping.taskKind) !== "video") continue;
    for (const key of bodyReferencedParamKeys(mapping.create?.body)) keys.add(key);
  }
  return [...keys].sort();
}

/**
 * 「带参考时该用哪个 taskKind 生成」——**derive 自该模型真实可带参考的模式**（与 list_models 的 referenceModes
 * 同一份判据，P1 单一真相），不再硬编码 image→image_edit / video→image_to_video。
 *
 * 根因（docs/plan/2026-08-20-w1d-reference-mode-alignment.md）：core.generateOnProject 此前硬编码
 * defaultKindForIntent(intent, hasReferences)——对多数模型恰好对（image_edit/image_to_video mapping 存在），
 * 但对「参考模式≠默认名」的模型会选错 kind、护栏按错 kind 判「发不出」。改为查真实模式：
 *   · 只看**匹配 intent 计费口径**的参考模式（image intent → 计费为 image 的模式如 image_edit；
 *     video intent → 计费为 video 的模式如 image_to_video）；
 *   · 有多个匹配时取字典序最小（稳定），交给护栏的 modeBodies 兜底纠偏；
 *   · 一个都没有 → 返回 null，调用方回退 defaultKindForIntent（走护栏诚实拒绝，语义不放松）。
 *
 * 纯函数（输入 CatalogState），可零依赖单测。
 */
export function referenceModeForIntent(
  state: CatalogState,
  vendorKey: string,
  modelKey: string,
  intent: BillingModelKind,
): ProfileKind | null {
  const model = state.models.find((m) => m.vendorKey === vendorKey && m.modelKey === modelKey
    && modelHasPublishedExecution(m, { mappings: state.mappings }));
  const modelMappings = mappingsForModel(state.mappings, vendorKey, modelKey, model?.modelAlias);
  const referenceModes = referenceSupportForModel(modelMappings).referenceModes;
  const matching = referenceModes.filter((taskKind) => billingKindForTaskKind(taskKind) === intent);
  // referenceModes 已字典序稳定，取首个匹配即可（护栏 reachableModeSuggestion 仍会在拒发时点名更优模式）。
  return matching[0] ?? null;
}

/**
 * 逐模型生产清单（enabled 且 adapter 已发布；legacy 无 adapter metadata 的存量行保持兼容）。
 * 纯函数：输入完整 CatalogState，不读盘不解密以外的副作用（解密由 secrets 注入的 safeStorage 完成）。
 *
 * **解密探测按 vendorKey 记忆化（本次调用内）**：keyStatus 只取决于 vendorKey（同 vendor 的所有模型共享同一条
 * key 记录与 authType），旧实现却**逐模型**调 apiKeyDecryptStatus——单 vendor N 个模型就是 N 次 safeStorage
 * 钥匙串 IPC，且 locked vendor 每个模型都吐一行重复解密失败日志（N 行一模一样）。改为每 vendor 探一次
 * 存进小 Map，同 vendor 后续模型直接命中，钥匙串往返与错误日志都降到「每 vendor 一次」。
 *
 * @param deps.keyStatusProbe 解密探测缝（house DI，默认真 apiKeyDecryptStatus）；测试注入 spy 断言「每 vendor 只探一次」。
 */
export function deriveModelListing(
  state: CatalogState,
  deps: { keyStatusProbe?: KeyStatusProbe } = {},
): ModelListingEntry[] {
  const probe = deps.keyStatusProbe ?? apiKeyDecryptStatus;
  const vendorByKey = new Map(state.vendors.map((v) => [v.key, v] as const));
  // 本次调用内的 vendorKey → keyStatus 记忆（同 vendor 只探一次解密）。
  const keyStatusByVendor = new Map<string, ApiKeyDecryptStatus>();
  return state.models
    .filter((model) => modelHasPublishedExecution(model, { mappings: state.mappings }))
    .map((model) => {
      const vendor = vendorByKey.get(model.vendorKey);
      const vendorName = vendor?.name || model.vendorKey;
      let keyStatus = keyStatusByVendor.get(model.vendorKey);
      if (keyStatus === undefined) {
        keyStatus = keyStatusForModel(state, model.vendorKey, vendor?.authType, probe);
        keyStatusByVendor.set(model.vendorKey, keyStatus);
      }
      const modelMappings = mappingsForModel(state.mappings, model.vendorKey, model.modelKey, model.modelAlias);
      return {
        vendor: model.vendorKey,
        vendorName,
        modelKey: model.modelKey,
        moduleId: SINGLE_SHOT_GENERATION_MODULE_ID,
        kind: model.kind,
        label: model.labelZh || model.modelKey,
        keyStatus,
        statusReason: statusReasonFor(keyStatus, vendorName),
        references: referenceSupportForModel(modelMappings),
      };
    });
}
