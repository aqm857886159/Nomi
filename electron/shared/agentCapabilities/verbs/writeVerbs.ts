import { storyboardAuthorFieldsSchema } from '../generationPlanSchemas'
// 十三个写动词（设计正本 §5.2）：一个动词一种状态一种效果。执行那一半住 `electron/agentLane/`：常驻的
// （write_script / 三个画布写 / start_model_setup）在 `laneDocumentTools.ts` / `laneCanvasTools.ts` /
// `laneDesktopTools.ts` 各自绑定；延迟组的经 `laneVerbTransport.ts` 翻成传输方法，`laneExtendedDesktopPorts.ts` 执行。
//
// 只有 `draft_shots` 能在画布上造出生成类节点；`arrange_canvas` / `make_artifact` / `stage_shot` 收到生成类 kind
// 一律 `wrong_verb` 拒绝并点名 `draft_shots`（判据 `electron/shared/canvas/nodeExecutionKinds.ts`，不手写名单）。
// 只有 `generate` 会把报价卡摆到用户面前；它的返回值是 GitHub MCP `issue_write` 的形状：isError + 明文「不要再调工具」。
import { z } from "zod";
import { timelineWriteResultSchema } from "../timelineWrite";
import { exportWriteResultSchema } from "../exportCapabilities";

import {
  cameraMoveParamsObjectSchema, CAMERA_MOVE_MODEL_GUIDELINES, STAGING_MODEL_GUIDELINES, stagingReferenceParamsSchema,
} from "../canvasModelShapes";
import { canvasDeletePiInputSchema } from "../canvasDelete";
import { CANVAS_NODE_PROMPT_GUIDELINES, plannedEdgeSchema } from "../canvasWrite";
import { modelArgumentTolerance } from "../modelArgumentTolerance";
import { isGeneratingNodeKind } from "../../canvas/nodeExecutionKinds";
import { LaneDomainFailure, wrongVerbFailure } from "../../agentLane/laneToolContract";
import type { VerbDeclaration } from "../verbDeclaration";
import { DOCUMENT_ID_TRANSPORT_FIELD, READ_GUIDELINES } from "./readVerbs";
import { canvasWriteInputOf, documentWriteInputOf } from "./verbSemanticInput";
import { directorStageShotModelSchema, directorWriteInputOf, prepareDirectorStageShotArguments } from "./directorStageShotFace";
import { director3dBoxFaceEnabled } from "../../featureFlags/director3dboxFace";
import { DIRECTOR_PLAN_MODEL_GUIDELINES } from "../../director/directorPlanGuidelines";
import {
  cancelJobModelSchema, editTimelineModelSchema, exportVideoModelSchema, generateModelSchema,
  saveSkillModelSchema, startModelSetupModelSchema, undoModelSchema,
} from "./verbProjections";

const shotId = z.string().trim().min(1).max(160);
const generationParameters = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));

/** 一镜草稿：模型填的是**语义**（提示词/模型/参数/参考），候选身份由宿主按目录合成，与单镜路径同一个解析器。 */
export const draftShotSchema = z.object({
  shotId: shotId.optional().describe("Existing shot id to update; omit to create one."),
  storyboard: storyboardAuthorFieldsSchema.optional().describe("Original author fields; anchors require kind and carrier."),
  title: z.string().trim().min(1).max(120).optional().describe("Short human title in the user's language, shown on the canvas node and spend card."),
  prompt: z.string().trim().min(1).max(8_000).optional().describe("Prompt in the user's language. Required for a new shot; when revising (operationId + shotId) send it only to change it."),
  // 2026-09-30（付费卡① 第 9 条）：种类不再按提示词猜。点名了模型（或 modeId）就由它定；两样都没点名时必须写明。
  // 措辞压到最短：这几句算在 draft_shots 的 schema 预算里（stage3-probe-p5 的 core 785），规矩写一遍在这里，modeId / modelId / 顶层只留指向。
  taskKind: z.enum(["text_to_image", "image_edit", "text_to_video", "image_to_video"]).optional().describe("What to make. Omit when modelId or modeId decides it; otherwise required."),
  role: z.enum(["anchor", "shot"]).optional().describe("anchor = a character/scene/style reference card reused by other shots; shot (default) = a numbered shot."),
  durationSec: z.number().positive().max(600).optional().describe("Clip length in seconds; omit for stills. The only place for length, never parameters."),
  // 2026-10-05：比例同理。各家的键名不一样（size / aspect_ratio / ratio / aspectRatio），模型只能猜；猜驼峰那次
  // 被宿主当意图键静默吞掉，用户付了钱拿到默认画幅。这里只收语义，宿主按所选模式翻成真实键（翻不了就拒）。
  aspectRatio: z.string().trim().optional().describe("e.g. 16:9 or auto."),
  modelId: z.string().trim().min(1).optional().describe("Catalog model id from list_models; omit for the user's default."),
  // 2026-09-22：`taskKind` 与 `modeId` 是同一件事实的两种写法。模式定了，种类就定了
  // （`transportTaskKindForModeId` 从档案扫出来），所以说明书直接告诉模型「写了模式就别再写种类」——
  // 两个都填正是它自己给自己造矛盾的地方（run2 A3/A6 三次）。
  modeId: z.string().trim().min(1).optional().describe("Mode id from list_models; it decides taskKind."),
  candidate: z.object({
    providerId: z.string().trim().min(1).describe("Provider id from list_models."),
    modelId: z.string().trim().min(1).describe("Model id from list_models."),
  }).optional().describe("Catalog candidate identity when known."),
  parameters: generationParameters.optional().describe("Profile values but length/ratio; revisions change named keys only, null deletes."),
  // 2026-09-22：这句话原来写着「asset ids …**or shot ids** (from look_at_canvas or this call)」，
  // 而解析这一头（`pinAssetReference`）只认项目素材库里的 assetId——镜头 id 送进来**必然**被拒，
  // 理由还是「不在这个项目的素材库里」（run2 的 A1/A4 各一次，模型照着说明书做的）。
  // 跨镜复用走的是 `storyboard.anchorIds`，不是这里。说明书按真的那份写。
  references: z.array(z.string().trim().min(1)).max(30).optional().describe("Asset ids from look_at_media. To reuse another shot's look use storyboard.anchorIds, not a shot id."),
}).strict();

