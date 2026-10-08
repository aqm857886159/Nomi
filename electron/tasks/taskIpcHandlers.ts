import { app, ipcMain } from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";
import { runTaskWithIdempotency } from "../submissionLedger";
import { mintSpendGrant } from "../spendGrant";
import { runTaskIpcGuard } from "./taskIpcGuard";
import { withTaskOwner } from "./localTaskJobs";
import { antigravityImageJobs } from "../catalog/antigravityImageOperation";
import { cancelComfyCandidateTest, failComfyCandidateEnvelope, runComfyCandidateTest } from "./comfyCandidateTest";

type RuntimeLoader = () => Promise<typeof import("../runtime")>;
type CanvasShotCore = Pick<typeof import("../capabilityCore/appIntegration"), "consentCanvasShots" | "submitCanvasShot" | "pollCanvasShot" | "releaseCanvasShot" | "withdrawCanvasShots" | "releaseCanvasShotSender">;
type CoreLoader = () => Promise<CanvasShotCore>;

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Register the renderer task boundary, including the spend-grant trust check. */
export function registerTaskIpcHandlers(loadRuntimeModule: RuntimeLoader, loadCore: CoreLoader): void {
  const owners = new Set<number>();
  let draining = false;
  let drained = false;
  app.on("will-quit", (event) => {
    if (drained) return;
    event.preventDefault();
    if (draining) return;
    draining = true;
    void antigravityImageJobs.cancelAll().finally(() => { drained = true; app.quit(); });
  });
  // 发起任务的窗口没了：它的本地任务取消，它在等的画布 Run 交给主进程观察者收完。
  const trackOwner = (sender: Electron.WebContents): void => {
    if (owners.has(sender.id)) return;
    const owner = sender.id; owners.add(owner);
    sender.once("destroyed", () => { owners.delete(owner); void antigravityImageJobs.cancelOwner(owner); void loadCore().then((core) => core.releaseCanvasShotSender(owner)).catch(() => undefined); });
  };
  // 付费守卫铸令牌：只剩附属付费口在用（新手页的工作流试生成；登记的例外，到期 2026-11-15）。画布不再铸令牌（发动机收敛第一刀）。
  ipcMain.handle("nomi:tasks:grant-spend", (event, payload) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as { nodeIds?: unknown; maxAttemptsPerNode?: unknown };
    const nodeIds = Array.isArray(raw.nodeIds) ? raw.nodeIds.map((id) => String(id)) : [];
    const maxAttemptsPerNode = typeof raw.maxAttemptsPerNode === "number" ? raw.maxAttemptsPerNode : undefined;
    return { grantId: mintSpendGrant({ nodeIds, ...(maxAttemptsPerNode ? { maxAttemptsPerNode } : {}) }) };
  });

  // 不花钱的那几条（本地 ComfyUI、文本）与附属付费口的渲染层调用：同 idempotencyKey 的提交内核在进程内只执行一次。
  // 画布的付费生成不走这里（走 canvas-submit，钱只从制作流程那一个口子出去）。
  ipcMain.handle("nomi:tasks:run", (event, payload) => {
    assertTrustedSender(event);
    trackOwner(event.sender);
    return runTaskIpcGuard(payload, async () => {
      const { runTask } = await loadRuntimeModule();
      return withTaskOwner(event.sender.id, () => runTaskWithIdempotency(payload, () => runTask(payload)));
    });
  });

  // 批量卡上点了确认（「生成全部」、分镜整批、框选生成）：卡上列出的每一镜各建一个单镜 Run，出价开着 = 这一镜他同意了。
  // 什么都还没交；轮到它时 canvas-submit 才冻住请求、批、交。
  ipcMain.handle("nomi:tasks:canvas-consent", async (event, payload) => {
    assertTrustedSender(event);
    trackOwner(event.sender);
    const raw = (payload || {}) as { projectId?: unknown; shots?: unknown };
    const projectId = str(raw.projectId);
    const shots = Array.isArray(raw.shots) ? raw.shots.map((shot) => {
      const value = (shot || {}) as Record<string, unknown>;
      return { nodeId: str(value.nodeId), runRecordId: str(value.runRecordId), vendor: str(value.vendor), modelKey: str(value.modelKey), kind: str(value.kind) };
    }) : [];
    if (!projectId || shots.length === 0 || shots.length > 500 || shots.some((shot) => !shot.nodeId || !shot.runRecordId || !shot.vendor || !shot.kind)) {
      throw new Error("canvas generation consent is invalid");
    }
    return (await loadCore()).consentCanvasShots({ projectId, shots, senderId: event.sender.id });
  });
  // 排队的那一镜被去掉 / 整批 ×：还没交的收回出价，再也交不出去。
  ipcMain.handle("nomi:tasks:canvas-withdraw", async (event, payload) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as { projectId?: unknown; runRecordIds?: unknown; by?: unknown };
    const projectId = str(raw.projectId);
    const runRecordIds = Array.isArray(raw.runRecordIds) ? raw.runRecordIds.map(str).filter(Boolean) : [];
    const by = raw.by === "removed" || raw.by === "user_closed" ? raw.by : "stopped";
    if (projectId && runRecordIds.length > 0) (await loadCore()).withdrawCanvasShots({ projectId, runRecordIds, by });
  });

  // 画布单节点 ↑ 的唯一付费口（发动机收敛第一刀）：这一下 IPC 就是用户的那一下点击，主进程按发起的窗口铸手势收据，
  // 建单镜 Run，经提交出口交出去。查结果也经 Run（poll → 出片就记进 Run）。错误照旧按结构化标记穿 IPC。
  ipcMain.handle("nomi:tasks:canvas-submit", (event, payload) => {
    assertTrustedSender(event);
    trackOwner(event.sender);
    const raw = (payload || {}) as { projectId?: unknown; nodeId?: unknown; runRecordId?: unknown; vendor?: unknown; request?: unknown };
    const request = raw.request as { kind?: unknown; prompt?: unknown; extras?: Record<string, unknown> } | undefined;
    const projectId = str(raw.projectId);
    const nodeId = str(raw.nodeId);
    const runRecordId = str(raw.runRecordId);
    const vendor = str(raw.vendor);
    if (!projectId || !nodeId || !runRecordId || !vendor || !request || typeof request.kind !== "string" || typeof request.prompt !== "string") {
      throw new Error("canvas generation request is invalid");
    }
    if (str(request.extras?.projectId) !== projectId || str(request.extras?.nodeId) !== nodeId) throw new Error("TASK_PROJECT_MISMATCH: canvas request identity disagrees");
    const gesture = { webContentsId: event.sender.id, frameId: event.senderFrame?.routingId ?? 0, origin: event.senderFrame?.origin ?? "" };
    return runTaskIpcGuard({ request }, async () => withTaskOwner(event.sender.id, async () => (await loadCore()).submitCanvasShot({
      projectId, nodeId, runRecordId, vendor, request: request as never, gesture, senderId: event.sender.id,
    })));
  });
  ipcMain.handle("nomi:tasks:canvas-poll", (event, payload) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as { projectId?: unknown; runRecordId?: unknown };
    const projectId = str(raw.projectId);
    const runRecordId = str(raw.runRecordId);
    if (!projectId || !runRecordId) throw new Error("canvas generation poll is invalid");
    return runTaskIpcGuard(payload, async () => withTaskOwner(event.sender.id, async () => (await loadCore()).pollCanvasShot({ projectId, runRecordId, senderId: event.sender.id })));
  });
  ipcMain.handle("nomi:tasks:canvas-release", async (event, payload) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as { projectId?: unknown; runRecordId?: unknown };
    const projectId = str(raw.projectId);
    const runRecordId = str(raw.runRecordId);
    if (projectId && runRecordId) (await loadCore()).releaseCanvasShot({ projectId, runRecordId });
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
