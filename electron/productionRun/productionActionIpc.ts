import { ipcMain } from "electron";

import type { ProductionActionResult, ProductionShotActionResult } from "./productionRunTypes";

import { assertTrustedSender } from "../ipcSenderGuard";
import { logError } from "../logging/logger";
/**
 * P4 S6 返工/续拍 IPC（从 main.ts 抽出来守 800 行门岗 R9）。渲染层（占位节点重试钮 / 失败镜 onRetry / 续拍钮）
 * 经此转调 appIntegration 编排（scheduler 闭包住那）。守卫：projectId 须 = 当前打开项目（返工/续拍是「用户在本机对
 * 本项目操作」）——非当前项目直接回结构化 run_not_open，不惊动能力核；appIntegration hook 内还会再校验一次。
 */
/** 能力核编排门面（appIntegration 的模块级导出；懒加载后转调）。main.ts 只传取当前项目 + 一个加载器。 */
type CapabilityActions = {
  reworkProductionShot: (input: { projectId: string; runId: string; shotId?: string }) => Promise<ProductionShotActionResult>;
  resumeProductionBatch: (input: { projectId: string; runId: string }) => Promise<ProductionShotActionResult>;
  /**
   * Agent 面板付费卡（D2 第③步）：交给画布 / 取消 / 不生成 × / 恢复。卡上没有参数，所以没有「改参数」。
   * **读不在这里**（2026-10-05）：待决出价随对话投影推给面板（`laneDesktopSpend`），渲染层没有第二条去拉它的路。
   */
  handOverPendingSpendShots: (input: SpendCardInput & { shotIds: readonly string[] }) => Promise<ProductionActionResult>;
  discardPendingSpendConfirmation: (input: SpendCardInput) => Promise<ProductionActionResult>;
  removePendingSpendShot: (input: SpendCardInput & { shotId: string }) => Promise<ProductionActionResult>;
  restorePendingSpendShot: (input: SpendCardInput & { shotId: string }) => Promise<ProductionActionResult>;
};

type SpendCardInput = { projectId: string; operationId: string; quoteId: string; presentationId?: string; presentationEpoch?: number; planVersion?: number };

