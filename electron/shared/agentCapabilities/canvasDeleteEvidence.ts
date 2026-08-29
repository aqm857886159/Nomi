import type { PreconditionSet, TargetRef } from "../capabilityTargeting";
import type { CanvasDeleteInput } from "./canvasDelete";
import {
  canvasWriteBatchRawEvidenceSchema,
  canvasWriteEvidenceHash,
  CanvasWriteEvidenceError,
  type CanvasWriteBatchRawEvidence,
} from "./canvasWriteEvidence";

export type CanvasDeleteAdmission = Readonly<{
  target: Extract<TargetRef, { kind: "canvas" }>;
  preconditions: PreconditionSet;
}>;

function stale(): never {
  throw new CanvasWriteEvidenceError("capability_target_stale");
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) stale();
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

export function buildCanvasDeleteAdmission(value: unknown, input: CanvasDeleteInput): CanvasDeleteAdmission {
  const parsed = canvasWriteBatchRawEvidenceSchema.safeParse(value);
  if (!parsed.success) throw new CanvasWriteEvidenceError("capability_input_invalid");
  const evidence = parsed.data;
  assertUnique(evidence.nodes.map((node) => node.id));
  assertUnique(evidence.edges.map((edge) => edge.id));
  assertUnique(evidence.groups.map((group) => group.id));
  assertUnique(evidence.resolvedReferences.map((reference) => reference.requestedId));
  if (
    evidence.resolvedReferences.length !== input.nodeIds.length ||
    input.nodeIds.some((requestedId) => !evidence.resolvedReferences.some((item) => item.requestedId === requestedId))
  ) {
    stale();
  }

  const nodeById = new Map(evidence.nodes.map((node) => [node.id, node]));
  const resolved = new Map(evidence.resolvedReferences.map((reference) => [reference.requestedId, reference.nodeId]));
  const targetNodes = input.nodeIds.map((requestedId) => nodeById.get(resolved.get(requestedId) ?? ""));
  if (targetNodes.some((node) => !node || node.locked)) stale();
  const nodes = targetNodes as CanvasWriteBatchRawEvidence["nodes"];
  assertUnique(nodes.map((node) => node.id));

  const allNodeIds = new Set(evidence.nodes.map((node) => node.id));
  for (const edge of evidence.edges) {
    if (!allNodeIds.has(edge.source) || !allNodeIds.has(edge.target)) stale();
  }
  for (const group of evidence.groups) {
    assertUnique(group.nodeIds);
    if (group.nodeIds.some((nodeId) => !allNodeIds.has(nodeId))) stale();
  }
  for (const node of evidence.nodes) {
    const containingGroups = evidence.groups.filter((group) => group.nodeIds.includes(node.id));
    if (node.groupId === null && containingGroups.length > 0) stale();
    if (
      node.groupId !== null &&
      (containingGroups.length !== 1 || containingGroups[0]?.id !== node.groupId)
    ) {
      stale();
    }
  }

  const targetGroupIds = Array.from(new Set(nodes.flatMap((node) => (node.groupId ? [node.groupId] : []))));
  const targetGroups = targetGroupIds.map((groupId) => evidence.groups.find((group) => group.id === groupId));
  if (targetGroups.some((group) => !group)) stale();

  const target = Object.freeze({
    kind: "canvas" as const,
    nodeIds: Object.freeze(nodes.map((node) => node.id)),
    ...(targetGroupIds.length ? { groupIds: Object.freeze(targetGroupIds) } : {}),
  });
  const preconditions: PreconditionSet = Object.freeze({
    nodes: Object.freeze(
      nodes.map((node) =>
        Object.freeze({
          nodeId: node.id,
          contentHash: canvasWriteEvidenceHash("node", node),
        }),
      ),
    ),
    ...(targetGroups.length
      ? {
          groups: Object.freeze(
            targetGroups.map((group) =>
              Object.freeze({
                groupId: group!.id,
                membershipHash: canvasWriteEvidenceHash("membership", group),
              }),
            ),
          ),
        }
      : {}),
    edges: Object.freeze([
      Object.freeze({
        relationHash: canvasWriteEvidenceHash("canvas", {
          edges: evidence.edges,
          groups: evidence.groups,
        }),
      }),
    ]),
    ...(nodes.some((node) => node.currentResult)
      ? {
          results: Object.freeze(
            nodes.flatMap((node) =>
              node.currentResult
                ? [
                    Object.freeze({
                      nodeId: node.id,
                      resultId: node.currentResult.id,
                      pointerHash: canvasWriteEvidenceHash("result", node.currentResult),
                    }),
                  ]
                : [],
            ),
          ),
        }
      : {}),
  });
  return Object.freeze({ target, preconditions });
}

export function assertCanvasDeleteAdmissionMatches(
  value: unknown,
  input: CanvasDeleteInput,
  expected: Readonly<{ target: unknown; preconditions: unknown }>,
): CanvasDeleteAdmission {
  const admission = buildCanvasDeleteAdmission(value, input);
  if (
    stableJson(admission.target) !== stableJson(expected.target) ||
    stableJson(admission.preconditions) !== stableJson(expected.preconditions)
  ) {
    stale();
  }
  return admission;
}
