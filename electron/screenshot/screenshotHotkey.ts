// 全局截图热键：应用没在前台时也能按一下把屏幕抓进画布。
//
// 用户 2026-08-02 拍板 **默认关**：全局热键会抢占用户在别的软件里的按键、macOS 还要「屏幕录制」系统权限，
// 装完就默认占一组键 + 弹权限框太打扰。开关和键都在设置里，随时改、随时关。
//
// 权限的诚实交付（R5 查过官方文档，别凭记忆）：
// - `systemPreferences.getMediaAccessStatus('screen')` 能查状态；
// - **`askForMediaAccess` 只支持 'microphone' / 'camera'，不支持 'screen'** —— 屏幕录制**没法程序化申请**，
//   只能指路系统设置。所以未授权时必须给人话 + 一键跳「系统设置 > 隐私与安全性 > 屏幕录制」，
//   绝不静默失败（按了没反应是最糟的形态）。
//
// 另一个官方文档明说的坑：`globalShortcut.register` 在**键已被别的应用占用时会静默失败**、只返回 false。
// 所以注册结果必须回给 UI，让用户知道「这组键没抢到，换一个」。
import { app, desktopCapturer, globalShortcut, screen, shell, systemPreferences } from "electron";
import path from "node:path";
import { getSettingsRoot, ensureDir, readJson } from "../runtimePaths";
import { writeJsonFileAtomic } from "../jsonFile";
import { getMainWindow } from "../mainWindowRegistry";
import { writeAsset } from "../runtime";
import { logError } from "../logging/logger";

const PREFS_FILE = "screenshot-hotkey-prefs.json";

export type ScreenshotHotkeyPrefs = {
  enabled: boolean;
  accelerator: string;
};

/** 默认键 ⌥⇧Q：避开 ⌘⇧Q（macOS 注销）、⌘⇧3/4/5（系统截图）这些已被占死的组合。 */
export const DEFAULT_SCREENSHOT_HOTKEY: ScreenshotHotkeyPrefs = {
  enabled: false,
  accelerator: "Alt+Shift+Q",
};

export function normalizeScreenshotHotkeyPrefs(value: unknown): ScreenshotHotkeyPrefs {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const accelerator = typeof raw.accelerator === "string" ? raw.accelerator.trim() : "";
  return {
    enabled: raw.enabled === true,
    accelerator: accelerator || DEFAULT_SCREENSHOT_HOTKEY.accelerator,
  };
}

function prefsPath(): string {
  return path.join(getSettingsRoot(), PREFS_FILE);
}

export function readScreenshotHotkeyPrefs(): ScreenshotHotkeyPrefs {
  return normalizeScreenshotHotkeyPrefs(readJson<unknown>(prefsPath(), DEFAULT_SCREENSHOT_HOTKEY));
}

export function writeScreenshotHotkeyPrefs(next: unknown): ScreenshotHotkeyPrefs {
  const normalized = normalizeScreenshotHotkeyPrefs(next);
  try {
    ensureDir(getSettingsRoot());
    writeJsonFileAtomic(prefsPath(), normalized);
  } catch {
    /* best-effort：写不进去也不该让设置面板崩 */
  }
  return normalized;
}

export type ScreenshotHotkeyStatus = {
  enabled: boolean;
  accelerator: string;
  /** 键真的抢到了吗（被别的应用占用时 register 静默返回 false）。 */
  registered: boolean;
  /** macOS 屏幕录制权限：granted / denied / restricted / not-determined / unknown。 */
  screenAccess: string;
};

/** 当前已注册的那一组键——改键时要先撤掉旧的，否则会越积越多。 */
let registeredAccelerator = "";

export function screenAccessStatus(): string {
  if (process.platform !== "darwin") return "granted";
  try {
    return systemPreferences.getMediaAccessStatus("screen");
  } catch {
    return "unknown";
  }
}

function unregisterCurrent(): void {
  if (!registeredAccelerator) return;
  try {
    globalShortcut.unregister(registeredAccelerator);
  } catch {
    /* 已经没了也无所谓 */
  }
  registeredAccelerator = "";
}

