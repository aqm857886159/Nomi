import { createHash } from "node:crypto";
import type { AgentChatRequest, AgentChatResponse } from "../harness/agentChatContracts";
import type {
  ProjectAgentHostState,
  ProjectAgentItem,
  ProjectAgentTaskItem,
  ProjectAgentTurn,
  ProjectBinding,
  ProjectAgentStatus,
} from "../shared/projectAgentContracts";
import { resolveCapabilityAlias } from "../shared/agentCapabilities/registry";
import {
  EXPORT_WRITE_ALIASES,
  exportWriteResultSchema,
} from "../shared/agentCapabilities/exportCapabilities";
import { skillReadResultSchema } from "../shared/agentCapabilities/skillRead";
import type { SkillLedgerItem } from "../harness/context/promptPipe";

export function stableJson(value: unknown): string {
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
  return JSON.stringify(String(value));
}

export function digest(value: unknown): string {
  return createHash("sha256")
    .update(`nomi-project-agent-execution:v1\0${stableJson(value)}`)
    .digest("hex");
}

export function hostPromptLedgerForTurn(snapshot: ProjectAgentHostState, threadId: string): SkillLedgerItem[] {
  return snapshot.items.flatMap((item) => item.threadId === threadId && item.kind === "tool" && item.skillLoad
    ? [{ kind: "tool", capability: item.capability, skillLoad: item.skillLoad }]
    : []);
}

export function statusForResponse(response: AgentChatResponse): ProjectAgentStatus {
  if (response.status === "cancelled") return "stopped";
  if (response.status === "error") return "failed";
  return "done";
}

export function executionPrompt(snapshot: ProjectAgentHostState, turnId: string, request: AgentChatRequest): string {
  // Single-shot calls are deliberately ephemeral: direction planning and
  // image judging must never inherit the resident thread's user/assistant
  // transcript. The Host still stores their result item for observability,
  // but that storage is not prompt history. Multi-turn resident capabilities
  // keep the initiating thread context even though the transport envelope is
  // also marked ephemeral by the Host queue boundary.
  if (request.capability === "single-shot") return request.prompt;
  const prior = snapshot.items
    .filter((item) => item.threadId === snapshot.activeThreadId && item.turnId !== turnId)
    .flatMap((item) => {
      if (item.kind === "user") return [`用户：${item.text}`];
      if (item.kind === "assistant") return [`Nomi：${item.text}`];
      return [];
    })
    .join("\n");
  if (!prior) return request.prompt;
  return `此前同一项目线程：\n${prior}\n\n本轮请求：\n${request.prompt}`;
}

/** Fold the user's latest steering instruction into the execution prompt (appended, never rewriting a committed effect). */
export function steeredExecutionPrompt(
  snapshot: ProjectAgentHostState,
  turnId: string,
  request: AgentChatRequest,
  steering: string | undefined,
): string {
  const base = executionPrompt(snapshot, turnId, request);
  return steering ? `${base}\n用户对当前任务的最新修正：${steering}` : base;
}

/** Steerable turn statuses: only an in-flight or pending turn may take a direction change. */
const STEERABLE_STATUSES: readonly ProjectAgentStatus[] = ["queued", "running", "proposed"];

/** Validate a steering instruction and confirm the turn is steerable; returns the normalized instruction. */
export function validateSteering(
  snapshot: ProjectAgentHostState,
  turnId: string,
  instruction: string,
  onInvalid: (message: string) => never,
): string {
  const normalized = instruction.trim();
  if (!normalized || normalized.length > 8_000) onInvalid("Project Agent steering instruction is invalid");
  const turn = snapshot.turns.find((candidate) => candidate.turnId === turnId);
  if (!turn || !STEERABLE_STATUSES.includes(turn.status)) onInvalid("Project Agent turn is not steerable");
  return normalized;
}

/** Whether an interrupt should proceed: the turn exists and is still queued/proposed/running. */
export function turnIsInterruptible(snapshot: ProjectAgentHostState, turnId: string, onMissing: () => never): boolean {
  const turn = snapshot.turns.find((candidate) => candidate.turnId === turnId);
  if (!turn) onMissing();
  return STEERABLE_STATUSES.includes(turn!.status);
}

