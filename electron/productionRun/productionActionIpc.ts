import { ipcMain } from "electron";

import type { ProductionActionResult } from "./productionRunTypes";
import type { PendingSpendConfirm } from "../shared/contracts/pendingSpendConfirm";

import { assertTrustedSender } from "../ipcSenderGuard";
/**
 * P4 S6 返工/续拍 IPC（从 main.ts 抽出来守 800 行门岗 R9）。渲染层（占位节点重试钮 / 失败镜 onRetry / 续拍钮）
 * 经此转调 appIntegration 编排（scheduler 闭包住那）。守卫：projectId 须 = 当前打开项目（返工/续拍是「用户在本机对
 * 本项目操作」）——非当前项目直接回结构化 run_not_open，不惊动能力核；appIntegration hook 内还会再校验一次。
 */
/** 能力核编排门面（appIntegration 的模块级导出；懒加载后转调）。main.ts 只传取当前项目 + 一个加载器。 */
type CapabilityActions = {
  reworkProductionShot: (input: { projectId: string; runId: string; shotId?: string }) => Promise<ProductionActionResult>;
  resumeProductionBatch: (input: { projectId: string; runId: string; reason: "budget" | "manual" }) => Promise<ProductionActionResult>;
  /** 2026-09-11 Agent 面板付费确认卡：读 / 改参数 / 丢弃 / 确认并开跑。 */
  listPendingSpendConfirmations: (projectId: string) => readonly PendingSpendConfirm[];
  revisePendingSpendConfirmation: (input: { projectId: string; operationId: string; shotId?: string; patch: Record<string, unknown> }) => Promise<ProductionActionResult>;
  discardPendingSpendConfirmation: (input: { projectId: string; operationId: string }) => Promise<ProductionActionResult>;
  confirmPendingSpendConfirmation: (input: { projectId: string; operationId: string; shotIds?: readonly string[] }) => Promise<ProductionActionResult>;
};

export function registerProductionActionIpc(deps: {
  getActiveProjectId: () => string;
  loadCore: () => Promise<CapabilityActions>;
}): void {
  const rework = async (input: { projectId: string; runId: string; shotId?: string }) => (await deps.loadCore()).reworkProductionShot(input);
  const resumeBatch = async (input: { projectId: string; runId: string; reason: "budget" | "manual" }) => (await deps.loadCore()).resumeProductionBatch(input);
  const objectOf = (payload: unknown): Record<string, unknown> =>
    payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  const guardProject = (projectId: string, runId: string): ProductionActionResult | null => {
    if (!projectId || !runId) return { ok: false, code: "failed", message: "missing projectId/runId" };
    if (projectId !== deps.getActiveProjectId()) return { ok: false, code: "run_not_open" };
    return null;
  };

  ipcMain.handle("nomi:production-runs:rework", async (event, payload: unknown): Promise<ProductionActionResult> => {
    assertTrustedSender(event);
    const raw = objectOf(payload);
    const projectId = str(raw.projectId);
    const runId = str(raw.runId);
    const shotId = str(raw.shotId) || undefined;
    const rejected = guardProject(projectId, runId);
    if (rejected) return rejected;
    return rework({ projectId, runId, ...(shotId ? { shotId } : {}) });
  });

  /**
   * 付费确认卡的四个通道。全部按同一条守卫收口：**只服务当前打开的项目**——
   * 卡是「用户此刻在这个项目的面板里做的决定」，跨项目的那笔生成没有人在看着这张卡。
   *
   * ⚠️ 读通道**不再吞异常**（2026-09-12）。原来这里是 `try { … } catch { return [] }`，
   * 理由写的是「能力核还没起来时抛异常会把面板打成错误态」。那句话把两件事说成了一件：
   *
   *   · 「现在没有要确认的东西」——空数组，对；
   *   · 「我读不到，不知道有没有」——**也回了空数组**，于是面板安安静静地什么都不画，
   *     而模型那头刚刚告诉用户「请在确认卡中批准」。用户看到的是沉默。
   *
   * 现在读不到就让这次调用**拒绝**，渲染层据此渲一张会说话的卡
   * （`missingInterventionCard.ts`）。「没有卡」和「画不出卡」从此是两种不同的结果。
   * 没打开项目仍回空数组——那是真的没有要确认的东西，不是失败。
   */
  ipcMain.handle("nomi:production-runs:pending-spend", async (event, payload: unknown): Promise<readonly PendingSpendConfirm[]> => {
    assertTrustedSender(event);
    const projectId = str(objectOf(payload).projectId);
    if (!projectId || projectId !== deps.getActiveProjectId()) return [];
    return (await deps.loadCore()).listPendingSpendConfirmations(projectId);
  });

  const spendOperation = (payload: unknown): { projectId: string; operationId: string } | ProductionActionResult => {
    const raw = objectOf(payload);
    const projectId = str(raw.projectId);
    const operationId = str(raw.operationId);
    if (!projectId || !operationId) return { ok: false, code: "failed", message: "missing projectId/operationId" };
    if (projectId !== deps.getActiveProjectId()) return { ok: false, code: "run_not_open" };
    return { projectId, operationId };
  };

  ipcMain.handle("nomi:production-runs:revise-spend", async (event, payload: unknown): Promise<ProductionActionResult> => {
    assertTrustedSender(event);
    const scoped = spendOperation(payload);
    if ("ok" in scoped) return scoped;
    const raw = objectOf(payload);
    const shotId = str(raw.shotId) || undefined;
    const patch = objectOf(raw.patch);
    if (Object.keys(patch).length === 0) return { ok: false, code: "failed", message: "empty revision" };
    return (await deps.loadCore()).revisePendingSpendConfirmation({ ...scoped, ...(shotId ? { shotId } : {}), patch });
  });

  ipcMain.handle("nomi:production-runs:discard-spend", async (event, payload: unknown): Promise<ProductionActionResult> => {
    assertTrustedSender(event);
    const scoped = spendOperation(payload);
    if ("ok" in scoped) return scoped;
    return (await deps.loadCore()).discardPendingSpendConfirmation(scoped);
  });

  ipcMain.handle("nomi:production-runs:confirm-spend", async (event, payload: unknown): Promise<ProductionActionResult> => {
    assertTrustedSender(event);
    const scoped = spendOperation(payload);
    if ("ok" in scoped) return scoped;
    const rawShotIds = objectOf(payload).shotIds;
    const shotIds = Array.isArray(rawShotIds)
      ? rawShotIds.map((value) => str(value)).filter(Boolean).slice(0, 256)
      : [];
    return (await deps.loadCore()).confirmPendingSpendConfirmation({ ...scoped, ...(shotIds.length ? { shotIds } : {}) });
  });

  ipcMain.handle("nomi:production-runs:resume-batch", async (event, payload: unknown): Promise<ProductionActionResult> => {
    assertTrustedSender(event);
    const raw = objectOf(payload);
    const projectId = str(raw.projectId);
    const runId = str(raw.runId);
    const reason = raw.reason === "budget" ? "budget" : "manual";
    const rejected = guardProject(projectId, runId);
    if (rejected) return rejected;
    return resumeBatch({ projectId, runId, reason });
  });
}
