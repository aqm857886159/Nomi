import { app, BrowserWindow } from "electron";
import path from "node:path";

import { getMainWindow } from "../mainWindowRegistry";
import { loadOrCreateArtifactPreviewSecret } from "./artifactProjection";
import { resolveProductionDeepLink, type ProductionDeepLinkTarget } from "./productionDeepLink";
import { createProductionRunRepository } from "./productionRunRepository";
import { logError, logWarn } from "../logging/logger";

type InstallArgs = {
  isMcpStdio: boolean;
  allowE2eMultiInstance: boolean;
  hasSingleInstanceLock: boolean;
  /** 零窗口时把主窗口建回来（main.ts 收口的唯一入口）。 */
  ensureMainWindow: () => void | Promise<void>;
  /** Optional diagnostic sink for startup failures (kept injectable for tests). */
  log?: (message: string) => void;
};

export function installProductionRunDesktopLifecycle(args: InstallArgs): {
  ensureArtifactPreviewSecret: () => void;
  flushPendingProductionDeepLink: () => void;
} {
  let pendingProductionDeepLink: string | null = null;

  function deliverProductionDeepLink(target: ProductionDeepLinkTarget): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) {
      // 按目标形状重建（工程级/节点级/Run 级三种，见 ProductionDeepLinkTarget）——
      // 旧版无条件拼 /run/{runId}，工程级目标会拼出 /run/undefined 这种再也解析不回来的链接。
      const project = encodeURIComponent(target.projectId);
      pendingProductionDeepLink = target.runId
        ? `nomi://project/${project}/run/${encodeURIComponent(target.runId)}${target.artifactId ? `?artifact=${encodeURIComponent(target.artifactId)}` : ""}`
        : target.nodeId
          ? `nomi://project/${project}/node/${encodeURIComponent(target.nodeId)}`
          : `nomi://project/${project}`;
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    window.webContents.send("nomi:production-deep-link", target);
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
      // 用户再次启动 app（双击图标 / 点任务栏），我们是唯一实例 → 必须让他看见一个窗口。
      // 曾经这里只 focus 已存在的窗口，零窗口时静默空转：新进程拿不到锁已自杀，老进程又不建窗，
      // 于是「怎么点都打不开，只能杀进程」（issue #62）。零窗口必须建窗，这是本分支的不变量。
      app.on("second-instance", (_event, commandLine) => {
        const deepLink = commandLine.find((value) => value.startsWith("nomi://"));
        if (deepLink) handleProductionDeepLink(deepLink);
        const [existing] = BrowserWindow.getAllWindows();
        if (!existing) {
          void args.ensureMainWindow();
          return;
        }
        if (existing.isMinimized()) existing.restore();
        existing.show(); // 窗口被隐藏时同样「打不开」，与 deliverProductionDeepLink 保持一致
        existing.focus();
      });
    }
  }

  return { ensureArtifactPreviewSecret, flushPendingProductionDeepLink };
}