/**
 * 三个画布写动词的共同前置：模型想借它们造生成类节点 → `wrong_verb` 拒绝并点名 `draft_shots`。
 * 判据是中立层词表 `isGeneratingNodeKind`，不手写名单；跑在 pi 的 ajv 之前（`prepareArguments`），
 * 所以拒绝的是**意图**（`nodes[]` / `kind` 里出现生成类种类），而不是等 schema 报一个「未知字段」。
 */
function rejectGeneratingNodes(attempted: string, tolerate: (args: unknown) => Record<string, unknown>) {
  return (args: unknown): Record<string, unknown> => {
    const record = tolerate(args);
    const kinds: string[] = [];
    if (typeof record.kind === "string") kinds.push(record.kind);
    for (const node of Array.isArray(record.nodes) ? record.nodes : []) {
      if (node && typeof node === "object" && typeof (node as { kind?: unknown }).kind === "string") kinds.push((node as { kind: string }).kind);
    }
    const generating = kinds.filter(isGeneratingNodeKind);
    if (generating.length > 0) {
      throw new LaneDomainFailure(wrongVerbFailure({
        attempted, useInstead: "draft_shots",
        because: `${attempted} cannot create ${[...new Set(generating)].join("/")} nodes; only draft_shots creates shots that generate media.`,
      }));
    }
    return record;
  };
}

/**
 * `write_script` 的容忍（#547 真机见过的三种「意思对、形状错」）：整个入参写成一段裸文本、
 * 字段名写成 `text`/`body`、正文拆成字符串数组。捏合不放松 schema：`where` 仍必填、仍 strict。
 */
const prepareWriteScriptArguments = (() => {
  const shared = modelArgumentTolerance({ fieldAliases: { content: ["text", "body"] } });
  return (args: unknown): Record<string, unknown> => {
    if (typeof args === "string" && !args.trim().startsWith("{")) return { content: args };
    const record = shared(args);
    if (Array.isArray(record.content)) {
      record.content = record.content.filter((part): part is string => typeof part === "string").join("");
    }
    return record;
  };
})();

/**
 * `shots[].modelId` 与 `shots[].candidate.modelId` 是**同一件事的两个位置**（都写着 "from list_models"）：
 * 平铺的那个只点模型，`candidate` 连供应商一起点。两个都填且互相矛盾时，传输层无论选哪个都是在替用户
 * 决定「这一笔花在哪个模型上」——那正是 2026-09-18 根因合同要消灭的沉默。所以这里当场退回去问模型，
 * 而不是挑一个。
 *
 * 2026-09-18 之前平铺的那个叫 `modelKey`，于是这条拒绝还得先解释「这两个名字是同一件事」；
 * 名字统一之后它只剩本来的职责：同一件事被说了两遍且说法不一致。
 */
/**
 * 一镜把**同一件事写了两遍且说法不一样** → 当场拒绝并点名两处。
 *
 * 两条判据同一个形状，所以住同一个函数（它们不是两个功能，是一条规则的两格）：
 *   · 模型身份：`modelId` 与 `candidate.modelId`；
 *   · 时长：`durationSec` 与 `parameters.duration`；
 *   · 比例：`parameters.aspectRatio` **一律**拒（2026-10-05）。它不是「两处写同一个数就放行」那一格：
 *     `aspectRatio` 在宿主那边是语义载体键（投影把 `shots[].aspectRatio` 放进去），模型直接写它
 *     就是在宿主的位置上替宿主做翻译，而它写的又恰好是最常猜错的那个名字。
 *
 * 时长这一条是 2026-09-21 实测加的：A3 那一镜同时写了 `durationSec: 43.7` 与
 * `parameters.duration: 5`（投影里 `durationSec` 赢，于是用户会拿到一段 43.7 秒的片子）。
 * 更要命的是它和当天 12 次「shots: must be array」在**同一个 token 上**断掉——
 * 那 12 段坏掉的 JSON 全部坏在 `"durationSec": ` 之后。两个家的字段正是模型最容易卡住的地方。
 *
 * **能宽容就宽容**：两处写的是同一个数 → 放行（不是歧义）；只写了一处 → 放行。
 */