export function toolItem(
  binding: ProjectBinding,
  turn: ProjectAgentTurn,
  record: AgentChatResponse["toolCalls"][number],
  now: string,
  provenance?: AgentChatResponse["provenance"],
): ProjectAgentItem {
  const status = record.status === "ok" ? "done" : record.status === "cancelled" ? "stopped" : "failed";
  const canonicalCapability = resolveCapabilityAlias(record.toolName)?.contract;
  const skillResult = canonicalCapability?.id === "skill.read" && record.status === "ok"
    ? skillReadResultSchema.safeParse(record.result)
    : { success: false as const };
  return Object.freeze({
    itemId: `tool-${digest([binding, turn.executionToken, record.toolCallId])}`,
    threadId: turn.threadId,
    turnId: turn.turnId,
    kind: "tool" as const,
    toolCallId: record.toolCallId,
    invocationId: `invocation-${digest([turn.executionToken, record.toolCallId])}`,
    capability: canonicalCapability
      ? { id: canonicalCapability.id, version: canonicalCapability.version }
      : { id: record.toolName, version: 1 },
    ...(record.error ? { text: record.error } : {}),
    resultRef: `result-${digest(record.result ?? record.error ?? record.status)}`,
    ...(provenance?.length ? { provenance } : {}),
    ...(skillResult.success ? {
      skillLoad: {
        name: skillResult.data.name,
        packageVersion: skillResult.data.packageVersion,
        contentHash: skillResult.data.contentHash,
      },
    } : {}),
    status,
    retryable: false,
    deviated: false,
    createdAt: now,
    updatedAt: now,
  });
}

export function exportJobTaskItems(
  binding: ProjectBinding,
  turn: ProjectAgentTurn,
  records: AgentChatResponse["toolCalls"],
  existingItems: readonly ProjectAgentItem[],
  now: string,
): ProjectAgentTaskItem[] {
  const knownJobIds = new Set(
    existingItems.flatMap((item) => item.kind === "task" && item.task.kind === "export-job"
      ? [item.task.jobId]
      : []),
  );
  const items: ProjectAgentTaskItem[] = [];
  for (const record of records) {
    if (record.status !== "ok" || record.toolName !== EXPORT_WRITE_ALIASES.start) continue;
    const result = exportWriteResultSchema.safeParse(record.result);
    if (!result.success || result.data.operation !== "export_timeline" || !result.data.accepted) continue;
    const rawJobId = record.result && typeof record.result === "object" && !Array.isArray(record.result)
      ? (record.result as Record<string, unknown>).jobId
      : undefined;
    if (rawJobId !== result.data.jobId || knownJobIds.has(result.data.jobId)) continue;
    knownJobIds.add(result.data.jobId);
    items.push(Object.freeze({
      itemId: `task-${digest([binding, turn.executionToken, "export-job", result.data.jobId])}`,
      threadId: turn.threadId,
      turnId: turn.turnId,
      correlationId: record.toolCallId,
      kind: "task" as const,
      task: Object.freeze({ kind: "export-job" as const, jobId: result.data.jobId }),
      status: "done" as const,
      retryable: false,
      deviated: false,
      createdAt: now,
      updatedAt: now,
    }));
  }
  return items;
}

/** A started ProductionRun is a task projection, never a second Host-owned status ledger. */
export function productionRunTaskItems(
  binding: ProjectBinding,
  turn: ProjectAgentTurn,
  records: AgentChatResponse["toolCalls"],
  existingItems: readonly ProjectAgentItem[],
  now: string,
): ProjectAgentTaskItem[] {
  const knownRunIds = new Set(
    existingItems.flatMap((item) => item.kind === "task" && item.task.kind === "production-run"
      ? [item.task.runId]
      : []),
  );
  const items: ProjectAgentTaskItem[] = [];
  for (const record of records) {
    if (record.status !== "ok" || record.toolName !== "start_production_run") continue;
    if (!record.result || typeof record.result !== "object" || Array.isArray(record.result)) continue;
    const result = record.result as Record<string, unknown>;
    const runId = typeof result.runId === "string" ? result.runId.trim() : "";
    if (!runId || knownRunIds.has(runId)) continue;
    knownRunIds.add(runId);
    const revision = typeof result.revision === "number" && Number.isSafeInteger(result.revision) ? result.revision : undefined;
    const stageId = typeof result.stageId === "string" && result.stageId.trim() ? result.stageId : undefined;
    items.push(Object.freeze({
      itemId: `task-${digest([binding, turn.executionToken, "production-run", runId])}`,
      threadId: turn.threadId,
      turnId: turn.turnId,
      correlationId: record.toolCallId,
      kind: "task" as const,
      task: Object.freeze({
        kind: "production-run" as const,
        runId,
        ...(revision !== undefined ? { expectedRunRevision: revision } : {}),
        ...(stageId ? { stageId } : {}),
      }),
      status: "done" as const,
      retryable: false,
      deviated: false,
      createdAt: now,
      updatedAt: now,
    }));
  }
  return items;
}
