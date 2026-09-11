// 助手模型选择器的「模型身份」——纯函数，单一真相源。
//
// 根因（2026-08-12 用户反馈「右侧 agent 显示的模型不是真实模型」）：模型的真实身份是
// **(vendorKey, modelKey) 两段**，偏好里也一直是这么存的；但选择器只拿 modelKey 当 option value
// 和匹配依据。同一个 modelKey 挂在多个供应商下是常态（从 APIMart 加了 gpt-5.2，又从自建中转
// 加了一个同名的），于是：
//   · 下拉里出现重复 value → 显示的是**第一条**，可能根本不是偏好里存的那个供应商的；
//   · 选中时 find(m => m.modelKey === next) 也只找第一条 → 静默绑到**另一个供应商**去。
// 身份从 derive 而来、不再用半截 key 凑合，这类「显示/绑定张冠李戴」才不会换个入口又复发。

import type { ModelAvailability } from '../../../electron/shared/modelAvailability'
import { modelSupportsToolCalls } from '../../../electron/shared/textModelCapabilities'
import { translateModelDisplayText } from '../../i18n/modelDisplayText';
export type ModelIdentity = { vendorKey: string; modelKey: string };

export type AssistantCatalogModelLike = {
  vendorKey: string;
  modelKey: string;
  kind: string;
  /** 主进程算好的「现在能不能用」——渲染层不重算（见 electron/shared/modelAvailability.ts）。 */
  availability: ModelAvailability;
  meta?: unknown;
};

function isPromptRefineOnly(meta: unknown): boolean {
  return Boolean(
    meta &&
      typeof meta === 'object' &&
      (meta as { promptRefineOnly?: unknown }).promptRefineOnly === true,
  )
}

/**
 * 助手下拉的数据门 = **可用性 owner 的结论** + 本下拉独有的**角色**要求。
 *
 * 2026-09-12 真实验收 P0-10：这里曾自己拼一份「vendor.enabled && hasApiKey && published」，
 * 而设置页拼的是另一份（只看 enabled）、首页横幅走主进程第三份。同一时刻三个地方两个答案。
 * 现在「能不能用」只有 `model.availability` 一个来源；这里只再过滤「能不能当助手主控」：
 * 必须是 text、不是 prompt_refine 专用、发得出工具调用。角色过滤器永远压在可用性之上，
 * 不是第二份可用性判据。
 */
export function filterUsableAssistantTextModels<T extends AssistantCatalogModelLike>(
  models: readonly T[],
): T[] {
  return models.filter((model) => model.availability.usable
    && fitsAssistantTextRole(model)
    && Boolean(model.vendorKey.trim())
    && Boolean(model.modelKey.trim()))
}

/** 「这一行能当助手主控吗」——纯角色判据，与主进程 textBrainResolver.fitsAssistantTextRole 同口径。 */
export function fitsAssistantTextRole(model: Pick<AssistantCatalogModelLike, 'kind' | 'meta'>): boolean {
  return model.kind === 'text' && !isPromptRefineOnly(model.meta) && modelSupportsToolCalls(model.meta)
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
