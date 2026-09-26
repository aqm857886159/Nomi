import { planAnchorSchema, planShotSchema } from '../storyboard/storyboardPlanSchema'
import { z } from "zod";

export const GENERATION_RECONCILE_OUTCOMES = ["found", "not_found"] as const;

/**
 * 一条**已钉住**的参考：内容哈希与版本都在，执行契约按它签名（`contractHash` 覆盖 references）。
 * 它是候选里存的形状，不是模型填的形状。
 */
const reference = z.lazy(() => z.object({
  assetId: z.string().trim().min(1),
  contentHash: z.string().trim().min(1),
  version: z.number().int().min(1),
  kind: z.enum(["image", "video", "audio"]).optional(),
  role: z.enum(["character", "first_frame", "last_frame", "reference", "audio"]).optional(),
}).strict());

/** Shared pinned asset identity; UI inputs derive from this exact contract. */
export const generationReferenceSchema = reference.schema;
export type GenerationReference = z.infer<typeof generationReferenceSchema>;

/**
 * 一条**模型填的**参考：只要 assetId。
 *
 * 2026-09-18 根因：这里原本就是上面那条已钉住的形状，于是 `draft_shots` 只要带一张参考图就
 * 100% 被判 `generation_input_invalid` —— 而 `contentHash` / `version` 是模型**拿不到**的东西
 * （`look_at_media` 与 `look_at_canvas` 都不返回它们）。「宿主要求动词给不出的字段」与多镜那次
 * 硬要整只 `candidate` 是同一类，解法也同一条：模型给语义（哪份素材、当什么用），身份由宿主按
 * 项目素材库补（`resolveProjectAssetReferenceIdentity`）。已经钉好的调用方照常直接给，逐字节不变。
 */
const planReferenceInput = z.lazy(() => z.object({
  assetId: z.string().trim().min(1),
  contentHash: z.string().trim().min(1).optional(),
  version: z.number().int().min(1).optional(),
  kind: z.enum(["image", "video", "audio"]).optional(),
  role: z.enum(["character", "first_frame", "last_frame", "reference", "audio"]).optional(),
}).strict());

/**
 * JSON values retain arbitrary nesting; the selected model catalog validates named parameters.
 * This is the one answer to "what a generation parameter value can be" for every producer — the
 * agent / MCP JSON transports and the renderer spend card (`spendCardDraft`) share it, so a producer
 * that could emit `undefined` (IPC structured clone keeps it, JSON drops it) fails to type-check
 * instead of being refused here at confirm time (2026-09-26, real paid T5).
 */
export type GenerationJsonValue = string | number | boolean | null | GenerationJsonValue[] | { [key: string]: GenerationJsonValue };
export const generationJsonValueSchema: z.ZodType<GenerationJsonValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(),
  z.array(generationJsonValueSchema), z.record(generationJsonValueSchema),
]));
const parameters = z.record(generationJsonValueSchema);

/** Original author-only fields; candidate identity and prompt keep their existing input owner. */
const authorFieldDescriptions: Record<string,string> = {
  kind:'Anchor category',carrier:'Visual or text guidance',scope:'All or selected',
  referenceUrl:'Anchor media URL',referenceKind:'Anchor media type',referenceSourceNodeId:'Source node id',
  anchorIds:'Reused anchor ids',referenceBindings:'Ordered slot media',promptSegments:'Prompt text ranges',
  variationType:'Variation strength',camIdx:'Camera preset index',ffDesc:'First-frame description',lfDesc:'Last-frame description',
  motionDesc:'Frame-to-frame motion',continuity:'Continuity facts',keyframe:'Independent keyframe',
  enabled:'Enable',prompt:'Prompt',modelKey:'Model id',modelVendor:'Provider',modeId:'Mode',params:'Model parameters',
  url:'Media URL',name:'Media name',sourceNodeId:'Source node id',anchorId:'Source anchor id',ignore:'Features to ignore',
  key:'Segment name',start:'Start offset',end:'End offset',durationSec:'Seconds for stills too',
};
/**
 * 作者字段的说明文字由上面那张表**逐个**登记。缺一条就在装配期抛，不许退回裸 key。
 *
 * 为什么不留 `?? key`：分镜 schema（`electron/shared/storyboard/storyboardPlanSchema.ts`）新长一个
 * 字段，它会自动出现在模型的工具 schema 里，说明就是那个字段的裸变量名——不报错、不红、没人看见，
 * 而模型据此写出来的东西要花钱。这条断言的位置就是「能让门岗拦的别留给人」（R17）。
 */
