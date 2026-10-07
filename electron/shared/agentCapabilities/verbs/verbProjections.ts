import { taskDomainSchema } from '../taskReference';
// 模型看到的那一面 = 宿主契约 schema 的**投影**。20 个动词里有 11 个的模型面在这里从宿主那一份派生
// 出来，而不是在动词声明里再手写一遍（`draft_shots` 是第 12 个，但它有损，住在
// `draftShotsProjection.ts`）。剩下 8 个投不了，原因在文件末尾「投影覆盖不到什么」里逐类写明。
//
// ── 它在解决哪个真实摩擦（一句大白话）──
//
// 一个工具过去在我们这里被写两遍：模型看的那份 schema 一遍、宿主收的那份一遍，中间再手写一张对照表
// 说清「模型的 A 对应宿主的 B」。三份东西描述同一件事，所以任何一份改了而另外两份没跟上，值就在中间
// 无声地丢掉——2026-09-18 当天量到两次（`durationSec` 被改名成宿主没有的顶层字段＝整条拒收；逐镜
// `candidate.providerId/modelId` 压根没被列进解构＝**静默**丢掉，模型点名的模型被换成用户默认的那个
// 去花钱）。外面六家的做法是**一份 schema 两个用途**：宿主契约那份是唯一真相，模型看的那一面是它的
// 投影（藏掉宿主自己会补的字段、覆写描述），宿主补完值之后**再过一遍同一份 schema**
// （Claude Agent SDK 的 `updatedInput` → 重新准入；MCP TS SDK 的 *"the listing and the call cannot
// diverge"*）。逐条出处：`docs/plan/2026-09-18-tool-projection-cancel-job-prototype.md` 的「先查别人」。
//
// ── 这个文件里没有一个字段名是手写的 ──
//
// 每条投影都是三件事，缺一不可：
//   ① `modelSchema` = 宿主 schema `.omit(宿主自补的字段)`，再 `.extend()` **只**覆写描述。
//      描述是唯一允许写在这里的东西——它是给模型读的话，不是第二份形状。
//   ② `HOST_FILL` = 宿主补的那份值，**显式**写出来，类型是 `HostFill<宿主, 模型>`＝「宿主面减模型面」。
//      藏了一个字段却没人补它 → tsc 当场红；补错了值 → 同样红（字面量类型对不上）。
//   ③ 补完**重过同一份宿主 schema**：这一步不在这里跑第二遍，宿主自己早有那一处
//      （`*InputForAlias` 都是 `semanticSchema.parse({ operation: alias, ...})`）。`HOST_FILL` 是那件事的
//      **声明**，`verbProjections.test.ts` 拿它和那条真路逐字节对账，所以常量不是注释，是被机器核过的规格。
//
// ── 「宿主新长出一个必填字段」会怎样（原型接不住的那条，这一刀怎么接住）──
//
// 两种可能，两道不同的红：
//   · 它落在 `.omit()` 名单里（＝我们有意藏它）→ `HOST_FILL` 的类型立刻要求补它，没补就是 **tsc 红**。
//   · 它没被藏 → 顺着投影流进模型面 → 模型面变了 → `check:model-face-frozen` **门岗红**
//     （`scripts/check-model-face-frozen.mjs`，基线 `scripts/model-face-baseline.json`）。
// 原型那次变异（给 cancel 分支加一个必填 `requestedBy`）走的是第二条：它当时全绿，是因为当时还没有
// 冻结模型面的那道门。现在两条路都有红，投影的那个默认（「宿主新加的字段都是模型该填的」）不再是静默假设。
//
// ── 投影**覆盖不到**什么（明说，不静默降级）──
//
// 前提是「有且只有一份宿主 schema 是真相」。不满足的**四类**，一类都不许静默降级：
//   · **双域**（`check_job` / `cancel_job` 的生成域）：同一个模型面字段要落到另一份 schema 的另一个名字上。
//     投影只会藏字段和覆写描述，**故意**没有「改名」这个动作 → `verbDualDomain.ts` 留一份带领域理由的
//     声明映射。（这两个动词的模型面本身仍是投影——投在**导出域**上，那一半零 rename。）
//   · **结构有损**（`draft_shots`）：嵌套层级变了、嵌套被拍平、参考素材的身份由宿主补
//     → `draftShotsProjection.ts` 的显式变换，每个模型字段都解构、剩下的落进 `Record<string, never>`。
//   · **模型面是构造出来的**（6 个）：`write_script` 的 `where`→`operation` 是**值**重映射；
//     `read_timeline` / `look_at_media` 按「给了哪些参数」派生走宿主的哪一支；
//     `arrange_canvas` / `make_artifact` / `stage_shot` 拼出整只节点结构。投影没有「改值」「选分支」
//     「拼结构」这三个动作 → 它们仍住 `verbSemanticInput.ts`，由 `check:verb-host-conformance` 看着。
//   · **宿主没有形状**（`look_at_canvas` / `list_models`：契约 `inputSchema` 是 `z.unknown()`）→ 没有可投影的
//     东西。下一刀先把那两个契约的输入形状收出来，它们才谈得上投影。
import { z } from "zod";
import type { z as ZodTypes } from "zod";

