import { z } from "zod";
import { generationNodeStatusSchema, parseGenerationNodeStatus } from "../canvas/generationNodeStatus";
import type { CapabilityContract } from "./capabilityContract";

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
  "text", "character", "scene", "image", "keyframe", "video", "audio", "clip", "shot", "output", "panorama",
  "scene3d", "whiteboard", "model3d", "asset",
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
    shotIndex: nonnegativeSafeIntegerSchema.optional(),
    hasResult: z.boolean(),
    currentResultId: opaqueResultIdSchema.optional(),
    resultIds: z.array(opaqueResultIdSchema).optional(),
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
  const shotIndex = node.shotIndex;
  const currentResultId = resultId(node.result);
  const resultIds = stableResultIds(node);
  const prompt = typeof node.prompt === "string" ? node.prompt : "";

  return {
    id,
    kind,
    title: typeof node.title === "string" ? node.title : "",
    prompt: prompt.length > 8_192 ? `${prompt.slice(0, 8_191)}…` : prompt,
    status,
    position,
    locked: node.locked === true,
    ...(isNonnegativeSafeInteger(shotIndex) ? { shotIndex } : {}),
    hasResult: asRecord(node.result) !== undefined,
    ...(currentResultId ? { currentResultId } : {}),
    ...(resultIds.length ? { resultIds } : {}),
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
  const seenNodeIds = new Set<string>();
  const nodes = (Array.isArray(canvas?.nodes) ? canvas.nodes : []).flatMap((value): CanvasReadNode[] => {
    const node = projectNode(value, seenNodeIds);
    return node ? [node] : [];
  });
  const survivingNodeIds = new Set(nodes.map((node) => node.id));

  return canvasReadResultSchema.parse({
    nodes,
    edges: projectEdges(canvas?.edges, survivingNodeIds),
    groups: projectGroups(canvas?.groups, survivingNodeIds),
    selectedNodeIds: survivingReferences(canvas?.selectedNodeIds, survivingNodeIds),
    ...(truncated ? { truncated: true } : {}),
  });
}

export const CANVAS_READ_CAPABILITY = {
  id: "canvas.read",
  version: 1,
  aliases: {
    pi: "read_canvas_state",
    mcp: "nomi_canvas_read",
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
  projections: {
    pi: {
      description: "Read the current generation canvas (nodes + edges).",
    },
    mcp: {
      description: "Read the project canvas as compact nodes and edges.",
    },
  },
} as const satisfies CapabilityContract<CanvasReadInput, CanvasReadResult>;
