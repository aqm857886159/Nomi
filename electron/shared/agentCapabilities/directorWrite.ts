/**
 * `director.write`：3D-BOX 导演计划写入的**仅内部**契约（方案 §5「契约层换芯，不动对外面」）。
 *
 * - 只在 3D-BOX 开关开时注册（`registry.ts`），`exposure: internal_only`、没有 `aliases.mcp`——对外 MCP 面
 *   一个字节都不会因为它而变；开关开时 `stage_shot` 这个名字从 `canvas.write` 的附加别名挪到这里，任一构建
 *   只装配一份。
 * - 传输复用画布写的 surface port（capture / execute 两条现成 IPC）、审批、收据、changeId 与撤销日志：
 *   导演工程就住在画布节点 meta 里，它的修订就是画布历史里的一条。preload 的操作白名单只在开关开时追加
 *   这两个操作（`surfacePortPreloadBridge.ts`）。
 * - 永不花钱：`reversible_local`。出片只走 `generate`。
 */
import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";
import { DIRECTOR_PREVIEW_STATUSES } from "../director/directorPreviewStatus";
import { directorPlanSchema } from "../director/directorPlanSchema";
import { DIRECTOR_PLAN_EDIT_OPS } from "../director/planPatch";

const canonicalIdSchema = z.string().trim().min(1).max(512);
const changeIdSchema = z.string().trim().min(1).max(200);

export const DIRECTOR_WRITE_OPERATIONS = ["create_director_plan", "patch_director_plan"] as const;
export type DirectorWriteOperation = (typeof DIRECTOR_WRITE_OPERATIONS)[number];

export function isDirectorWriteOperation(value: unknown): value is DirectorWriteOperation {
  return typeof value === "string" && (DIRECTOR_WRITE_OPERATIONS as readonly string[]).includes(value);
}

export const directorPlanEditSchema = z.object({
  op: z.enum(DIRECTOR_PLAN_EDIT_OPS),
  path: z.string().trim().min(2).max(240),
  // 值的形状由补丁应用后的整份计划校验来判（`planPatch.ts`），这里不复制计划 schema 的第二份。
  value: z.unknown().optional(),
}).strict();

const createDirectorPlanInputSchema = z.object({
  operation: z.literal("create_director_plan"),
  /** 为哪一镜（画布上的视频 / 镜头节点）搭预演；省略 = 独立预演，不挂任何节点。 */
  shotNodeId: canonicalIdSchema.optional(),
  plan: directorPlanSchema,
}).strict();

const patchDirectorPlanInputSchema = z.object({
  operation: z.literal("patch_director_plan"),
  directorNodeId: canonicalIdSchema,
  baseRevision: z.string().trim().min(1).max(64),
  edits: z.array(directorPlanEditSchema).min(1).max(64),
}).strict();

export const directorWriteSemanticInputSchema = z.discriminatedUnion("operation", [
  createDirectorPlanInputSchema,
  patchDirectorPlanInputSchema,
]);
export type DirectorWriteInput = z.infer<typeof directorWriteSemanticInputSchema>;

/** 它点名的那一个节点：为哪一镜新建（可省略）/ 改哪个 3D-BOX 节点。主进程准入与渲染端取证用同一份。 */
export function directorWriteReferenceIds(input: DirectorWriteInput): string[] {
  return input.operation === "create_director_plan" ? (input.shotNodeId ? [input.shotNodeId] : []) : [input.directorNodeId];
}

const issueSchema = z.object({
  kind: z.string().trim().min(1).max(64),
  message: z.string().max(2_000),
  time: z.number().finite().optional(),
  ref: z.string().max(512).optional(),
}).strict();

const cutSchema = z.object({
  /** 计划里覆盖这段时间的镜头名；测量切点与计划窗口对不上时为 null。 */
  shot: z.string().nullable(),
  start: z.number().finite(),
  end: z.number().finite(),
  /** 实测景别；没有可测主体 = null。 */
  shotSize: z.string().nullable(),
  /** 实测运镜 id。 */
  move: z.string(),
}).strict();

