import { resolveShotTaskKind, statedShotTaskKind, type ShotTaskKindRefusal } from "../shared/generationShotKind";
import { modelKindForTaskKind } from "../shared/capabilityModeManifest";
import { refuseArgument, refuseGeneration } from "./transportFailure";
import { modelHandleOf, resolveModelForTask, resolvedModelNameOf, type ModelHandleRow, type ResolvedModelName } from "../shared/agentCapabilities/modelHandle";
import { catalogRowFor } from "./modelAdmissionSchema";
import type { GenerationDefaultTaskKind } from "../settings/generationModelDefaultsContract";
import type { PlanCandidate } from "./executionContract";
import { ModuleRegistryError, type ModuleResolveInput } from "./moduleRegistry";

/**
 * The model-facing create tool intentionally accepts a short, natural request
 * (`{ prompt: "..." }`).  This module turns that request into the same
 * validated PlanCandidate used by the explicit candidate path.  Keeping this
 * boundary separate prevents the MCP handler from growing a second parser or
 * a provider-specific selection algorithm.
 */

export type SemanticGenerationCandidateParams = Readonly<Record<string, unknown>>;

export type SemanticGenerationDefault = Readonly<{
  moduleId: string;
  providerId: string;
  modelId: string;
  mode: string;
}>;

export type SemanticGenerationCandidateDeps = Readonly<{
  operationId: string;
  params: SemanticGenerationCandidateParams;
  candidateFrom: (value: unknown) => PlanCandidate;
  defaultModelForTaskKind?: (taskKind: GenerationDefaultTaskKind) => SemanticGenerationDefault | undefined;
  /** Structural snapshot only; the handler may expose a registry without a snapshot in tests. */
  registry?: { snapshot?: () => readonly unknown[] };
  /**
   * Test-only escape hatch for isolated registry fixtures. Production callers
   * must resolve the user's saved Workbench default (or pass an explicit
   * model); silently picking the first catalog row is not an acceptable user
   * experience or spend policy.
   */
  allowRegistryFallback?: boolean;
  /**
   * assetId → 可引用身份（内容哈希 + 版本）。生产装配点绑 `resolveProjectAssetReferenceIdentity`
   * 并把 projectId 闭进去。未注入 = 只接受已经带着身份来的参考（逐字节等同接线前），缺身份的当场
   * 拿到人话拒绝，而不是候选 schema 的 `Required`。
   */
  resolveAssetReferenceIdentity?: ResolveAssetReferenceIdentity;
  /**
   * 点名的模型不是一字不差落下的（大小写 / 别名 / 近似写法 / 同名多家按默认落）——合成器每认一次就递一条，
   * 调用方把它们放进回执（`modelNamesResolved`），与 lane `draft_shots` 的回执同一个形状、同一个判据。
   */
  noteResolvedModelName?: (entry: ResolvedModelName) => void;
  /**
   * 这一镜自己没写种类时，调用方按镜头角色 / 有没有参考定下的那一种（剧本拟镜用：锚是文生图，带参考的镜头是图生视频）。
   * 镜头自己写了（`taskKind` / 任务名的 `mode` / 能推出种类的 `modeId`）就以镜头为准。
   */
  taskKindWhenUnstated?: GenerationDefaultTaskKind;
}>;

/** 一份素材的可引用身份。真解析器住 `electron/assets/projectAssetStore.ts`（全仓唯一算它的地方）。 */
export type AssetReferenceIdentity = Readonly<{ contentHash: string; version: number; kind?: "image" | "video" | "audio" }>;
export type ResolveAssetReferenceIdentity = (assetId: string) => AssetReferenceIdentity | undefined;

const TASK_KINDS = new Set<GenerationDefaultTaskKind>([
  "text_to_image",
  "image_edit",
  "text_to_video",
  "image_to_video",
]);

/**
 * Long-form intent is deliberately derived from the user's goal, not from a
 * provider parameter. `parameters.duration` is usually the duration of one
 * provider clip (for example 5 seconds), so treating it as the requested
 * movie length would silently turn every short video into a storyboard.
 */
