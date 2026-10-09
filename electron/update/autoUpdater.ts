import { app, ipcMain, shell } from "electron";
import { desktopT } from "../i18n";
import { buildDownloadPageUrl } from "./downloadPage";

import { assertTrustedSender } from "../ipcSenderGuard";
import { recordTelemetryEvent } from "../telemetry/telemetryOutbox";
import { isAutomatedLaunch, type UpdateFailureReason } from "../telemetry/telemetryEvents";
import type { TelemetryResult } from "../shared/contracts/telemetry";
import { classifyUpdateError, createAutoCheckScheduler, createVersionNotifyGate, describeUpdateFailure } from "./autoCheck";
import { createInstallOnQuit } from "./installOnQuit";
import { digestReleaseNotesHtml } from "../shared/releaseNotesDigest";
import { currentUpdaterState, publishUpdateEvent } from "./updateHub";
import { openUpdateReminderStore, type UpdateReminderStore } from "./updateReminderStore";
import { registerQuitDrain } from "../quitTeardown";
import type { UpdateInfo } from "electron-updater";
import { buildReleaseNotesUrl, type UpdaterErrorStage, type UpdateSnapshot, type VersionNotes } from "../shared/updateReminder";
// 版本号 + 检查更新 + 一键更新（功能需求 1/2/3）。
// GitHub Releases provider 由 package.json build.publish 自动派生，无需额外服务器。
// 下载与安装都由用户显式触发（P2 用户掌控）：点「下载更新」= 同意更新，下好后下次退出时自动装
// （installOnQuit.ts，走退出唯一 owner 的排空项）；autoInstallOnAppQuit 保持关，库自己不订阅 quit。

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

// 未签名 mac 无法就地自动安装；其余平台（Windows NSIS）可以。
const CAN_AUTO_INSTALL = process.platform !== "darwin";
const CAN_CHECK_UPDATES = app.getName().trim().toLowerCase() === "nomi";

function trackUpdate(action: "check" | "download" | "install", result: TelemetryResult, reason?: UpdateFailureReason): void {
  const props = reason && result === "failure" ? { action, result, reason } : { action, result };
  recordTelemetryEvent({ eventName: "update.action", props }, app.getVersion());
}

// 自动检查是「静默」的：不闪「检查中」、不报错、没有新版不吭声，只有发现新版才走现有角标。
// 手动检查（点按钮）行为不变。silentCheck 只在自动检查进行时为 true。
let silentCheck = false;
let manualCheckInFlight = false;
// 下载已开始或已下载完：自动检查不再插手（再广播 checking 会冲掉「已下载」状态）。
let downloadStarted = false;
const notifyGate = createVersionNotifyGate();

function describeError(error: unknown): string {
  if (error == null) return desktopT("common.unknownError");
  if (error instanceof Error) return error.message || String(error);
  return String(error);
}

// 当前正在做的是哪一步：错误事件带上它，界面的「重试」才能直接重做失败的那一步（一次点击生效）。
let stage: UpdaterErrorStage = "check";
let downloadInFlight = false;
let installRequested = false;
let loadedUpdater: Awaited<ReturnType<typeof loadAutoUpdater>> | null = null;
let reminderStore: UpdateReminderStore | null = null;

function publishError(error: unknown, at: UpdaterErrorStage = stage): void {
  publishUpdateEvent({ type: "error", message: describeError(error), stage: at, reason: describeUpdateFailure(error) });
}

/** 从 electron-updater 给的 releaseNotes（单段 HTML，或 fullChangelog 下每个新版本一段）摘出每个版本的两种语言摘要。 */
function toVersionNotes(info: UpdateInfo): VersionNotes[] {
  const raw = info.releaseNotes;
  if (!raw) return [];
  if (typeof raw === "string") return [digestReleaseNotesHtml(raw, info.version)];
  return raw.filter((entry) => entry.note).map((entry) => digestReleaseNotesHtml(entry.note ?? "", entry.version));
}

/** 安装包大小：Windows 取 .exe 那一项，其余取最大的一项；更新信息没给就返回 null（界面不写这一行）。 */
function installerSizeBytes(info: UpdateInfo): number | null {
  const files = (info.files ?? []).filter((file) => typeof file.size === "number" && file.size > 0);
  if (!files.length) return null;
  const exe = files.find((file) => /\.exe$/i.test(file.url));
  return (exe ?? files.reduce((largest, file) => ((file.size ?? 0) > (largest.size ?? 0) ? file : largest))).size ?? null;
}