import { documentReadSemanticInputSchema, type DocumentReadInput } from "../documentRead";
import { CANVAS_DELETE_ALIAS, canvasDeletePiInputSchema, canvasDeleteSemanticInputSchema } from "../canvasDelete";
import {
  EXPORT_READ_ALIASES, EXPORT_WRITE_ALIASES, exportReadSemanticInputSchema, exportWriteSemanticInputSchema,
} from "../exportCapabilities";
import { generationPlanInputSchema } from "../generationPlanSchemas";
import { modelSetupOpenInputSchema } from "../modelSetup";
import { SKILL_READ_ALIASES, skillReadSemanticInputSchema } from "../skillRead";
import { SKILL_WRITE_ALIASES, skillWriteSemanticInputSchema } from "../skillWrite";
import { timelineEditPlanModelSchema } from "../timelineRead";
import { TIMELINE_WRITE_ALIASES, timelineWriteSemanticInputSchema, undoTimelineEditInputBaseSchema } from "../timelineWrite";

/**
 * 宿主补的那份值的类型：**宿主面减模型面**。
 *
 * 这一个类型就是整套机制的编译期闸：模型面藏掉一个宿主必填字段而没人补它 → 这里少一个键 → tsc 红；
 * 宿主把自补字段的取值改了（`z.literal("a")` → `z.literal("b")`）而补的人不知道 → 字面量类型对不上 → tsc 红。
 * 后一种正是 Codex `timeout_ms` 那个已被量到的漂移形状搬到**补值**这一侧的样子。
 */
export type HostFill<Host extends ZodTypes.ZodTypeAny, Model extends ZodTypes.ZodTypeAny> =
  Omit<ZodTypes.infer<Host>, keyof ZodTypes.infer<Model>>;

/** 从一份 zod 对象 schema 取字段名单。投影的两边名单都从这里来——**不许手抄第二份**。 */
export function objectFieldKeys(schema: z.ZodTypeAny, label: string): readonly string[] {
  let node: unknown = schema;
  for (let depth = 0; depth < 8; depth += 1) {
    const def = (node as { _def?: Record<string, unknown> })._def;
    const shape = (node as { shape?: Record<string, unknown> }).shape;
    if (shape && typeof shape === "object") return Object.freeze(Object.keys(shape));
    if (!def) break;
    const inner = def.innerType ?? def.type ?? def.schema;
    if (!inner) break;
    node = inner;
  }
  throw new Error(`objectFieldKeys(${label}): 这不是一份能取出字段名单的对象 schema`);
}

// ── read_script · document.read ──────────────────────────────────────────────

/**
 * 宿主要 `scope` 必填，模型面让它可选——**缺省值是宿主补的**，所以这不是两份 schema，是一次投影加一次 fill。
 *
 * 2026-09-18 之前这个缺省只活在内部 lane 的一句手写 `?? "full"` 里，对外 MCP 面没有那句，于是
 * `nomi_document_read` 只带租约调用时当场 `capability_input_invalid`——同一个默认值，一边有一边没有。
 * 缺省搬到声明上（`readVerbs.ts` 的 `semanticInputOf`）之后，两个 profile 共用同一份。
 */
export const readScriptModelSchema = documentReadSemanticInputSchema.extend({
  scope: documentReadSemanticInputSchema.shape.scope.optional()
    .describe("full (default) reads the whole document; selection reads only what the user selected."),
});

/**
 * 模型没说时宿主按哪一档读。类型取自宿主 schema，所以宿主改枚举、这里就红——
 * 不会再出现「缺省值指着一个宿主已经不认的档」。
 */
export const READ_SCRIPT_SCOPE_DEFAULT: DocumentReadInput["scope"] = "full";

// ── read_skill · skill.read ──────────────────────────────────────────────────

/**
 * 藏两个字段：`operation` 是契约的分支判别值（模型不该知道传输层的方法词表）；
 * `expectedContentHash` 是**乐观并发**用的内容哈希，只有宿主自己拿得到（没有任何读动词返回它），
 * 所以它既不该出现在模型面上，也不该由模型填——这正是 B 类缺陷（宿主要一个模型拿不到的字段）的形状。
 */