const VIDEO_INTENT = /(视频|短片|镜头|分镜|动画|成片|video|clip|film|animate|motion)/i;
const LONG_FORM_TERMS = /(长视频|长片|完整视频|成片|多镜|分镜|剧本|广告片|宣传片|纪录片|long[-\s]?form|feature[-\s]?length|multi[-\s]?shot|storyboard)/i;
const DURATION_TOKEN = /(\d+(?:\.\d+)?)\s*(小时|小時|h(?:ours?)?|分钟|分|min(?:ute)?s?|秒|s(?:ec(?:ond)?s?)?)/iu;

/** Parse a total video duration stated in a natural-language goal. */
export function requestedVideoDurationSeconds(params: SemanticGenerationCandidateParams): number | undefined {
  const explicit = [params.totalDurationSeconds, params.targetDurationSeconds].find((value) =>
    typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  if (typeof explicit === "number") return explicit;
  const prompt = [params.prompt, params.scriptText, params.goal]
    .map(text)
    .find((value) => value.length > 0) ?? "";
  const match = prompt.match(DURATION_TOKEN);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = match[2].toLowerCase();
  if (unit === "小时" || unit === "小時" || unit.startsWith("h")) return amount * 3_600;
  if (unit === "分钟" || unit === "分" || unit.startsWith("min")) return amount * 60;
  return amount;
}

/**
 * Decide whether a natural create must enter the storyboard/multi-shot path.
 * A minute-scale duration or an explicit long-form/storyboard term is enough;
 * ordinary 3–30 second clips remain the compact single-shot path.
 */
export function isLongFormGenerationRequest(params: SemanticGenerationCandidateParams): boolean {
  const explicitTaskKind = normalized(params.taskKind);
  if (explicitTaskKind === "text_to_image" || explicitTaskKind === "image_edit") return false;
  const prompt = [params.prompt, params.scriptText, params.goal]
    .map(text)
    .find((value) => value.length > 0) ?? "";
  const video = explicitTaskKind === "text_to_video" || explicitTaskKind === "image_to_video" || VIDEO_INTENT.test(prompt);
  if (!video) return false;
  const duration = requestedVideoDurationSeconds(params);
  return (duration !== undefined && duration >= 60) || LONG_FORM_TERMS.test(prompt);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value: unknown): string {
  return text(value).toLowerCase().replace(/[-\s]/g, "_");
}

function isTaskKind(value: unknown): value is GenerationDefaultTaskKind {
  return typeof value === "string" && TASK_KINDS.has(value as GenerationDefaultTaskKind);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) refuseArgument(`${label} must be an object`);
  return { ...(value as Record<string, unknown>) };
}

/**
 * 参考素材：模型给的是 `assetId`，**身份由宿主补**。
 *
 * 2026-09-18 根因：以前这里只是原样拷一遍，于是缺 `contentHash`/`version` 的那条直接撞上候选
 * schema 的 `Required`——而那两个字段模型根本拿不到。已经带着身份来的（外部宿主、面板自己那条路）
 * 逐字节不变；缺身份又没接解析器时，报的是人话而不是一个模型看不懂的字段名。
 */
/**
 * 一条参考素材的身份补齐。**全仓唯一的那一份**。
 *
 * 2026-09-22 之前这条规则有两份实现：create 走这里，patch 走 `mcpGenerationTools.pinReference`——
 * 逐字一样的两段，连那句中文提示都抄了一遍。它们一起被 adapter 的兜底吃掉时，我只改了其中一份，
 * 回归测试当场报出另一份还在（这正是「同一个语义有几份定义」那一族缺陷的长相）。现在 patch 那条
 * 调的就是这个函数，改措辞只有一个地方。
 */
export function pinAssetReference(item: unknown, resolve?: ResolveAssetReferenceIdentity): unknown {
  if (!item || typeof item !== "object") return item;
  const reference = { ...(item as Record<string, unknown>) };
  // `kind`（图 / 视频 / 音频）由素材本身决定，调用方填的不算：传输层按它选图片 / 视频通道，
  // 缺了或填错，3D-BOX 预演 mp4 就被塞进 image_urls。已带身份的参考只补 / 纠 kind，别的逐字节不变。
  if (typeof reference.contentHash === "string" && reference.contentHash && reference.version !== undefined) {
    const kind = text(reference.assetId) ? resolve?.(text(reference.assetId))?.kind : undefined;
    return kind ? { ...reference, kind } : reference;
  }
  const assetId = text(reference.assetId);
  if (!assetId) refuseArgument("参考素材需要 assetId（来自 look_at_media）", { field: "references" });
  const identity = resolve?.(assetId);
  if (!identity) {
    // 模型最常见的两种错法，分开说：给了一个**镜头 id**（说明书曾经说这里收镜头 id，见 writeVerbs 的
    // `references`），和给了一个**根本不在库里的 assetId**。两种的下一步不一样，合成一句话等于两种都没说清。
    refuseArgument(/^(gen-v2-|shot-)/.test(assetId)
      ? `${assetId} 看起来是画布上的一个镜头/节点 id，不是素材库里的文件。references 只收 look_at_media 给出的 assetId；要复用另一镜的形象，把它写进 storyboard.anchorIds。`
      : `参考素材 ${assetId} 不在这个项目的素材库里，请先用 look_at_media 找到它的 assetId`, { field: "references" });
  }
  return { ...reference, contentHash: identity.contentHash, version: identity.version, ...(identity.kind ? { kind: identity.kind } : {}) };
}

