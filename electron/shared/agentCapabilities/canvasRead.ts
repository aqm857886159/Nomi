import { z } from "zod";
import { taskReferenceSchema } from './taskReference';
import { resolveShotIdentities } from "../canvas/shotNumbering";
import { formatStoryboardShotLabelForAgent, resolveStoryboardShotLabel, storyboardLabelSourceSchema } from "../canvas/storyboardShotLabel";
import { generationNodeStatusSchema, parseGenerationNodeStatus } from "../canvas/generationNodeStatus";
import { DIRECTOR_PREVIEW_STATUSES } from "../director/directorPreviewStatus";
import type { CapabilityContract } from "./capabilityContract";
import { director3dBoxFaceEnabled } from "../featureFlags/director3dboxFace";

const URI_SCHEME_RESULT_ID = /^[a-z][a-z0-9+.-]*:/i;
const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const opaqueResultIdSchema = trimmedNonEmptyStringSchema.refine((id) => !URI_SCHEME_RESULT_ID.test(id), {
  message: "Result identity must be opaque",
});

const canvasReadPositionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

const nonnegativeSafeIntegerSchema = z
  .number()
  .refine(isNonnegativeSafeInteger, { message: "Sequence number must be a nonnegative safe integer" });

/** Shared persisted-domain vocabulary; canvas read and write boundaries consume this same list. */
export const CANVAS_NODE_KINDS = Object.freeze([
  "shot_table", "text", "character", "scene", "image", "keyframe", "video", "audio", "clip", "shot", "output", "panorama",
  "director", "whiteboard", "model3d", "asset", "agent-artifact",
] as const);
export const CANVAS_EDGE_MODES = Object.freeze([
  "reference", "first_frame", "last_frame", "style_ref", "character_ref", "composition_ref",
] as const);

