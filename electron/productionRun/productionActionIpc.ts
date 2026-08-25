import { ipcMain } from "electron";

import type { ProductionActionResult } from "./productionRunTypes";

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