function references(value: unknown, resolve?: ResolveAssetReferenceIdentity): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) refuseArgument("references must be an array of asset ids.", { field: "references" });
  return value.map((item) => pinAssetReference(item, resolve));
}

/**
 * 这一镜**明写**的种类（`statedShotTaskKind`：`taskKind` / 任务名的 `mode` / 能推出种类的 `modeId`），
 * 都没写时退到调用方按镜头角色定下的那一种（`taskKindWhenUnstated`）。`taskKind` 写了却不是四种之一 → 拒。
 */
function explicitTaskKind(deps: Pick<SemanticGenerationCandidateDeps, "params" | "taskKindWhenUnstated">): GenerationDefaultTaskKind | undefined {
  if (deps.params.taskKind !== undefined && !isTaskKind(deps.params.taskKind)) {
    refuseArgument("taskKind must be text_to_image, image_edit, text_to_video or image_to_video");
  }
  return statedShotTaskKind(deps.params) ?? deps.taskKindWhenUnstated;
}

/**
 * 已认出的那一行（供应商 + 模型，一字不差）在目录里声明了哪些模式。纯投影：不认名字（名字只在名字主人认），
 * 两段缺一段或目录里没有这一行 = undefined。
 */
function namedModelModes(registry: SemanticGenerationCandidateDeps["registry"], modelId: string, providerId: string): readonly string[] | undefined {
  if (!modelId || !providerId) return undefined;
  return catalogModelRows(registry).find((row) => row.vendor === providerId && row.modelId === modelId)?.modes;
}

const TASK_KINDS_TEXT = "text_to_image, image_edit, text_to_video or image_to_video";

/** 目录快照里的一行模型：名字主人要的两段身份 + 别名，外加它在哪个模块、声明了哪些模式。 */
type CatalogModelRow = ModelHandleRow & Readonly<{ vendor: string; moduleId: string; modes: readonly string[] }>;

/**
 * 宿主这一刻的目录行（快照里的模块 → 供应商 → 模型）。快照本来就是可用性那道闸筛过的（这里不再判一遍「能不能用」）。
 * 别名从装配期已装好的目录行查（`catalogRowFor`），不另读盘。同一个（供应商, 模型）在两个模块里出现只算一行。
 */
function catalogModelRows(registry: SemanticGenerationCandidateDeps["registry"]): CatalogModelRow[] {
  const rows: CatalogModelRow[] = [];
  const seen = new Set<string>();
  for (const manifest of registry?.snapshot?.() ?? []) {
    if (!manifest || typeof manifest !== "object") continue;
    const moduleId = text((manifest as { moduleId?: unknown }).moduleId);
    const providers = (manifest as { providers?: unknown }).providers;
    if (!moduleId || !Array.isArray(providers)) continue;
    for (const provider of providers) {
      if (!provider || typeof provider !== "object") continue;
      const vendor = text((provider as { providerId?: unknown }).providerId);
      const models = (provider as { models?: unknown }).models;
      if (!vendor || !Array.isArray(models)) continue;
      for (const model of models) {
        if (!model || typeof model !== "object") continue;
        const modelId = text((model as { modelId?: unknown }).modelId);
        const key = modelHandleOf({ vendor, modelId });
        if (!modelId || seen.has(key)) continue;
        seen.add(key);
        const modes = (model as { modes?: unknown }).modes;
        rows.push({ vendor, modelId, moduleId, modelAlias: catalogRowFor(vendor, modelId)?.modelAlias ?? null,
          modes: Array.isArray(modes) ? modes.filter((mode): mode is string => typeof mode === "string") : [] });
      }
    }
  }
  return rows;
}

