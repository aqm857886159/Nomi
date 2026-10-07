// 升级版 `stage_shot`（3D-BOX 开关开时装配，契约 `director.write`）的**模型面**与参数翻译。
// 声明本身仍住 `writeVerbs.ts`（唯一声明处）；这里只放它要用的 schema、容忍与「动词参数 → 契约语义输入」。
//
// 模型面 = 宿主计划 schema 的投影（`directorPlanModelSchema`：strict、每个字段有描述、无根级 union / const），
// 根是扁平对象：新建交 `plan`，修改交 `edits`（按名字寻址的 RFC 6902 子集），跨字段约束在 superRefine 里
// 给说得清的拒绝。宿主解析仍只用 `directorPlanSchema` 这一份。
import { z } from "zod";

import { directorPlanModelSchema, normalizeDirectorPlan, parseDirectorPlan } from "../../director/directorPlanSchema";
import { DIRECTOR_PLAN_EDIT_OPS } from "../../director/planPatch";
import { LaneDomainFailure } from "../../agentLane/laneToolContract";
import { directorWriteSemanticInputSchema, type DirectorWriteInput } from "../directorWrite";
import { modelArgumentTolerance } from "../modelArgumentTolerance";

/**
 * 工具面上的计划 = 宿主投影去掉 `scene.dressing`：那一支是按米写坐标的灰模几何，与「计划只写意图、几何归编译器」
 * 相悖，也是整份 schema 里最大的一块（约 2k 字符，开关开的工具面预算 10k token 卡在它身上）。宿主照收
 * （旧数据 / 评测仍可带），只是不再请模型写。
 */
const planModel = directorPlanModelSchema.extend({
  scene: directorPlanModelSchema.shape.scene.omit({ dressing: true }).describe("Setting, lighting, and scene objects."),
}).describe("The whole director plan. Only when creating a new preview.");
const planShape = planModel.shape;
const shotModel = planShape.shots.element;
const actorModel = planShape.actors.element;
const setPieceModel = planShape.scene.shape.setPieces.removeDefault().element;
const blockingModel = planShape.blocking.removeDefault().element;

/** 补丁值：标量、字符串 / 数字列表，或整件镜头 / 角色 / 场景件 / 一个角色的走位列表 / 机位角度。运镜按字段改（/shots/<name>/move/kind）。 */
const editValueModel = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
  shotModel.partial({ id: true }),
  actorModel.partial({ id: true }),
  setPieceModel.partial({ id: true }),
  z.array(blockingModel.partial({ actor: true })),
  shotModel.shape.angle,
]);

export const directorStageShotModelSchema = z.object({
  target: z.object({
    shotId: z.string().trim().min(1).max(160).optional()
      .describe("Video shot id from look_at_canvas or draft_shots; the preview becomes its reference video."),
    directorNodeId: z.string().trim().min(1).max(160).optional()
      .describe("Existing 3D-BOX node id; required with edits."),
  }).strict().optional()
    .describe("Omit for a standalone preview; shotId to build one for a shot; directorNodeId to edit one."),
  // 描述只挂在 planModel 上一处：外层再 describe 会盖掉内层，模型面就丢了一句契约声明的话（laneToolSchema 的无损断言）。
  plan: planModel.optional(),
  baseRevision: z.string().trim().min(1).max(64).optional()
    .describe("Current revision of that node; required with edits."),
  edits: z.array(z.object({
    op: z.enum(DIRECTOR_PLAN_EDIT_OPS).describe("add a new named item or field, remove one, or replace one."),
    path: z.string().trim().min(2).max(240)
      .describe("By name: /shots/<name>[/field], /actors/<name>[/field], /scene/setPieces/<name>[/field], /scene/<field>, /blocking/<actor>."),
    value: editValueModel.optional().describe("New value for add and replace; omit for remove."),
  }).strict()).min(1).max(64).optional()
    .describe("Only the changes the user asked for, in order."),
}).strict().superRefine((value, context) => {
  const creates = value.plan !== undefined;
  const edits = (value.edits?.length ?? 0) > 0;
  if (creates === edits) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["plan"], message: "give exactly one of plan (create a preview) or edits (change an existing one)" });
  }
  if (value.target?.shotId && value.target.directorNodeId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["target"], message: "target is either shotId or directorNodeId, not both" });
  }
  if (creates && value.target?.directorNodeId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["target", "directorNodeId"], message: "to change an existing 3D-BOX node send edits, not a whole plan" });
  }
  if (edits && (!value.target?.directorNodeId || !value.baseRevision)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["edits"], message: "edits need target.directorNodeId and baseRevision" });
  }
  if (!edits && value.baseRevision !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["baseRevision"], message: "baseRevision only goes with edits" });
  }
});

const tolerate = modelArgumentTolerance({ objectFields: ["target", "plan"], arrayFields: ["edits"] });

/**
 * 容忍（JSON 文本化的字段）+ 计划的无损同义归一，然后在**发出之前**用宿主那份唯一的计划 schema 核一遍
 * 跨字段规则（引用的角色 / 场景件存在、窗口递增）。不过就当场说清哪一条，模型自修，画布一个字不动。
 */
export function prepareDirectorStageShotArguments(args: unknown): Record<string, unknown> {
  const record = tolerate(args);
  if (record.plan === undefined) return record;
  const normalized = normalizeDirectorPlan(record.plan);
  const parsed = parseDirectorPlan(normalized);
  if (!parsed.success && parsed.error.issues.some((issue) => issue.code === z.ZodIssueCode.custom)) {
    const problems = parsed.error.issues.filter((issue) => issue.code === z.ZodIssueCode.custom)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new LaneDomainFailure({
      code: "capability_input_invalid",
      message: `The director plan refers to names it never defines: ${problems.join("; ")}.`,
      nextAction: "Define every actor and set piece you reference (or use a template anchor id), then send the plan again. Nothing was changed.",
    });
  }
  return { ...record, plan: normalized };
}

type StageShotArgs = Readonly<{
  target?: { shotId?: string; directorNodeId?: string };
  plan?: unknown;
  baseRevision?: string;
  edits?: Array<{ op: string; path: string; value?: unknown }>;
}>;

/** 动词参数 → `director.write` 语义输入（两条分支由上面的 superRefine 保证互斥）。 */
export function directorWriteInputOf(args: Readonly<Record<string, unknown>>): DirectorWriteInput {
  const { target, plan, baseRevision, edits } = args as StageShotArgs;
  const semantic = plan !== undefined
    ? { operation: "create_director_plan", ...(target?.shotId ? { shotNodeId: target.shotId } : {}), plan: normalizeDirectorPlan(plan) }
    : { operation: "patch_director_plan", directorNodeId: target?.directorNodeId, baseRevision, edits };
  return directorWriteSemanticInputSchema.parse(semantic);
}