const describeAuthorFields = <T extends z.ZodRawShape>(shape:T):T => Object.fromEntries(Object.entries(shape).map(([key,value])=>{
  if (value.description) return [key,value];
  const described = authorFieldDescriptions[key];
  if (!described) throw new Error(`storyboard author field has no model-visible description: ${key}`);
  return [key,value.describe(described)];
})) as T;
const originalBindings=planShotSchema.shape.referenceBindings.unwrap();
const authorBindings=z.record(z.array(z.object(describeAuthorFields(originalBindings.element.element.shape))));
const authorShape=planAnchorSchema.omit({id:true,name:true,description:true,modelKey:true,modelVendor:true,modeId:true,params:true,referenceBindings:true})
  .merge(planShotSchema.omit({shotId:true,index:true,prompt:true,shotKind:true,modelKey:true,modelVendor:true,modeId:true,params:true,referenceBindings:true,keyframe:true,continuity:true,promptSegments:true})).partial().extend({
    referenceBindings:authorBindings.optional(),
    promptSegments:z.array(z.object(describeAuthorFields(planShotSchema.shape.promptSegments.unwrap().element.shape))).optional(),
    continuity:z.union([z.string(),z.number(),parameters]).optional(),
    keyframe:z.object(describeAuthorFields({...planShotSchema.shape.keyframe.unwrap().shape,params:parameters.optional()})).strict().optional(),
  });
export const storyboardAuthorFieldsSchema=z.lazy(()=>z.object(describeAuthorFields(authorShape.shape)).strict());
export type StoryboardAuthorFields=z.infer<typeof storyboardAuthorFieldsSchema>;

/** The explicit candidate accepted by the generation domain owner. */
export const generationCandidateSchema = z.object({
  candidateId: z.string().trim().min(1), revision: z.number().int().min(1),
  moduleId: z.string().trim(), providerId: z.string().trim(), modelId: z.string().trim(),
  mode: z.string().trim(), modeId: z.string().trim().min(1).optional(),
  variantId: z.string().trim().min(1).optional(), prompt: z.string(),
  parameters: parameters.default({}), references: z.array(reference).default([]),
}).strip();

const candidatePatch = z.object({
  storyboard: storyboardAuthorFieldsSchema.optional(),
  prompt: z.string().optional(),
  taskKind: z.enum(["text_to_image", "image_edit", "text_to_video", "image_to_video"]).optional(),
  moduleId: z.string().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  mode: z.string().optional(),
  modeId: z.string().optional(),
  variantId: z.string().optional(),
  parameters: parameters.optional(),
  references: z.array(planReferenceInput).optional(),
}).strict();