const previewSchema = z.object({
  status: z.enum(DIRECTOR_PREVIEW_STATUSES),
  targetNodeId: canonicalIdSchema.optional(),
  /** 渲染好以后怎么挂：模型有参考视频槽 = video_ref；没有 = 只能写进提示词（精度低）。 */
  attach: z.enum(["video_ref", "prompt_only"]).optional(),
  /** ready 时预演在项目素材库里的 id（`draft_shots` 的 references 收它）。 */
  assetId: z.string().trim().min(1).max(512).optional(),
  reason: z.string().max(200).optional(),
}).strict();

export const directorWriteAppliedSchema = z.object({
  applied: z.literal(true),
  proposalId: canonicalIdSchema,
  changeId: changeIdSchema,
  operation: z.enum(DIRECTOR_WRITE_OPERATIONS),
  directorNodeId: canonicalIdSchema,
  revision: z.string().trim().min(1).max(64),
  /** 补丁没改变规范化计划：画布、预演都没动。 */
  unchanged: z.boolean(),
  /** 规范化后的完整计划（Agent 下一次补丁的基准）。 */
  plan: z.unknown(),
  issues: z.array(issueSchema).max(200),
  cuts: z.array(cutSchema).max(200),
  /** 补丁直接改到的计划实体（`shot:<id>` / `actor:<id>` / `setPiece:<id>` / `scene` / `blocking:<actor>`）。 */
  touched: z.array(z.string().max(512)).max(200),
  /** 用户手改里被这次补丁直接改到、因而丢弃的那几条（`<实体 id>.<属性>`，整实体增删写实体 id）；撤销这次补丁即恢复。 */
  reorderedOverrides: z.array(z.string().max(512)).max(200),
  /** 补丁没有直接点名、但重编译后变了的实体 id（其上的手改照常保留）。 */
  changedEntities: z.array(z.string().max(512)).max(400),
  preview: previewSchema,
}).strict();

/**
 * 领域拒绝（修订过期 / 补丁不成立 / 编译不过）：渲染端在事务里**什么都不写**、照常提交一条空收据，
 * 再把原因交回来；lane 把它翻成模型读得懂的失败（`LaneDomainFailure`）。
 * 不走传输错误码：那是闭合词表，装不下「当前修订号是什么」「哪条路径为什么不对」。
 */
export const directorWriteRejectedSchema = z.object({
  applied: z.literal(false),
  proposalId: canonicalIdSchema,
  operation: z.enum(DIRECTOR_WRITE_OPERATIONS),
  rejected: z.enum(["stale_revision", "invalid_patch", "compile_failed", "target_missing"]),
  messages: z.array(z.string().max(2_000)).min(1).max(100),
  currentRevision: z.string().max(64).optional(),
}).strict();

export const directorWriteResultSchema = z.union([directorWriteAppliedSchema, directorWriteRejectedSchema]);
export type DirectorWriteResult = z.infer<typeof directorWriteResultSchema>;
export type DirectorWriteApplied = z.infer<typeof directorWriteAppliedSchema>;

export const DIRECTOR_WRITE_CAPABILITY = {
  id: "director.write",
  version: 1,
  aliases: { pi: "stage_shot" },
  // 计划 schema 带默认值（输入 ≠ 输出形状），契约类型只认单一形状：解析后的才是语义输入。
  inputSchema: directorWriteSemanticInputSchema as unknown as z.ZodType<DirectorWriteInput>,
  outputSchema: directorWriteResultSchema,
  effect: "reversible_write",
  effectClass: "reversible_local",
  operationEffectClasses: Object.freeze({
    create_director_plan: "reversible_local",
    patch_director_plan: "reversible_local",
  }),
  execution: { port: "canvas", availability: "renderer_required" },
  exposure: "internal_only",
  requiredScope: "canvas:write",
  targetKind: "canvas",
} as const satisfies CapabilityContract<DirectorWriteInput, DirectorWriteResult>;
