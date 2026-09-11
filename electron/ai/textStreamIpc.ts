// 文本任务流式 IPC（per-session 通道，与 Agent 对话 IPC 同形状）。
//
// runTask 是请求/响应式（一次性返回 TaskResult），没法推 delta。这里另开一条单向
// 事件通道：handle 立即返回 streamId，逐 token 经 webContents.send 推到渲染层。
// 支持 cancel（AbortController 真中断流，不只是置标志）。
import { ipcMain, webContents as electronWebContents } from "electron";
import type { WebContents } from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";
type TextStreamSession = {
  streamId: string;
  webContentsId: number;
  abortController: AbortController;
};

const textStreamSessions = new Map<string, TextStreamSession>();
let textTaskRunnerPromise: Promise<typeof import("../textTaskRunner")> | null = null;

function loadTextTaskRunner(): Promise<typeof import("../textTaskRunner")> {
  textTaskRunnerPromise ??= import("../textTaskRunner");
  return textTaskRunnerPromise;
}

function sendTextEvent(session: TextStreamSession, event: unknown): void {
  const target: WebContents | undefined = electronWebContents.fromId(session.webContentsId) || undefined;
  if (!target || target.isDestroyed()) return;
  target.send("nomi:tasks:text:event", { streamId: session.streamId, event });
}

export function registerTextStreamIpc(): void {
  ipcMain.handle("nomi:tasks:text:stream", async (event, payload: Record<string, unknown>) => {
    assertTrustedSender(event);
    const streamId = `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: TextStreamSession = {
      streamId,
      webContentsId: event.sender.id,
      abortController: new AbortController(),
    };
    textStreamSessions.set(streamId, session);

    // once("destroyed") 挂在 sender 上、只在 webContents 销毁时触发；流正常结束后必须
    // 显式解绑，否则监听器与闭包引用的 session/abortController 随会话数累积（MaxListeners 泄漏）。
    const onSenderDestroyed = () => {
      const live = textStreamSessions.get(streamId);
      if (!live) return;
      live.abortController.abort();
      textStreamSessions.delete(streamId);
    };
    event.sender.once("destroyed", onSenderDestroyed);

    // 异步跑，让 handle 立刻返回 streamId（渲染层先订阅事件再收 delta）。
    queueMicrotask(() => {
      void (async () => {
        const { runTextTaskStream } = await loadTextTaskRunner();
        return runTextTaskStream(payload, {
          onDelta: (delta) => sendTextEvent(session, { type: "delta", delta }),
          abortSignal: session.abortController.signal,
        });
      })()
        .then((result) => {
          sendTextEvent(session, { type: "done", result });
        })
        .catch(async (error: unknown) => {
          // 同根因1：透出上游 responseBody 人话，而非裸状态文本。
          // vendorKey 传下去 → 错误带结构化 category 穿到渲染层，文本节点的错误卡不再靠正则猜。
          const { describeAgentError } = await import("./agentError");
          const vendorKey = String((payload as { vendor?: unknown })?.vendor || "").trim();
          const message = describeAgentError(error, { ...(vendorKey ? { vendorKey } : {}) });
          sendTextEvent(session, { type: "error", message });
        })
        .finally(() => {
          textStreamSessions.delete(streamId);
          if (!event.sender.isDestroyed()) event.sender.removeListener("destroyed", onSenderDestroyed);
        });
    });

    return { streamId };
  });

  ipcMain.handle("nomi:tasks:text:cancel", async (event, payload: { streamId?: string }) => {
    assertTrustedSender(event);
    const session = textStreamSessions.get(String(payload?.streamId || ""));
    if (!session) return { ok: false, error: "stream not found" };
    session.abortController.abort();
    return { ok: true };
  });
}