/** 按当前设置装/卸热键。设置改动、启动、退出都走它（单一装卸点）。 */
export function applyScreenshotHotkey(prefs?: ScreenshotHotkeyPrefs): ScreenshotHotkeyStatus {
  const config = prefs ?? readScreenshotHotkeyPrefs();
  unregisterCurrent();
  let registered = false;
  if (config.enabled && config.accelerator) {
    try {
      registered = globalShortcut.register(config.accelerator, () => {
        void captureScreenToCanvas().catch((error) => {
          logError("screenshot", "capture-failed", error);
        });
      });
    } catch {
      registered = false;
    }
    if (registered) registeredAccelerator = config.accelerator;
  }
  return {
    enabled: config.enabled,
    accelerator: config.accelerator,
    registered,
    screenAccess: screenAccessStatus(),
  };
}

/** 这组键现在真注册着吗（被别的应用抢走时 isRegistered 也返回 false）。 */
export function isScreenshotHotkeyRegistered(accelerator: string): boolean {
  if (!accelerator) return false;
  try {
    return globalShortcut.isRegistered(accelerator) && registeredAccelerator === accelerator;
  } catch {
    return false;
  }
}

export function disposeScreenshotHotkey(): void {
  unregisterCurrent();
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* 退出路径，best-effort */
  }
}

/** 指路系统设置的屏幕录制页（macOS 没法程序化申请这项权限，只能带用户过去）。 */
export async function openScreenRecordingSettings(): Promise<void> {
  if (process.platform !== "darwin") return;
  await shell
    .openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
    .catch(() => {
      /* 打不开就算了，UI 上已经写清了路径 */
    });
}

/** 抓「鼠标所在那块屏」——多显示器下抓主屏是错的，用户正看着的才是他要的。 */
function displayUnderCursor(): Electron.Display {
  const point = screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(point);
}

export type ScreenshotCapture = {
  /** 整屏原图（nomi-local:// 项目素材）。选区在渲染层做（见 ScreenshotCropOverlay）。 */
  url: string;
  width: number;
  height: number;
};

/**
 * 抓屏 → 落项目素材 → 通知渲染层开选区面板。
 * 抓的是**整块屏**：选区交给渲染层做，这样用户能看清、能重选、能取消，而不是在一层看不清的浮层上盲拖。
 */
export async function captureScreenToCanvas(): Promise<void> {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;

  const access = screenAccessStatus();
  if (access !== "granted") {
    // 未授权：给人话 + 指路，绝不静默什么都不发生。
    win.webContents.send("nomi:screenshot:denied", { screenAccess: access });
    win.show();
    win.focus();
    return;
  }

  const display = displayUnderCursor();
  const scale = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    // 按物理像素要图，否则 Retina 上拿到的是半分辨率的糊图。
    thumbnailSize: {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale),
    },
  });
  const source =
    sources.find((candidate) => String(candidate.display_id) === String(display.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    win.webContents.send("nomi:screenshot:failed", { reason: "empty" });
    return;
  }

  const size = source.thumbnail.getSize();
  const projectId = currentProjectIdForCapture();
  if (!projectId) {
    win.webContents.send("nomi:screenshot:failed", { reason: "no-project" });
    win.show();
    win.focus();
    return;
  }

  const record = writeAsset(
    projectId,
    source.thumbnail.toPNG(),
    `screenshot-${Date.now()}.png`,
    "image/png",
    { kind: "generated", source: "screen-capture" },
  ) as { data?: { url?: string } };
  const url = record?.data?.url;
  if (!url) {
    win.webContents.send("nomi:screenshot:failed", { reason: "write" });
    return;
  }

  win.show();
  win.focus();
  win.webContents.send("nomi:screenshot:captured", { url, width: size.width, height: size.height });
}

/** 抓屏时用哪个项目落素材——由渲染层在项目切换时报上来（主进程不自己猜当前项目）。 */
let activeProjectId = "";
export function setScreenshotProjectId(projectId: string): void {
  activeProjectId = String(projectId || "").trim();
}
function currentProjectIdForCapture(): string {
  return activeProjectId;
}

app.on("will-quit", () => {
  // 不撤会一直占着用户的全局键（哪怕 Nomi 已经退了）。
  disposeScreenshotHotkey();
});
