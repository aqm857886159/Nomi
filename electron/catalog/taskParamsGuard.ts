// L3 诚实护栏：发出去之前判「连上的参考到底发不发得出去」，发不出就零扣费拒发并指路
// （从 taskParams.ts 按职责拆出，2026-11-15，函数体逐字不变）。
import { bodyReferencedParamKeys } from "./paramTranslate";
import { bodyReferenceSupport, type ModelModeBody, type ReferenceFamily } from "./referenceReachability";
import { comparableReferenceUrl, comparableReferenceValues } from "./outboundReferenceUrl";
import type { ParameterReferenceSelection } from "./parameterReferenceContract";
import { carriedReferenceFamilies, carriedReferences, hasImageEditReferences } from "./taskParamsReferences";
import { taskTemplateParams, type TaskParamsInput } from "./taskParams";

/**
 * L3 诚实护栏第三闸（纯函数）：**这条 wire 的 body 到底读不读得到我要发的参考素材**。
 *
 * 为什么需要：UI 的能力由**模型档案**声明（供应商无关，同一模型走哪家都显示同一套槽位），而真正
 * 发出去的 body 由渠道模板决定。两者不匹配时——典型是「通用中转接入」用的是最小模板 {model,
 * prompt, duration, size, image}——用户连上的尾帧/角色图/参考视频/参考音频**在 body 里根本不出现**，
 * 于是静默退化成纯文生：生成成功、扣费成功、和参考素材毫无关系。
 *
 * 判据完全 derive，不 hardcode 任何 vendor 键名：把 body 引用到的 `{{request.params.X}}` 取出来，
 * 渲染出它们的值，看这次携带的每条参考 URL 在不在里面。在 = 发得出；不在 = 发不出。
 * 对所有渠道、所有模式成立。
 *
 * @returns 发不出去的参考类别（人话），空数组 = 全都发得出。
 */
export function unreachableReferenceLabels(request: TaskParamsInput, createBody: unknown,
  selected?: ParameterReferenceSelection): string[] {
  const carried = carriedReferences(request.extras || {}, selected);
  if (carried.length === 0) return [];
  const params = taskTemplateParams(request, selected);
  const referencedKeys = bodyReferencedParamKeys(createBody);
  if (referencedKeys.length === 0) return [];
  // params 里的参考已序列化（taskTemplateParams）：携带的原样地址按同一个序列化再比，带空格的参考不被误判发不出。
  const reachable = JSON.stringify(comparableReferenceValues(referencedKeys.map((key) => params[key])));
  const missing = new Set<string>();
  for (const ref of carried) if (!reachable.includes(comparableReferenceUrl(ref.url))) missing.add(ref.label);
  return [...missing];
}

/** 一个模式（taskKind）的 create body——供拒发建议判「哪个模式带得动我携带的参考」。 */
const FAMILY_LABEL: Record<ReferenceFamily, string> = { image: "参考图", video: "参考视频", audio: "参考音频" };
const FAMILY_PARAMETER_LABEL: Record<ReferenceFamily, string> = { image: "图片", video: "视频", audio: "音频" };
// taskKind → 人话模式名（拒发建议里点名"用哪个模式"）。未登记的原样用 taskKind。
const TASK_KIND_LABEL: Record<string, string> = {
  image_edit: "图生图（改图）",
  image_to_video: "图生视频（i2v）",
  text_to_video: "文生视频",
  text_to_image: "文生图",
};

/** 发不出的参考里，请求体连同类声明位都没有的那几类：只给参考的调用方据此改成显式参数名（用户 10-25 拍板）。 */
function undeclaredReferenceHint(request: TaskParamsInput, createBody: unknown, selected?: ParameterReferenceSelection): string {
  const support = bodyReferenceSupport(createBody, selected);
  const undeclared = [...carriedReferenceFamilies(request.extras || {}, selected)].filter((family) => !support[family]);
  if (undeclared.length === 0) return "";
  return `这个模型的请求体没有声明${undeclared.map((family) => FAMILY_PARAMETER_LABEL[family]).join(" / ")}参考位，请在调用里写明参数名。`;
}