const readSkillHostSchema = skillReadSemanticInputSchema;
export const readSkillModelSchema = readSkillHostSchema.omit({ operation: true, expectedContentHash: true }).extend({
  name: readSkillHostSchema.shape.name.describe("Skill name exactly as listed in the skills index."),
});

export const READ_SKILL_HOST_FILL: HostFill<typeof readSkillHostSchema, typeof readSkillModelSchema> = {
  operation: SKILL_READ_ALIASES.load,
};

// ── cancel_job（导出域那一半）· export.write ──────────────────────────────────

/**
 * 这一次调用真正要过的那份宿主 schema——**不是**长得像的那一份。
 *
 * （对照表时代这里取错过：`EXPORT_JOB_ROUTES.cancel_job` 的目标字段名单取自
 * `exportReadSemanticInputSchema` 的 `inspect_export_job` 分支，而这条路调用的是 `cancel_export_job`。
 * 两份今天字段名单恰好相同所以没出过错，但核的一直是另一份 schema。投影按构造消灭这一类：真相源
 * 就是这条调用要过的那一份，取错都取不了。）
 *
 * **只覆盖导出域。** `cancel_job` 是双域动词，生成域那一半必然是一次改名，见 `verbDualDomain.ts`。
 */
const cancelJobHostSchema = exportWriteSemanticInputSchema.options[1];

export const cancelJobModelSchema = cancelJobHostSchema.omit({ operation: true }).extend({
  domain: taskDomainSchema.describe('Copy domain from the taskRef returned by the task owner. Required for cancellation.'),
  jobId: cancelJobHostSchema.shape.jobId.describe("The job to cancel."),
});

export type CancelJobModelArgs = z.infer<typeof cancelJobModelSchema>;

export const CANCEL_JOB_HOST_FILL: HostFill<typeof cancelJobHostSchema, typeof cancelJobModelSchema> = {
  operation: EXPORT_WRITE_ALIASES.cancel,
};

// ── export_video · export.write ──────────────────────────────────────────────

const exportVideoHostSchema = exportWriteSemanticInputSchema.options[0];

export const exportVideoModelSchema = exportVideoHostSchema.omit({ operation: true }).extend({
  expectedRevision: exportVideoHostSchema.shape.expectedRevision.describe("The timeline revision from read_timeline."),
  outputName: exportVideoHostSchema.shape.outputName.describe("File name without extension."),
  aspectRatio: exportVideoHostSchema.shape.aspectRatio.describe("Output aspect ratio."),
  resolution: exportVideoHostSchema.shape.resolution.describe("Output resolution."),
  quality: exportVideoHostSchema.shape.quality.describe("Encoding quality preset."),
});

export const EXPORT_VIDEO_HOST_FILL: HostFill<typeof exportVideoHostSchema, typeof exportVideoModelSchema> = {
  operation: EXPORT_WRITE_ALIASES.start,
};

// ── save_skill · skill.write ─────────────────────────────────────────────────

export const saveSkillModelSchema = skillWriteSemanticInputSchema.omit({ operation: true }).extend({
  dirName: skillWriteSemanticInputSchema.shape.dirName.describe("Directory slug for the skill (ASCII letters, digits, . _ -)."),
  skillMarkdown: skillWriteSemanticInputSchema.shape.skillMarkdown.describe("The complete SKILL.md content, frontmatter included."),
});

export const SAVE_SKILL_HOST_FILL: HostFill<typeof skillWriteSemanticInputSchema, typeof saveSkillModelSchema> = {
  operation: SKILL_WRITE_ALIASES.author,
};

// ── delete_from_canvas · canvas.delete ───────────────────────────────────────

/**
 * 这一条**本来就是投影**，只是方向反过来写的：`canvas.delete` 的宿主面定义成
 * `canvasDeletePiInputSchema.extend({ operation })`，所以那份 pi schema 就是模型面，两边只有一份定义。
 * 这里不再起第二个名字（那会变成同一个形状的两个家），只把宿主自补的那个值显式声明出来——
 * 于是「藏了却没人补」在这个动词上同样是 tsc 红。
 */
export const DELETE_FROM_CANVAS_HOST_FILL:
  HostFill<typeof canvasDeleteSemanticInputSchema, typeof canvasDeletePiInputSchema> = {
  operation: CANVAS_DELETE_ALIAS,
};

// ── start_model_setup · model.setup.open ─────────────────────────────────────

/**
 * 宿主一个字段都不补：模型面 = 宿主面 + 一句描述覆写。没有 `*_HOST_FILL`，因为差集是空的——
 * 空的 fill 写出来只是噪音，而「宿主新长出一个必填字段」在这条路上照样有红：它会流进模型面，
 * `check:model-face-frozen` 当场拦住。
 */