function rejectDuplicateShotIdentity(args: unknown): Record<string, unknown> {
  const record = (args && typeof args === "object" && !Array.isArray(args) ? args : {}) as Record<string, unknown>;
  const shots = Array.isArray(record.shots) ? record.shots : [];
  const refuse = (because: string): never => {
    throw new LaneDomainFailure(wrongVerbFailure({ attempted: "draft_shots", useInstead: "draft_shots", because }));
  };
  for (const shot of shots) {
    if (!shot || typeof shot !== "object") continue;
    const { modelId, candidate, durationSec, parameters } = shot as {
      modelId?: unknown; candidate?: { modelId?: unknown };
      durationSec?: unknown; parameters?: { duration?: unknown; aspectRatio?: unknown };
    };
    const declared = candidate && typeof candidate === "object" ? candidate.modelId : undefined;
    if (typeof modelId === "string" && typeof declared === "string" && modelId.trim() && declared.trim()
      && modelId.trim() !== declared.trim()) {
      refuse(`A shot names two different models: modelId="${modelId.trim()}" and candidate.modelId="${declared.trim()}". `
        + "Both come from list_models and mean the same thing; pass only one so the shot has a single model identity.");
    }
    // 比例只有一个家：模型面上的 `aspectRatio`。`parameters.aspectRatio` 正是 2026-10-05 那次被静默吞掉的写法，
    // 现在当场说清，而不是替它挪过去——挪过去就又成了「同一件事写两处、宿主替它挑一个」。
    if (parameters && typeof parameters === "object" && Object.prototype.hasOwnProperty.call(parameters, "aspectRatio")) {
      refuse("A shot puts its frame ratio in parameters.aspectRatio. Ratio has one home: set aspectRatio on the shot "
        + "(for example \"aspectRatio\": \"16:9\") and leave it out of parameters; the host maps it to this model's own key.");
    }
    const nestedDuration = parameters && typeof parameters === "object" ? parameters.duration : undefined;
    if (typeof durationSec === "number" && typeof nestedDuration === "number" && durationSec !== nestedDuration) {
      refuse(`A shot names two different lengths: durationSec=${durationSec} and parameters.duration=${nestedDuration}. `
        + "Length has one home: set durationSec and leave duration out of parameters.");
    }
  }
  return record;
}

const CANVAS_WRITE_GUIDELINES = Object.freeze([
  "Every canvas write is a reversible local edit: describe what changed in your reply using the returned userSees line rather than claiming more.",
]);