const canvasReadNodeSchema = z
  .object({
    id: trimmedNonEmptyStringSchema,
    kind: trimmedNonEmptyStringSchema,
    title: z.string(),
    prompt: z.string(),
    status: generationNodeStatusSchema,
    position: canvasReadPositionSchema,
    locked: z.boolean(),
    shotIndex: z.number().int().positive().safe().optional(),
    /**
     * 分镜镜头的名字（「镜 03」/「<分镜名> · 镜 03」，owner = canvas/storyboardShotLabel）。
     * 有它的节点**不带 shotIndex**：全局镜号只是内部排序键，分镜镜头对人、对模型只有这一个号。
     */
    shotLabel: z.string().min(1).optional(),
    shotRole: z.enum(["first_frame", "video", "image"]).optional(),
    shotOwnerNodeIds: z.array(trimmedNonEmptyStringSchema).optional(),
    hasResult: z.boolean(),
    currentResultId: opaqueResultIdSchema.optional(),
    resultIds: z.array(opaqueResultIdSchema).optional(),
    taskRef: taskReferenceSchema.optional(),
    /**
     * 这个节点挂着的模型身份（只有标识，不含参数——参数按需去 `nomi_read{target:"model"}` 查，
     * 那是分级披露的详情那一档；整张画布每个节点都拖着一份参数表会把回合上下文撑爆）。
     *
     * 修复前这份投影**一个模型字段都不返回**：写路径又不校验模型键，于是外部宿主写错一个
     * modelKey，既拦不住也读不回来——错误完全不可观测。
     */
    /**
     * 3D-BOX 节点（开关开的构建才有）：补丁要用的修订号与名字。完整计划在每次 `stage_shot` 的结果里，
     * 这里只放一行能装下的东西——整张画布共用一份摘要预算，不让一个预演挤掉别的节点。
     */
    director: z
      .object({
        revision: trimmedNonEmptyStringSchema,
        shots: z.array(z.string()).max(64),
        actors: z.array(z.string()).max(64),
        setPieces: z.array(z.string()).max(64),
        issueCount: z.number().int().nonnegative(),
        preview: z.enum(DIRECTOR_PREVIEW_STATUSES),
        previewTargetNodeId: trimmedNonEmptyStringSchema.optional(),
        /** 预演就绪后在项目素材库里的 id（`draft_shots` 的 references 收它）。 */
        previewAssetId: trimmedNonEmptyStringSchema.optional(),
      })
      .strict()
      .optional(),
    model: z
      .object({
        modelKey: trimmedNonEmptyStringSchema,
        vendor: trimmedNonEmptyStringSchema.optional(),
        variantId: trimmedNonEmptyStringSchema.optional(),
        modeId: trimmedNonEmptyStringSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const canvasReadEdgeSchema = z
  .object({
    id: trimmedNonEmptyStringSchema,
    source: trimmedNonEmptyStringSchema,
    target: trimmedNonEmptyStringSchema,
    mode: z.string(),
    order: nonnegativeSafeIntegerSchema.optional(),
  })
  .strict();

const canvasReadGroupSchema = z
  .object({
    id: trimmedNonEmptyStringSchema,
    name: z.string(),
    nodeIds: z.array(trimmedNonEmptyStringSchema),
    collapsed: z.boolean(),
  })
  .strict();

function duplicateIndexes(values: readonly string[]): number[] {
  const seen = new Set<string>();
  const duplicates: number[] = [];
  values.forEach((value, index) => {
    if (seen.has(value)) duplicates.push(index);
    seen.add(value);
  });
  return duplicates;
}

export const canvasReadSemanticInputSchema = z.object({}).strict();

export const canvasReadResultSchema = z
  .object({
    nodes: z.array(canvasReadNodeSchema),
    edges: z.array(canvasReadEdgeSchema),
    groups: z.array(canvasReadGroupSchema),
    selectedNodeIds: z.array(trimmedNonEmptyStringSchema),
    truncated: z.boolean().optional(),
  })
  .strict()
  .superRefine((result, context) => {
    for (const index of duplicateIndexes(result.nodes.map((node) => node.id))) {
      context.addIssue({ code: "custom", message: "Node ID must be unique", path: ["nodes", index, "id"] });
    }
    for (const index of duplicateIndexes(result.edges.map((edge) => edge.id))) {
      context.addIssue({ code: "custom", message: "Edge ID must be unique", path: ["edges", index, "id"] });
    }
    for (const index of duplicateIndexes(result.groups.map((group) => group.id))) {
      context.addIssue({ code: "custom", message: "Group ID must be unique", path: ["groups", index, "id"] });
    }

    const nodeIds = new Set(result.nodes.map((node) => node.id));
    result.edges.forEach((edge, edgeIndex) => {
      for (const field of ["source", "target"] as const) {
        if (!nodeIds.has(edge[field])) {
          context.addIssue({
            code: "custom",
            message: `Edge ${field} must reference a node`,
            path: ["edges", edgeIndex, field],
          });
        }
      }
    });
    result.groups.forEach((group, groupIndex) => {
      for (const nodeIndex of duplicateIndexes(group.nodeIds)) {
        context.addIssue({
          code: "custom",
          message: "Group node IDs must be unique",
          path: ["groups", groupIndex, "nodeIds", nodeIndex],
        });
      }
      group.nodeIds.forEach((nodeId, nodeIndex) => {
        if (!nodeIds.has(nodeId)) {
          context.addIssue({
            code: "custom",
            message: "Group node ID must reference a node",
            path: ["groups", groupIndex, "nodeIds", nodeIndex],
          });
        }
      });
    });
    for (const index of duplicateIndexes(result.selectedNodeIds)) {
      context.addIssue({
        code: "custom",
        message: "Selected node IDs must be unique",
        path: ["selectedNodeIds", index],
      });
    }
    result.selectedNodeIds.forEach((nodeId, index) => {
      if (!nodeIds.has(nodeId)) {
        context.addIssue({
          code: "custom",
          message: "Selected node ID must reference a node",
          path: ["selectedNodeIds", index],
        });
      }
    });
    result.nodes.forEach((node, nodeIndex) => {
      for (const ownerIndex of duplicateIndexes(node.shotOwnerNodeIds ?? [])) {
        context.addIssue({ code: "custom", message: "Shot owner IDs must be unique", path: ["nodes", nodeIndex, "shotOwnerNodeIds", ownerIndex] });
      }
      node.shotOwnerNodeIds?.forEach((ownerId, ownerIndex) => {
        if (!nodeIds.has(ownerId)) context.addIssue({ code: "custom", message: "Shot owner must reference a node", path: ["nodes", nodeIndex, "shotOwnerNodeIds", ownerIndex] });
      });
      for (const resultIndex of duplicateIndexes(node.resultIds ?? [])) {
        context.addIssue({
          code: "custom",
          message: "Result IDs must be unique",
          path: ["nodes", nodeIndex, "resultIds", resultIndex],
        });
      }
    });
  });

export type CanvasReadInput = z.infer<typeof canvasReadSemanticInputSchema>;
export type CanvasReadResult = z.infer<typeof canvasReadResultSchema>;
type CanvasReadNode = CanvasReadResult["nodes"][number];
type CanvasReadEdge = CanvasReadResult["edges"][number];
type CanvasReadGroup = CanvasReadResult["groups"][number];
type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resultId(value: unknown): string | undefined {
  const id = nonEmptyString(asRecord(value)?.id);
  return id && !URI_SCHEME_RESULT_ID.test(id) ? id : undefined;
}

function stableResultIds(node: UnknownRecord): string[] {
  const values = [node.result, ...(Array.isArray(node.history) ? node.history : [])];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    const id = resultId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * 节点 meta 里的模型身份。读的键与解析器读的是**同一组**（`canvasNodeFactory.bindModelIdentity`
 * 写的那四件 + 变体/模式）——读写不许各认一套键，否则「读得回来」只是看起来读得回来。
 */
function projectNodeModel(meta: UnknownRecord | undefined): CanvasReadNode["model"] | undefined {
  const modelKey = nonEmptyString(meta?.modelKey) ?? nonEmptyString(meta?.modelAlias);
  if (!modelKey) return undefined;
  const vendor = nonEmptyString(meta?.modelVendor) ?? nonEmptyString(meta?.vendor);
  const variantId = nonEmptyString(meta?.variantId);
  const modeId = nonEmptyString(meta?.modeId);
  return {
    modelKey,
    ...(vendor ? { vendor } : {}),
    ...(variantId ? { variantId } : {}),
    ...(modeId ? { modeId } : {}),
  };
}

function namesOf(value: unknown, key: "id"): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const name = nonEmptyString(asRecord(item)?.[key]);
    return name ? [name] : [];
  }).slice(0, 64);
}

/**
 * 3D-BOX 节点摘要。读的键与写的键同一组（导演节点 meta 的 `directorPlan` / `directorPreview`，
 * 写者是 `stage_shot` 的渲染端执行体）。开关关的构建一个字不多。
 */
function projectDirectorBox(meta: UnknownRecord | undefined): CanvasReadNode["director"] | undefined {
  if (!director3dBoxFaceEnabled()) return undefined;
  const planMeta = asRecord(meta?.directorPlan);
  const revision = nonEmptyString(planMeta?.revision);
  const plan = asRecord(planMeta?.plan);
  if (!revision || !plan) return undefined;
  const preview = asRecord(meta?.directorPreview);
  const status = preview?.status;
  const target = nonEmptyString(preview?.targetNodeId);
  const assetId = status === "ready" ? nonEmptyString(preview?.assetId) : undefined;
  const issueCount = finiteNumber(planMeta?.issueCount);
  return {
    revision,
    shots: namesOf(plan.shots, "id"),
    actors: namesOf(plan.actors, "id"),
    setPieces: namesOf(asRecord(plan.scene)?.setPieces, "id"),
    issueCount: issueCount !== undefined && issueCount >= 0 ? Math.floor(issueCount) : 0,
    preview: status === "rendering" || status === "ready" || status === "failed" ? status : "none",
    ...(target ? { previewTargetNodeId: target } : {}),
    ...(assetId ? { previewAssetId: assetId } : {}),
  };
}

function projectNode(value: unknown, seen: Set<string>): CanvasReadNode | undefined {
  const node = asRecord(value);
  const id = nonEmptyString(node?.id);
  const kind = nonEmptyString(node?.kind);
  if (!node || !id || !kind || seen.has(id)) return undefined;
  if (!CANVAS_NODE_KINDS.includes(kind as typeof CANVAS_NODE_KINDS[number])) {
    throw Object.assign(new Error("Canvas snapshot contains an unknown node kind"), { code: "unknown_node_kind" });
  }
  seen.add(id);

  const rawPosition = asRecord(node.position);
  const position = {
    x: finiteNumber(rawPosition?.x) ?? 0,
    y: finiteNumber(rawPosition?.y) ?? 0,
  };
  const rawStatus = nonEmptyString(node.status);
  const status = parseGenerationNodeStatus(rawStatus) ?? "idle";
  const currentResultId = resultId(node.result);
  const resultIds = stableResultIds(node);
  const prompt = typeof node.prompt === "string" ? node.prompt : "";
  const runId = nonEmptyString(asRecord(node.meta)?.productionRunId);
  const model = projectNodeModel(asRecord(node.meta));
  const director = kind === "director" ? projectDirectorBox(asRecord(node.meta)) : undefined;

  return {
    id,
    kind,
    title: typeof node.title === "string" ? node.title : "",
    prompt: prompt.length > 8_192 ? `${prompt.slice(0, 8_191)}…` : prompt,
    status,
    position,
    locked: node.locked === true,
    hasResult: asRecord(node.result) !== undefined,
    ...(currentResultId ? { currentResultId } : {}),
    ...(resultIds.length ? { resultIds } : {}),
    ...(runId ? { taskRef: { domain: 'generation' as const, jobId: runId } } : {}),
    ...(model ? { model } : {}),
    ...(director ? { director } : {}),
  };
}

function projectEdges(values: unknown, survivingNodeIds: ReadonlySet<string>): CanvasReadEdge[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const edges: CanvasReadEdge[] = [];
  for (const value of values) {
    const edge = asRecord(value);
    const id = nonEmptyString(edge?.id);
    const source = nonEmptyString(edge?.source);
    const target = nonEmptyString(edge?.target);
    if (!edge || !id || !source || !target || seen.has(id)) continue;
    if (edge.mode !== undefined && !CANVAS_EDGE_MODES.includes(edge.mode as typeof CANVAS_EDGE_MODES[number])) {
      throw Object.assign(new Error("Canvas snapshot contains an unknown edge mode"), { code: "invalid_edge_mode" });
    }
    if (!survivingNodeIds.has(source) || !survivingNodeIds.has(target)) continue;
    seen.add(id);
    const order = edge.order;
    edges.push({
      id,
      source,
      target,
      mode: nonEmptyString(edge.mode) ?? "reference",
      ...(isNonnegativeSafeInteger(order) ? { order } : {}),
    });
  }
  return edges;
}

function survivingReferences(values: unknown, survivingNodeIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const references: string[] = [];
  for (const value of values) {
    const id = nonEmptyString(value);
    if (!id || !survivingNodeIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    references.push(id);
  }
  return references;
}

function projectGroups(values: unknown, survivingNodeIds: ReadonlySet<string>): CanvasReadGroup[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const groups: CanvasReadGroup[] = [];
  for (const value of values) {
    const group = asRecord(value);
    const id = nonEmptyString(group?.id);
    if (!group || !id || seen.has(id)) continue;
    seen.add(id);
    groups.push({
      id,
      name: typeof group.name === "string" ? group.name : "",
      nodeIds: survivingReferences(group.nodeIds, survivingNodeIds),
      collapsed: group.collapsed === true,
    });
  }
  return groups;
}

export function projectCanvasRead(source: unknown): CanvasReadResult {
  const canvas = asRecord(source);
  const truncated = Array.isArray(canvas?.nodes) && canvas.nodes.some((value) => {
    const node = asRecord(value);
    return typeof node?.prompt === "string" && node.prompt.length > 8_192;
  });
  const identityInputs: Array<Parameters<typeof resolveShotIdentities>[0][number]> = [];
  const seenNodeIds = new Set<string>();
  const nodes = (Array.isArray(canvas?.nodes) ? canvas.nodes : []).flatMap((value): CanvasReadNode[] => {
    const node = projectNode(value, seenNodeIds);
    if (!node) return [];
    const raw = asRecord(value)!;
    identityInputs.push({
      id: node.id, kind: node.kind, position: node.position,
      ...(typeof raw.categoryId === "string" ? { categoryId: raw.categoryId } : {}),
      ...(typeof raw.shotIndex === "number" ? { shotIndex: raw.shotIndex } : {}),
      meta: asRecord(raw.meta),
    });
    return [node];
  });
  const survivingNodeIds = new Set(nodes.map((node) => node.id));
  const edges = projectEdges(canvas?.edges, survivingNodeIds);
  const identities = resolveShotIdentities(identityInputs, edges);
  // 读面随画布一起带来的分镜编号源（渲染层 readCanvasReadSource）；没有 = 旧读面 / 外部图，照旧只有全局号。
  const storyboards = storyboardLabelSourceSchema.safeParse(canvas?.storyboards);
  const labelSource = storyboards.success ? storyboards.data : [];
  const metaById = new Map(identityInputs.map((input) => [input.id, input.meta]));

  return canvasReadResultSchema.parse({
    nodes: nodes.map((node) => {
      const identity = identities.get(node.id);
      const label = resolveStoryboardShotLabel({ meta: metaById.get(node.id) }, labelSource);
      if (!label) return { ...node, ...identity };
      const { shotIndex: _internalOrder, ...rest } = identity ?? {};
      return { ...node, ...rest, shotLabel: formatStoryboardShotLabelForAgent(label) };
    }),
    edges,
    groups: projectGroups(canvas?.groups, survivingNodeIds),
    selectedNodeIds: survivingReferences(canvas?.selectedNodeIds, survivingNodeIds),
    ...(truncated ? { truncated: true } : {}),
  });
}

export const CANVAS_READ_CAPABILITY = {
  id: "canvas.read",
  version: 1,
  aliases: {
    pi: "look_at_canvas",
    mcp: "nomi_canvas_read",
    method: "nomi_canvas_read",
  },
  inputSchema: canvasReadSemanticInputSchema,
  outputSchema: canvasReadResultSchema,
  effect: "read",
  effectClass: "reversible_local",
  execution: {
    port: "canvas",
    availability: "main_or_renderer",
  },
  exposure: "mcp_safe",
  requiredScope: "canvas:read",
  targetKind: "project",
} as const satisfies CapabilityContract<CanvasReadInput, CanvasReadResult>;