const modelLabel = (providerId: string, modelId: string): string => (providerId ? `${providerId}/${modelId}` : modelId);

/** 「这个模型不在目录里」——定种类时、核目录时、合成候选时三处说同一句话（码 `unknown_model`）。最像的那一个由名字主人给。 */
function refuseUnknownModel(registry: SemanticGenerationCandidateDeps["registry"], modelId: string, providerId: string): never {
  const rows = catalogModelRows(registry);
  const hit = resolveModelForTask(rows, { modelId, vendor: providerId }, { taskKindOf: () => undefined });
  const nearestHandle = !hit.ok && hit.reason === "unknown" ? hit.nearest[0] : undefined;
  const nearestRow = nearestHandle ? rows.find((row) => modelHandleOf(row) === nearestHandle) : undefined;
  const nearest = nearestRow ? modelLabel(nearestRow.vendor, nearestRow.modelId) : undefined;
  return refuseGeneration({ code: "unknown_model", field: "candidate.modelId", model: modelLabel(providerId, modelId), ...(nearest ? { nearest } : {}) });
}

/** 「这个模型做不了这一种」——两处拒绝（定种类时、核目录时）说同一句话（码 `mode_not_in_model`）。 */
function refuseCannotDo(model: string, requested: string, supported: readonly string[]): never {
  return refuseGeneration({ code: "mode_not_in_model", field: "taskKind", model, value: requested, allowed: supported });
}

/**
 * 种类定不下来时给调用方（多半是 Agent，外部 MCP 宿主也是）的那句话：说清是哪一种情形、下一步怎么写。
 * 写给模型看，和这一层其余的拒绝一样用英文（它照着改参数，不转述原话）。
 * `providerId` / `modelId` 是名字主人认出的那一行（认不出时是原写法）。
 */
function refuseShotTaskKind(refusal: ShotTaskKindRefusal, registry: SemanticGenerationCandidateDeps["registry"], providerId: string, modelId: string): never {
  switch (refusal.reason) {
    case "kind_unspecified":
      // 点了名却定不出种类 = 目录里没有这个模型（有的话它的模式就定了种类）。
      if (modelId) return refuseUnknownModel(registry, modelId, providerId);
      return refuseArgument(`Say what this shot makes: set taskKind (${TASK_KINDS_TEXT}), or name a model from list_models. Nomi does not guess it from the prompt.`, { field: "taskKind" });
    case "model_cannot_do":
      return refuseCannotDo(modelLabel(providerId, modelId), refusal.requested ?? "images or videos", refusal.declared);
    case "model_ambiguous":
      return refuseArgument(`Model ${modelId} makes both images and videos; set taskKind to one of: ${refusal.supported.join(", ")}.`,
        { field: "taskKind", allowed: refusal.supported });
  }
}

/** 点名的模型认成的那一行；不是一字不差落下的，带回执那一条。 */
type NamedCatalogModel = Readonly<{ row: CatalogModelRow; resolved?: ResolvedModelName }>;

const hasReferencesIn = (params: SemanticGenerationCandidateParams): boolean => Array.isArray(params.references) && params.references.length > 0;

/**
 * 点名的模型 → 目录里那一行。**名字只在名字主人认**（`resolveModelForTask`：整串 / 大小写 / 别名 / 近似写法，
 * 说了供应商就只在那一家里认）。同名多家又没说哪家：只有用户给「这一种任务」设的默认恰好是其中一家才落它（U1），
 * 否则拒并列出全部家——绝不取遍历到的第一家（2026-09-22「同名跨家在本仓是两个模型」）。
 * 没点名 = undefined；没有目录快照（隔离夹具）= undefined，身份原样交给后面的准入那一道判。
 */
