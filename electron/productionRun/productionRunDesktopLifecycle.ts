import { app, BrowserWindow } from "electron";
import path from "node:path";

import { getMainWindow } from "../mainWindowRegistry";
import { loadOrCreateArtifactPreviewSecret } from "./artifactProjection";
import { resolveProductionDeepLink, type ProductionDeepLinkTarget } from "./productionDeepLink";
import { createProductionRunRepository } from "./productionRunRepository";

type InstallArgs = {
  isMcpStdio: boolean;
  allowE2eMultiInstance: boolean;
  hasSingleInstanceLock: boolean;
};

export function installProductionRunDesktopLifecycle(args: InstallArgs): {
  ensureArtifactPreviewSecret: () => void;
  flushPendingProductionDeepLink: () => void;
} {
  let pendingProductionDeepLink: string | null = null;

  function deliverProductionDeepLink(target: ProductionDeepLinkTarget): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) {
      pendingProductionDeepLink = `nomi://project/${encodeURIComponent(target.projectId)}/run/${encodeURIComponent(target.runId)}${target.artifactId ? `?artifact=${encodeURIComponent(target.artifactId)}` : ""}`;
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
      console.warn("[nomi:desktop] ignored invalid production deep link", error instanceof Error ? error.message : String(error));
    }
  }

  function flushPendingProductionDeepLink(): void {
    if (!pendingProductionDeepLink) return;
    const rawUrl = pendingProductionDeepLink;
    pendingProductionDeepLink = null;
    handleProductionDeepLink(rawUrl);
  }

  function ensureArtifactPreviewSecret(): void {
    if (String(process.env.NOMI_ARTIFACT_PREVIEW_SECRET || '').trim()) return;
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
      app.quit();
    } else {
      app.on("second-instance", (_event, commandLine) => {
        const deepLink = commandLine.find((value) => value.startsWith("nomi://"));
        if (deepLink) handleProductionDeepLink(deepLink);
        const [existing] = BrowserWindow.getAllWindows();
        if (existing) {
          if (existing.isMinimized()) existing.restore();
          existing.focus();
        }
      });
    }
  }

  return { ensureArtifactPreviewSecret, flushPendingProductionDeepLink };
}
