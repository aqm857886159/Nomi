import { createHash } from "node:crypto";
import type { AgentChatRequest, AgentChatResponse } from "../harness/agentChatContracts";
import type {
  ProjectAgentHostState,
  ProjectAgentItem,
  ProjectAgentTurn,
  ProjectBinding,
  ProjectAgentStatus,
} from "../shared/projectAgentContracts";
import { resolveCapabilityAlias } from "../shared/agentCapabilities/registry";

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

export function statusForResponse(response: AgentChatResponse): ProjectAgentStatus {
  if (response.status === "cancelled") return "stopped";
  if (response.status === "error") return "failed";
  return "done";
}

export function executionPrompt(snapshot: ProjectAgentHostState, turnId: string, request: AgentChatRequest): string {
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

export function toolItem(
  binding: ProjectBinding,
  turn: ProjectAgentTurn,
  record: AgentChatResponse["toolCalls"][number],
  now: string,
): ProjectAgentItem {
  const status = record.status === "ok" ? "done" : record.status === "cancelled" ? "stopped" : "failed";
  const canonicalCapability = resolveCapabilityAlias(record.toolName)?.contract;
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
    status,
    retryable: false,
    deviated: false,
    createdAt: now,
    updatedAt: now,
  });
}