function namedCatalogModel(
  deps: Pick<SemanticGenerationCandidateDeps, "params" | "registry" | "defaultModelForTaskKind">,
  explicit: GenerationDefaultTaskKind | undefined,
): NamedCatalogModel | undefined {
  const modelId = text(deps.params.modelId);
  if (!modelId) return undefined;
  const rows = catalogModelRows(deps.registry);
  if (rows.length === 0) return undefined;
  const providerId = text(deps.params.providerId);
  const written = { modelId, vendor: providerId };
  const defaultFor = deps.defaultModelForTaskKind;
  const hit = resolveModelForTask(rows, written, {
    taskKindOf: (matches) => {
      const verdict = resolveShotTaskKind({ ...(explicit ? { explicit } : {}), modelModes: matches.flatMap((row) => row.modes), hasReferences: hasReferencesIn(deps.params) });
      return verdict.ok ? verdict.taskKind : undefined;
    },
    ...(defaultFor ? { defaultFor: (taskKind: GenerationDefaultTaskKind) => {
      const declared = defaultFor(taskKind);
      return declared ? { vendor: declared.providerId, modelId: declared.modelId } : undefined;
    } } : {}),
  });
  if (hit.ok) {
    const resolved = resolvedModelNameOf(written, hit);
    return { row: hit.row, ...(resolved ? { resolved } : {}) };
  }
  if (hit.reason === "ambiguous") {
    const vendors = [...new Set(hit.rows.map((row) => row.vendor))];
    return refuseArgument(`Model ${modelId} is carried by several providers (${hit.handles.join(", ")}) and none of them is the user's default for this kind of task. Set providerId to one of: ${vendors.join(", ")}.`,
      { field: "providerId", allowed: vendors });
  }
  return refuseUnknownModel(deps.registry, modelId, providerId);
}

/**
 * 改计划换模型时写下的（供应商, 模型）→ 目录里那一行。与起草同一个名字主人、同一套拒收（`unknown_model` 带最像的、
 * 多家同名按 U1）：`clip-x` 认成 `Clip-X`，别名认成原行。没有目录快照（隔离夹具）= 原样返回，交给后面的准入判。
 * 只换模型、没写供应商（`currentProviderId` 是这一镜现在那家）：现在那家认得出就留在这家（今天「同家换个模型」照旧能用）；
 * 这家认不出才当没说供应商、在全部家里认——和起草一样，同名多家按 U1，不悄悄落到别家。
 */
export function resolvePatchedModel(
  deps: Pick<SemanticGenerationCandidateDeps, "registry" | "defaultModelForTaskKind">,
  written: Readonly<{ providerId?: string; modelId: string }>,
  taskKind: string,
  currentProviderId?: string,
): Readonly<{ providerId: string; modelId: string; resolved?: ResolvedModelName }> {
  const kind = normalized(taskKind);
  const stated = text(written.providerId);
  const current = text(currentProviderId);
  const staysWithCurrent = !stated && Boolean(current)
    && resolveModelForTask(catalogModelRows(deps.registry), { modelId: written.modelId, vendor: current }, { taskKindOf: () => undefined }).ok;
  const providerId = stated || (staysWithCurrent ? current : "");
  const named = namedCatalogModel({ ...deps, params: { modelId: written.modelId, providerId } }, isTaskKind(kind) ? kind : undefined);
  if (!named) return { providerId: stated || current, modelId: written.modelId };
  return { providerId: named.row.vendor, modelId: named.row.modelId, ...(named.resolved ? { resolved: named.resolved } : {}) };
}

/**
 * 这一镜要哪一种生成任务——**只从「点名的模型 + 明写的种类」来**（2026-09-30 付费卡① 第 9 条）。
 * 以前这里按提示词关键词猜（「镜头」「视频」→ 视频），于是点名的图片模型被配上了视频模式，
 * 卡标题、卡体、画布节点、派发各说各的。判据住在 `generationShotKind.resolveShotTaskKind`；这里只负责拒绝时说人话。
 * 点名的模型先经名字主人认出那一行，种类读那一行的模式——大小写 / 别名写法不再被当成「没有这个模型」。
 */
export function shotTaskKind(
  deps: Pick<SemanticGenerationCandidateDeps, "params" | "registry" | "defaultModelForTaskKind" | "taskKindWhenUnstated">,
  named: NamedCatalogModel | undefined = namedCatalogModel(deps, explicitTaskKind(deps)),
): GenerationDefaultTaskKind {
  const modelId = text(deps.params.modelId);
  const explicit = explicitTaskKind(deps);
  const verdict = resolveShotTaskKind({
    ...(explicit ? { explicit } : {}),
    ...(modelId ? { modelModes: named?.row.modes } : {}),
    hasReferences: hasReferencesIn(deps.params),
  });
  if (!verdict.ok) return refuseShotTaskKind(verdict.refusal, deps.registry, named?.row.vendor ?? text(deps.params.providerId), named?.row.modelId ?? modelId);
  return verdict.taskKind;
}

