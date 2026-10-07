// 改草稿那一刀的合并规则：把 patch 并进候选、清掉换模型带来的残留、把调用方这一次点名的
// 参数当场判掉，并算出要报给调用方的 changeset。
//
// 为什么单独成文件：`mcpGenerationTools.ts` 贴着 800 行门岗（R9），而这段逻辑本身是一个
// 完整的单元（两种参数两种待遇那条分界线就住在这里），拆出来比塞在 handler 里更好读、可单测。
import { admitPlanCandidate, type PlanCandidate } from "./executionContract";
import { normalizeAuthoredCandidate, stripParametersNotAccepted, videoCompileOptions } from "./mcpGenerationVideoResolve";
import { admitShotIdentity, declaredModeForModel } from "./semanticGenerationCandidate";
import type { ModuleRegistry } from "./moduleRegistry";
import type { VideoModelCandidate } from "../shared/videoCapabilities/recommendation";
import { resolveArchetypeForModel } from "../shared/modelArchetypes";
import { modeTransportFor } from "../shared/videoCapabilities/modeTransport";
import { mergeNamedParameters, parameterChanges } from "../shared/generationParameterPatch";

/** 读盘归一只需要草稿的这几样（避免把 handler 的大类型拖进来）。 */
type GenerationOperationLike = {
  state: string;
  candidate: PlanCandidate;
  shots?: ReadonlyArray<{ shotId: string; candidate: PlanCandidate }>;
};

const normalizedModelIdentity = (value: string): string => value.trim().toLowerCase();
/** 目录里任务种类的两种拼法（`text-to-image` / `text_to_image`）是同一个种类。 */
const sameTaskKind = (left: string, right: string): boolean =>
  left.trim().toLowerCase().replace(/[-\s]/g, "_") === right.trim().toLowerCase().replace(/[-\s]/g, "_");

/**
 * 档案里的一个生成方式（`t2i` / `i2i` / `i2v` …）在这个模型上是哪一种任务，按目录里这个模型的拼法写出来。
 * 种类只由 `modeTransportFor` 定（供应商特化 > 模式 > 档案）——画布挑 mapping 桶、视频候选归一用的都是它；
 * 这里不另写一张表。认不出这个模型或这个模式 = undefined（不改种类）。
 */
function modeForArchetypeMode(
  registry: Parameters<typeof declaredModeForModel>[0],
  providerId: string,
  modelId: string,
  modeId: string,
): string | undefined {
  const archetype = resolveArchetypeForModel({ modelKey: modelId, vendorKey: providerId });
  const mode = archetype?.modes.find((candidate) => normalizedModelIdentity(candidate.id) === normalizedModelIdentity(modeId));
  const transport = mode && archetype ? modeTransportFor(mode, archetype, providerId) : undefined;
  if (!transport) return undefined;
  return declaredModeForModel(registry, providerId, modelId, transport) ?? transport;
}

export type PlanPatchResolution = {
  normalizedPatch: Partial<Omit<PlanCandidate, "candidateId" | "revision">>;
  changeset?: Record<string, unknown>;
};

/**
 * 两种参数，两种待遇（这条分界线是本刀的核心）：
 *  · 调用方**这一次点名**的参数 → 当场判，错了就结构化拒绝（模型才有得自纠）；
 *  · 换模型带来的**上个模型的残留** → 清掉并如实上报，不拒（它不是谁刚写错的）。
 */
