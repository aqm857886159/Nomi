// 助手模型选择器的「模型身份」——纯函数，单一真相源。
//
// 根因（2026-08-12 用户反馈「右侧 agent 显示的模型不是真实模型」）：模型的真实身份是
// **(vendorKey, modelKey) 两段**，偏好里也一直是这么存的；但选择器只拿 modelKey 当 option value
// 和匹配依据。同一个 modelKey 挂在多个供应商下是常态（从 APIMart 加了 gpt-5.2，又从自建中转
// 加了一个同名的），于是：
//   · 下拉里出现重复 value → 显示的是**第一条**，可能根本不是偏好里存的那个供应商的；
//   · 选中时 find(m => m.modelKey === next) 也只找第一条 → 静默绑到**另一个供应商**去。
// 身份从 derive 而来、不再用半截 key 凑合，这类「显示/绑定张冠李戴」才不会换个入口又复发。

import { modelSupportsToolCalls } from '../../../electron/shared/textModelCapabilities'
import { translateModelDisplayText } from '../../i18n/modelDisplayText';
export type ModelIdentity = { vendorKey: string; modelKey: string };

export type AssistantCatalogModelLike = {
  vendorKey: string;
  modelKey: string;
  kind: string;
  enabled: boolean;
  published: boolean;
  meta?: unknown;
};

export type AssistantCatalogVendorLike = {
  key: string;
  enabled: boolean;
  authType?: string | null;
  hasApiKey?: boolean;
};

function isPromptRefineOnly(meta: unknown): boolean {
  return Boolean(
    meta &&
      typeof meta === 'object' &&
      (meta as { promptRefineOnly?: unknown }).promptRefineOnly === true,
  )
}

/**
 * 助手下拉的唯一数据门：只让真实 catalog 中「已启用 + 供应商当前可用」的文本模型进入 UI。
 *
 * `listModels({ kind: 'text', enabled: true })` 只保证模型行本身启用，不能保证供应商仍有
 * key（用户拔 key 后 vendor.enabled 可能还保留）。这里和生成节点的可用性判据对齐，避免
 * 下拉给出一个看似能选、点击后必然失败的假选择；身份字段不完整的行也直接丢弃。
 */
export function filterUsableAssistantTextModels<T extends AssistantCatalogModelLike>(
  models: readonly T[],
  vendors: readonly AssistantCatalogVendorLike[],
): T[] {
  const usableVendorKeys = new Set(
    vendors
      .filter((vendor) => vendor.enabled && (vendor.authType === 'none' || vendor.hasApiKey === true))
      .map((vendor) => vendor.key.trim().toLowerCase())
      .filter(Boolean),
  )
  return models.filter((model) => {
    const vendorKey = model.vendorKey.trim().toLowerCase()
    return model.kind === 'text'
      && model.enabled
      && model.published
      && !isPromptRefineOnly(model.meta)
      && modelSupportsToolCalls(model.meta)
      && Boolean(vendorKey)
      && Boolean(model.modelKey.trim())
      && usableVendorKeys.has(vendorKey)
  })
}

/** 两段身份 → DOM 安全且可逆的 option value。用 encodeURIComponent 是因为 vendorKey 是从
 *  baseUrl 派生的串，什么字符都可能有，随便挑个分隔符迟早撞上。 */
export function encodeModelIdentity(identity: ModelIdentity): string {
  return `${encodeURIComponent(identity.vendorKey)}/${encodeURIComponent(identity.modelKey)}`;
}

export function decodeModelIdentity(value: string): ModelIdentity | null {
  const slash = value.indexOf("/");
  if (slash < 0) return null;
  try {
    return {
      vendorKey: decodeURIComponent(value.slice(0, slash)),
      modelKey: decodeURIComponent(value.slice(slash + 1)),
    };
  } catch {
    return null;
  }
}

/**
 * 只在**真有歧义**时才把供应商名缀到标签上（同一个 modelKey 挂了多个供应商）。
 * 不无条件缀：绝大多数人只接一家，凭空多出「· 某某」是噪音（P2 用户视角 + 极简）。
 * 供应商名取 catalog 里的 name；取不到才退回 key（派生串不好看，但总比分不清哪个强）。
 */
export function labelForModel(
  model: { modelKey: string; labelZh?: string; vendorKey: string },
  // 这里**故意**只按裸 modelKey 比：它是碰撞探测器，不是身份断言——问的是「这个名字
  // 出现了不止一次吗」，是就把供应商名缀上去消歧。带上 vendor 反而永远不重复，标签就永远缀不出来。
  allModels: ReadonlyArray<{ modelKey: string }>,
  vendorNameByKey: Readonly<Record<string, string>>,
): string {
  const base = translateModelDisplayText(model.labelZh || model.modelKey);
  const duplicated = allModels.filter((item) => item.modelKey === model.modelKey).length > 1;
  if (!duplicated) return base;
  return `${base} · ${translateModelDisplayText(vendorNameByKey[model.vendorKey] || model.vendorKey)}`;
}