/**
 * 换模型时这一镜的模式怎么跟过去：同一种任务（比如文生图）在新模型的目录里写成哪一个模式字符串（拼法以目录为准）。
 * 新模型做不了这一种 = undefined——交给 `admitShotIdentity` 当场拒绝，不悄悄换成别的种类。
 */
export function declaredModeForModel(
  registry: SemanticGenerationCandidateDeps["registry"],
  providerId: string,
  modelId: string,
  mode: string,
): string | undefined {
  const wanted = normalized(mode);
  return namedModelModes(registry, modelId, providerId)?.find((declared) => normalized(declared) === wanted);
}

/**
 * 一镜的「模型 + 模式」在目录里真有这一对——建镜头的**每一条路**（单镜 create、多镜 create、剧本拟镜、改草稿）
 * 落盘前都过这一道，和派发前编译合同用的是同一个判据（`registry.resolve`）。矛盾的镜头当场拒绝、说清原因，
 * 不留到点「生成这张」那一刻才发现。参考卡（anchor）只能是图片：它是定形象用的那张图。
 */
export function admitShotIdentity(
  candidate: Pick<PlanCandidate, "moduleId" | "providerId" | "modelId" | "mode">,
  registry: { resolve(input: ModuleResolveInput): unknown; snapshot?: () => readonly unknown[] },
  role?: string,
): void {
  if (role === "anchor" && modelKindForTaskKind(candidate.mode) !== "image") {
    refuseArgument(`A reference card (role "anchor") must be an image: it fixes how a character or place looks. This one is ${candidate.mode}. Name an image model for it, or make it a normal shot.`, { field: "role" });
  }
  try {
    registry.resolve({ moduleId: candidate.moduleId, providerId: candidate.providerId, modelId: candidate.modelId, mode: candidate.mode });
  } catch (error) {
    if (!(error instanceof ModuleRegistryError)) throw error;
    const declared = namedModelModes(registry, candidate.modelId, candidate.providerId) ?? [];
    if (declared.length === 0) refuseUnknownModel(registry, candidate.modelId, candidate.providerId);
    if (!declared.some((mode) => normalized(mode) === normalized(candidate.mode))) {
      refuseCannotDo(`${candidate.providerId}/${candidate.modelId}`, candidate.mode, declared);
    }
    // 模型做得了这一种，目录却对不上（模块 / 拼法）：照目录的原话说，别说成「做不了」。
    refuseArgument(`${error.message}. Model ${candidate.modelId} declares: ${declared.join(", ")}.`, { field: "mode", allowed: declared });
  }
}

function modeFromSnapshot(
  deps: SemanticGenerationCandidateDeps,
  selected: SemanticGenerationDefault,
  taskKind: GenerationDefaultTaskKind,
): string {
  const manifests = deps.registry?.snapshot?.() ?? [];
  const manifest = manifests.find((item): item is { moduleId: string; modes?: readonly unknown[]; providers?: readonly unknown[] } =>
    Boolean(item && typeof item === "object" && (item as { moduleId?: unknown }).moduleId === selected.moduleId));
  const providers = Array.isArray(manifest?.providers) ? manifest.providers : [];
  const provider = providers.find((item): item is { providerId: string; models?: readonly unknown[] } =>
    Boolean(item && typeof item === "object" && (item as { providerId?: unknown }).providerId === selected.providerId));
  const models = Array.isArray(provider?.models) ? provider.models : [];
  const model = models.find((item): item is { modelId: string; modes?: readonly unknown[] } =>
    Boolean(item && typeof item === "object" && (item as { modelId?: unknown }).modelId === selected.modelId));
  const modelModes = Array.isArray(model?.modes) ? model.modes.filter((mode): mode is string => typeof mode === "string") : [];
  const manifestModes = Array.isArray(manifest?.modes) ? manifest.modes.filter((mode): mode is string => typeof mode === "string") : [];
  const wanted = normalized(selected.mode) || normalized(taskKind);
  const declared = modelModes.find((mode) => normalized(mode) === wanted)
    ?? modelModes.find((mode) => normalized(mode) === normalized(taskKind))
    ?? manifestModes.find((mode) => normalized(mode) === wanted)
    ?? manifestModes.find((mode) => normalized(mode) === normalized(taskKind));
  return declared ?? selected.mode;
}