export function resolvePlanPatch(input: {
  baseCandidate: PlanCandidate;
  userPatch: Partial<Omit<PlanCandidate, "candidateId" | "revision">>;
  registry: Pick<ModuleRegistry, "resolve"> & Partial<Pick<ModuleRegistry, "snapshot">>;
  videoModelCandidates?: readonly VideoModelCandidate[];
}): PlanPatchResolution {
  const { baseCandidate, userPatch, registry, videoModelCandidates } = input;
  const nextProviderId = typeof userPatch.providerId === "string" ? userPatch.providerId : baseCandidate.providerId;
  const nextModelId = typeof userPatch.modelId === "string" ? userPatch.modelId : baseCandidate.modelId;
  const modelChanged = normalizedModelIdentity(nextProviderId) !== normalizedModelIdentity(baseCandidate.providerId)
    || normalizedModelIdentity(nextModelId) !== normalizedModelIdentity(baseCandidate.modelId);
  // 只换了生成方式（档案模式 id）、没写种类：种类跟着这个生成方式走（付费卡上切「文生图 / 图生图」、画布连来参考图时卡自己
  // 切过去，都是这一下）。不跟的话候选就成了「模式 id 说改图、种类说文生图」——派发按种类挑供应商的 mapping，
  // 文生图那一份不收参考图，点下去在出站前被拒（2026-10-02 pb02：`catalog generation parameter is unsupported: image_urls`）。
  const modeIdChanged = typeof userPatch.modeId === "string" && userPatch.modeId.trim() !== ""
    && normalizedModelIdentity(userPatch.modeId) !== normalizedModelIdentity(baseCandidate.modeId ?? "");
  const modeFromModeId = userPatch.mode === undefined && modeIdChanged
    ? modeForArchetypeMode(registry, nextProviderId, nextModelId, userPatch.modeId as string)
    : undefined;
  const modeChanged = (typeof userPatch.mode === "string" && normalizedModelIdentity(userPatch.mode) !== normalizedModelIdentity(baseCandidate.mode))
    || (modeFromModeId !== undefined && !sameTaskKind(modeFromModeId, baseCandidate.mode));
  // 换了模型、没另写模式：这一镜还是同一种任务（图还是图），只是模式字符串按新模型目录里的拼法来。
  // 新模型做不了这一种就不换——下面 `admitShotIdentity` 当场拒绝，不悄悄把图片镜头变成视频镜头（第 9 条）。
  const followedMode = modelChanged && userPatch.mode === undefined && modeFromModeId === undefined
    ? declaredModeForModel(registry, nextProviderId, nextModelId, baseCandidate.mode)
    : undefined;
  const nextMode = modeFromModeId !== undefined && !sameTaskKind(modeFromModeId, baseCandidate.mode) ? modeFromModeId : followedMode;
  // 身份那一半先并（模型 / 模式 / 变体），参数先留着原来那份：原有参数要按**新的**身份清残留。
  const identityCandidate = {
    ...baseCandidate,
    ...userPatch,
    ...(nextMode ? { mode: nextMode } : {}),
    ...(modelChanged && userPatch.variantId === undefined ? { variantId: undefined } : {}),
    ...((modelChanged || modeChanged) && userPatch.modeId === undefined ? { modeId: undefined } : {}),
    parameters: baseCandidate.parameters,
    references: userPatch.references ?? baseCandidate.references,
  } as PlanCandidate;
  // 原有参数里新身份不接受的（换模型带来的残留）清掉并上报；这一次点名的参数不走这里，在下面准入时当场判。
  const stripped = stripParametersNotAccepted(identityCandidate, registry, videoModelCandidates);
  const kept = stripped.candidate.parameters;
  // ── 改草稿 = 只改被点名的参数，其余不动（2026-10-05 协调会话定的规则）──
  // 以前这里是 `userPatch.parameters ?? base`：整份替换。Agent 写 `{resolution: "4K"}` 是想改清晰度，
  // 结果比例被清回默认；只改比例时 4K 掉回 1K（验收线实测）。现在点名的键合并进原有参数；
  // 要清掉一个键必须显式写 `null`。付费卡每次带的是这一镜的完整参数集，合并与替换结果相同。
  // 点名的参数单独过语义翻译（比例 → 这个模式的真实键），与 create 两扇门同一个函数；原有参数只当「同一档」的参照。
  // 合并规则（点名的键覆盖、null 删键）与文稿方案改一镜是同一个函数（`mergeNamedParameters`）。
  const normalizedIdentity = normalizeAuthoredCandidate({ ...stripped.candidate, parameters: {} }, registry, videoModelCandidates);
  const mergedParameters = mergeNamedParameters(kept, userPatch.parameters, (written) =>
    normalizeAuthoredCandidate({ ...stripped.candidate, parameters: written }, registry, videoModelCandidates, kept).parameters);
  const normalizedCandidate = { ...normalizedIdentity, parameters: mergedParameters } as PlanCandidate;
  const clearedParameters = stripped.cleared;
  const changedParameters = parameterChanges(baseCandidate.parameters, mergedParameters);
  // 模型或模式变了：和建镜头时同一道账——这一对在目录里必须真有（第 9 条，矛盾的镜头造不出来）。
  if (modelChanged || modeChanged) admitShotIdentity(normalizedCandidate, registry);
  // 判的是**归一之后**的候选：变体别名（`fast-face` → `fast`）要先被认成正名，
  // 否则合法的别名会被自己的变体清单拒掉。
  if (userPatch.parameters !== undefined) {
    // 只做**准入**那一趟，不做提示词投影：plan 这条路拿不到 `referenceSourceUrls`，
    // 整份合同编译一遍会让任何一份 prompt 里带 `@[asset:…]` 的草稿改一次参数就被
    // 「投影不出 @image1」打回。判据与 preview/gate_request 是同一趟（`admitPlanCandidate`）。
    admitPlanCandidate(normalizedCandidate, registry, videoCompileOptions(normalizedCandidate, videoModelCandidates));
  }
  return {
    normalizedPatch: {
      ...userPatch,
      ...(nextMode && nextMode !== baseCandidate.mode ? { mode: nextMode } : {}),
      // 清理过就必须**连同清理后的参数一起落盘**。漏掉这一行时清理只是算了一遍、报了一遍，
      // 存的还是旧参数——「不上报 clearedParameters」那个变异当时因此杀不掉（2026-09-22 验收）。
      //
      // 调用方这一次写了参数时，落盘的是**翻译之后**的那份（语义比例已换成真实键）；只落 userPatch 原样，
      // 下一次读盘归一会把 `aspectRatio` 当残留清掉——用户说的比例就又悄悄没了。
      ...(clearedParameters.length || userPatch.parameters !== undefined ? { parameters: mergedParameters } : {}),
      ...(normalizedCandidate.variantId ? { variantId: normalizedCandidate.variantId } : { variantId: undefined }),
      ...(normalizedCandidate.modeId ? { modeId: normalizedCandidate.modeId } : { modeId: undefined }),
    },
    ...(modelChanged || modeChanged || changedParameters.length ? {
      changeset: {
        modelChanged, modeChanged,
        // 这一次实际改了哪几个键（改前 → 改后；不在 = 这一镜原来没有 / 现在没有）。Agent 照它向用户说改了什么。
        ...(changedParameters.length ? { changedParameters } : {}),
        ...(modelChanged && userPatch.variantId === undefined && baseCandidate.variantId ? { clearedVariantId: baseCandidate.variantId } : {}),
        ...((modelChanged || modeChanged) && userPatch.modeId === undefined && baseCandidate.modeId ? { clearedModeId: baseCandidate.modeId } : {}),
        ...(clearedParameters.length ? { clearedParameters } : {}),
        previousModel: `${baseCandidate.providerId}/${baseCandidate.modelId}`,
        nextModel: `${nextProviderId}/${nextModelId}`,
      },
    } : {}),
  };
}

