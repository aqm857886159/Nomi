// 对话流事件 → NomiEvent 旁路翻译器(harness S3:结构化轨迹最小版)。
// 挂在 agentChatV2Ipc 的事件出口上:只观察、只追加,任何失败不影响对话主流程。
// 因果链:tool.completed / proposal.approved|rejected 的 causeId 指回 tool.proposed 事件 id。
import crypto from "node:crypto";
import { appendEvents, projectIdFromSessionKey } from "./eventLogRepository";
import type { NewNomiEvent } from "./types";

const TEXT_HEAD = 2048;
const PROMPT_HEAD = 256;

type TurnTrace = {
  projectId: string;
  sessionId: string;
  /** toolCallId → tool.proposed 事件 id(因果链)。 */
  proposedIds: Map<string, string>;
};

const turns = new Map<string, TurnTrace>();

const mintId = () => `evt_${crypto.randomUUID().slice(0, 12)}`;

function head(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  return text.slice(0, max);
}

function append(trace: TurnTrace, event: Omit<NewNomiEvent, "id"> & { id?: string }): string {
  const id = event.id ?? mintId();
  appendEvents(trace.projectId, [{ ...event, id }]);
  return id;
}

/** turn 开始:从 start payload 建 trace(项目不可解析时返回 null,全程 no-op)。 */
export function beginTurnTrace(sessionId: string, payload: Record<string, unknown>): void {
  const projectId = projectIdFromSessionKey(typeof payload.sessionKey === "string" ? payload.sessionKey : undefined);
  if (!projectId) return;
  const trace: TurnTrace = { projectId, sessionId, proposedIds: new Map() };
  turns.set(sessionId, trace);
  append(trace, {
    source: "user",
    type: "agent.turn.started",
    payload: {
      sessionId,
      skillKey: head(payload.skillKey, 128),
      promptHead: head(payload.displayPrompt || payload.prompt, PROMPT_HEAD),
    },
  });
}

/** 对话流事件旁路(挂在 sendChatV2Event 出口)。 */
export function traceChatEvent(sessionId: string, event: unknown): void {
  const trace = turns.get(sessionId);
  if (!trace || !event || typeof event !== "object") return;
  const rec = event as Record<string, unknown>;
  const toolCallId = typeof rec.toolCallId === "string" ? rec.toolCallId : "";
  switch (rec.type) {
    case "tool-call": {
      const id = append(trace, {
        source: "agent",
        type: "agent.tool.proposed",
        payload: { toolCallId, toolName: rec.toolName, args: rec.args },
      });
      if (toolCallId) trace.proposedIds.set(toolCallId, id);
      return;
    }
    case "tool-result":
      append(trace, {
        source: "runtime",
        type: "agent.tool.completed",
        ...(trace.proposedIds.has(toolCallId) ? { causeId: trace.proposedIds.get(toolCallId) } : {}),
        payload: { toolCallId, toolName: rec.toolName, ok: true, resultHead: head(rec.result, TEXT_HEAD) },
      });
      return;
    case "tool-error":
      append(trace, {
        source: "runtime",
        type: "agent.tool.completed",
        ...(trace.proposedIds.has(toolCallId) ? { causeId: trace.proposedIds.get(toolCallId) } : {}),
        payload: { toolCallId, toolName: rec.toolName, ok: false, message: head(rec.message, PROMPT_HEAD) },
      });
      return;
    case "error":
      append(trace, {
        source: "runtime",
        type: "agent.turn.error",
        payload: { sessionId, message: head(rec.message, PROMPT_HEAD) },
      });
      return;
    case "result": {
      const result = (rec.result ?? {}) as Record<string, unknown>;
      const text = typeof result.text === "string" ? result.text : "";
      append(trace, {
        source: "agent",
        type: "agent.turn.finished",
        payload: {
          sessionId,
          status: "ok",
          finalTextHead: text.slice(0, TEXT_HEAD),
          finalTextSha256: crypto.createHash("sha256").update(text).digest("hex"),
          usage: result.usage ?? null,
          finishReason: result.finishReason ?? null,
        },
      });
      return;
    }
    case "done":
      turns.delete(sessionId);
      return;
    default:
      return; // content-delta / step-finish / tool-call-pending:瞬态,不入日志(§4.3)
  }
}

/** 确认门判决旁路(挂在 confirmTool 处理器)。
 *  S6-0:approved 携 effectiveArgs(合并后全量快照,对账逐字段比对的米)+ overridesDelta
 *  (用户改了哪些字段,记忆提炼的最强偏好信号);二者缺省则不写,空对象不进日志。
 *  S6-2:proposalId 落事件级字段(连带 txnId=txn_<proposalId>,与画布事件同键 join)。 */
export function traceToolDecision(
  sessionId: string,
  toolCallId: string,
  decision: { ok: boolean; message?: string; effectiveArgs?: Record<string, unknown>; overridesDelta?: Record<string, unknown>; proposalId?: string },
): void {
  const trace = turns.get(sessionId);
  if (!trace) return;
  append(trace, {
    source: "user",
    type: decision.ok ? "agent.proposal.approved" : "agent.proposal.rejected",
    ...(trace.proposedIds.has(toolCallId) ? { causeId: trace.proposedIds.get(toolCallId) } : {}),
    ...(decision.proposalId ? { proposalId: decision.proposalId, txnId: `txn_${decision.proposalId}` } : {}),
    payload: decision.ok
      ? {
          toolCallId,
          ...(decision.effectiveArgs ? { effectiveArgs: decision.effectiveArgs } : {}),
          ...(decision.overridesDelta ? { overridesDelta: decision.overridesDelta } : {}),
        }
      : { toolCallId, message: decision.message || "rejected by user" },
  });
}

/** gate 拒绝旁路(S6-1):锁/校验判定 deny 时记账。reason 是人话(回喂 LLM 可自我修正,
 *  N14 素材);intent 经 causeId→tool.proposed 反走可还原(toolName+完整 args)。 */
export function traceGateDenied(sessionId: string, toolCallId: string, reason: string): void {
  const trace = turns.get(sessionId);
  if (!trace) return;
  append(trace, {
    source: "system",
    type: "agent.gate.denied",
    ...(trace.proposedIds.has(toolCallId) ? { causeId: trace.proposedIds.get(toolCallId) } : {}),
    payload: { toolCallId, reason },
  });
}

/** context.capped:截断真的发生时记账(C1 触发器观测 + 对话内提示的数据源)。 */
export function traceContextCapped(sessionKey: string, droppedCount: number, keptCount: number): void {
  const projectId = projectIdFromSessionKey(sessionKey);
  if (!projectId || droppedCount <= 0) return;
  appendEvents(projectId, [
    { id: mintId(), source: "system", type: "context.capped", payload: { sessionKey, droppedCount, keptCount } },
  ]);
}
