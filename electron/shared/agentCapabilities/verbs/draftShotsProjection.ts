// `draft_shots` 的投影：**结构有损**的那一档，唯一一个。
//
// ── 为什么它不能像别的动词那样一行 `.omit()` 了事 ──
//
// 能投影的那 11 个动词里，模型面与宿主面只差「宿主自己会补的那几个字段」，所以模型面就是宿主面的
// `.omit()` 投影，字段名逐字相同，中间没有任何可写的对应关系（见 `verbProjections.ts`）。
// `draft_shots` 有三处**形状真的变了**，而投影里故意没有「改形状」这个动作：
//
//   ① `durationSec` → `parameters.duration`：改的是**嵌套层级**。宿主读时长只有一处
//      （`mcpGenerationVideoResolve.shotDurationSeconds` 认 `parameters.duration`），顶层没有时长字段。
//   ② `model`（完整名字 `模型id@供应商`）→ 宿主的 `providerId` / `modelId`：**一个名字拆回两件身份**。
//      宿主不解析这串字：lane 拿这条消息带上来的同一份可用模型清单按整串查表（`modelHandle.ts`），
//      查到的那一行给出两件身份。分镜子对象里独立关键帧的 `keyframe.model` 同样查表、换回 `modelKey` / `modelVendor`。
//      查不到 / 只写 id 而多家都有 → 当场拒收并给完整名字（`resolveDraftShotModels`），不替 Agent 挑一家。
//   ①' `aspectRatio` → `parameters.aspectRatio`（2026-10-05）：同样是嵌套层级。这里落的是**语义载体键**，
//      不是任何一家的参数名——哪家叫 `size`、哪家叫 `ratio`，这一层看不见（投影不知道最后选的是哪个模型，
//      没点名时还是宿主按用户默认补的），所以翻成真实键由宿主在看得见所选模式参数表的那一处做
//      （`capabilityCore/semanticAspectRatio.ts`）。三条路（多镜 / 单镜 / 改草稿）都过这一个函数，一处覆盖三条。
//   ③ `references: string[]` → `{assetId}[]`：形状变了，内容哈希与版本由宿主按项目素材库补
//      （`resolveProjectAssetReferenceIdentity`）。两个读动词都不返回那两件，模型根本拿不到它们——
//      当年正是硬要它给，才让带参考图的分镜 100% 失败。
//      （裁决 §4.5 提过另一条出路：宿主直接收 `string | {assetId,…}` 的 union。没走，因为那会把这次
//      归一从**一处声明**推进到每一个下游消费点——正是 R5 那条规则在治的形状。）
//
// 另外两件不是形状变化，是**这条路上没有它的位置**：改草稿递给宿主的是候选 patch（提示词/模型/参数/
// 参考），镜头**信封**（`title` / `role`）不在那份形状里；单镜 create 把一镜摊成顶层参数，顶层同样没有
// 信封的位置。「送不到」与「可以丢」长得一模一样（都是「值没过去」），所以两者必须分开写明：
// 信封字段 `refuse`（当场说）。`shotId` 是第三种——它**既不是**候选内容**也不是**该丢的东西，
// 而是**寻址**：提到 plan patch 的信封上（`draftShotsPatchEnvelope`），宿主据它只改那一镜。
//
// ── 「一个字段都不许没人管」在这里是**编译期**的 ──
//
// 对照表时代这条不变量住在装配期（表里漏一条就抛）。这里换成 TypeScript：每个函数把模型面的字段**全部
// 解构出来**，剩下的落进 `unhandled`，再一句 `unhandled satisfies Record<string, never>`——动词 schema
// 新长一个字段而没人处置它，`tsc` 当场红，不用等 App 起来。落点那一侧同样由类型钉住：返回类型取自宿主
// schema，宿主改名就红。这两条合起来，比那张 353 行的关系表**早一步**、也**严一层**。
import type { z } from "zod";