/**
 * 拒发后附一句**可走的路**（交付4）：从**同一套 mapping 数据**（各模式 create body）derive——
 * 找出这个模型哪些模式的 body 真读得到我携带的参考族，点名它（"该模型 i2v 模式的 image_urls 支持多张参考图"）；
 * 一个模式都带不动 → 老实说没有，并指路 list_models 找别的。**不 hardcode 任何 vendor 串**：模式名来自 taskKind，
 * 多图与否来自 bodyReferenceSupport.multiImage。给不出 modeBodies（未注入）→ 返回空串（保持既有拒发语义不变）。
 *
 * 排除的是**刚被判发不出的那条 body 本身**（failedBody，按序列化相等判定），不是按 taskKind 排除——因为同一
 * taskKind 可能有多条 mapping（当前走的通用中转 body 发不出，但该模型自己的原生 i2v body 读得到），按 taskKind
 * 排除会把唯一可行的那条也误删（seedance 唯一的 i2v 原生 body 就这么被漏掉过）。同一 taskKind 去重：多条能行的
 * 只报一次模式名。
 */
export function reachableModeSuggestion(
  request: TaskParamsInput,
  failedBody: unknown,
  modeBodies: ModelModeBody[] | undefined,
  selected?: ParameterReferenceSelection,
): string {
  if (!modeBodies || modeBodies.length === 0) return "";
  const carried = carriedReferenceFamilies(request.extras || {}, selected);
  if (carried.size === 0) return "";
  const failedKey = typeof failedBody === "undefined" ? undefined : JSON.stringify(failedBody);
  // 找出 body 覆盖了全部携带族的模式（排除刚失败的那条 body 本身）；同 taskKind 去重、记住是否多图。
  const byTaskKind = new Map<string, boolean>();
  for (const mode of modeBodies) {
    if (failedKey !== undefined && JSON.stringify(mode.body) === failedKey) continue; // 刚被判发不出的那条，不推荐它自己。
    const support = bodyReferenceSupport(mode.body, mode.selection);
    const covers = [...carried].every((family) => support[family]);
    if (covers) byTaskKind.set(mode.taskKind, (byTaskKind.get(mode.taskKind) ?? false) || support.multiImage);
  }
  const carriedText = [...carried].map((f) => FAMILY_LABEL[f]).join(" + ");
  if (byTaskKind.size === 0) {
    // 一个模式都带不动——老实说，指路换模型。
    return `该模型没有任何模式能携带你连上的${carriedText}；请断开它们，或用 nomi_list_models 找一个 references 覆盖${carriedText}的模型。`;
  }
  const parts = [...byTaskKind.entries()].map(([taskKind, multiImage]) => {
    const modeName = TASK_KIND_LABEL[taskKind] || taskKind;
    const multi = multiImage && carried.has("image") ? "（支持多张参考图）" : "";
    return `${modeName}${multi}`;
  });
  return `可改用该模型的：${parts.join(" / ")}——它读得到你携带的${carriedText}。`;
}

/**
 * **无 mapping 时 runtime 兜底请求体的形状**（单一真相源）。
 *
 * runtime 在找不到任何 mapping 时会 POST `/v1/images/generations` 或 `/v1/videos/generations`，
 * body 是写死的这几个键（electron/runtime.ts 的兜底分支直接展开它）。这里声明它是为了让 L3 第三闸
 * 能用**同一份形状**判断「参考发不发得出去」——闸门与真实 wire 必须同源，否则又是一处
 * 「UI/闸门说能发、实际发不出」的漂移。值用 `{{request.params.X}}` 占位与模板同构，
 * bodyReferencedParamKeys 据此取键；**刻意不含任何参考族的键**（这条兜底 wire 确实没有图片位）。
 */
export const NO_MAPPING_FALLBACK_BODY = {
  model: "{{model.modelKey}}",
  prompt: "{{request.prompt}}",
  size: "{{request.params.size}}",
  seed: "{{request.params.seed}}",
  n: "{{request.params.n}}",
  response_format: "url",
} as const;

/**
 * L3 诚实护栏（runTask 前置闸，纯函数）：图生图/图生视频「参考图缺失」或「无传输 mapping」→ 返回
 * 人话错误（调用方在付费守卫/vendor 调用之前拒发，零扣费）；其余情况 null。此前会静默退化成纯文生
 * ——模板引擎丢空键 / fallback body 根本没有图片位——生成成功、扣费成功、和原图毫无关系，
 * 正是「图生图不按原图」的用户体感（docs/plan/2026-07-06-i2i-reference-reliability.md）。
 *
 * modeBodies（可选）：这个模型**所有模式**的 create body。给了则第三闸拒发时多附一句"可走的路"（交付4，
 * reachableModeSuggestion），点名哪个模式带得动携带的参考；不给则维持原拒发文案（语义/零扣费保证不变）。
 */
