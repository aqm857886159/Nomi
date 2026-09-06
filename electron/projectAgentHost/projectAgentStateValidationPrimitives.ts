import type { ProjectAgentStatus } from "../shared/projectAgentContracts";
import { PROJECT_AGENT_STATUSES } from "../shared/projectAgentContracts";
import { ProjectAgentStateError } from "./projectAgentStateError";

const STATUS_SET = new Set<ProjectAgentStatus>(PROJECT_AGENT_STATUSES);

export function isProjectAgentStatus(value: unknown): value is ProjectAgentStatus {
  return STATUS_SET.has(value as ProjectAgentStatus);
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectAgentStateError("invalid_state");
  }
  return value as Record<string, unknown>;
}

export function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new ProjectAgentStateError("invalid_state");
  }
}

export function assertNonEmpty(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProjectAgentStateError("invalid_state");
  }
}

export function assertCanonicalId(value: unknown): asserts value is string {
  assertNonEmpty(value);
  if (value !== value.trim()) throw new ProjectAgentStateError("invalid_state");
}

export function assertCanonicalTimestamp(value: unknown): asserts value is string {
  assertNonEmpty(value);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new ProjectAgentStateError("invalid_state");
  }
}

export function assertTimestampOrder(earlier: string, later: string): void {
  if (new Date(later).getTime() < new Date(earlier).getTime()) {
    throw new ProjectAgentStateError("invalid_state");
  }
}

export function assertSafeInteger(value: unknown, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new ProjectAgentStateError("invalid_state");
  }
}

export function assertProjectAgentUsage(value: unknown): void {
  const usage = asRecord(value);
  assertAllowedKeys(usage, [
    "promptTokens",
    "completionTokens",
    "cachedPromptTokens",
    "totalTokens",
    "reasoningTokens",
    "costUsd",
  ]);
  for (const key of ["promptTokens", "completionTokens", "cachedPromptTokens", "totalTokens"] as const) {
    assertSafeInteger(usage[key]);
  }
  // The two optional fields are optional because the provider may not report
  // them. Present-but-nonsense is still a corrupt record; absent is legal.
  if (usage.reasoningTokens !== undefined) assertSafeInteger(usage.reasoningTokens);
  if (usage.costUsd !== undefined) {
    if (typeof usage.costUsd !== "number" || !Number.isFinite(usage.costUsd) || usage.costUsd < 0) {
      throw new ProjectAgentStateError("invalid_state");
    }
  }
}

export function assertStringArray(value: unknown): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new ProjectAgentStateError("invalid_state");
  }
}

export function assertVersionRef(value: unknown): void {
  const ref = asRecord(value);
  assertAllowedKeys(ref, ["id", "version"]);
  assertNonEmpty(ref.id);
  if (
    !(
      (typeof ref.version === "string" && ref.version.trim()) ||
      (typeof ref.version === "number" && Number.isFinite(ref.version))
    )
  ) {
    throw new ProjectAgentStateError("invalid_state");
  }
}

export function assertVersionRefs(value: unknown): void {
  if (!Array.isArray(value)) throw new ProjectAgentStateError("invalid_state");
  value.forEach(assertVersionRef);
}

export function assertSkillLoadReference(value: unknown): void {
  const reference = asRecord(value);
  assertAllowedKeys(reference, ["name", "packageVersion", "contentHash"]);
  assertNonEmpty(reference.name);
  assertNonEmpty(reference.packageVersion);
  if (typeof reference.contentHash !== "string" || !/^[a-f0-9]{64}$/iu.test(reference.contentHash)) {
    throw new ProjectAgentStateError("invalid_state");
  }
}

export function assertStatusRecord(value: Record<string, unknown>): void {
  if (!isProjectAgentStatus(value.status)) throw new ProjectAgentStateError("invalid_state");
  if (typeof value.retryable !== "boolean" || typeof value.deviated !== "boolean") {
    throw new ProjectAgentStateError("invalid_state");
  }
}