import { generationPlanInputSchema, type StoryboardAuthorFields } from "../generationPlanSchemas";
import { resolveModelForTask, resolvedModelNameOf, type ModelHandleRow, type ModelIdentity, type ResolvedModelName } from "../modelHandle";
import { resolveShotTaskKind, statedShotTaskKind } from "../../generationShotKind";
import { modelKindForTaskKind } from "../../capabilityModeManifest";
import { GENERATION_DEFAULT_TASK_KINDS, type GenerationDefaultTaskKind } from "../../../settings/generationModelDefaultsContract";
import { LaneDomainFailure, toolArgumentsRejected } from "../../agentLane/laneToolContract";
import type { ToolInputIssue } from "../../agentLane/toolInputIssues";
import { generationShotEnvelopeOf, type GenerationShotEnvelope } from "../../generationShotEnvelope";
import { draftShotSchema } from "./writeVerbs";
import { ASPECT_RATIO_SEMANTIC_KEY } from "../../aspectRatioValue";
import { generationProblemFrom } from "../../generationProblem";
import { GENERATION_INPUT_INVALID_CODE } from "../admissionRejectionHints";

/** 宿主那两支的类型锚点（只在类型位置用，所以写成类型而不是 const——那会是一条 lint 噪音）。 */
type PlanCreate = z.infer<(typeof generationPlanInputSchema.options)[1]>;
type PlanPatch = z.infer<(typeof generationPlanInputSchema.options)[2]>;

/** 模型面的一镜。 */
export type DraftShot = z.infer<typeof draftShotSchema>;
/** 模型面的顶层（`draft_shots` 自己的 schema 推出来的，不在这里重列）。 */
export type DraftShotsArgs = { operationId?: string; newPlan?: boolean; taskKind?: DraftShot["taskKind"]; shots: DraftShot[] };
/** 查表之后的身份：宿主那两件。 */
export type DraftShotModelIdentity = Readonly<{ providerId: string; modelId: string }>;
/** 一镜查到的身份：镜头自己的（`model`）与独立关键帧的（`storyboard.keyframe.model`）。缺 = 没点名 = 用户默认。 */
export type DraftShotModels = Readonly<{ shot?: DraftShotModelIdentity; keyframe?: DraftShotModelIdentity }>;
/** Agent 写的不是完整名字、宿主替它认出来了：回执里告诉它落成了谁，下次照抄完整名字（形状与判据住名字主人）。 */
export type { ResolvedModelName };
/** 用户给每一种任务设的默认（lane 由 `readLaneDeclaredDefaults` 给，和宿主补默认问的是同一个解析器）。 */
export type DraftShotModelDefaults = Readonly<Partial<Record<GenerationDefaultTaskKind, ModelIdentity>>>;
/** 宿主的多镜 create 里的一镜。 */
type PlanShot = NonNullable<PlanCreate["shots"]>[number];
/** 宿主的候选 patch（改草稿那一支）。 */
type CandidatePatch = PlanPatch["patch"];
/** 宿主的单镜 create：一镜摊成顶层参数。 */
type PlanFlatCreate = Omit<PlanCreate, "operation" | "shots" | "scriptText" | "cardHidden" | "candidate">;

/** `refuse` 那一档：模型填了它，而这条路送不到宿主。静默丢掉就是这一整类缺陷的形状。 */
function refuse(field: string, why: string): never {
  throw Object.assign(new Error(`draft_shots: "${field}" 在这条路上送不到宿主（${why}）`), {
    code: "capability_input_invalid",
  });
}

const REFUSE_ON_PATCH = "改草稿递给宿主的是候选 patch（提示词/模型/参数/参考），信封不在那份形状里";
const REFUSE_ON_FLAT = "单镜 create 把这一镜摊成顶层参数，顶层没有信封的位置";

/**
 * 三个宿主形状**共有**的那一半：模型填的语义。三处形状变化（①②③）全在这里，一处一行。
 * 返回类型取自宿主的候选 patch，所以宿主改名就是 tsc 红。
 */