function fallbackFromSnapshot(
  deps: SemanticGenerationCandidateDeps,
  taskKind: GenerationDefaultTaskKind,
): SemanticGenerationDefault | undefined {
  for (const manifest of deps.registry?.snapshot?.() ?? []) {
    if (!manifest || typeof manifest !== "object") continue;
    const moduleId = text((manifest as { moduleId?: unknown }).moduleId);
    const providers = (manifest as { providers?: unknown }).providers;
    if (!moduleId || !Array.isArray(providers)) continue;
    for (const provider of providers) {
      if (!provider || typeof provider !== "object") continue;
      const providerId = text((provider as { providerId?: unknown }).providerId);
      const models = (provider as { models?: unknown }).models;
      if (!providerId || !Array.isArray(models)) continue;
      const model = models.find((candidate) => {
        if (!candidate || typeof candidate !== "object") return false;
        const modes = (candidate as { modes?: unknown }).modes;
        return Array.isArray(modes) && modes.some((mode) => normalized(mode) === normalized(taskKind));
      }) as { modelId?: unknown; modes?: unknown } | undefined;
      if (model) {
        const modes = Array.isArray(model.modes) ? model.modes.filter((candidate): candidate is string => typeof candidate === "string") : [];
        const mode = modes.find((candidate) => normalized(candidate) === normalized(taskKind)) ?? modes[0];
        const modelId = text(model.modelId);
        if (mode && modelId) return { moduleId, providerId, modelId, mode };
      }
    }
  }
  return undefined;
}

/**
 * Build the canonical candidate for a short semantic create request.  An
 * explicit `candidate` is still authoritative and is parsed unchanged; the
 * short path only fills omitted identity fields from saved Workbench defaults
 * or the live module registry.
 */
export function semanticCandidateFromParams(deps: SemanticGenerationCandidateDeps): PlanCandidate {
  if (deps.params.candidate !== undefined) {
    // 显式候选也走同一条参考解析：否则「给了 candidate」这条路又变成一份不补身份的平行版（P1）。
    const explicit = record(deps.params.candidate, "candidate");
    return deps.candidateFrom(explicit.references === undefined
      ? explicit
      : { ...explicit, references: references(explicit.references, deps.resolveAssetReferenceIdentity) });
  }
  const prompt = text(deps.params.prompt);
  if (!prompt) refuseArgument("prompt is required when candidate is omitted");

  const named = namedCatalogModel(deps, explicitTaskKind(deps));
  const taskKind = shotTaskKind(deps, named);
  if (named?.resolved) deps.noteResolvedModelName?.(named.resolved);
  const configured = deps.defaultModelForTaskKind?.(taskKind);
  // A production semantic request must never infer a spend-bearing model from
  // catalog row order. The only implicit identity is the saved Workbench
  // default; registry fallback is opt-in for no-provider unit fixtures only.
  const fallback = configured ?? (deps.allowRegistryFallback ? fallbackFromSnapshot(deps, taskKind) : undefined);
  // 显式点名的模型：身份是名字主人认出的那一行（目录事实）；只有没点名时才落到保存的默认。
  // 点了名却认不出（没有目录快照的隔离夹具）时只用写下的两段，绝不把默认的供应商拼到点名的 id 上。
  const namedModelId = text(deps.params.modelId);
  const moduleId = text(deps.params.moduleId) || named?.row.moduleId || fallback?.moduleId;
  const providerId = named?.row.vendor || text(deps.params.providerId) || (namedModelId ? undefined : fallback?.providerId);
  const modelId = named?.row.modelId || namedModelId || fallback?.modelId;
  if (!moduleId || !providerId || !modelId) {
    // 两种情形，两个码（2026-11-08）：**点了名却在目录里找不到** = `unknown_model`（带最接近的那一个）；
    // 没点名也没有默认 = `no_default_model`。以前两者是同一句「没有配置可用的图片模型」——39 题轨迹里
    // 9 次模型点名的 id 只是拼错 / 供应商写错，却被告知去设置里配默认模型。
    // 后一句有两个读者（2026-09-18 真机实测）：用户能去设置里选，**而 Agent 不能**，所以正文同时说「这次调用里直接点名」。
    if (namedModelId) refuseUnknownModel(deps.registry, namedModelId, text(deps.params.providerId));
    refuseGeneration({ code: "no_default_model", field: "candidate.modelId", media: taskKind.includes("video") ? "video" : "image" });
  }
  // 方式不从默认继承（2026-11-17 U4）：默认只答「哪个模型」，方式由归一按这个模型的档案 + 这次真放进来的参考现算
  // （`mcpGenerationVideoResolve.normalizeVideoCandidate` → `modeForInputs`）。说明白的 `modeId` / `variantId` 照收。
  const selectedModeId = text(deps.params.modeId);
  const selectedVariantId = text(deps.params.variantId);
  const selected = {
    moduleId,
    providerId,
    modelId,
    mode: text(deps.params.mode) || taskKind,
    ...(selectedModeId ? { modeId: selectedModeId } : {}),
    ...(selectedVariantId ? { variantId: selectedVariantId } : {}),
  };
  const mode = modeFromSnapshot(deps, selected, taskKind);
  return deps.candidateFrom({
    candidateId: `cand-${deps.operationId}`,
    revision: 1,
    moduleId: selected.moduleId,
    providerId: selected.providerId,
    modelId: selected.modelId,
    mode,
    ...(selected.modeId ? { modeId: selected.modeId } : {}),
    ...(selected.variantId ? { variantId: selected.variantId } : {}),
    prompt,
    parameters: record(deps.params.parameters, "parameters"),
    references: references(deps.params.references, deps.resolveAssetReferenceIdentity),
  });
}

