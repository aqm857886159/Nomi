import crypto from "node:crypto";

import type { ProjectAgentMutation } from "../shared/projectAgentContracts";
import { PROJECT_AGENT_MUTATION_TYPES } from "../shared/projectAgentContracts";
import { assertProjectAgentBinding } from "./projectAgentIdentity";
import { ProjectAgentReducerError } from "./projectAgentReducerContract";
import { stableProjectAgentJson } from "./projectAgentSnapshot";

function invalid(): never {
  throw new ProjectAgentReducerError("invalid_mutation");
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

export function isCanonicalProjectAgentId(value: unknown): value is string {
  return nonEmpty(value) && value === value.trim();
}

export function assertCanonicalMutationTimestamp(value: unknown): asserts value is string {
  if (!nonEmpty(value)) invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid();
}

export function assertOptionalMutationBoolean(value: unknown): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") invalid();
}

export function assertExactMutationKeys(value: unknown, allowed: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) invalid();
}

export function assertProjectAgentMutationEnvelope(mutation: ProjectAgentMutation): void {
  assertExactMutationKeys(mutation, ["commandId", "expectedRevision", "binding", "sender", "type", "payload"]);
  assertExactMutationKeys(mutation.binding, ["projectId", "immutableProjectUuid", "projectGeneration"]);
  assertExactMutationKeys(mutation.sender, ["kind", "senderId"]);
  if (
    !isCanonicalProjectAgentId(mutation.commandId) ||
    !Number.isSafeInteger(mutation.expectedRevision) ||
    mutation.expectedRevision < 0 ||
    !mutation.sender ||
    !["renderer", "embedded-agent", "internal"].includes(mutation.sender.kind) ||
    !isCanonicalProjectAgentId(mutation.sender.senderId) ||
    !PROJECT_AGENT_MUTATION_TYPES.includes(mutation.type as (typeof PROJECT_AGENT_MUTATION_TYPES)[number])
  ) {
    invalid();
  }
  try {
    assertProjectAgentBinding(mutation.binding);
  } catch {
    invalid();
  }
}

export function hashProjectAgentMutation(mutation: ProjectAgentMutation): string {
  return crypto
    .createHash("sha256")
    .update("nomi-project-agent-mutation:v1\0")
    .update(stableProjectAgentJson(mutation))
    .digest("hex");
}
