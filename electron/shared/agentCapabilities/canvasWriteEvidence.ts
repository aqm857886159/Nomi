import { z } from "zod";

import type { PreconditionSet, TargetRef } from "../capabilityTargeting";
import { synchronousSha256 } from "../synchronousSha256";
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
    groups: z.array(
      z
        .object({
          id: canonicalIdSchema,
          categoryId: canonicalIdSchema,
          nodeIds: z.array(canonicalIdSchema).max(20_000),
        })
        .strict(),
    ).max(16),
  })
  .strict();

export type CanvasWriteRawEvidence = z.infer<typeof canvasWriteRawEvidenceSchema>;

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

export function canvasWriteEvidenceHash(domain: "node" | "result" | "membership", value: unknown): string {
  const text = `nomi-canvas-write:${domain}:v1\0${stableJson(value)}`;
  return `sha256-${synchronousSha256(text)}`;
}

function stale(): never {
  throw new CanvasWriteEvidenceError("capability_target_stale");
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) stale();
}

export function buildCanvasWriteAdmission(value: unknown): CanvasWriteAdmission {
  const parsed = canvasWriteRawEvidenceSchema.safeParse(value);
  if (!parsed.success) throw new CanvasWriteEvidenceError("capability_input_invalid");
  const evidence = parsed.data;
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