export const startModelSetupModelSchema = modelSetupOpenInputSchema.extend({
  provider: modelSetupOpenInputSchema.shape.provider.describe("Provider name hint, e.g. DeepSeek or Anthropic."),
});

// ── undo · timeline.write ────────────────────────────────────────────────────

const undoHostSchema = undoTimelineEditInputBaseSchema.extend({ operation: z.literal("undo_timeline_edit") });

/**
 * `operation` 与 `reason` 是宿主字段；内部模型面只收统一的 `changeId`。
 * 旧 MCP `undoToken` 仅在 alias 适配器边界归一化。
 */
export const undoModelSchema = undoHostSchema.omit({ operation: true, reason: true, undoToken: true }).extend({
  changeId: undoHostSchema.shape.changeId.unwrap().describe("The changeId returned by the reversible write you are reverting."),
  expectedRevision: undoHostSchema.shape.expectedRevision.describe("Current timeline revision from read_timeline."),
}).strict();

export const UNDO_HOST_FILL: HostFill<typeof undoHostSchema, typeof undoModelSchema> = {
  operation: TIMELINE_WRITE_ALIASES.undo,
};

// ── edit_timeline · timeline.write ───────────────────────────────────────────

/**
 * 这一条的投影比别的多一步，而那一步是**有理由**的：宿主把 `operations` 声明成九支判别联合，
 * 而模型面发布的是**拍平**成一个对象的那一版（`timelineEditPlanModelSchema`，每个字段带
 * `[for move, text]` 这样的适用标注）。拍平不是第二份形状：它由同一份宿主 schema 机器生成
 * （`flattenDiscriminatedUnion`），对外 MCP 的 `plan` 字段与这里同源同一份。
 * 理由是领域约束——多家供应商的工具校验器对根级/嵌套 `anyOf` 支持不一致（`laneExtendedTools.test.ts`
 * 的 `collectVendorCompatibilityFailures` 就是那条断言），拍平是为了让模型那一侧真的收得下。
 *
 * 剩下的和别的投影一样：藏掉 `planId`（宿主按这次调用派生的幂等键）与 `operation`，只覆写一句描述。
 */
export const editTimelineModelSchema = timelineEditPlanModelSchema.omit({ planId: true }).extend({
  baseRevision: timelineEditPlanModelSchema.shape.baseRevision
    .describe("The revision returned by read_timeline; the edit applies only if it is still current."),
});

/** 幂等键的算法只有这一处；`editTimelineHostFill` 与传输层都从它来。 */
export const editTimelinePlanId = (toolCallId: string): string => `plan-${toolCallId}`;

export function editTimelineHostFill(
  toolCallId: string,
): HostFill<(typeof timelineWriteSemanticInputSchema.options)[0], typeof editTimelineModelSchema> {
  return { planId: editTimelinePlanId(toolCallId), operation: TIMELINE_WRITE_ALIASES.applyPlan };
}

// ── generate · generation.plan（present 分支）────────────────────────────────

const generateHostSchema = generationPlanInputSchema.options[4];

export const generateModelSchema = generateHostSchema.omit({ operation: true }).extend({
  operationId: generateHostSchema.shape.operationId.describe("The operationId returned by draft_shots."),
  shotIds: generateHostSchema.shape.shotIds.describe("Only these shots of the draft; omit for all."),
});

export const GENERATE_HOST_FILL: HostFill<typeof generateHostSchema, typeof generateModelSchema> = {
  operation: "present",
};

// ── check_job / cancel_job：双域动词的模型面（两个都投在**导出域**上）────────────

/**
 * 两个双域动词的模型面都从导出域派生，因为导出域那一半是**零 rename** 的真投影：宿主字段真叫
 * `jobId`（`…/jobs/<jobId>/` 的目录名）。生成域那一半才是改名（`.nomi/runs/<operationId>/`），
 * 那一条留在 `verbDualDomain.ts` 里当一条带领域理由的声明映射——投影**故意**没有「改名」这个动作。
 */
const checkJobHostSchema = exportReadSemanticInputSchema.options[0];

export const checkJobModelSchema = checkJobHostSchema.omit({ operation: true }).extend({
  domain: taskDomainSchema.describe('Copy domain from the taskRef returned by the task owner. Never infer it from a node ID.'),
  jobId: checkJobHostSchema.shape.jobId
    .describe("The job id returned by generate or export_video, or shown on a canvas node."),
});

export const CHECK_JOB_HOST_FILL: HostFill<typeof checkJobHostSchema, typeof checkJobModelSchema> = {
  operation: EXPORT_READ_ALIASES.inspect,
};
