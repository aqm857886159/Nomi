// appIntegration 的「先落节点、再发请求」接线（架构③；从 appIntegration 拆出，守 800 行门岗 · R9）。
//
// 两件事：
//   ① 派发前落地要的项目没打开时，只在「主窗口隐藏、用户从没叫出来过」的情况下让那个窗口打开它（landingProjectAccess）；
//      走现有的 `nomi:production-deep-link` 通道，但**不 show、不 focus**——没有新的可见界面，也只有一个窗口在写项目。
//   ② 多镜开拍时先经唯一准入点把这批镜落到画布上，落不下来的当场回给 Agent 一句如实的话（调度器随后照样只派落下的）。
import { getMainWindow } from "../appWindowRegistry";
import { mainWindowHiddenFromUser } from "../backgroundLaunch";
import { getDesktopLocale } from "../i18n";
import { createLandingProjectAccess } from "../productionRun/landingProjectAccess";
import type { ProductionRunRepository } from "../productionRun/productionRunRepository";
import { admitShotsForDispatch, type LandShotsOnCanvas } from "../productionRun/shotLandingAdmission";
import { landingFailureNotice } from "../shared/landingFailureCopy";
import { shotIncluded } from "../shared/productionShotJobs";
import { readWorkspaceProject } from "../workspace/workspaceRepository";
import { getWorkspaceRepositoryDeps } from "../runtimePaths";

export function createGuiLandingProjectAccess(isProjectOpen: (projectId: string) => boolean): (projectId: string) => Promise<void> {
  return createLandingProjectAccess({
    isProjectOpen,
    mainWindowHiddenFromUser: () => mainWindowHiddenFromUser(getMainWindow()),
    openInHiddenWindow: (projectId) => {
      const window = getMainWindow();
      if (window && !window.isDestroyed()) window.webContents.send("nomi:production-deep-link", { projectId });
    },
    projectName: (projectId) => {
      try {
        return readWorkspaceProject(projectId, getWorkspaceRepositoryDeps())?.name;
      } catch {
        return undefined;
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}

export function desktopNoticeLocale(): "zh-CN" | "en" {
  return getDesktopLocale() === "en" ? "en" : "zh-CN";
}

/**
 * 多镜开拍前先落画布（与调度器同一个准入点）。全落下了返回 null；有落不下来的，返回给 Agent 的那一段
 * （调度器那一趟会再试一次、照样只派落下的，并把 Run 停在 landing_failed）。
 */
export async function landBatchBeforeKick(input: Readonly<{
  repository: Pick<ProductionRunRepository, "read" | "execute">;
  landShots: LandShotsOnCanvas;
  projectId: string;
  runId: string;
}>): Promise<{ landingFailure: { code: string; projectId: string; projectName?: string }; notice: string } | null> {
  const run = input.repository.read(input.projectId, input.runId);
  const shotIds = (run?.generationPlan?.shots ?? []).filter(shotIncluded).map((shot) => shot.shotId);
  if (shotIds.length === 0) return null;
  const outcome = await admitShotsForDispatch({ repository: input.repository, land: input.landShots, projectId: input.projectId, runId: input.runId, shotIds });
  if (outcome.unlanded.length === 0) return null;
  const landingFailure = outcome.landingFailure ?? { code: "canvas_landing_failed", projectId: input.projectId };
  return { landingFailure, notice: landingFailureNotice(desktopNoticeLocale(), landingFailure) };
}
