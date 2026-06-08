import { ipcMain, webContents as electronWebContents } from "electron";
import type { WebContents } from "electron";
import { clearAgentChatV2History, runAgentChatV2 } from "./agentChatV2";

// ---------------------------------------------------------------------------
// Agent chat V2 — real streaming + tool-call confirmation
// ---------------------------------------------------------------------------

type AgentChatV2Session = {
  sessionId: string;
  webContentsId: number;
  pendingConfirmations: Map<string, {
    resolve: (decision: { ok: true; result: unknown } | { ok: false; message: string }) => void;
  }>;
  cancelled: boolean;
  abortController: AbortController;
};

const agentChatV2Sessions = new Map<string, AgentChatV2Session>();

function sendChatV2Event(session: AgentChatV2Session, event: unknown): void {
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

    // Run the agent loop asynchronously so the IPC call can return the
    // sessionId immediately; the renderer subscribes to events first.
    queueMicrotask(() => {
      void runAgentChatV2(payload as Parameters<typeof runAgentChatV2>[0], {
        emit: (evt) => sendChatV2Event(session, evt),
        abortSignal: session.abortController.signal,
        awaitToolConfirmation: ({ toolCallId, toolName, args }) => new Promise((resolve) => {
          if (session.cancelled) {
            resolve({ ok: false, message: "session cancelled" });
            return;
          }
          session.pendingConfirmations.set(toolCallId, { resolve });
          sendChatV2Event(session, {
            type: "tool-call-pending",
            toolCallId,
            toolName,
            args,
          });
        }),
      })
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
    decision: { ok: true; result?: unknown } | { ok: false; message?: string };
  }) => {
    const session = agentChatV2Sessions.get(payload.sessionId);
    if (!session) return { ok: false, error: "session not found" };
    const pending = session.pendingConfirmations.get(payload.toolCallId);
    if (!pending) return { ok: false, error: "tool call not pending" };
    session.pendingConfirmations.delete(payload.toolCallId);
    if (payload.decision && payload.decision.ok === true) {
      pending.resolve({ ok: true, result: payload.decision.result ?? null });
    } else {
      const message = (payload.decision && (payload.decision as { message?: string }).message) || "rejected by user";
      pending.resolve({ ok: false, message });
    }
    return { ok: true };
  });

  ipcMain.handle("nomi:agents:chatV2:cancel", async (_event, payload: { sessionId: string }) => {
    const session = agentChatV2Sessions.get(payload.sessionId);
    if (!session) return { ok: false, error: "session not found" };
    session.cancelled = true;
    // Abort the in-flight stream (real cancel, not just flag) + reject pending
    // confirmations so the agent loop exits even mid-stream.
    session.abortController.abort();
    for (const [toolCallId, pending] of session.pendingConfirmations) {
      pending.resolve({ ok: false, message: "session cancelled" });
      session.pendingConfirmations.delete(toolCallId);
    }
    return { ok: true };
  });

  // "新对话" — wipe the shared conversation memory for a sessionKey so the next
  // turn starts fresh (no key = wipe all).
  ipcMain.handle("nomi:agents:chatV2:clearSession", async (_event, payload: { sessionKey?: string }) => {
    clearAgentChatV2History(payload?.sessionKey);
    return { ok: true };
  });
}