const createFields = {
  storyboard: storyboardAuthorFieldsSchema.optional(),
  prompt: z.string().trim().min(1).optional(),
  taskKind: z.enum(["text_to_image", "image_edit", "text_to_video", "image_to_video"]).optional(),
  moduleId: z.string().trim().min(1).optional(),
  providerId: z.string().trim().min(1).optional(),
  modelId: z.string().trim().min(1).optional(),
  mode: z.string().trim().min(1).optional(),
  modeId: z.string().trim().min(1).optional(),
  variantId: z.string().trim().min(1).optional(),
  parameters: parameters.optional(),
  references: z.array(planReferenceInput).optional(),
  candidate: generationCandidateSchema.optional(),
  shots: z.array(z.object({
    storyboard: storyboardAuthorFieldsSchema.optional(),
    shotId: z.string().trim().min(1).optional(),
    role: z.enum(["anchor", "shot"]).optional(),
    included: z.boolean().optional(),
    /**
     * 这一镜给人看的短标题（模型自己拟，如「日落前的一分钟」）。两个终点在等它：画布节点的标签，
     * 以及花钱确认卡上那行「#1 〈标题〉· 模型 · 价格」。上限 120 与 `sceneOneLiner` 的截断长度同源。
     */
    title: z.string().trim().min(1).max(120).optional(),
    candidate: generationCandidateSchema.optional(),
    prompt: z.string().trim().min(1).optional(),
    taskKind: z.enum(["text_to_image", "image_edit", "text_to_video", "image_to_video"]).optional(),
    /**
     * 2026-09-18 扫描：这两个字段**合成器早就在读**（`semanticCandidateFromParams` 按 `params.moduleId`
     * / `params.providerId` 取身份），只有这份 `.strict()` 的 shots 元素没声明它们。于是模型按目录点名
     * 「用 apimart 的 image-1」时，多镜那条路要么被整条拒收、要么把点名悄悄丢掉、落回用户的默认模型——
     * 一次**花钱**的调用用错模型且没有任何人报错。补齐的是声明，不是新能力。
     *
     * 换一个角度说同一件事（两份根因合同同一天各自挖到）：一镜能点名模型却点不了它的供应商，
     * 身份就只剩一半——没有 `providerId`，「这一笔花在哪个模型上」在多镜路上根本无法表达。
     */
    moduleId: z.string().trim().min(1).optional(),
    providerId: z.string().trim().min(1).optional(),
    modelId: z.string().trim().min(1).optional(),
    mode: z.string().trim().min(1).optional(),
    modeId: z.string().trim().min(1).optional(),
    variantId: z.string().trim().min(1).optional(),
    parameters: parameters.optional(),
    references: z.array(planReferenceInput).optional(),
  }).strict()).optional(),
  scriptText: z.string().trim().min(1).optional(),
  /**
   * 建草稿时先不把报价卡摆到用户面前（`draft_shots` 动词：草稿落画布、带单价角标、不出卡、不花钱）；
   * `present` 再翻成可见。缺省 = 卡立刻可见（外部 MCP 宿主与面板自己的路径，行为逐字不变）。
   */
  cardHidden: z.boolean().optional(),
} as const;

/**
 * 一次生成运行的 id。**上限是宿主这一侧的准入约束，不是模型面的装饰**：这个值直接当
 * `.nomi/runs/<operationId>/` 的目录名用（`mcpGenerationTools.ts` 里没给就发一个 `op-<uuid>`＝39 字），
 * 外部调用方给一个无界长串就是一条无界路径。2026-09-18 投影化之前这条上限只写在模型面上——
 * 也就是写在**最拦不住的那一层**（R17）；搬到宿主之后模型面从它派生，两边不可能再各写一份。
 */
const operationId = z.string().trim().min(1).max(160);

export const generationPlanInputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("context"),
    taskKind: createFields.taskKind, scope: z.enum(["summary", "full"]).optional(),
  }).strict(),
  z.object({ operation: z.literal("create"), ...createFields }).strict(),
  /** `shotId`：改多镜草稿里的**一镜**（`draft_shots` 带 draftId + shotId）；缺省 = 顶层候选（单镜草稿）。 */
  z.object({ operation: z.literal("patch"), operationId, shotId: z.string().trim().min(1).optional(), patch: candidatePatch }).strict(),
  z.object({ operation: z.literal("preview"), operationId }).strict(),
  /** `generate` 动词：把已建草稿的报价卡摆到用户面前；`shotIds` 只把卡限定在这几镜（缺省全部）。 */
  z.object({ operation: z.literal("present"), operationId, shotIds: z.array(z.string().trim().min(1).max(160)).max(40).optional() }).strict(),
  // Strategy resolution is the separate GENERATION_RESOLVE_CAPABILITY owner.
]);

export const generationStatusInputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("read"), operationId }).strict(),
  z.object({ operation: z.literal("cancel"), operationId }).strict(),
  z.object({ operation: z.literal("reconcile"), operationId, outcome: z.enum(GENERATION_RECONCILE_OUTCOMES) }).strict(),
]);

/** Host capability projection retains the canonical branches, never a parallel schema. */
export function generationPlanSchemaForHost(host: { preview: boolean }) {
  const [context, create, patch, , present] = generationPlanInputSchema.options;
  return host.preview ? generationPlanInputSchema : z.discriminatedUnion('operation', [context, create, patch, present]);
}

export const GENERATION_CREATE_EXAMPLE = {
  operation: 'create', taskKind: 'text_to_image',
  candidate: { candidateId: 'candidate-1', revision: 1, moduleId: 'image', providerId: 'from-context',
    modelId: 'from-context', mode: 'from-context', prompt: '海上日出' },
} as const;