function semanticsOf(shot: DraftShot, models: DraftShotModels): CandidatePatch {
  const {
    storyboard, prompt, taskKind, modeId, model: _resolvedIntoModels, variantId, parameters, durationSec, aspectRatio, references,
    // 信封那三件不属于「语义」，由各自的调用点按这条路有没有位置处置。
    shotId: _envelopeShotId, role: _envelopeRole, title: _envelopeTitle,
    ...unhandled
  } = shot;
  // 一个字段都不许没人管：新长出来的模型面字段落进 `unhandled`，而这个类型不接受任何键 → tsc 红。
  void (unhandled satisfies Record<string, never>);
  return {
    ...(storyboard !== undefined ? { storyboard: hostStoryboardOf(storyboard, models.keyframe) } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(taskKind !== undefined ? { taskKind } : {}),
    // ① 时长改的是嵌套层级：宿主只在 `parameters.duration` 读它，顶层没有时长字段。
    // ①' 比例同样下沉，落语义载体键；宿主翻成所选模式的真实键（翻不了就拒，不回落默认）。
    ...(parameters !== undefined || durationSec !== undefined || aspectRatio !== undefined
      ? { parameters: {
        ...(parameters ?? {}),
        ...(durationSec !== undefined ? { duration: durationSec } : {}),
        ...(aspectRatio !== undefined ? { [ASPECT_RATIO_SEMANTIC_KEY]: aspectRatio } : {}),
      } }
      : {}),
    ...(modeId !== undefined ? { modeId } : {}),
    ...(variantId !== undefined ? { variantId } : {}),
    // ② 一个名字拆回两件身份（查表在 `resolveDraftShotModels`，这里只落位）。
    ...(models.shot ? { providerId: models.shot.providerId, modelId: models.shot.modelId } : {}),
    // ③ 身份由宿主补：模型只给「哪份素材」。
    ...(references !== undefined ? { references: references.map((assetId) => ({ assetId })) } : {}),
  };
}

/** 分镜子对象：模型面的 `keyframe.model` 换回宿主的 `modelKey` / `modelVendor`（落盘字段不变）。 */
function hostStoryboardOf(storyboard: NonNullable<DraftShot["storyboard"]>, keyframeModel: DraftShotModelIdentity | undefined): StoryboardAuthorFields {
  if (!storyboard.keyframe) return storyboard as StoryboardAuthorFields;
  const { model: _resolved, ...keyframe } = storyboard.keyframe;
  return { ...storyboard, keyframe: { ...keyframe,
    ...(keyframeModel ? { modelKey: keyframeModel.modelId, modelVendor: keyframeModel.providerId } : {}) } } as StoryboardAuthorFields;
}

const LIST_MODELS_NEXT = "Copy a full name exactly as list_models or the model index prints it.";

/**
 * 有一镜点的名字查不到：码与原因和宿主准入那一层的「目录里没有这个模型」同一个（`generation_input_invalid` +
 * `unknown_model`），面板照旧说「没有这个模型」、遥测照旧记 `unknown_model`——查表从宿主挪到这里，用户看到的不变。
 * 字段行仍按镜列（同一个格式器），模型读到的是这一镜写了什么、最像的完整名字是哪几个。
 * 只有歧义（只写 id 而多家都有）时没有闭合原因可套，按入参被拒收说（`tool_arguments_invalid`）。
 */
function modelNameRejected(issues: readonly ToolInputIssue[], unknown: Readonly<{ path: string; written: string; nearest?: string }> | undefined): LaneDomainFailure {
  const rejected = toolArgumentsRejected("draft_shots", issues);
  if (!unknown) return new LaneDomainFailure({ ...rejected, nextAction: LIST_MODELS_NEXT });
  return new LaneDomainFailure({
    ...rejected,
    code: GENERATION_INPUT_INVALID_CODE,
    message: `draft_shots could not complete the requested action (${GENERATION_INPUT_INVALID_CODE}): model ${unknown.written} is not in the model list for this message; nothing ran and nothing was charged.`,
    nextAction: LIST_MODELS_NEXT,
    problem: generationProblemFrom({ code: "unknown_model", field: unknown.path, ...(unknown.nearest ? { nearest: unknown.nearest } : {}) }),
  });
}

/**
 * 每一镜点名的模型 → 宿主的两件身份。**名字只在名字主人认**（`resolveModelForTask`，与宿主语义合成同一个函数），
 * 清单是这条消息带上来的同一份可用模型（模型在索引和 list_models 里看到的就是它）。拒收只有两种，都带下一步：
 *   · 查不到：给最像的 ≤3 个完整名字（一个都不像就指向 list_models）；
 *   · 只写了 id 而多家都有，又没有一家是用户给「这一种任务」设的默认（U1）：列出那几个完整名字。
 *     恰好一家是默认 → 落它，回执写明「同名有 N 家，按你的默认用了哪家」。
 * 「这一种任务」：这一镜明写的（`statedShotTaskKind`），没写就按对上的那几行是图还是视频 + 这一镜带没带参考
 * （`resolveShotTaskKind`，和宿主定种类同一个判据）。独立关键帧恒为文生图。
 * （第三种「这个模型做不了这类任务」在宿主准入那一层，照旧。）
 * 全部问题一次说完，不让模型一镜一镜地撞。
 */
export function resolveDraftShotModels(
  shots: readonly DraftShot[],
  rows: readonly LaneModelRow[],
  defaults: DraftShotModelDefaults = {},
): { models: DraftShotModels[]; resolved: ResolvedModelName[] } {
  const issues: ToolInputIssue[] = [];
  const resolved: ResolvedModelName[] = [];
  let unknown: { path: string; written: string; nearest?: string } | undefined;
  const lookup = (written: string | undefined, path: string, taskKindOf: (matches: readonly LaneModelRow[]) => GenerationDefaultTaskKind | undefined): DraftShotModelIdentity | undefined => {
    if (written === undefined) return undefined;
    const hit = resolveModelForTask(rows, written, { taskKindOf, defaultFor: (taskKind) => defaults[taskKind] });
    if (hit.ok) {
      const name = resolvedModelNameOf(written, hit);
      if (name) resolved.push(name);
      return { providerId: hit.row.vendor ?? "", modelId: hit.row.modelId };
    }
    const allowed = hit.reason === "ambiguous" ? hit.handles : hit.nearest;
    if (hit.reason !== "ambiguous" && !unknown) unknown = { path, written, ...(allowed[0] ? { nearest: allowed[0] } : {}) };
    issues.push({ path, kind: "not_allowed", received: written, allowed,
      note: hit.reason === "ambiguous" ? "several vendors carry this model id and none is the user's default for this kind of task; pick one full name"
        : allowed.length ? "no model with this full name" : "no model with this name; call list_models for full names" });
    return undefined;
  };
  const models = shots.map((shot, index) => ({
    shot: lookup(shot.model, `shots.${index}.model`, (matches) => statedShotTaskKind(shot) ?? kindFromRows(matches, (shot.references?.length ?? 0) > 0)),
    keyframe: lookup(shot.storyboard?.keyframe?.model, `shots.${index}.storyboard.keyframe.model`, () => "text_to_image"),
  }));
  if (issues.length) {
    throw modelNameRejected(issues, unknown);
  }
  return { models, resolved };
}

/** lane 清单里的一行：名字主人要的身份，外加它出什么（`AgentModelEntry` 天然满足）。 */
type LaneModelRow = ModelHandleRow & Readonly<{ kind?: string }>;

/** 对上的那几行出什么（图 / 视频）+ 有没有参考 → 这一种任务。判据是宿主那一个（`resolveShotTaskKind`）。 */
function kindFromRows(matches: readonly LaneModelRow[], hasReferences: boolean): GenerationDefaultTaskKind | undefined {
  const modelModes = GENERATION_DEFAULT_TASK_KINDS.filter((taskKind) => matches.some((row) => row.kind === modelKindForTaskKind(taskKind)));
  const verdict = resolveShotTaskKind({ modelModes, hasReferences });
  return verdict.ok ? verdict.taskKind : undefined;
}

/**
 * 信封那一部分整只从**单一真相源**搬（`generationShotEnvelopeOf`），不在这里手写字段列表——
 * `title` 当年正是死在五处手写的逐字段重建里（R5）。两个字段在这条路上摘掉：
 * `included` 从来不是模型的事（用户在报价卡上勾，缺省即算数），`shotId` 建新镜时还不存在（宿主发）。
 */
const SHOT_ID_ASSIGNED_BY_HOST = "";
function modelAuthoredEnvelopeOf(shot: DraftShot): Partial<GenerationShotEnvelope> {
  const { shotId, included: _hostAssigns, ...rest } = generationShotEnvelopeOf({
    shotId: shot.shotId ?? SHOT_ID_ASSIGNED_BY_HOST, role: shot.role, title: shot.title,
  });
  return shot.shotId === undefined ? rest : { shotId, ...rest };
}

/** 多镜 create 的一镜：语义 + 完整信封（这条路上信封有位置）。 */
export function draftShotToPlanShot(shot: DraftShot, models: DraftShotModels): PlanShot {
  return { ...semanticsOf(shot, models), ...modelAuthoredEnvelopeOf(shot) };
}

/**
 * 改草稿那一支的候选 patch：只有语义。
 * `title` / `role` 当场拒绝（动词声明的 `superRefine` 在更早一层已经告诉过模型，这里是它的第二层）；
 * `shotId` 不在这里——它是寻址不是候选，由 `draftShotsPatchEnvelope` 提到 plan patch 的信封上。
 */
export function draftShotToCandidatePatch(shot: DraftShot, models: DraftShotModels): CandidatePatch {
  if (shot.title !== undefined) refuse("shots[].title", REFUSE_ON_PATCH);
  if (shot.role !== undefined) refuse("shots[].role", REFUSE_ON_PATCH);
  return semanticsOf(shot, models);
}

/** 单镜 create：一镜摊成顶层参数，顶层没有信封的位置，三件都当场拒绝。 */
export function draftShotToFlatCreate(shot: DraftShot, models: DraftShotModels): PlanFlatCreate {
  if (shot.title !== undefined) refuse("shots[].title", REFUSE_ON_FLAT);
  if (shot.role !== undefined) refuse("shots[].role", REFUSE_ON_FLAT);
  if (shot.shotId !== undefined) refuse("shots[].shotId", REFUSE_ON_FLAT);
  return semanticsOf(shot, models);
}

/**
 * 顶层的缺省（只剩 `taskKind`）折进每一镜：**逐镜自己写的优先**。顶层 `candidate` 2026-11-15 删了：
 * 「不填 = 用户默认」已经是每镜 `model` 的语义，第二个默认位置只是第二个家。
 * （宿主那侧也有一份 `inherited`，两者不是同一件事：这一份决定「发出去的那一镜长什么样」，
 * 宿主那份决定「没人说时按目录怎么合成」。）
 */
export function withDraftShotsDefaults(args: DraftShotsArgs, shot: DraftShot): DraftShot {
  const { taskKind, operationId: _selectsBranch, newPlan: _planChoice, shots: _theseShots, ...unhandled } = args;
  void (unhandled satisfies Record<string, never>);
  return {
    ...shot,
    ...(shot.taskKind === undefined && taskKind !== undefined ? { taskKind } : {}),
  };
}

/**
 * 改草稿那一支的**信封**：哪一份草稿（`operationId`）、哪一镜（`shotId`）。
 *
 * `shotId` 为什么在这里而不在候选 patch 里：它是**寻址**，不是候选内容。宿主按它只改那一镜的候选
 * （那一镜 revision +1，已落的节点按它重绑定）；缺省 = 单镜草稿的顶层候选。2026-09-18 之前这条是
 * 「有意丢弃」，于是「改第 2 镜」永远改的是顶层候选，用户在画布上什么都看不到——单一账本那一刀
 * （#813）把这扇门开通，宿主的 patch 分支从那天起收 `shotId`，这里跟着把它提到信封上。
 *
 * 返回类型取自**宿主自己的 patch 分支**减掉候选内容，所以宿主改名或改必填，这里是 tsc 红。
 */
export function draftShotsPatchEnvelope(args: DraftShotsArgs, shot: DraftShot): Omit<PlanPatch, "operation" | "patch"> {
  if (args.operationId === undefined) throw new Error("draft_shots: 改草稿那一支必须带 operationId");
  return { operationId: args.operationId, ...(shot.shotId !== undefined ? { shotId: shot.shotId } : {}) };
}
