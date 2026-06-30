import { ipcMain, webContents as electronWebContents } from "electron";
import type { WebContents } from "electron";
import { beginTurnTrace, traceChatEvent, traceGateDenied, traceToolDecision } from "../events/agentChatTrace";

// ---------------------------------------------------------------------------
// Agent chat V2 — real streaming + tool-call confirmation
// ---------------------------------------------------------------------------

type AgentChatV2Session = {
  sessionId: string;
  webContentsId: number;
  pendingConfirmations: Map<string, {
    resolve: (decision: { ok: true; result: unknown } | { ok: false; message: string }) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>;
  cancelled: boolean;
  abortController: AbortController;
};

// 工具确认无限期等用户回话 → 渲染层崩溃/卸载/IPC 事件丢失时，主进程永久 await + session 泄漏。
// 兜底上限：超时自动按「拒绝」收口（与用户 Stop 同出口），让 agent loop 干净退出、Map 清理。
// 设宽松（10 分钟）——只为兜「永远不会来的确认」，正常用户深思熟虑绰绰有余。
const CONFIRM_TIMEOUT_MS = 10 * 60_000;

const agentChatV2Sessions = new Map<string, AgentChatV2Session>();
let agentChatV2ModulePromise: Promise<typeof import("./agentChatV2")> | null = null;

function loadAgentChatV2Module(): Promise<typeof import("./agentChatV2")> {
  agentChatV2ModulePromise ??= import("./agentChatV2");
  return agentChatV2ModulePromise;
}

// 统一取消出口：abort 在途流 + 解开所有挂起确认（清各自超时定时器）。
// 被「cancel IPC」与「渲染层 webContents 销毁」两处复用——后者根治「窗口关了但主进程还在 await」。
function cancelAgentChatV2Session(session: AgentChatV2Session): void {
  session.cancelled = true;
  session.abortController.abort();
  for (const [toolCallId, pending] of session.pendingConfirmations) {
    clearTimeout(pending.timeout);
    pending.resolve({ ok: false, message: "session cancelled" });
    session.pendingConfirmations.delete(toolCallId);
  }
}

function sendChatV2Event(session: AgentChatV2Session, event: unknown): void {
  // 结构化轨迹旁路(S3):先记账再投递;翻译器内部吞掉一切失败,绝不影响对话。
  traceChatEvent(session.sessionId, event);
  const target: WebContents | undefined = electronWebContents.fromId(session.webContentsId) || undefined;
  if (!target || target.isDestroyed()) return;
  target.send("nomi:agents:chatV2:event", { sessionId: session.sessionId, event });
}

export function registerAgentChatV2Ipc(): void {
  ipcMain.handle("nomi:agents:chatV2:start", async (event, payload: Record<string, unknown>) => {
    const sessionId = `chatV2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: AgentChatV2Session = {
      sessionId,
      webContentsId: event.sender.id,
      pendingConfirmations: new Map(),
      cancelled: false,
      abortController: new AbortController(),
    };
    agentChatV2Sessions.set(sessionId, session);
    beginTurnTrace(sessionId, payload);

    // 渲染层（窗口/标签）销毁 → 任何挂起确认永远不会回话。监听 destroyed，按取消收口，
    // 根治「窗口关了主进程还在 await + session 泄漏」整类（确认超时是再下一层兜底）。
    event.sender.once("destroyed", () => {
      const live = agentChatV2Sessions.get(sessionId);
      if (live) cancelAgentChatV2Session(live);
    });

    // Run the agent loop asynchronously so the IPC call can return the
    // sessionId immediately; the renderer subscribes to events first.
    queueMicrotask(() => {
      void (async () => {
        const { runAgentChatV2 } = await loadAgentChatV2Module();
        return runAgentChatV2(payload as Parameters<typeof runAgentChatV2>[0], {
          emit: (evt) => sendChatV2Event(session, evt),
          abortSignal: session.abortController.signal,
          awaitToolConfirmation: ({ toolCallId, toolName, args }) => new Promise((resolve) => {
            if (session.cancelled) {
              resolve({ ok: false, message: "session cancelled" });
              return;
            }
            // 兜底超时：渲染层若永不回话（崩溃/事件丢失），到点自动按拒绝收口并清理。
            const timeout = setTimeout(() => {
              const pending = session.pendingConfirmations.get(toolCallId);
              if (!pending) return;
              session.pendingConfirmations.delete(toolCallId);
              console.error(`[agentv2] 工具确认 ${CONFIRM_TIMEOUT_MS / 60_000} 分钟无响应，自动跳过（${toolName}）`);
              pending.resolve({ ok: false, message: "工具确认超时（长时间无响应，已自动跳过）" });
            }, CONFIRM_TIMEOUT_MS);
            session.pendingConfirmations.set(toolCallId, { resolve, timeout });
            sendChatV2Event(session, {
              type: "tool-call-pending",
              toolCallId,
              toolName,
              args,
            });
          }),
        });
      })()
        .then((result) => {
          sendChatV2Event(session, { type: "result", result });
          sendChatV2Event(session, { type: "done", reason: "finished" });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          sendChatV2Event(session, { type: "error", message });
          sendChatV2Event(session, { type: "done", reason: "error" });
        })
        .finally(() => {
          agentChatV2Sessions.delete(sessionId);
        });
    });

    return { sessionId };
  });

  ipcMain.handle("nomi:agents:chatV2:confirmTool", async (_event, payload: {
    sessionId: string;
    toolCallId: string;
    // S6-0:ok 分支携 effectiveArgs/overridesDelta —— 进 proposal.approved 供对账,result.resolve 不取它。
    // S6-1:ok.silent=只读放行不记 approved;false.denied=gate 拒绝走 gate.denied。
    // S6-2:ok.proposalId —— approved 事件级事务标注,与画布事件/txn.committed 同键 join。
    decision:
      | { ok: true; result?: unknown; effectiveArgs?: Record<string, unknown>; overridesDelta?: Record<string, unknown>; silent?: boolean; proposalId?: string }
      | { ok: false; message?: string; denied?: boolean };
  }) => {
    const session = agentChatV2Sessions.get(payload.sessionId);
    if (!session) return { ok: false, error: "session not found" };
    const pending = session.pendingConfirmations.get(payload.toolCallId);
    if (!pending) return { ok: false, error: "tool call not pending" };
    clearTimeout(pending.timeout);
    session.pendingConfirmations.delete(payload.toolCallId);
    if (payload.decision && payload.decision.ok === true) {
      // 只读 allow 不入日志(§6.1 纯噪声);写操作批准才记对账快照。
      if (!payload.decision.silent) {
        traceToolDecision(payload.sessionId, payload.toolCallId, {
          ok: true,
          effectiveArgs: payload.decision.effectiveArgs,
          overridesDelta: payload.decision.overridesDelta,
          proposalId: payload.decision.proposalId,
        });
      }
      pending.resolve({ ok: true, result: payload.decision.result ?? null });
    } else {
      const message = (payload.decision && (payload.decision as { message?: string }).message) || "rejected by user";
      const denied = Boolean(payload.decision && (payload.decision as { denied?: boolean }).denied);
      // gate 拒绝(锁/校验)≠ 用户拒绝:前者入 gate.denied(人话 reason 回喂 LLM),后者入 proposal.rejected。
      if (denied) traceGateDenied(payload.sessionId, payload.toolCallId, message);
      else traceToolDecision(payload.sessionId, payload.toolCallId, { ok: false, message });
      pending.resolve({ ok: false, message });
    }
    return { ok: true };
  });

  ipcMain.handle("nomi:agents:chatV2:cancel", async (_event, payload: { sessionId: string }) => {
    const session = agentChatV2Sessions.get(payload.sessionId);
    if (!session) return { ok: false, error: "session not found" };
    // 真取消（abort 在途流 + 解开挂起确认并清超时定时器），与渲染层销毁共用同一出口。
    cancelAgentChatV2Session(session);
    return { ok: true };
  });

  // "新对话" — wipe the shared conversation memory for a sessionKey so the next
  // turn starts fresh (no key = wipe all).
  ipcMain.handle("nomi:agents:chatV2:clearSession", async (_event, payload: { sessionKey?: string }) => {
    const { clearAgentChatV2History } = await loadAgentChatV2Module();
    clearAgentChatV2History(payload?.sessionKey);
    return { ok: true };
  });

  // S1b 诚实探针:UI 呈现的"AI 记得的范围"⊆ LLM 实际范围(总方案 §5 不变量)。
  ipcMain.handle("nomi:agents:chatV2:sessionAlive", async (_event, payload: { sessionKey?: string }) => {
    const { hasAgentChatV2History } = await loadAgentChatV2Module();
    return { alive: hasAgentChatV2History(String(payload?.sessionKey || "")) };
  });

  // 会话历史:翻回旧对话时,从该线程气泡重建模型工作缓存,使模型「记起」这段、可无缝接着聊。
  ipcMain.handle(
    "nomi:agents:chatV2:seedSession",
    async (_event, payload: { sessionKey?: string; messages?: Array<{ role?: string; content?: string }> }) => {
      const { seedAgentChatV2History } = await loadAgentChatV2Module();
      seedAgentChatV2History(String(payload?.sessionKey || ""), Array.isArray(payload?.messages) ? payload.messages : []);
      return { ok: true };
    },
  );
}
