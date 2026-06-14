// 文本任务流式 IPC（镜像 agentChatV2Ipc 的 per-session 通道）。
//
// runTask 是请求/响应式（一次性返回 TaskResult），没法推 delta。这里另开一条单向
// 事件通道：handle 立即返回 streamId，逐 token 经 webContents.send 推到渲染层。
// 支持 cancel（AbortController 真中断流，不只是置标志）。
import { ipcMain, webContents as electronWebContents } from "electron";
import type { WebContents } from "electron";
import { runTextTaskStream } from "../textTaskRunner";
import { describeAgentError } from "./agentError";

type TextStreamSession = {
  streamId: string;
  webContentsId: number;
  abortController: AbortController;
};

const textStreamSessions = new Map<string, TextStreamSession>();

function sendTextEvent(session: TextStreamSession, event: unknown): void {
  const target: WebContents | undefined = electronWebContents.fromId(session.webContentsId) || undefined;
  if (!target || target.isDestroyed()) return;
  target.send("nomi:tasks:text:event", { streamId: session.streamId, event });
}

export function registerTextStreamIpc(): void {
  ipcMain.handle("nomi:tasks:text:stream", async (event, payload: Record<string, unknown>) => {
    const streamId = `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: TextStreamSession = {
      streamId,
      webContentsId: event.sender.id,
      abortController: new AbortController(),
    };
    textStreamSessions.set(streamId, session);

    // 异步跑，让 handle 立刻返回 streamId（渲染层先订阅事件再收 delta）。
    queueMicrotask(() => {
      void runTextTaskStream(payload, {
        onDelta: (delta) => sendTextEvent(session, { type: "delta", delta }),
        abortSignal: session.abortController.signal,
      })
        .then((result) => {
          sendTextEvent(session, { type: "done", result });
        })
        .catch((error: unknown) => {
          // 同根因1：透出上游 responseBody 人话，而非裸状态文本。
          const message = describeAgentError(error);
          sendTextEvent(session, { type: "error", message });
        })
        .finally(() => {
          textStreamSessions.delete(streamId);
        });
    });

    return { streamId };
  });

  ipcMain.handle("nomi:tasks:text:cancel", async (_event, payload: { streamId?: string }) => {
    const session = textStreamSessions.get(String(payload?.streamId || ""));
    if (!session) return { ok: false, error: "stream not found" };
    session.abortController.abort();
    return { ok: true };
  });
}
