import { ipcMain } from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";
import { runTaskWithIdempotency } from "../submissionLedger";
import { mintSpendGrant } from "../spendGrant";
import { runTaskIpcGuard } from "./taskIpcGuard";

type RuntimeLoader = () => Promise<typeof import("../runtime")>;

/** Register the renderer task boundary, including the spend-grant trust check. */
export function registerTaskIpcHandlers(loadRuntimeModule: RuntimeLoader): void {
  // 付费守卫铸令牌：仅由渲染层「真人确认」事件链调用（务实纵深：铸造面小而审计过 + 主进程硬闸兜底）。
  ipcMain.handle("nomi:tasks:grant-spend", (event, payload) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as { nodeIds?: unknown; maxAttemptsPerNode?: unknown };
    const nodeIds = Array.isArray(raw.nodeIds) ? raw.nodeIds.map((id) => String(id)) : [];
    const maxAttemptsPerNode = typeof raw.maxAttemptsPerNode === "number" ? raw.maxAttemptsPerNode : undefined;
    return { grantId: mintSpendGrant({ nodeIds, ...(maxAttemptsPerNode ? { maxAttemptsPerNode } : {}) }) };
  });

  // 提交幂等包在 IPC 边界：渲染层每次提交（含控制器重试）都经此，同 idempotencyKey 的提交内核 at-most-once。
  ipcMain.handle("nomi:tasks:run", (event, payload) => {
    assertTrustedSender(event);
    return runTaskIpcGuard(payload, async () => {
      const { runTask } = await loadRuntimeModule();
      return runTaskWithIdempotency(payload, () => runTask(payload));
    });
  });

  ipcMain.handle("nomi:tasks:result", (event, payload) => {
    assertTrustedSender(event);
    return runTaskIpcGuard(payload, async () => {
      const { fetchTaskResult } = await loadRuntimeModule();
      return fetchTaskResult(payload);
    });
  });
}