const installOnQuit = createInstallOnQuit({
  registerDrain: registerQuitDrain,
  install: () => {
    const updater = loadedUpdater as unknown as { install?: (isSilent: boolean, isForceRunAfter: boolean) => boolean } | null;
    const started = updater?.install?.(true, false) ?? false;
    trackUpdate("install", started ? "success" : "failure");
    return started;
  },
});

let eventsWired = false;
let autoUpdaterPromise: Promise<typeof import("electron-updater")["autoUpdater"]> | null = null;

function wireUpdaterEvents(autoUpdater: typeof import("electron-updater")["autoUpdater"]): void {
  if (eventsWired) return;
  eventsWired = true;
  autoUpdater.on("checking-for-update", () => { if (!silentCheck) publishUpdateEvent({ type: "checking" }); });
  autoUpdater.on("update-available", (info) => {
    if (!notifyGate.shouldNotify(info.version, silentCheck)) return;
    publishUpdateEvent({
      type: "available",
      version: info.version,
      notes: toVersionNotes(info),
      sizeBytes: installerSizeBytes(info),
      releaseUrl: buildReleaseNotesUrl(info.version),
    });
  });
  autoUpdater.on("update-not-available", () => { if (!silentCheck) publishUpdateEvent({ type: "up-to-date" }); });
  autoUpdater.on("download-progress", (progress) =>
    publishUpdateEvent({ type: "progress", percent: Math.max(0, Math.min(100, Math.round(progress.percent))) }));
  autoUpdater.on("update-downloaded", (info) => {
    installOnQuit.markDownloaded();
    publishUpdateEvent({ type: "downloaded", version: info.version });
  });
  autoUpdater.on("error", (error) => {
    if (silentCheck) return;
    if (stage === "install") { installRequested = false; installOnQuit.markInstallFailed(); }
    publishError(error);
  });
}

async function loadAutoUpdater(): Promise<typeof import("electron-updater")["autoUpdater"]> {
  autoUpdaterPromise ??= import("electron-updater").then(({ autoUpdater }) => {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    // 跳了几版的用户要在「已更新」卡里看到每一版改了什么：让库返回当前版本之后每个版本的说明。
    autoUpdater.fullChangelog = true;
    // electron-updater 默认日志器会刷屏 + 抢崩溃日志，错误统一走事件透传给用户，关掉它。
    autoUpdater.logger = null;
    wireUpdaterEvents(autoUpdater);
    loadedUpdater = autoUpdater;
    return autoUpdater;
  });
  return autoUpdaterPromise;
}

/** 打包的正式版才自动检查；开发版、RC / 预览并行版、自动化启动都不查。 */
const autoCheckScheduler = createAutoCheckScheduler({
  enabled: () => app.isPackaged && CAN_CHECK_UPDATES && !isAutomatedLaunch(),
  busy: () => manualCheckInFlight || downloadStarted,
  run: async () => {
    silentCheck = true;
    try {
      const autoUpdater = await loadAutoUpdater();
      await autoUpdater.checkForUpdates();
    } finally {
      silentCheck = false;
    }
  },
});

export function startAutoUpdateCheck(): void {
  autoCheckScheduler.start();
}

function pendingFromState(): { fromVersion: string; toVersion: string; notes: readonly VersionNotes[] } | null {
  const state = currentUpdaterState();
  if (!state.latestVersion) return null;
  return { fromVersion: app.getVersion(), toVersion: state.latestVersion, notes: state.notes };
}