export function registerProductionActionIpc(deps: {
  getActiveProjectId: () => string;
  loadCore: () => Promise<CapabilityActions>;
}): void {
  /**
   * 返工 / 续拍这两个通道**不往渲染层抛异常**：编排层把每一种可预期的失败都分好了类，能漏到这里的只剩 Nomi 自己的
   * bug（能力核加载失败、不变量没守住）。原话连堆栈记进主进程日志，渲染层拿到的是如实的 internal_error，
   * 而不是一次 IPC rejection——那会被渲染层当成「连不上桌面端」。
   */
  const shotAction = async (channel: string, run: (core: CapabilityActions) => Promise<ProductionShotActionResult>): Promise<ProductionShotActionResult> => {
    try {
      return await run(await deps.loadCore());
    } catch (error) {
      logError("production-run", `${channel}-internal-error`, error);
      return { ok: false, code: "failed", failure: "internal_error" };
    }
  };
  const rework = (input: { projectId: string; runId: string; shotId?: string }) => shotAction("rework", (core) => core.reworkProductionShot(input));
  const resumeBatch = (input: { projectId: string; runId: string }) => shotAction("resume-batch", (core) => core.resumeProductionBatch(input));
  const objectOf = (payload: unknown): Record<string, unknown> =>
    payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  const guardProject = (projectId: string, runId: string): ProductionShotActionResult | null => {
    if (!projectId || !runId) return { ok: false, code: "failed", failure: "request_invalid" };
    if (projectId !== deps.getActiveProjectId()) return { ok: false, code: "failed", failure: "run_not_open" };
    return null;
  };

  ipcMain.handle("nomi:production-runs:rework", async (event, payload: unknown): Promise<ProductionShotActionResult> => {
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
   * 付费确认卡的动作通道。全部按同一条守卫收口：**只服务当前打开的项目**——
   * 卡是「用户此刻在这个项目的面板里做的决定」，跨项目的那笔生成没有人在看着这张卡。
   */
  const spendOperation = (payload: unknown): { projectId: string; operationId: string } | ProductionActionResult => {
    const raw = objectOf(payload);
    const projectId = str(raw.projectId);
    const operationId = str(raw.operationId);
    if (!projectId || !operationId) return { ok: false, code: "failed", message: "missing projectId/operationId" };
    if (projectId !== deps.getActiveProjectId()) return { ok: false, code: "run_not_open" };
    return { projectId, operationId };
  };
  const cardIdentity = (raw: Record<string, unknown>): { presentationId?: string; presentationEpoch?: number; planVersion?: number } => ({
    ...(str(raw.presentationId) ? { presentationId: str(raw.presentationId) } : {}),
    ...(typeof raw.presentationEpoch === "number" ? { presentationEpoch: raw.presentationEpoch } : {}),
    ...(typeof raw.planVersion === "number" ? { planVersion: raw.planVersion } : {}),
  });

  /**
   * 「生成」/「全部生成（N）」/「生成剩下 N 段」/「再试一次」：渲染层只递「用户点的是这几镜」和他有没有在卡上看过「托管」那一句，
   * 它们必须就是卡上还在等决定的那几镜（宿主核）；交不交、怎么交由主进程定（逐镜走画布单节点提交，同一张手势收据）。
   */
  ipcMain.handle("nomi:production-runs:hand-over-spend", async (event, payload: unknown): Promise<ProductionActionResult> => {
    assertTrustedSender(event);
    const scoped = spendOperation(payload);
    if ("ok" in scoped) return scoped;
    const raw = objectOf(payload);
    const shotIds = Array.isArray(raw.shotIds) ? raw.shotIds.map(str).filter(Boolean) : [];
    if (shotIds.length === 0) return { ok: false, code: "failed", message: "generation_scope_invalid" };
    return (await deps.loadCore()).handOverPendingSpendShots({ ...scoped, ...cardIdentity(raw), quoteId: str(raw.quoteId), shotIds });
  });

  ipcMain.handle("nomi:production-runs:discard-spend", async (event, payload: unknown): Promise<ProductionActionResult> => {
    assertTrustedSender(event);
    const scoped = spendOperation(payload);
    if ("ok" in scoped) return scoped;
    const raw = objectOf(payload);
    return (await deps.loadCore()).discardPendingSpendConfirmation({ ...scoped, ...cardIdentity(raw), quoteId: str(raw.quoteId) });
  });

  const shotChannel = (channel: string, run: (core: CapabilityActions, input: SpendCardInput & { shotId: string }) => Promise<ProductionActionResult>) => {
    ipcMain.handle(channel, async (event, payload: unknown): Promise<ProductionActionResult> => {
      assertTrustedSender(event);
      const scoped = spendOperation(payload);
      if ("ok" in scoped) return scoped;
      const raw = objectOf(payload);
      const shotId = str(raw.shotId);
      if (!shotId) return { ok: false, code: "failed", message: "generation_scope_invalid" };
      return run(await deps.loadCore(), { ...scoped, ...cardIdentity(raw), quoteId: str(raw.quoteId), shotId });
    });
  };
  // 「不生成 ×」与再点一次的「恢复」：一镜一下，可撤回。
  shotChannel("nomi:production-runs:remove-spend-shot", (core, input) => core.removePendingSpendShot(input));
  shotChannel("nomi:production-runs:restore-spend-shot", (core, input) => core.restorePendingSpendShot(input));

  ipcMain.handle("nomi:production-runs:resume-batch", async (event, payload: unknown): Promise<ProductionShotActionResult> => {
    assertTrustedSender(event);
    const raw = objectOf(payload);
    const projectId = str(raw.projectId);
    const runId = str(raw.runId);
    // 续额度还是直接接着拍由主进程照 Run 记下的停下原因定，渲染层不再传「为什么停」。
    const rejected = guardProject(projectId, runId);
    if (rejected) return rejected;
    return resumeBatch({ projectId, runId });
  });
}