export function writeVerbs(): VerbDeclaration[] {
  const writeScript: VerbDeclaration = {
    name: "write_script", contractId: "document.write", effect: "reversible_local", nextAction: "none",
    describe: {
      does: "Write finished prose into the creation document — at the cursor, in place of the selection, or at the end.",
      useWhen: "The user asks you to write, rewrite, tighten or extend script text.",
      notWhen: "Never write a diff, a summary of the change, or a plan to write later. Not for shot prompts (draft_shots). Read the selection first (read_script) unless the user told you exactly what to replace.",
      params: "content is the exact text; where is cursor, selection or end.",
    },
    promptGuidelines: ["Write finished prose into the document, never a diff, a summary of your change, or a plan to write it later."],
    schema: z.object({
      content: z.string().min(1).describe("The exact text to write. Plain prose or Markdown, never a diff or a summary of the change."),
      where: z.enum(["cursor", "selection", "end"]).describe("cursor inserts at the user's cursor; selection replaces the selected text; end appends to the document."),
    }).strict(),
    examples: [{ when: "Append a closing line:", arguments: { content: "The rain had not stopped for three days.", where: "end" } }],
    mcpTransportFields: DOCUMENT_ID_TRANSPORT_FIELD,
    prepareArguments: prepareWriteScriptArguments,
    semanticInputOf: (args) => documentWriteInputOf(args),
  };

  const draftShots: VerbDeclaration = {
    name: "draft_shots", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "generation.plan", effect: "reversible_local", nextAction: "none", internalGroup: "generation",
    effectGroups: ["canvas-node-creation"],
    describe: {
      does: "Create or update image, video, audio or 3D shot drafts in the project; document plans are saved without automatic canvas placement.",
      useWhen: "Whenever the user asks to make, draw, render, regenerate, restyle or re-time any media — including a single image — or to split text into shots, or to change a shot's prompt, model, parameters or references. Pass shotId to update an existing draft; omit it to create.",
      notWhen: "New drafts do not request generation or show a spend card — call generate for that, unless the user said not to generate yet. Updating an already-presented draft retains its existing approval policy; use the returned result to determine whether that policy started generation. Not for links, groups or layout (arrange_canvas), not for hand-made artifacts (make_artifact), not for staging or camera references (stage_shot).",
      params: "shots[] each with prompt, optional title, taskKind, durationSec, modelId (or candidate with providerId + modelId, never both for one shot), modeId, parameters, references, role. For anchor role, include storyboard with kind (character/scene/prop/style) and carrier (visual/text); title names the anchor and prompt describes it. Original shot details (anchorIds, keyframe, referenceBindings) also go in storyboard. A top-level candidate or taskKind is the default for shots that omit their own. Model and parameter values come from list_models; reuse operationId and shotId from the current draft result. Two shapes: creating a shot needs prompt; revising one (operationId + shotId) carries only the fields you are changing — prompt, model, modeId, parameters, references — and leaves the rest out, including title and role, which are fixed when the shot is created.",
    },
    promptGuidelines: [...READ_GUIDELINES, ...CANVAS_NODE_PROMPT_GUIDELINES],
    schema: z.object({
      operationId: z.string().trim().min(1).max(160).optional().describe("operationId from an earlier draft_shots call, to update it."),
      taskKind: z.enum(["text_to_image", "image_edit", "text_to_video", "image_to_video"]).optional().describe("Default taskKind for shots that set none."),
      candidate: z.object({
        providerId: z.string().trim().min(1).describe("Provider id from list_models."),
        modelId: z.string().trim().min(1).describe("Model id from list_models."),
      }).optional().describe("Default catalog candidate for these shots."),
      shots: z.array(draftShotSchema).min(1).max(40).describe("The shots to create or update."),
    }).strict().superRefine((value, context) => {
      // `shotId` 只在「改已有草稿」时有意义。少了这条约束，模型发
      // `{shots:[{shotId:"shot-3", prompt:"…"}]}`（忘了 operationId）时会新建一份草稿、把 shot-3 悄悄丢掉——
      // 它以为改好了，用户看到的是画布上多了一个镜头（2026-09-18 扫描的 D 类：静默丢字段）。
      // 「新建」与「修订」是**两种形状**，而 schema 只有一份（模型面不许长出第二个工具）。
      // 差别只有一条，就写在这里：新建必须给 `prompt`，修订只带你要改的那几件。
      //
      // 2026-09-21 实测里这条是自相矛盾的：`prompt` 在 schema 上是必填，而同一份说明书告诉模型
      // 「改草稿改的是提示词/模型/参数/参考」。于是只想改一个参数的那次被回了
      // `shots.0.prompt: must have required properties prompt`——它照做，把整段提示词重抄一遍，
      // 而重抄的那一遍就是它写坏 JSON 的地方。
      if (value.operationId === undefined) {
        const missing = value.shots.findIndex((shot) => shot.prompt === undefined);
        if (missing >= 0) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["shots", missing, "prompt"],
            message: "a new shot needs a prompt (only a revision may leave it out, and a revision needs operationId)" });
        }
      } else {
        // 修订一镜却一个字段都没改 = 一次没有意义的往返；当场说清，别让它以为改成功了。
        const empty = value.shots.findIndex((shot) => Object.keys(shot).filter((key) => key !== "shotId").length === 0);
        if (empty >= 0) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["shots", empty],
            message: "this revision changes nothing — include at least one of prompt, modelId/candidate, modeId, parameters, references, durationSec, aspectRatio" });
        }
      }
      const stray = value.shots.findIndex((shot) => shot.shotId !== undefined);
      if (value.operationId === undefined && stray >= 0) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["shots", stray, "shotId"], message: "shotId only addresses a shot inside an existing draft — pass operationId too, or omit shotId to create" });
      }
      // `title` 是镜头**信封**上的字段（`generationShotEnvelope.ts`），而改草稿这条路递给宿主的是
      // **候选** patch（提示词/模型/参数/参考）——信封不在那份 patch 的形状里。不拦的话模型收到的是
      // 宿主的 `Unrecognized key(s): 'title'`：一个它看不懂为什么的拒绝。在这里拦，它当场知道该怎么做。
      // `title` / `role` 是镜头**信封**上的字段（`generationShotEnvelope.ts`），而改草稿这条路递给宿主的是
      // **候选** patch（提示词/模型/参数/参考）——信封不在那份 patch 的形状里。不拦的话它们要么被宿主回一句
      // 模型看不懂的 `Unrecognized key`，要么无声消失。在这里拦，它当场知道该怎么做。
      // 这条与对应表上 `absentOn.patch = refuse` 是同一句话的两层：表保证它不会静默丢，这里保证模型先被告知。
      for (const field of ["title", "role"] as const) {
        const index = value.operationId === undefined ? -1 : value.shots.findIndex((shot) => shot[field] !== undefined);
        if (index < 0) continue;
        context.addIssue({
          code: z.ZodIssueCode.custom, path: ["shots", index, field],
          message: `a shot's ${field} is set when the shot is created — revising a draft changes its prompt, model, parameters and references, so drop ${field} here`,
        });
      }
      // ── 2026-09-22：这条曾经是**拒绝**，现在不是了 ──
      //
      // 原文（git blame 96462450a / 2026-09-18）：「`role: "anchor"` 的定义就是被**其它镜头**复用的参考卡，
      // 一份只有锚的计划自相矛盾」。那是个**定义**上的论证，不是机械上的：
      //   · 锚本身就是要生成的图（它有候选、有价、`anchorChips` 在报价卡上逐张标价），
      //   · present/seal 的范围是 `shots.filter(included !== false)`——**锚本来就在里面**，会真的跑、真的扣钱，
      //   · 真正会坏的只有一处：`multiShotGateProjectionFor` 的行是按「非锚」筛的，全是锚就返回 undefined。
      // 也就是说，拦的理由是**投影的管道**，不是领域。而「先建几张参考卡、镜头下一轮再补」是用户与
      // Agent 都会走的正常路径（2026-09-18 实测 27 次失败里 11 次是模型在走标准分镜流程被这条拦下来），
      // 用户 2026-09-21 亲自点名过这条报错。按「不因为我们自己的缺省拦用户」：**放行**。
      //
      // 管道那一处同 commit 修好（锚也能投影成报价行），「还没有镜头用到它们」降成草稿上的一条安静提示
      // （`anchorsOnly` note，`mcpGenerationTools` 的 create 返回里），不是一次拒绝。
    }),
    examples: [
      { when: "One opening still:", arguments: { shots: [{ title: "Opening", prompt: "sunrise over the sea, wide shot, warm light", taskKind: "text_to_image", candidate: { providerId: "apimart", modelId: "image-1" } }] } },
      { when: "Change one existing shot's prompt:", arguments: { operationId: "op-1", shots: [{ shotId: "shot-3", prompt: "夜景，霓虹灯下的街道" }] } },
    ],
    prepareArguments: (args: unknown) => rejectDuplicateShotIdentity(modelArgumentTolerance({ arrayFields: ["shots"] })(args)),
  };

  const generate: VerbDeclaration = {
    name: "generate", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "generation.plan", effect: "reversible_local", nextAction: "user_sees_spend_card", internalGroup: "generation",
    describe: {
      does: "Ask the user to approve generating a draft and wait for his answer; the result says whether generation started, he declined, or he wrote something else.",
      useWhen: `Right after draft_shots, when the user asked to generate; or when they ask to generate existing drafts ("run all six").`,
      notWhen: `Never to get a price — look_at_canvas already carries unit prices. Never when the user said "don't generate yet". It does not grant new spending permission; the existing approval policy controls execution. To change a shot first use draft_shots.`,
      params: "operationId is the id returned by draft_shots; shotIds optionally limits the card to some of its shots.",
    },
    // 模型面 = `generation.plan` 的 `present` 分支减掉 `operation`，只覆写描述（`verbProjections.ts`）。
    schema: generateModelSchema,
    examples: [{ when: "Ask the user to approve a draft, and learn what he decided:", arguments: { operationId: "op-1" } }],
    prepareArguments: modelArgumentTolerance({ arrayFields: ["shotIds"] }),
  };

  // 三个画布写动词只投内部面。对外 MCP 的画布写今天仍是契约粒度的手写传输 `nomi_canvas_edit`（`operation` 分支含
  // 分镜写入，那些在内部面归 `draft_shots`；MCP 侧的生成面还没收编，切了外部宿主就没地方写分镜）——
  // 外部画布面按动词拆名与 #754 同一刀定，这里用**如实的**过渡理由登记，不写成「无头宿主」。
  const arrangeCanvas: VerbDeclaration = {
    name: "arrange_canvas", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "canvas.write", effect: "reversible_local", nextAction: "none",
    effectGroups: ["canvas-node-creation"],
    describe: {
      does: "Change how existing nodes relate and sit on the canvas: connect reference links or tidy the layout.",
      useWhen: "The user asks to connect, link or tidy.",
      notWhen: "It cannot create shots or any generating node — such a request is rejected and draft_shots is named instead. Not for hand-authored artifacts (make_artifact) or staging and camera references (stage_shot).",
      params: "links[] (fromId, toId, role) connect existing nodes; tidy true re-lays out the canvas (optionally one categoryId). All ids from look_at_canvas.",
    },
    promptGuidelines: [...READ_GUIDELINES, ...CANVAS_WRITE_GUIDELINES],
    schema: z.object({
      links: z.array(z.object({
        fromId: z.string().trim().min(1).describe("Source node id."),
        toId: z.string().trim().min(1).describe("Target node id."),
        role: plannedEdgeSchema.shape.mode,
      }).strict()).max(48).optional().describe("Reference links to add between existing nodes."),
      tidy: z.boolean().optional().describe("Re-lay out the canvas."),
      categoryId: z.string().trim().min(1).optional().describe("With tidy: only this canvas category."),
    }).strict().superRefine((value, context) => {
      // 两个分支**互斥**：给了 links 就是连边，给了 tidy 就是重排。都不给的那次过去会在翻译层抛一个
      // 裸 Error（模型收到的不是一条说得清的拒绝）；两个都给时 tidy 被静默忽略。约束写在声明上，
      // 模型在调用发出之前就被告知（R17：防线建在最早能拦住的那层）。
      const connects = (value.links?.length ?? 0) > 0;
      const tidies = value.tidy === true;
      if (connects === tidies) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["links"], message: "give exactly one of links (to connect nodes) or tidy: true (to re-lay out)" });
      }
      if (value.categoryId !== undefined && !tidies) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["categoryId"], message: "categoryId only narrows tidy: true" });
      }
    }),
    examples: [{ when: "Use the character sheet as a reference for a shot:", arguments: { links: [{ fromId: "node-char", toId: "node-shot-2", role: "character_ref" }] } }],
    prepareArguments: rejectGeneratingNodes("arrange_canvas", modelArgumentTolerance({ arrayFields: ["links"] })),
    semanticInputOf: (args) => canvasWriteInputOf("arrange_canvas", args),
  };

  const makeArtifact: VerbDeclaration = {
    name: "make_artifact", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "canvas.write", effect: "reversible_local", nextAction: "none",
    effectGroups: ["canvas-node-creation"],
    describe: {
      does: "Put a hand-authored artifact on the canvas — SVG, HTML, Markdown, a table or plain text you wrote yourself.",
      useWhen: "The user wants a chart, table, mood board, comparison sheet or diagram that you can author directly without a generation model.",
      notWhen: "Not for images or video that need a model (draft_shots), not for links or layout (arrange_canvas), not for staging references (stage_shot).",
      params: "fileType, title and content; the content is the whole file.",
    },
    promptGuidelines: CANVAS_WRITE_GUIDELINES,
    schema: z.object({
      fileType: z.enum(["svg", "html", "markdown", "table", "text"]).describe("Which kind of file the content is."),
      title: z.string().trim().min(1).max(120).describe("Node title in the user's language."),
      content: z.string().min(1).describe("The whole artifact content."),
    }).strict(),
    examples: [{ when: "A shot comparison table:", arguments: { fileType: "table", title: "Shot comparison", content: "| Shot | Content |\n|---|---|\n| 1 | Opening |" } }],
    prepareArguments: rejectGeneratingNodes("make_artifact", modelArgumentTolerance({ fieldAliases: { content: ["text", "body"] } })),
    semanticInputOf: (args) => canvasWriteInputOf("make_artifact", args),
  };

  const stageShot: VerbDeclaration = {
    name: "stage_shot", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "canvas.write", effect: "reversible_local", nextAction: "none",
    effectGroups: ["canvas-node-creation"],
    describe: {
      does: "Attach a staging (blocking) or camera-move reference to one shot; Nomi renders a gray 3D reference for it.",
      useWhen: `The user asks for a push-in, a two-shot, a specific blocking, or "show me the camera move".`,
      notWhen: "It does not generate the shot itself and it is not a prompt edit (draft_shots). Not for links (arrange_canvas) or hand-made artifacts (make_artifact).",
      params: "shotId from look_at_canvas or draft_shots; exactly one of staging (characters, layout, camera, environment, customBlocking) or cameraMove (move, customMove, speed, subjectPose).",
    },
    promptGuidelines: [...STAGING_MODEL_GUIDELINES, ...CAMERA_MOVE_MODEL_GUIDELINES],
    schema: z.object({
      shotId: shotId.describe("The shot to attach the reference to."),
      staging: z.object({
        characters: stagingReferenceParamsSchema.shape.characters,
        layout: stagingReferenceParamsSchema.shape.layout,
        camera: stagingReferenceParamsSchema.shape.camera,
        environment: stagingReferenceParamsSchema.shape.environment,
        crowd: stagingReferenceParamsSchema.shape.crowd,
        sceneTemplate: stagingReferenceParamsSchema.shape.sceneTemplate,
        props: stagingReferenceParamsSchema.shape.props,
        customBlocking: stagingReferenceParamsSchema.shape.customBlocking,
      }).strict().optional().describe("Blocking reference: characters or customBlocking is required."),
      cameraMove: z.object({
        move: cameraMoveParamsObjectSchema.shape.move,
        customMove: cameraMoveParamsObjectSchema.shape.customMove,
        speed: cameraMoveParamsObjectSchema.shape.speed,
        shot: cameraMoveParamsObjectSchema.shape.shot,
        subjectPose: cameraMoveParamsObjectSchema.shape.subjectPose,
        sceneTemplate: stagingReferenceParamsSchema.shape.sceneTemplate,
        props: stagingReferenceParamsSchema.shape.props,
      }).strict().optional().describe("Camera-motion reference: move or customMove is required."),
    }).strict().superRefine((value, context) => {
      if ((value.staging === undefined) === (value.cameraMove === undefined)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["staging"], message: "give exactly one of staging or cameraMove" });
      }
    }),
    examples: [{ when: "Push in on a shot:", arguments: { shotId: "shot-4", cameraMove: { move: "push_in" } } }],
    prepareArguments: rejectGeneratingNodes("stage_shot", modelArgumentTolerance({ objectFields: ["staging", "cameraMove"] })),
    semanticInputOf: (args) => canvasWriteInputOf("stage_shot", args),
  };

  // 3D-BOX（开关开）：同名换芯。契约 `director.write`（仅内部，不投影到对外 MCP），新建交整份导演计划，
  // 修改交按名字寻址的补丁；任一构建只装配 stageShot / directorStageShot 其中一份（见文件末尾的 return）。
  // 到期 2026-11-15：切换 PR 同 commit 删掉旧的 stageShot 与这条分叉。
  const directorStageShot: VerbDeclaration = {
    name: "stage_shot", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "director.write", effect: "reversible_local", nextAction: "none",
    effectGroups: ["canvas-node-creation"],
    describe: {
      does: "Build or change a 3D-BOX director plan; Nomi compiles a gray 3D preview with blocking and cameras and attaches it to the shot as reference video.",
      useWhen: "The user describes a scene, blocking or camera coverage, or asks to change part of an existing preview.",
      notWhen: "Not for producing the final shot: once the user approves the preview, that is generate. Not for prompt edits or new shots (draft_shots), links or layout (arrange_canvas), or hand-made artifacts (make_artifact).",
      params: "Create: plan (+ target.shotId). Change: target.directorNodeId, baseRevision and edits from look_at_canvas or the last stage_shot result.",
    },
    promptGuidelines: DIRECTOR_PLAN_MODEL_GUIDELINES,
    schema: directorStageShotModelSchema,
    examples: [
      {
        when: "Preview a two-person dialogue for a shot:",
        arguments: {
          target: { shotId: "shot-3" },
          plan: {
            scene: { environment: "day", template: "room", tags: ["图书馆"] },
            actors: [
              { id: "librarian", kind: "person", desc: "管理员", placement: { relation: "at", ref: "s1-room-floor" } },
              { id: "student", kind: "person", desc: "学生", placement: { relation: "in_front_of", ref: "librarian" } },
            ],
            shots: [
              { id: "over_librarian", window: [0, 3], transitionIn: "cut", subject: "student", size: "中景", angle: { over_shoulder: "librarian" }, height: "eye", move: { kind: "static" } },
              { id: "over_student", window: [3, 6], transitionIn: "cut", subject: "librarian", size: "中景", angle: { over_shoulder: "student" }, height: "eye", move: { kind: "push_in", speed: "slow" } },
            ],
          },
        },
      },
      { when: "Make the second shot a close-up:", arguments: { target: { directorNodeId: "node-director-1" }, baseRevision: "dplan-0123456789abcdef", edits: [{ op: "replace", path: "/shots/over_student/size", value: "特写" }] } },
    ],
    prepareArguments: prepareDirectorStageShotArguments,
    semanticInputOf: (args) => directorWriteInputOf(args),
  };

  const editTimeline: VerbDeclaration = {
    name: "edit_timeline", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "timeline.write", effect: "reversible_local", nextAction: "user_sees_review_card", internalGroup: "timeline",
    describe: {
      does: "Apply one transaction of timeline operations (move, trim, split, ripple, transition, text, audio) against the revision you read.",
      useWhen: "The user asks to cut, trim, reorder, or add captions or transitions on the timeline.",
      notWhen: "Not without a fresh read_timeline — a stale revision is rejected and resending it cannot succeed. Not for shot content (draft_shots). To revert use undo.",
      params: "baseRevision from read_timeline, a one-line summary, and 1-128 operations in frames. Valid operation kinds: move, remove, split, trim, source-window, ripple, transition, text, audio.",
    },
    promptGuidelines: [
      "Frames, not seconds: every timeline position and duration is an integer frame count at the fps read_timeline returns.",
      "Always plan against a fresh revision: read the timeline, build the plan from what you just read, and pass that same revision back as baseRevision.",
    ],
    // 模型面 = `timeline.write` 的 `apply_edit_plan` 分支减掉 `planId`（宿主派生的幂等键）与 `operation`，
    // `operations` 用同一份宿主 schema 机器拍平的那一版。`baseRevision` **不改名**：宿主同一个对象里另有
    // 一个 `revision`＝编辑之后的新版本号，两个词指两件事，模型面少一个词就把它们叠成了一件。
    // 见 `verbProjections.ts`。
    schema: editTimelineModelSchema,
    outputSchema: timelineWriteResultSchema.options[0],
    examples: [{ when: "Move the opening clip to the start:", arguments: { baseRevision: "revision-1", summary: "Move the opening clip", operations: [{ kind: "move", clipId: "clip-1", startFrame: 0 }] } }],
    prepareArguments: modelArgumentTolerance({ arrayFields: ["operations"] }),
  };

  const undo: VerbDeclaration = {
    name: "undo", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "timeline.write", effect: "reversible_local", nextAction: "none", internalGroup: "timeline",
    describe: {
      does: "Revert one reversible change you made, by the changeId its result returned.",
      useWhen: "The user says undo, go back, or that the last change was wrong.",
      notWhen: "It cannot un-spend money or un-export; those are not undoable and check_job or cancel_job are the verbs there. If a later edit touched the same object, undo is rejected with the conflict reason.",
      params: "changeId from any reversible Agent write; expectedRevision is required only for a timeline change and may be omitted for a canvas change.",
    },
    // 模型面 = `timeline.write` 的 `undo_timeline_edit` 分支减掉 `operation` 与 `reason`（`verbProjections.ts`）。
    schema: undoModelSchema,
    examples: [{ when: "Revert the last plan:", arguments: { changeId: "timeline:v1:receipt-1", expectedRevision: "revision-2" } }],
    prepareArguments: modelArgumentTolerance({}),
  };

  const deleteFromCanvas: VerbDeclaration = {
    name: "delete_from_canvas", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "canvas.delete", effect: "irreversible", nextAction: "user_sees_confirm_card", internalGroup: "maintenance",
    describe: {
      does: "Delete exact nodes (shots, artifacts, director references) from the canvas.",
      useWhen: "The user names what to delete.",
      notWhen: "Never to clean up on your own initiative (arrange_canvas tidies without removing); never for nodes you did not read in look_at_canvas.",
      params: "nodeIds are exact current ids from look_at_canvas; locked nodes and stale ids are rejected.",
    },
    // `canvas.delete` 的宿主面就定义成这份 pi schema `.extend({ operation })`——模型面与宿主面只有一份
    // 定义，宿主自补的那个值在 `verbProjections.ts` 的 `DELETE_FROM_CANVAS_HOST_FILL` 里显式声明。
    schema: canvasDeletePiInputSchema,
    examples: [{ when: "Delete two nodes the user pointed at:", arguments: { nodeIds: ["node-a", "node-b"] } }],
    prepareArguments: modelArgumentTolerance({ arrayFields: ["nodeIds"] }),
  };

  const exportVideo: VerbDeclaration = {
    name: "export_video", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "export.write", effect: "irreversible", nextAction: "job_running", internalGroup: "media",
    describe: {
      does: "Start exporting the timeline to an MP4 file at one exact revision.",
      useWhen: "The user asks to export, render out or save the video.",
      notWhen: "Not before reading the current timeline (read_timeline); stale revisions and empty timelines are rejected. To stop a running export use cancel_job; to follow it use check_job.",
      params: "expectedRevision from read_timeline; outputName, aspectRatio, resolution and quality are optional.",
    },
    // 模型面 = `export.write` 的 `export_timeline` 分支减掉 `operation`，只覆写描述（`verbProjections.ts`）。
    schema: exportVideoModelSchema,
    outputSchema: z.union([exportWriteResultSchema.options[0], exportWriteResultSchema.options[1]]),
    examples: [{ when: "Export at 1080p:", arguments: { expectedRevision: "revision-3", resolution: "1080p" } }],
    prepareArguments: modelArgumentTolerance({}),
  };

  const cancelJob: VerbDeclaration = {
    name: "cancel_job", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "export.write", alsoCovers: ["generation.control"], effect: "irreversible", nextAction: "user_sees_confirm_card", internalGroup: "media",
    effectGroups: ["job-status-cancel"],
    describe: {
      does: "Cancel one running generation or export job.",
      useWhen: "The user asks to stop it.",
      notWhen: "Not for drafts (delete_from_canvas) and not for cards (the user closes them). Read it first with check_job; credit already spent is not refunded.",
      params: "Copy domain and jobId from taskRef returned by generate, export_video, check_job or look_at_canvas. Never guess a task ID from a node ID or retry cancellation in another domain.",
    },
    // **投影原型（2026-09-18，只有这一个动词）**：模型面不再手写，而是从它声明的那份宿主契约 schema
    // 派生——`.omit()` 掉宿主自补的分支判别值，只覆写描述。宿主字段改名时这里是 tsc 红。
    // 为什么只有这一个、它覆盖不到什么（双域动词），见 `verbs/verbProjections.ts` 的文件头与
    // `docs/plan/2026-09-18-tool-projection-cancel-job-prototype.md`。
    schema: cancelJobModelSchema,
    examples: [{ when: "Stop a running export:", arguments: { domain: 'export', jobId: "export-1" } }],
    prepareArguments: modelArgumentTolerance({}),
  };

  const saveSkill: VerbDeclaration = {
    name: "save_skill", profiles: ["internal"], profileReason: "mcpHandwrittenTransport", contractId: "skill.write", effect: "reversible_local", nextAction: "none", internalGroup: "skills",
    describe: {
      does: "Save a validated skill package to the user's library.",
      useWhen: "The user asks to save this way of working as a skill.",
      notWhen: "Not for one-off instructions; to follow an existing skill use read_skill.",
      params: "dirName is an ASCII slug; skillMarkdown is the whole SKILL.md (frontmatter plus body).",
    },
    // 模型面 = `skill.write` 宿主面减掉 `operation`，只覆写描述（`verbProjections.ts`）。
    schema: saveSkillModelSchema,
    examples: [{ when: "Save a skill:", arguments: { dirName: "talking-head-cut", skillMarkdown: "---\nname: talking-head-cut\ndescription: Cut a talking head.\n---\n1. Read the transcript." } }],
    prepareArguments: modelArgumentTolerance({}),
  };

  const startModelSetup: VerbDeclaration = {
    name: "start_model_setup", profiles: ["internal"], profileReason: "headlessHost", contractId: "model.setup.open", effect: "reversible_local", nextAction: "user_sees_panel",
    describe: {
      does: "Open Nomi's model settings for one provider so the user can connect it.",
      useWhen: "The user asks to connect, add or set up a model or provider.",
      notWhen: "It never accepts, asks for, or stores an API key; keys are typed by the user in that panel only. To see what is already connected use list_models.",
      params: "provider is an optional hint (free text is fine).",
    },
    // 模型面 = `model.setup.open` 宿主面 + 一句描述覆写；宿主一个字段都不补（`verbProjections.ts`）。
    schema: startModelSetupModelSchema,
    examples: [{ when: "Connect DeepSeek:", arguments: { provider: "DeepSeek" } }],
    prepareArguments: modelArgumentTolerance({}),
  };

  return [writeScript, draftShots, generate, arrangeCanvas, makeArtifact, director3dBoxFaceEnabled() ? directorStageShot : stageShot, editTimeline, undo, deleteFromCanvas, exportVideo, cancelJob, saveSkill, startModelSetup];
}
