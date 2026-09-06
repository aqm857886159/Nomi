import { app, ipcMain } from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";
import { runTaskWithIdempotency } from "../submissionLedger";
import { mintSpendGrant } from "../spendGrant";
import { runTaskIpcGuard } from "./taskIpcGuard";
import { withTaskOwner } from "./localTaskJobs";
import { antigravityImageJobs } from "../catalog/antigravityImageOperation";
import { cancelComfyCandidateTest, failComfyCandidateEnvelope, runComfyCandidateTest } from "./comfyCandidateTest";

type RuntimeLoader = () => Promise<typeof import("../runtime")>;

/** Register the renderer task boundary, including the spend-grant trust check. */
export function registerTaskIpcHandlers(loadRuntimeModule: RuntimeLoader): void {
  const owners = new Set<number>();
  let exiting = false;
  let drained = false;
  app.on("before-quit", (event) => {
    if (drained) return;
    event.preventDefault();
    if (exiting) return;
    exiting = true;
    void antigravityImageJobs.cancelAll().finally(() => { drained = true; app.quit(); });
  });
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
    if (!owners.has(event.sender.id)) {
      const owner = event.sender.id; owners.add(owner);
      event.sender.once("destroyed", () => { owners.delete(owner); void antigravityImageJobs.cancelOwner(owner); });
    }
    return runTaskIpcGuard(payload, async () => {
      const { runTask } = await loadRuntimeModule();
      return withTaskOwner(event.sender.id, () => runTaskWithIdempotency(payload, () => runTask(payload)));
    });
  });

  ipcMain.handle("nomi:tasks:result", (event, payload) => {
    assertTrustedSender(event);
    return runTaskIpcGuard(payload, async () => {
      const { fetchTaskResult } = await loadRuntimeModule();
      return withTaskOwner(event.sender.id, () => fetchTaskResult(payload));
    });
  });
  ipcMain.handle("nomi:tasks:comfy-candidate-test", async (event, payload) => {
    assertTrustedSender(event);
    let ownerDestroyed = false;
    const envelope = (payload as { candidate?: unknown })?.candidate;
    const onDestroyed = () => {
      ownerDestroyed = true;
      cancelComfyCandidateTest(envelope);
      failComfyCandidateEnvelope(payload, "candidate_cancelled");
    };
    event.sender.once("destroyed", onDestroyed);
    try {
      return await runTaskIpcGuard(payload, async () => {
        const { runTask, fetchTaskResult } = await loadRuntimeModule();
        if (ownerDestroyed) return failComfyCandidateEnvelope(payload, "candidate_cancelled");
        return withTaskOwner(event.sender.id, () => runComfyCandidateTest(payload, { runTask, fetchTaskResult }));
      });
    } catch (error) {
      // 绑住这个 error：空 catch 曾把上游真因（含我们自己的出站策略拒绝）整个丢掉，
      // 只留一个裸码给界面渲染。真因脱敏后随 params.detail 一起交出去。
      return failComfyCandidateEnvelope(
        payload,
        ownerDestroyed ? "candidate_cancelled" : "provider_failed",
        ownerDestroyed ? undefined : error,
      );
    } finally {
      event.sender.removeListener("destroyed", onDestroyed);
    }
  });
  ipcMain.handle("nomi:tasks:comfy-candidate-cancel", (event, payload) => {
    assertTrustedSender(event);
    const result = cancelComfyCandidateTest(payload);
    failComfyCandidateEnvelope(payload, "candidate_cancelled");
    return result;
  });
  ipcMain.handle("nomi:tasks:cancel", (event, taskId: unknown) => {
    assertTrustedSender(event);
    if (typeof taskId !== "string" || !/^local-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(taskId)) throw new Error("LOCAL_TASK_INVALID_ID");
    return antigravityImageJobs.cancel(taskId, event.sender.id);
  });
}