/**
 * 「这份草稿用的模型」与「用户声明的默认模型」对不上的那几镜。
 *
 * 补默认只发生在模型**没点名**的时候（上面 `semanticCandidateFromParams`）；模型点名了别家，宿主照单全收——
 * 因为宿主分不清「用户点名」和「模型自己挑的」。所以在草稿落地的这一处把**事实**递还给模型：
 * 用户的默认是谁、这份草稿实际用的是谁。它据此要么改回默认，要么在回话里向用户说清为什么换、换成了谁——
 * 嘴里的话读的是这份状态，不是它的印象。默认由 `defaultModelForTaskKind`（用户声明的唯一解释者）回答，这里不另存。
 */
export type DeclaredDefaultDeviation = Readonly<{
  shotId?: string;
  taskKind: GenerationDefaultTaskKind;
  userDefault: string;
  used: string;
  /** 用户在界面上看到的名字——Agent 对用户说话只许用它，不许念上面两个 id。拿不到名字时退回 id 本身（照实，不编）。 */
  userDefaultName: string;
  usedName: string;
}>;

export function declaredDefaultDeviations(
  items: ReadonlyArray<{ shotId?: string; params: SemanticGenerationCandidateParams; candidate: Pick<PlanCandidate, "providerId" | "modelId" | "mode"> }>,
  defaultFor: SemanticGenerationCandidateDeps["defaultModelForTaskKind"],
  names: Readonly<Record<string, string>> = {},
): DeclaredDefaultDeviation[] {
  if (!defaultFor) return [];
  return items.flatMap(({ shotId, candidate }): DeclaredDefaultDeviation[] => {
    // 种类读建好的候选（它在建镜头那一刻已经和点名的模型对过账），不再按提示词另猜一遍。
    const taskKind = normalized(candidate.mode);
    if (!isTaskKind(taskKind)) return [];
    const declared = defaultFor(taskKind);
    if (!declared || (declared.providerId === candidate.providerId && declared.modelId === candidate.modelId)) return [];
    const userDefault = `${declared.providerId}/${declared.modelId}`;
    const used = `${candidate.providerId}/${candidate.modelId}`;
    return [{ ...(shotId ? { shotId } : {}), taskKind, userDefault, used, userDefaultName: names[userDefault] ?? declared.modelId, usedName: names[used] ?? candidate.modelId }];
  });
}

export const DECLARED_DEFAULT_DEVIATION_NOTE =
  "modelDeviatesFromUserDefault lists drafts whose model is not the one the user set as default in Settings. "
  + "If the user did not name that model, patch the draft back to the user's default; if you keep it, tell the user why it changed and which model it is now — say the models to the user by userDefaultName / usedName (the names the user sees on cards and in Settings) — never read out the ids, and take names from this result, not from memory.";
