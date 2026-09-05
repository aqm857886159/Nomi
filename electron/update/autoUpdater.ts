import { app, BrowserWindow, ipcMain, shell } from "electron";
import { desktopT } from "../i18n";
import { buildDownloadPageUrl } from "./downloadPage";

import { assertTrustedSender } from "../ipcSenderGuard";
import { recordTelemetryEvent } from "../telemetry/telemetryOutbox";
import type { TelemetryResult } from "../shared/contracts/telemetry";
// 版本号 + 检查更新 + 一键更新（功能需求 1/2/3）。
// GitHub Releases provider 由 package.json build.publish 自动派生，无需额外服务器。
// 全程用户显式触发：关自动下载 / 关退出即装，下载与安装都必须用户点（P2 用户掌控）。

type AppInfo = {
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  // macOS 的 Squirrel.Mac 强制校验代码签名，未签名包无法就地装（electron-builder 官方：
  // "macOS application must be signed in order for auto updating to work"）。当前包未签名，
  // 故 darwin 下走「检测到新版→开浏览器手动下载」兜底；Windows NSIS 未签名也能就地装。
  // 真相源在主进程，UI 纯 derive，别在渲染层 hardcode 平台分支。
  canAutoInstall: boolean;
  canCheckUpdates: boolean;
};

const EVENT_CHANNEL = "nomi:update:event";

// 未签名 mac 无法就地自动安装；其余平台（Windows NSIS）可以。
const CAN_AUTO_INSTALL = process.platform !== "darwin";
const CAN_CHECK_UPDATES = app.getName().trim().toLowerCase() === "nomi";

function trackUpdate(action: "check" | "download" | "install", result: TelemetryResult): void {
  recordTelemetryEvent({ eventName: "update.action", props: { action, result } }, app.getVersion());
}

function broadcast(payload: Record<string, unknown>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, payload);
  }
}

function describeError(error: unknown): string {
  if (error == null) return desktopT("common.unknownError");
  if (error instanceof Error) return error.message || String(error);
  return String(error);
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, "").replace(/\s+\n/g, "\n").trim();
}

type ReleaseNote = { version: string; note: string | null };

function normalizeNotes(notes: string | ReleaseNote[] | null | undefined): string {
  if (!notes) return "";
  if (typeof notes === "string") return stripHtml(notes);
  return notes
    .map((entry) => stripHtml(entry.note || ""))
    .filter(Boolean)
    .join("\n");
}

let eventsWired = false;
let autoUpdaterPromise: Promise<typeof import("electron-updater")["autoUpdater"]> | null = null;

function wireUpdaterEvents(autoUpdater: typeof import("electron-updater")["autoUpdater"]): void {
  if (eventsWired) return;
  eventsWired = true;
  autoUpdater.on("checking-for-update", () => broadcast({ type: "checking" }));
  autoUpdater.on("update-available", (info) =>
    broadcast({ type: "available", version: info.version, notes: normalizeNotes(info.releaseNotes) }));
  autoUpdater.on("update-not-available", () => broadcast({ type: "up-to-date" }));
  autoUpdater.on("download-progress", (progress) =>
    broadcast({ type: "progress", percent: Math.max(0, Math.min(100, Math.round(progress.percent))) }));
  autoUpdater.on("update-downloaded", (info) => broadcast({ type: "downloaded", version: info.version }));
  autoUpdater.on("error", (error) => broadcast({ type: "error", message: describeError(error) }));
}

async function loadAutoUpdater(): Promise<typeof import("electron-updater")["autoUpdater"]> {
  autoUpdaterPromise ??= import("electron-updater").then(({ autoUpdater }) => {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    // electron-updater 默认日志器会刷屏 + 抢崩溃日志，错误统一走事件透传给用户，关掉它。
    autoUpdater.logger = null;
    wireUpdaterEvents(autoUpdater);
    return autoUpdater;
  });
  return autoUpdaterPromise;
}

export function registerUpdaterIpc(): void {
  ipcMain.handle("nomi:app:version", (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    canAutoInstall: CAN_AUTO_INSTALL,
    canCheckUpdates: CAN_CHECK_UPDATES,
  }));

  // 手动更新兜底：把主进程已知的真实平台/架构交给官网，由官网直接启动对应安装包下载。
  ipcMain.handle("nomi:update:open-download", async (event) => {
    // shell.openExternal：能让任意内容驱动系统去打开外部 URL。
    assertTrustedSender(event);
    try {
      await shell.openExternal(buildDownloadPageUrl(process.platform, process.arch));
      return { ok: true };
    } catch (error) {
      broadcast({ type: "error", message: describeError(error) });
      return { ok: false };
    }
  });

  ipcMain.handle("nomi:update:check", async (event) => {
    assertTrustedSender(event);
    // 未打包（dev）时 electron-updater 不可用——诚实回错，不假装能更新。
    if (!app.isPackaged) {
      broadcast({ type: "error", message: desktopT("updater.devUnavailable") });
      trackUpdate("check", "failure");
      return { ok: false, reason: "not-packaged" };
    }
    if (!CAN_CHECK_UPDATES) { trackUpdate("check", "failure"); return { ok: false, reason: "non-stable-build" }; }
    try {
      const autoUpdater = await loadAutoUpdater();
      await autoUpdater.checkForUpdates();
      trackUpdate("check", "success");
      return { ok: true };
    } catch (error) {
      broadcast({ type: "error", message: describeError(error) });
      trackUpdate("check", "failure");
      return { ok: false };
    }
  });

  ipcMain.handle("nomi:update:download", async (event) => {
    assertTrustedSender(event);
    try {
      const autoUpdater = await loadAutoUpdater();
      await autoUpdater.downloadUpdate();
      trackUpdate("download", "success");
      return { ok: true };
    } catch (error) {
      broadcast({ type: "error", message: describeError(error) });
      trackUpdate("download", "failure");
      return { ok: false };
    }
  });

  ipcMain.handle("nomi:update:install", (event) => {
    // 装更新会立刻重启整个应用，是最强的一条控制权。
    assertTrustedSender(event);
    trackUpdate("install", "success");
    // 立即重启并安装（非静默）。mac 未签名会被 Gatekeeper 拦——降级实况以真机为准。
    setImmediate(() => {
      try {
        void loadAutoUpdater()
          .then((autoUpdater) => autoUpdater.quitAndInstall())
          .catch((error) => broadcast({ type: "error", message: describeError(error) }));
      } catch (error) {
        broadcast({ type: "error", message: describeError(error) });
      }
    });
    return { ok: true };
  });
}
