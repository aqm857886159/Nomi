import { z } from "zod";

import type { PreconditionSet, TargetRef } from "../capabilityTargeting";
import { synchronousSha256 } from "../synchronousSha256";
import type { CanvasWriteInput } from "./canvasWrite";
import { CANVAS_WRITE_MAX_PROMPT_CHARS } from "./canvasWrite";

const canonicalIdSchema = z.string().trim().min(1).max(512);
const optionalCanonicalIdSchema = canonicalIdSchema.nullable();

const canvasWriteModelEvidenceSchema = z
  .object({
    modelKey: optionalCanonicalIdSchema,
    vendorKey: optionalCanonicalIdSchema,
    archetypeId: optionalCanonicalIdSchema,
    modeId: optionalCanonicalIdSchema,
    variantId: optionalCanonicalIdSchema,
  })
  .strict();

const canvasWriteResultPointerEvidenceSchema = z
  .object({
    id: canonicalIdSchema,
    type: canonicalIdSchema,
    taskId: canonicalIdSchema.optional(),
    assetId: canonicalIdSchema.optional(),
    assetRefId: canonicalIdSchema.optional(),
  })
  .strict();

export const canvasWriteRawEvidenceSchema = z
  .object({
    node: z
      .object({
        id: canonicalIdSchema,
        kind: z.string().trim().min(1).max(128),
        title: z.string().max(4_096),
        prompt: z.string().max(CANVAS_WRITE_MAX_PROMPT_CHARS),
        locked: z.boolean(),
        categoryId: optionalCanonicalIdSchema,
        groupId: optionalCanonicalIdSchema,
        model: canvasWriteModelEvidenceSchema,
        currentResult: canvasWriteResultPointerEvidenceSchema.nullable(),
      })
      .strict(),
    groups: z
      .array(
        z
          .object({
            id: canonicalIdSchema,
            categoryId: canonicalIdSchema,
            nodeIds: z.array(canonicalIdSchema).max(20_000),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();

export type CanvasWriteRawEvidence = z.infer<typeof canvasWriteRawEvidenceSchema>;

const canvasWritePositionEvidenceSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const canvasWriteBatchNodeEvidenceSchema = z
  .object({
    id: canonicalIdSchema,
    kind: z.string().trim().min(1).max(128),
    title: z.string().max(4_096),
    prompt: z.string().max(CANVAS_WRITE_MAX_PROMPT_CHARS),
    locked: z.boolean(),
    categoryId: optionalCanonicalIdSchema,
    groupId: optionalCanonicalIdSchema,
    position: canvasWritePositionEvidenceSchema,
    model: canvasWriteModelEvidenceSchema,
    currentResult: canvasWriteResultPointerEvidenceSchema.nullable(),
  })
  .strict();
const canvasWriteBatchEdgeEvidenceSchema = z
  .object({
    id: canonicalIdSchema,
    source: canonicalIdSchema,
    target: canonicalIdSchema,
    mode: z.string().trim().min(1).max(128),
    order: z.number().int().nonnegative().optional(),
  })
  .strict();
export const canvasWriteBatchRawEvidenceSchema = z
  .object({
    nodes: z.array(canvasWriteBatchNodeEvidenceSchema).max(20_000),
    edges: z.array(canvasWriteBatchEdgeEvidenceSchema).max(40_000),
    groups: z
      .array(
        z
          .object({
            id: canonicalIdSchema,
            categoryId: canonicalIdSchema,
            nodeIds: z.array(canonicalIdSchema).max(20_000),
          })
          .strict(),
      )
      .max(16),
    resolvedReferences: z
      .array(
        z
          .object({
            requestedId: canonicalIdSchema,
            nodeId: canonicalIdSchema,
          })
          .strict(),
      )
      .max(96),
  })
  .strict();
export type CanvasWriteBatchRawEvidence = z.infer<typeof canvasWriteBatchRawEvidenceSchema>;

export type CanvasWriteAdmission = Readonly<{
  target: Extract<TargetRef, { kind: "canvas" }>;
  preconditions: PreconditionSet;
}>;

export type CanvasWriteEvidenceErrorCode = "capability_input_invalid" | "capability_target_stale";

export class CanvasWriteEvidenceError extends Error {
  constructor(readonly code: CanvasWriteEvidenceErrorCode) {
    super(code);
    this.name = "CanvasWriteEvidenceError";
  }
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  throw new CanvasWriteEvidenceError("capability_input_invalid");
}

export function canvasWriteEvidenceHash(domain: "node" | "result" | "membership" | "canvas", value: unknown): string {
  const text = `nomi-canvas-write:${domain}:v1\0${stableJson(value)}`;
  return `sha256-${synchronousSha256(text)}`;
}

function stale(): never {
  throw new CanvasWriteEvidenceError("capability_target_stale");
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) stale();
}

/**
 * Every canvas.write operation that names existing nodes must bind those ids
 * into the captured snapshot.  Keeping this mapping in one helper prevents a
 * newly added operation from silently receiving an empty target (the old
 * failure mode for storyboard/staging/camera tools).
 */
function requestedReferenceIds(
  input: Exclude<CanvasWriteInput, { operation: "set_node_prompt" }>,
): string[] {
  switch (input.operation) {
    case "tidy_canvas":
    case "propose_storyboard_plan":
    case "patch_shots":
      return [];
    case "arrange_storyboard_to_timeline":
      return [...input.nodeIds];
    case "create_staging_reference":
    case "create_camera_move":
      return input.shotClientId ? [input.shotClientId] : [];
    case "connect_canvas_edges":
    case "create_canvas_nodes":
      return (input.edges ?? []).flatMap((edge) => [edge.sourceClientId, edge.targetClientId]);
  }
}

export function buildCanvasWriteAdmission(value: unknown): CanvasWriteAdmission {
  const parsed = canvasWriteRawEvidenceSchema.safeParse(value);
  if (!parsed.success) throw new CanvasWriteEvidenceError("capability_input_invalid");
  const evidence = parsed.data;
  if (evidence.node.locked) stale();
  assertUnique(evidence.groups.map((group) => group.id));
  for (const group of evidence.groups) assertUnique(group.nodeIds);

  const containingGroups = evidence.groups.filter((group) => group.nodeIds.includes(evidence.node.id));
  let group: CanvasWriteRawEvidence["groups"][number] | undefined;
  if (evidence.node.groupId === null) {
    if (containingGroups.length > 0) stale();
  } else {
    group = evidence.groups.find((candidate) => candidate.id === evidence.node.groupId);
    if (!group || containingGroups.length !== 1 || containingGroups[0]?.id !== group.id) stale();
  }
  if (group && evidence.node.categoryId !== null && evidence.node.categoryId !== group.categoryId) stale();

  const effectiveCategoryId = group?.categoryId ?? evidence.node.categoryId;
  const membership = Object.freeze({
    nodeId: evidence.node.id,
    groupId: group?.id ?? null,
    categoryId: effectiveCategoryId,
  });
  const nodeContentHash = canvasWriteEvidenceHash("node", {
    id: evidence.node.id,
    kind: evidence.node.kind,
    title: evidence.node.title,
    prompt: evidence.node.prompt,
    locked: evidence.node.locked,
    model: evidence.node.model,
    currentResult: evidence.node.currentResult,
    membership,
  });

  const target = Object.freeze({
    kind: "canvas" as const,
    nodeIds: Object.freeze([evidence.node.id]),
    ...(group ? { groupIds: Object.freeze([group.id]) } : {}),
  });
  const preconditions: PreconditionSet = Object.freeze({
    nodes: Object.freeze([Object.freeze({ nodeId: evidence.node.id, contentHash: nodeContentHash })]),
    ...(group
      ? {
          groups: Object.freeze([
            Object.freeze({
              groupId: group.id,
              membershipHash: canvasWriteEvidenceHash("membership", membership),
            }),
          ]),
        }
      : {}),
    ...(evidence.node.currentResult
      ? {
          results: Object.freeze([
            Object.freeze({
              nodeId: evidence.node.id,
              resultId: evidence.node.currentResult.id,
              pointerHash: canvasWriteEvidenceHash("result", evidence.node.currentResult),
            }),
          ]),
        }
      : {}),
  });
  return Object.freeze({ target, preconditions });
}

function buildBatchCanvasWriteAdmission(
  value: unknown,
  input: Exclude<CanvasWriteInput, { operation: "set_node_prompt" }>,
): CanvasWriteAdmission {
  const parsed = canvasWriteBatchRawEvidenceSchema.safeParse(value);
  if (!parsed.success) throw new CanvasWriteEvidenceError("capability_input_invalid");
  const evidence = parsed.data;
  assertUnique(evidence.nodes.map((node) => node.id));
  assertUnique(evidence.edges.map((edge) => edge.id));
  assertUnique(evidence.groups.map((group) => group.id));
  const nodeIds = new Set(evidence.nodes.map((node) => node.id));
  for (const edge of evidence.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) stale();
  }
  for (const group of evidence.groups) {
    assertUnique(group.nodeIds);
    if (group.nodeIds.some((nodeId) => !nodeIds.has(nodeId))) stale();
  }
  assertUnique(evidence.resolvedReferences.map((reference) => reference.requestedId));
  const resolved = new Map(evidence.resolvedReferences.map((reference) => [reference.requestedId, reference.nodeId]));
  if (evidence.resolvedReferences.some((reference) => !nodeIds.has(reference.nodeId))) stale();
  if (input.operation === "tidy_canvas" && input.categoryId) {
    if (!evidence.groups.every((group) => group.categoryId.trim())) stale();
  }
  const relationHash = canvasWriteEvidenceHash("canvas", {
    nodes: evidence.nodes,
    edges: evidence.edges,
    groups: evidence.groups,
    resolvedReferences: evidence.resolvedReferences,
  });
  const inputReferenceIds = requestedReferenceIds(input);
  const targetNodeIds =
    input.operation === "tidy_canvas"
      ? evidence.nodes
          .filter((node) => (node.categoryId ?? "shots") === (input.categoryId ?? "shots"))
          .map((node) => node.id)
      : Array.from(new Set(inputReferenceIds.map((id) => resolved.get(id)).filter((id): id is string => Boolean(id))));
  const targetIdSet = new Set(targetNodeIds);
  if (input.operation === "tidy_canvas" && evidence.nodes.some((node) => targetIdSet.has(node.id) && node.locked))
    stale();
  if (
    input.operation === "connect_canvas_edges" ||
    input.operation === "create_canvas_nodes" ||
    input.operation === "arrange_storyboard_to_timeline" ||
    input.operation === "create_staging_reference" ||
    input.operation === "create_camera_move"
  ) {
    const lockedTargets = new Set(
      inputReferenceIds.map((id) => resolved.get(id)).filter((id): id is string => Boolean(id)),
    );
    if (evidence.nodes.some((node) => lockedTargets.has(node.id) && node.locked)) stale();
  }
  const target = Object.freeze({ kind: "canvas" as const, nodeIds: Object.freeze(targetNodeIds) });
  const preconditions: PreconditionSet = Object.freeze({
    edges: Object.freeze([Object.freeze({ relationHash })]),
  });
  return Object.freeze({ target, preconditions });
}

export function buildCanvasWriteAdmissionForOperation(value: unknown, input: CanvasWriteInput): CanvasWriteAdmission {
  return input.operation === "set_node_prompt"
    ? buildCanvasWriteAdmission(value)
    : buildBatchCanvasWriteAdmission(value, input);
}

export function assertCanvasWriteAdmissionMatches(
  value: unknown,
  expected: Readonly<{ target: unknown; preconditions: unknown }>,
  input?: CanvasWriteInput,
): CanvasWriteAdmission {
  const admission = input ? buildCanvasWriteAdmissionForOperation(value, input) : buildCanvasWriteAdmission(value);
  if (
    stableJson(admission.target) !== stableJson(expected.target) ||
    stableJson(admission.preconditions) !== stableJson(expected.preconditions)
  ) {
    stale();
  }
  return admission;
}
