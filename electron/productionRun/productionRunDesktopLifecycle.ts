import { app } from "electron";
import path from "node:path";

import { revealMainWindow, sendToMainWindow } from "../mainWindowPresence";
import { loadOrCreateArtifactPreviewSecret } from "./artifactProjection";
import { resolveProductionDeepLink, type ProductionDeepLinkTarget } from "./productionDeepLink";
import { createProductionRunRepository } from "./productionRunRepository";
import { logError, logWarn } from "../logging/logger";

type InstallArgs = {
  isMcpStdio: boolean;
  allowE2eMultiInstance: boolean;
  hasSingleInstanceLock: boolean;
  /** Optional diagnostic sink for startup failures (kept injectable for tests). */
  log?: (message: string) => void;
};

export function installProductionRunDesktopLifecycle(args: InstallArgs): {
  ensureArtifactPreviewSecret: () => void;
  flushPendingProductionDeepLink: () => void;
} {
  let pendingProductionDeepLink: string | null = null;

  function deliverProductionDeepLink(target: ProductionDeepLinkTarget): void {
    // 叫回只发意图（主窗主人决定建、等还是亮）；主窗不在或在建时先记下，就绪后冲刷（只投递一次）。
    revealMainWindow("deep-link");
    if (!sendToMainWindow("nomi:production-deep-link", target)) {
      // 按目标形状重建（工程级/节点级/Run 级三种，见 ProductionDeepLinkTarget）——
      // 旧版无条件拼 /run/{runId}，工程级目标会拼出 /run/undefined 这种再也解析不回来的链接。
      const project = encodeURIComponent(target.projectId);
      pendingProductionDeepLink = target.runId
        ? `nomi://project/${project}/run/${encodeURIComponent(target.runId)}${target.artifactId ? `?artifact=${encodeURIComponent(target.artifactId)}` : ""}`
        : target.nodeId
          ? `nomi://project/${project}/node/${encodeURIComponent(target.nodeId)}`
          : `nomi://project/${project}`;
    }
  }

  function handleProductionDeepLink(rawUrl: string): void {
    if (!app.isReady()) {
      pendingProductionDeepLink = rawUrl;
      return;
    }
    try {
      const target = resolveProductionDeepLink(rawUrl, createProductionRunRepository());
      deliverProductionDeepLink(target);
    } catch (error) {
      logWarn("production-run", "invalid-deep-link-ignored", undefined, error);
    }
  }

  function flushPendingProductionDeepLink(): void {
    if (!pendingProductionDeepLink) return;
    const rawUrl = pendingProductionDeepLink;
    pendingProductionDeepLink = null;
    handleProductionDeepLink(rawUrl);
  }

  function ensureArtifactPreviewSecret(): void {
    if (String(process.env.NOMI_ARTIFACT_PREVIEW_SECRET || "").trim()) return;
    try {
      process.env.NOMI_ARTIFACT_PREVIEW_SECRET = loadOrCreateArtifactPreviewSecret(
        path.join(app.getPath("userData"), "capability-core", "artifact-preview.key"),
      );
    } catch {
      // Tests and pre-ready lifecycle hooks may not expose app.getPath; the module falls back to a process secret.
    }
  }

  app.on("open-url", (event, rawUrl) => {
    event.preventDefault();
    if (rawUrl.startsWith("nomi://")) handleProductionDeepLink(rawUrl);
  });

  if (!args.isMcpStdio && !args.allowE2eMultiInstance) {
    if (!args.hasSingleInstanceLock) {
      // Electron otherwise exits with code 0 and no window, which looks like a
      // renderer crash when another Nomi instance owns the profile lock.
      (args.log ?? ((message: string) => logError("main", "single-instance-exit", undefined, { reason: message })))(
        "[nomi:desktop] another Nomi instance is already using this profile; this process is exiting. " +
          "Close the running Nomi app, or set NOMI_ELECTRON_USER_DATA_DIR to an isolated directory for development.",
      );
      app.quit();
    } else {
      // 用户再次启动 app（双击图标 / 点任务栏），我们是唯一实例 → 必须让他看见主窗（不是第一扇辅助窗）。
      // 零窗口、藏着、最小化、正在建、正在退都由主窗主人处理（issue #62；正在退时退完自动重开一次）。
      app.on("second-instance", (_event, commandLine) => {
        const deepLink = commandLine.find((value) => value.startsWith("nomi://"));
        if (deepLink) handleProductionDeepLink(deepLink);
        revealMainWindow("second-instance");
      });
    }
  }

  return { ensureArtifactPreviewSecret, flushPendingProductionDeepLink };
}
