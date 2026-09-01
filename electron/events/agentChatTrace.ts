// 对话流事件 → NomiEvent 旁路翻译器(harness S3:结构化轨迹最小版)。
// 挂在 agentChatV2Ipc 的事件出口上:只观察、只追加,任何失败不影响对话主流程。
// 因果链:tool.completed / proposal.approved|rejected 的 causeId 指回 tool.proposed 事件 id。
import crypto from "node:crypto";
import { appendEvents, projectIdFromSessionKey } from "./eventLogRepository";
import type { NewNomiEvent } from "./types";
import { getExperienceRepository } from "../experience/experienceRepository";
import type { ExperienceTrajectory } from "../experience/experienceTypes";

const TEXT_HEAD = 2048;
const PROMPT_HEAD = 256;

type TurnTrace = {
  projectId: string;
  sessionId: string;
  threadId?: string;
  area?: "creation" | "generation";
  prompt: string;
  response: string;
  observedEvents: ExperienceTrajectory["events"];
  /** toolCallId → tool.proposed 事件 id(因果链)。 */
  proposedIds: Map<string, string>;
  completed: boolean;
};

const turns = new Map<string, TurnTrace>();

type ExperienceCompletionHandler = (trajectory: ExperienceTrajectory) => void | Promise<void>;
const defaultExperienceCompletionHandler: ExperienceCompletionHandler = (trajectory) => {
  void getExperienceRepository().complete(trajectory).catch((error: unknown) => {
    console.warn("[experience] completion projection unavailable", error);
  });
};
let experienceCompletionHandler: ExperienceCompletionHandler = defaultExperienceCompletionHandler;

export function setExperienceCompletionHandlerForTests(handler: ExperienceCompletionHandler | null): void {
  experienceCompletionHandler = handler ?? defaultExperienceCompletionHandler;
}

const mintId = () => `evt_${crypto.randomUUID().slice(0, 12)}`;

function head(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  return text.slice(0, max);
}

function append(trace: TurnTrace, event: Omit<NewNomiEvent, "id"> & { id?: string }): string {
  const id = event.id ?? mintId();
  const written = appendEvents(trace.projectId, [{ ...event, id }]);
  const payload = event.payload || {};
  const encoded = JSON.stringify(payload);
  trace.observedEvents.push({
    type: event.type,
    ...(written[0]?.seq ? { seq: written[0].seq } : {}),
    ...(encoded.length <= 2000 ? { payload } : { payload: { summary: encoded.slice(0, 2000) } }),
  });
  return id;
}

function completeTrace(trace: TurnTrace): void {
  if (trace.completed) return;
  trace.completed = true;
  const trajectory: ExperienceTrajectory = {
    trajectoryId: `traj_${trace.sessionId}`,
    projectId: trace.projectId,
    sessionId: trace.sessionId,
    ...(trace.threadId ? { threadId: trace.threadId } : {}),
    ...(trace.area ? { area: trace.area } : {}),
    prompt: trace.prompt,
    response: trace.response,
    events: trace.observedEvents,
    completedAt: new Date().toISOString(),
  };
  try {
    void Promise.resolve(experienceCompletionHandler(trajectory)).catch((error: unknown) => {
      console.warn("[experience] completion handler unavailable", error);
    });
  } catch (error) {
    console.warn("[experience] completion handler unavailable", error);
  }
}

/** turn 开始:从 start payload 建 trace(项目不可解析时返回 null,全程 no-op)。 */
export function beginTurnTrace(sessionId: string, payload: Record<string, unknown>): void {
  const history = payload.history as { kind?: string; binding?: { sessionKey?: string; threadId?: string } } | undefined;
  const binding = history?.kind === 'persistent' ? history.binding : undefined;
  const projectId = projectIdFromSessionKey(binding?.sessionKey)
    || (typeof payload.projectId === 'string' ? payload.projectId : typeof payload.canvasProjectId === 'string' ? payload.canvasProjectId : null);
  if (!projectId) return;
  const trace: TurnTrace = {
    projectId,
    sessionId,
    ...(binding?.threadId ? { threadId: binding.threadId } : {}),
    ...(binding?.sessionKey?.endsWith(":creation") ? { area: "creation" as const } : binding?.sessionKey?.endsWith(":generation") ? { area: "generation" as const } : {}),
    prompt: head(payload.displayPrompt || payload.prompt, TEXT_HEAD),
    response: "",
    observedEvents: [],
    proposedIds: new Map(),
    completed: false,
  };
  turns.set(sessionId, trace);
  append(trace, {
    source: "user",
    type: "agent.turn.started",
    payload: {
      sessionId,
      ...(binding ? { sessionKey: binding.sessionKey, threadId: binding.threadId } : {}),
      ...(typeof payload.featureKey === 'string' ? { featureKey: payload.featureKey } : {}),
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
      trace.response = text.slice(0, TEXT_HEAD);
      append(trace, {
        source: "agent",
        type: "agent.turn.finished",
        payload: {
          sessionId,
          status: result.status,
          finalTextHead: text.slice(0, TEXT_HEAD),
          finalTextSha256: crypto.createHash("sha256").update(text).digest("hex"),
          usage: result.usage ?? null,
          finishReason: result.finishReason ?? null,
        },
      });
      completeTrace(trace);
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
