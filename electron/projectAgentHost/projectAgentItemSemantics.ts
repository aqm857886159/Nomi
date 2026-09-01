import type { ProjectAgentItem } from "../shared/projectAgentContracts";
import { ProjectAgentReducerError } from "./projectAgentReducerContract";
import { stableProjectAgentJson } from "./projectAgentSnapshot";
import {
  hasDuplicateProjectAgentArtifactIdentity,
  hasDuplicateProjectAgentToolIdentity,
} from "./projectAgentSemanticIdentity";

function fail(code: "foreign_domain_state" | "invalid_mutation" | "record_exists"): never {
  throw new ProjectAgentReducerError(code);
}

function assertRefOnlyItem(item: ProjectAgentItem): void {
  if (item.kind === "task") {
    const allowed = new Set(["kind", "runId", "expectedRunRevision", "stageId", "jobId", "shotId"]);
    if (Object.keys(item.task as unknown as Record<string, unknown>).some((key) => !allowed.has(key))) {
      fail("foreign_domain_state");
    }
    if (item.status !== "done" || item.retryable || item.deviated) fail("foreign_domain_state");
  }
  if (item.kind === "proposal" && item.humanApproval) {
    const allowed = new Set(["challengeId", "handoffId", "binding", "runId", "gateId", "contractHash"]);
    if (Object.keys(item.humanApproval as unknown as Record<string, unknown>).some((key) => !allowed.has(key))) {
      fail("foreign_domain_state");
    }
    if (item.status !== "done" || item.retryable || item.deviated) {
      fail("foreign_domain_state");
    }
  }
}

export function assertCanAppendProjectAgentItem(
  existingItems: readonly ProjectAgentItem[],
  item: ProjectAgentItem,
  allowLocalProposal: boolean,
  allowAsyncToolResult = false,
): void {
  if (existingItems.some((value) => value.itemId === item.itemId)) fail("record_exists");
  assertRefOnlyItem(item);
  if (item.kind === "user" && existingItems.some((value) => value.kind === "user" && value.turnId === item.turnId)) {
    fail("record_exists");
  }
  if (item.kind === "assistant") fail("invalid_mutation");
  if (item.kind === "tool") {
    if (!allowAsyncToolResult) fail("invalid_mutation");
    if (hasDuplicateProjectAgentToolIdentity([...existingItems, item])) {
      fail("record_exists");
    }
  }
  if (item.kind === "artifact" && hasDuplicateProjectAgentArtifactIdentity([...existingItems, item])) {
    fail("record_exists");
  }
  if (item.kind === "proposal" && item.approval && !allowLocalProposal) {
    fail("invalid_mutation");
  }
  if (
    item.kind === "proposal" &&
    item.approval &&
    existingItems.some((value) => value.kind === "proposal" && value.approval?.approvalId === item.approval?.approvalId)
  ) {
    fail("record_exists");
  }
  if (
    item.kind === "task" &&
    existingItems.some(
      (value) => value.kind === "task" && stableProjectAgentJson(value.task) === stableProjectAgentJson(item.task),
    )
  ) {
    fail("record_exists");
  }
  if (
    item.kind === "proposal" &&
    item.humanApproval &&
    existingItems.some(
      (value) =>
        value.kind === "proposal" &&
        value.humanApproval?.challengeId === item.humanApproval?.challengeId &&
        value.humanApproval?.handoffId === item.humanApproval?.handoffId,
    )
  ) {
    fail("record_exists");
  }
}