export function registerUpdaterIpc(): void {
  reminderStore = openUpdateReminderStore(app.getVersion());

  ipcMain.handle("nomi:app:version", (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    canAutoInstall: CAN_AUTO_INSTALL,
    canCheckUpdates: CAN_CHECK_UPDATES,
  }));

  // 渲染层挂载时补上已经发生的事（项目库页可能晚于「发现新版」事件才打开），再靠事件跟随。
  ipcMain.handle("nomi:update:snapshot", (event): UpdateSnapshot => {
    assertTrustedSender(event);
    return { state: currentUpdaterState(), memory: reminderStore?.memory() ?? { dismissedBanners: [], updatedCard: null } };
  });

  // 热修横幅 ✕ / 「已更新」卡 ✕：只记「看过了」，一次性。
  ipcMain.handle("nomi:update:dismiss", (event, payload: unknown) => {
    assertTrustedSender(event);
    const request = payload as { kind?: unknown; version?: unknown } | null;
    if (request?.kind === "banner" && typeof request.version === "string") return reminderStore?.dismissBanner(request.version) ?? null;
    if (request?.kind === "updated-card") return reminderStore?.dismissUpdatedCard() ?? null;
    return null;
  });

  // 手动更新兜底（未签名 Mac）：把主进程已知的真实平台/架构交给官网，由官网直接启动对应安装包下载。
  ipcMain.handle("nomi:update:open-download", async (event) => {
    // shell.openExternal：能让任意内容驱动系统去打开外部 URL。
    assertTrustedSender(event);
    try {
      await shell.openExternal(buildDownloadPageUrl(process.platform, process.arch));
      const pending = pendingFromState();
      if (pending) reminderStore?.rememberPending(pending);
      return { ok: true };
    } catch (error) {
      publishError(error, "download");
      return { ok: false };
    }
  });

  ipcMain.handle("nomi:update:check", async (event) => {
    assertTrustedSender(event);
    // 未打包（dev）时 electron-updater 不可用——诚实回错，不假装能更新。
    // 开发版 / 非正式版不是「检查失败」：回错给界面，但不上报成 failure。
    if (!app.isPackaged) {
      publishUpdateEvent({ type: "error", message: desktopT("updater.devUnavailable"), stage: "check", reason: "other" });
      return { ok: false, reason: "not-packaged" };
    }
    if (!CAN_CHECK_UPDATES) return { ok: false, reason: "non-stable-build" };
    manualCheckInFlight = true;
    stage = "check";
    try {
      const autoUpdater = await loadAutoUpdater();
      await autoUpdater.checkForUpdates();
      trackUpdate("check", "success");
      return { ok: true };
    } catch (error) {
      publishError(error, "check");
      trackUpdate("check", "failure", classifyUpdateError(error));
      return { ok: false };
    } finally {
      manualCheckInFlight = false;
    }
  });

  ipcMain.handle("nomi:update:download", async (event) => {
    assertTrustedSender(event);
    // 连点「下载更新」只开一次下载。
    if (downloadInFlight) return { ok: true };
    downloadInFlight = true;
    downloadStarted = true;
    stage = "download";
    // 点下载 = 同意更新：下好后下次退出时自动装；同时记下「从哪版到哪版 + 说明」，装好后第一次打开出「已更新」卡。
    installOnQuit.consent();
    const pending = pendingFromState();
    if (pending) reminderStore?.rememberPending(pending);
    publishUpdateEvent({ type: "progress", percent: 0 });
    try {
      const autoUpdater = await loadAutoUpdater();
      await autoUpdater.downloadUpdate();
      trackUpdate("download", "success");
      return { ok: true };
    } catch (error) {
      downloadStarted = false;
      installOnQuit.revoke();
      publishError(error, "download");
      trackUpdate("download", "failure", classifyUpdateError(error));
      return { ok: false };
    } finally {
      downloadInFlight = false;
    }
  });

  ipcMain.handle("nomi:update:install", (event) => {
    // 装更新会立刻重启整个应用，是最强的一条控制权。
    assertTrustedSender(event);
    // 连点「重启以更新」只触发一次；还没下好不装。
    if (installRequested || currentUpdaterState().phase !== "downloaded") return { ok: false };
    installRequested = true;
    stage = "install";
    installOnQuit.markInstallStarted();
    trackUpdate("install", "success");
    // 立即重启并安装（非静默）。mac 未签名会被 Gatekeeper 拦——降级实况以真机为准。
    setImmediate(() => {
      try {
        void loadAutoUpdater()
          // ESLint exemption (eslint.config.mjs directQuitExemptionFiles): electron-updater 6.8.9
          // BaseUpdater.quitAndInstall spawns the installer then calls app.quit(); MacUpdater hands
          // off to Squirrel, which closes windows then app.quit(). Both re-enter the quit owner.
          .then((autoUpdater) => autoUpdater.quitAndInstall())
          .catch((error) => { installRequested = false; installOnQuit.markInstallFailed(); publishError(error, "install"); });
      } catch (error) {
        installRequested = false;
        installOnQuit.markInstallFailed();
        publishError(error, "install");
      }
    });
    return { ok: true };
  });
}