/**
 * **读盘归一**：把一张**存量草稿**身上这个模型已经不接受的参数清掉，并**落盘一次**。
 *
 * 为什么在读点做而不是逐入口补（2026-09-22 第二轮验收）：上一轮只在 `plan` 那条路清理，
 * 于是 `preview` 算了一遍但不回写、`gate_request` 压根不清——同一张未改动的草稿
 * **预览看得见、点确认时炸**（`unknown_parameter`）。破坏没关闭，只是从预览挪到了付费闸。
 * 所有 capability 都经 `operations.read` 这一个读点，所以归一放这里：
 * 读出来的就是干净的，下游不必各自记得清一次。
 *
 * 只动 `draft`：已密封/已提交的操作是花钱闸的凭据，一个字都不能改。
 */
export async function normalizeStoredDraft(input: {
  operation: GenerationOperationLike;
  projectId: string;
  operationId: string;
  now: string;
  registry: Pick<ModuleRegistry, "resolve">;
  videoModelCandidates?: readonly VideoModelCandidate[];
  patch: (projectId: string, operationId: string, patch: Partial<Omit<PlanCandidate, "candidateId" | "revision">>, now: string, shotId?: string) => GenerationOperationLike | Promise<GenerationOperationLike>;
}): Promise<{ operation: GenerationOperationLike; clearedParameters: string[] }> {
  const { operation, registry, videoModelCandidates } = input;
  if (operation.state !== "draft") return { operation, clearedParameters: [] };
  const cleared = new Set<string>();
  let current = operation;
  // 顶层候选与每一镜是同一段逻辑，走同一个循环（`shotId` 缺省 = 顶层）。
  const units = [{ candidate: operation.candidate, shotId: undefined as string | undefined }, ...(operation.shots ?? [])];
  for (const unit of units) {
    const stripped = stripParametersNotAccepted(unit.candidate, registry, videoModelCandidates);
    if (stripped.cleared.length === 0) continue;
    for (const key of stripped.cleared) cleared.add(key);
    current = await input.patch(input.projectId, input.operationId, { parameters: stripped.candidate.parameters }, input.now, unit.shotId);
  }
  return { operation: current, clearedParameters: [...cleared].sort() };
}
