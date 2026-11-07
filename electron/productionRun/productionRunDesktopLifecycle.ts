import { app } from "electron";
import path from "node:path";

import { loadOrCreateArtifactPreviewSecret } from "./artifactProjection";
import { resolveProductionDeepLink, type ProductionDeepLinkTarget } from "./productionDeepLink";
import { createProductionRunRepository } from "./productionRunRepository";
import { logError, logWarn } from "../logging/logger";

type InstallArgs = {
  isMcpStdio: boolean;
  allowE2eMultiInstance: boolean;
  hasSingleInstanceLock: boolean;
  /** 等主窗口就绪并显示（mainWindowPresence 的唯一恢复边界）。 */
  ensureMainWindow: (entry: string) => Promise<import("electron").BrowserWindow | null>;
  /** Optional diagnostic sink for startup failures (kept injectable for tests). */
  log?: (message: string) => void;
};

export function installProductionRunDesktopLifecycle(args: InstallArgs): {
  ensureArtifactPreviewSecret: () => void;
  flushPendingProductionDeepLink: () => void;
} {
  let pendingProductionDeepLink: string | null = null;

  function deliverProductionDeepLink(target: ProductionDeepLinkTarget, rawUrl: string): void {
    void args.ensureMainWindow("deep-link").then((window) => {
      if (!window || window.isDestroyed()) {
        pendingProductionDeepLink = rawUrl;
        return;
      }
      window.webContents.send("nomi:production-deep-link", target);
    }).catch((error) => {
      pendingProductionDeepLink = rawUrl;
      logWarn("production-run", "deep-link-delivery-failed", undefined, error);
    });
  }

  function handleProductionDeepLink(rawUrl: string): void {
    if (!app.isReady()) {
      pendingProductionDeepLink = rawUrl;
      return;
    }
    try {
      const target = resolveProductionDeepLink(rawUrl, createProductionRunRepository());
      deliverProductionDeepLink(target, rawUrl);
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
      app.on("second-instance", (_event, commandLine) => {
        const deepLink = commandLine.find((value) => value.startsWith("nomi://"));
        if (deepLink) handleProductionDeepLink(deepLink);
        else void args.ensureMainWindow("second-instance");
      });
    }
  }

  return { ensureArtifactPreviewSecret, flushPendingProductionDeepLink };
}
