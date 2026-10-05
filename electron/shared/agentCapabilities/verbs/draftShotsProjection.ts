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
//   ② `candidate.{providerId,modelId}` → 顶层 `providerId` / `modelId`：**拍平嵌套**。宿主的逐镜
//      `candidate` 是完整的内部候选（candidateId / revision / 传输接线），模型给不出；它给的两件按
//      目录身份分别落位。平铺的 `modelId` 与 `candidate.modelId` 抢同一个落点，**逐镜点名的赢**。
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

import { generationPlanInputSchema } from "../generationPlanSchemas";
import { generationShotEnvelopeOf, type GenerationShotEnvelope } from "../../generationShotEnvelope";
import { draftShotSchema } from "./writeVerbs";
import { ASPECT_RATIO_SEMANTIC_KEY } from "../../aspectRatioValue";

/** 宿主那两支的类型锚点（只在类型位置用，所以写成类型而不是 const——那会是一条 lint 噪音）。 */
type PlanCreate = z.infer<(typeof generationPlanInputSchema.options)[1]>;
type PlanPatch = z.infer<(typeof generationPlanInputSchema.options)[2]>;

/** 模型面的一镜。 */
export type DraftShot = z.infer<typeof draftShotSchema>;
/** 模型面的顶层（`draft_shots` 自己的 schema 推出来的，不在这里重列）。 */
export type DraftShotsArgs = { operationId?: string; taskKind?: DraftShot["taskKind"]; candidate?: DraftShot["candidate"]; shots: DraftShot[] };
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
function semanticsOf(shot: DraftShot): CandidatePatch {
  const {
    storyboard, prompt, taskKind, modeId, modelId, candidate, parameters, durationSec, aspectRatio, references,
    // 信封那三件不属于「语义」，由各自的调用点按这条路有没有位置处置。
    shotId: _envelopeShotId, role: _envelopeRole, title: _envelopeTitle,
    ...unhandled
  } = shot;
  // 一个字段都不许没人管：新长出来的模型面字段落进 `unhandled`，而这个类型不接受任何键 → tsc 红。
  void (unhandled satisfies Record<string, never>);
  return {
    ...(storyboard !== undefined ? { storyboard } : {}),
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
    // ② 拍平嵌套；逐镜点名的 `candidate` 赢过平铺的 `modelId`（谁赢是**声明**出来的，不靠写的顺序）。
    ...(candidate?.modelId !== undefined ? { modelId: candidate.modelId }
      : modelId !== undefined ? { modelId } : {}),
    ...(candidate?.providerId !== undefined ? { providerId: candidate.providerId } : {}),
    // ③ 身份由宿主补：模型只给「哪份素材」。
    ...(references !== undefined ? { references: references.map((assetId) => ({ assetId })) } : {}),
  };
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
export function draftShotToPlanShot(shot: DraftShot): PlanShot {
  return { ...semanticsOf(shot), ...modelAuthoredEnvelopeOf(shot) };
}

/**
 * 改草稿那一支的候选 patch：只有语义。
 * `title` / `role` 当场拒绝（动词声明的 `superRefine` 在更早一层已经告诉过模型，这里是它的第二层）；
 * `shotId` 不在这里——它是寻址不是候选，由 `draftShotsPatchEnvelope` 提到 plan patch 的信封上。
 */
export function draftShotToCandidatePatch(shot: DraftShot): CandidatePatch {
  if (shot.title !== undefined) refuse("shots[].title", REFUSE_ON_PATCH);
  if (shot.role !== undefined) refuse("shots[].role", REFUSE_ON_PATCH);
  return semanticsOf(shot);
}

/** 单镜 create：一镜摊成顶层参数，顶层没有信封的位置，三件都当场拒绝。 */
export function draftShotToFlatCreate(shot: DraftShot): PlanFlatCreate {
  if (shot.title !== undefined) refuse("shots[].title", REFUSE_ON_FLAT);
  if (shot.role !== undefined) refuse("shots[].role", REFUSE_ON_FLAT);
  if (shot.shotId !== undefined) refuse("shots[].shotId", REFUSE_ON_FLAT);
  return semanticsOf(shot);
}

/**
 * 顶层的两个缺省折进每一镜：**逐镜自己写的优先**。
 * （宿主那侧也有一份 `inherited`，两者不是同一件事：这一份决定「发出去的那一镜长什么样」，
 * 宿主那份决定「没人说时按目录怎么合成」。）
 */
export function withDraftShotsDefaults(args: DraftShotsArgs, shot: DraftShot): DraftShot {
  const { taskKind, candidate, operationId: _selectsBranch, shots: _theseShots, ...unhandled } = args;
  void (unhandled satisfies Record<string, never>);
  return {
    ...shot,
    ...(shot.taskKind === undefined && taskKind !== undefined ? { taskKind } : {}),
    ...(shot.candidate === undefined && candidate !== undefined ? { candidate } : {}),
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