export function imageEditGuardError(
  kind: string,
  request: TaskParamsInput,
  hasMapping: boolean,
  modelLabel: string,
  /** 这条 mapping 的 create body。给了就多过一道闸：body 读不到的参考素材直接拒发（见上）。 */
  createBody?: unknown,
  modeBodies?: ModelModeBody[],
  selected?: ParameterReferenceSelection,
): string | null {
  // image_to_prompt is a runtime-fixed multimodal text path: executeTextTask
  // inlines its referenceImages into the one model call itself, so it has no
  // profile/fallback body for this guard to audit.
  if (kind === "image_to_prompt") return null;

  // 第三闸对**所有 kind** 生效（运镜的参考视频可能挂在 t2v/omni 上），且只在真带了参考时才可能触发。
  //
  // `createBody === undefined` 有两种截然不同的成因，处置也相反：
  //  · 有 mapping、只是调用方没把 body 传进来（如 customCall 走脚本，不看模板 body）→ 无证据，放行；
  //  · **压根没有 mapping**（hasMapping=false）→ 这不是「查不到」，而是**确知**接下来会走
  //    runtime 的无 mapping 兜底（electron/runtime.ts:449-481），那条 body 是写死的
  //    `{model,prompt,size,seed,n,response_format,extras}`，**任何参考族都没有位置**。
  // 后者此前只在 image_edit / image_to_video 两个 kind 被拦（下方 !hasMapping 分支），于是
  // 自建中转的 text_to_image / text_to_video 带着参考图落进兜底：模板丢键 → 生成成功、扣费成功、
  // 和参考图毫无关系——正是本闸设立要根治的那种静默退化，只是从另一个 kind 的入口回来了。
  // 用 FALLBACK-body 同款判据（不 hardcode 参考键名），让所有 kind 一口径。
  //
  // 补兜底 body 只补**下方没管的那些 kind**：image_edit / image_to_video 无 mapping 时，
  // 下方那条「没有『图生图（改图）』通道」更具体（点名缺的是哪条通道、该怎么办），
  // 拒发与零扣费的效果二者相同，就把话语权留给更会说话的那条，别在这儿抢答。
  const fallbackBodyApplies = !hasMapping && kind !== "image_edit" && kind !== "image_to_video";
  const effectiveBody = typeof createBody !== "undefined" ? createBody
    : fallbackBodyApplies ? NO_MAPPING_FALLBACK_BODY : undefined;
  if (typeof effectiveBody !== "undefined") {
    // 拒不拒只看渲染后的请求体里真有没有这条参考（派生载体、别名都算数）；声明表只决定怎么说下一步。
    const unreachable = unreachableReferenceLabels(request, effectiveBody, selected);
    if (unreachable.length > 0) {
      const base = `模型「${modelLabel}」在这个接入方式下发不出：${unreachable.join(" / ")}。连上的这些素材不会进入请求——为免白扣费这次不发。请断开它们，或换一个支持这些参考的渠道/模型。`;
      const suggestion = reachableModeSuggestion(request, effectiveBody, modeBodies, selected);
      return [base, undeclaredReferenceHint(request, effectiveBody, selected), suggestion].filter(Boolean).join("\n");
    }
  }
  if (kind !== "image_edit" && kind !== "image_to_video") return null;
  const what = kind === "image_edit" ? "图生图" : "图生视频";
  if (!hasImageEditReferences(request, selected)) {
    return `${what}缺少参考图：这次请求里没有任何图片可以发给模型。请连接一张图片节点（或在参考槽添加图片）后再生成${kind === "image_edit" ? "，或切回「文生图」" : ""}。`;
  }
  if (!hasMapping) {
    // 别再让用户「删除后重新接入一次」——中转视频模型缺这条通道的根因在接入路径本身（它从来不建
    // image_to_video），重接一万次也一样；已由 catalogCommit 补齐 + v8 迁移给存量自愈。走到这里说明
    // 这个上游/模型确实没有该能力，如实说，别给假动作。
    return `模型「${modelLabel}」没有「${kind === "image_edit" ? "图生图（改图）" : "图生视频"}」通道，参考图发不出去。请改用支持${what}的模型${kind === "image_edit" ? "，或断开参考图走纯文生图" : "，或断开参考图走纯文生视频"}。`;
  }
  return null;
}
