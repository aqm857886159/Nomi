import type { PreconditionSet, TargetRef } from "../shared/capabilityTargeting";
import type { ProjectBinding } from "../shared/projectBinding";
import { assertProjectAgentBinding, sameProjectAgentBinding } from "./projectAgentIdentity";
import { ProjectAgentStateError } from "./projectAgentStateError";
import {
  asRecord,
  assertAllowedKeys,
  assertCanonicalId,
  assertNonEmpty,
  assertSafeInteger,
  assertStringArray,
} from "./projectAgentStateValidationPrimitives";

export function assertTarget(value: unknown): asserts value is TargetRef {
  const target = asRecord(value);
  switch (target.kind) {
    case "document": {
      assertAllowedKeys(target, ["kind", "documentId", "anchor"]);
      assertNonEmpty(target.documentId);
      const anchor = asRecord(target.anchor);
      switch (anchor.kind) {
        case "whole-document":
          assertAllowedKeys(anchor, ["kind"]);
          break;
        case "range":
          assertAllowedKeys(anchor, ["kind", "from", "to", "selectedTextHash"]);
          assertSafeInteger(anchor.from);
          assertSafeInteger(anchor.to);
          assertNonEmpty(anchor.selectedTextHash);
          break;
        case "cursor":
          assertAllowedKeys(anchor, ["kind", "position", "beforeHash", "afterHash"]);
          assertSafeInteger(anchor.position);
          assertNonEmpty(anchor.beforeHash);
          assertNonEmpty(anchor.afterHash);
          break;
        case "document-end":
          assertAllowedKeys(anchor, ["kind", "trailingTextHash"]);
          assertNonEmpty(anchor.trailingTextHash);
          break;
        default:
          throw new ProjectAgentStateError("invalid_state");
      }
      break;
    }
    case "canvas":
      assertAllowedKeys(target, ["kind", "nodeIds", "groupIds"]);
      assertStringArray(target.nodeIds);
      if (target.groupIds !== undefined) assertStringArray(target.groupIds);
      break;
    case "canvas-result":
      assertAllowedKeys(target, ["kind", "nodeId", "resultId"]);
      assertNonEmpty(target.nodeId);
      assertNonEmpty(target.resultId);
      break;
    case "asset":
      assertAllowedKeys(target, ["kind", "assetIds"]);
      assertStringArray(target.assetIds);
      break;
    case "timeline":
      assertAllowedKeys(target, ["kind", "clipIds"]);
      assertStringArray(target.clipIds);
      break;
    case "export": {
      assertAllowedKeys(target, ["kind", "jobId", "timelineRevision"]);
      const hasJobId = target.jobId !== undefined;
      const hasTimelineRevision = target.timelineRevision !== undefined;
      if (hasJobId === hasTimelineRevision) throw new ProjectAgentStateError("invalid_state");
      if (hasJobId) assertNonEmpty(target.jobId);
      if (hasTimelineRevision) assertNonEmpty(target.timelineRevision);
      break;
    }
    case "artifact":
      assertAllowedKeys(target, ["kind", "runId", "artifactId", "version", "contentHash"]);
      assertNonEmpty(target.runId);
      assertNonEmpty(target.artifactId);
      assertSafeInteger(target.version, 1);
      assertNonEmpty(target.contentHash);
      break;
    case "production":
      assertAllowedKeys(target, ["kind", "runId", "gateId", "jobId"]);
      assertNonEmpty(target.runId);
      if (target.gateId !== undefined) assertNonEmpty(target.gateId);
      if (target.jobId !== undefined) assertNonEmpty(target.jobId);
      break;
    default:
      throw new ProjectAgentStateError("invalid_state");
  }
}

function assertEntityConditions(value: unknown, allowed: readonly string[], idKey: string, hashKey: string): void {
  const record = asRecord(value);
  assertAllowedKeys(record, allowed);
  assertNonEmpty(record[idKey]);
  assertNonEmpty(record[hashKey]);
  if (record.revision !== undefined) assertSafeInteger(record.revision);
}

export function assertPreconditions(value: unknown): asserts value is PreconditionSet {
  const conditions = asRecord(value);
  assertAllowedKeys(conditions, ["document", "nodes", "groups", "edges", "results", "clips", "timeline", "run"]);
  if (conditions.document !== undefined) {
    const document = asRecord(conditions.document);
    assertAllowedKeys(document, ["revision", "contentHash"]);
    assertSafeInteger(document.revision);
    if (document.contentHash !== undefined) assertNonEmpty(document.contentHash);
  }
  const arrays: ReadonlyArray<readonly [string, readonly string[], string, string]> = [
    ["nodes", ["nodeId", "revision", "contentHash"], "nodeId", "contentHash"],
    ["groups", ["groupId", "membershipHash"], "groupId", "membershipHash"],
    ["results", ["nodeId", "resultId", "pointerHash"], "nodeId", "pointerHash"],
    ["clips", ["clipId", "revision", "contentHash"], "clipId", "contentHash"],
  ];
  for (const [key, allowed, idKey, hashKey] of arrays) {
    const collection = conditions[key];
    if (collection === undefined) continue;
    if (!Array.isArray(collection)) throw new ProjectAgentStateError("invalid_state");
    collection.forEach((entry) => assertEntityConditions(entry, allowed, idKey, hashKey));
    if (key === "results") {
      collection.forEach((entry) => assertNonEmpty(asRecord(entry).resultId));
    }
  }
  if (conditions.edges !== undefined) {
    if (!Array.isArray(conditions.edges)) throw new ProjectAgentStateError("invalid_state");
    conditions.edges.forEach((entry) => {
      const edge = asRecord(entry);
      assertAllowedKeys(edge, ["relationHash"]);
      assertNonEmpty(edge.relationHash);
    });
  }
  if (conditions.run !== undefined) {
    const run = asRecord(conditions.run);
    assertAllowedKeys(run, ["runId", "revision"]);
    assertNonEmpty(run.runId);
    assertSafeInteger(run.revision);
  }
  if (conditions.timeline !== undefined) {
    const timeline = asRecord(conditions.timeline);
    assertAllowedKeys(timeline, ["revision"]);
    assertNonEmpty(timeline.revision);
  }
}

export function assertContextRef(value: unknown, binding: ProjectBinding, threadId: string): void {
  const ref = asRecord(value);
  assertAllowedKeys(ref, ["binding", "contextRevision", "recordId"]);
  assertCanonicalId(ref.recordId);
  assertSafeInteger(ref.contextRevision);
  const contextBinding = asRecord(ref.binding);
  assertAllowedKeys(contextBinding, ["project", "threadId", "sessionKey"]);
  assertProjectAgentBinding(contextBinding.project as ProjectBinding);
  if (!sameProjectAgentBinding(contextBinding.project as ProjectBinding, binding)) {
    throw new ProjectAgentStateError("invalid_state");
  }
  assertCanonicalId(contextBinding.threadId);
  if (contextBinding.threadId !== threadId) throw new ProjectAgentStateError("invalid_state");
  const expectedSessionKey = `nomi:project-agent:${binding.immutableProjectUuid}:g${binding.projectGeneration}`;
  if (contextBinding.sessionKey !== expectedSessionKey) {
    throw new ProjectAgentStateError("invalid_state");
  }
}
